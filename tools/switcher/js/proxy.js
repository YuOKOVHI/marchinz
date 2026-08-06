"use strict";
/* ============ プロキシ(取り込んだ素材の縮小版) ============

   4K素材を4Kのまま合成に流していたのをやめる仕組み(2026-08-06 優さん指示
   「4Kとかは ①縦型では1080×640に ②自動スイッチングではFHDに」)。

   なぜ効くか ─ 書き出しの重さは**合成が91%**(iPhone実機 v1.70.0: 52.3秒中40.6秒、
   exporter.js の注記)。その合成の中で、入力の画素数がそのまま効く場所が2つある:
     ・colormatch.js の texImage2D は**元フレームを丸ごとGPUへ上げる**
       (SCALE_LADDER が縮めるのはレンダー先だけで、ここには効かない)
     ・generateMipmap も毎コマ、元の大きさで走る
   加えて VideoFrame 1枚が 12.4MB(4K) → 1.09MB(1138x640) になり、
   3カメラぶんのGPUメモリが 260MB → 23MB へ落ちる。

   設計の背骨 ─ **プロキシは純粋な高速化キャッシュで、正しさは一切依存しない**。
   作れなかった・途中でやめた・レイアウトを変えられた・範囲がずれた、
   のすべてが `usable()` が false を返して元ファイルへ戻るだけで片づく。

   絶対に守ること:
   ①音声はプロキシから取らない(AAC priming と elst の基準が変わると、
     誰も気づかないまま数フレームずれた完成品が出る)
   ②`_opfsName`(未保存の成果物の保護)には入れない ─ プロキシは成果物ではない
   ③File はページ再読み込みをまたいで生き残らないので、プロキシは次の
     セッションでは使えない。掃除は短い据え置き(下の STALE_MS。同一セッションの
     別タブを守る)だけ残して消す
   ④クラッシュ後の「続きから」では、前半パート=プロキシ画質(FHD再エンコード)・
     後半=元画質の混在が起きる。これは許容 ─ exportJobId にプロキシ有無を
     入れるとリロード後に jobId が必ず変わり、再開機能そのものが死ぬ(2026-08-06) */

const MCproxy = {};
MC.proxy = MCproxy;

MC.proxy.PREFIX = "mzprox_";
MC.proxy.PAD_SEC = 1.5;        // トリムが後で微調整されても窓が生き残るための余白
MC.proxy.STALE_MS = 3600e3;    // 掃除の据え置き(同一セッションの**別タブ**の使用中を守る)
MC.proxy.BUDGET = 600e6;       // 3本ぶんの上限(超えたら効果の小さい素材から諦める)

/* 実測でしか決められない値はここへ集めて、URLで上書きできるようにする */
MC.proxy.TUNE = {
  alwaysBelow: 0.25,  // 画素がこれ以下まで落ちる素材(=4K級)だけ作る
  bpp: 0.09,          // ビットレート = 画素 × fps × これ
};

/* このタブが「今まさに使っている」プロキシの名前。掃除はこれ以外を消す */
MC.proxy._live = new Set();

/* 殺しスイッチ。?noproxy で全部止まり、素材は元ファイルのまま流れる */
MC.proxy.off = () => {
  try { return new URLSearchParams(location.search).has("noproxy"); }
  catch (_) { return false; }
};

/* ---------- この素材が「今」描かれる矩形(出力ピクセル) ----------
   ★ layout.js の drawComposite の分岐を1対1で写すこと。
     ずれると必要な解像度を取り違え、拡大されたぼけた絵が出る
     (neededIds が同じ規約を持っているのと同じ理由) */
MC.proxy.paneRects = clipId => {
  const L = MC.LAYOUTS[MC.S.layoutId];
  if (!L) return [];
  const { w: W, h: H } = MC.exporter.exportDims();
  const out = [];
  if (L.type === "wipe") {
    const main = MC.wipeMain();
    if (main === clipId) out.push({ w: W, h: H });
    const id1 = MC.wipePip1(main);
    const pw = W * MC.S.wipeSize, ph = pw * 9 / 16;
    if (id1 != null && id1 !== main && id1 === clipId) out.push({ w: pw, h: ph });
    if (MC.S.wipeClipId2 != null && MC.S.wipeClipId2 !== id1 &&
        MC.S.wipeClipId2 !== main && MC.S.wipeClipId2 === clipId) out.push({ w: pw, h: ph });
    return out;
  }
  if (L.type === "switch") {
    /* カット割りはまだ確定していないことがある(プロキシを作るのは解析の前)。
       どのカメラも全画面で出うるものとして扱う ─ 小さく見積もって
       拡大させるより、大きく見積もって効果を取り逃がすほうが安全 */
    const c = MC.getClip(clipId);
    if (c && !c.isImage && !c.isAudio) out.push({ w: W, h: H });
    return out;
  }
  /* 分割系。同じ素材が複数のスロットに入っていれば、その数だけ描かれる */
  L.rects.forEach((r, i) => {
    if (MC.S.slots[i] === clipId) out.push({ w: r.w * W, h: r.h * H });
  });
  return out;
};

/* ---------- プロキシの仕様。作らないなら null ---------- */
MC.proxy.specFor = clip => {
  if (MC.proxy.off()) return null;
  if (!clip || clip.isImage || clip.isAudio || !clip.file) return null;
  if (!clip.width || !clip.height || !clip.duration) return null;
  const panes = MC.proxy.paneRects(clip.id);
  if (!panes.length) return null;                   // 画面に出ない素材は変換しない

  /* 表示上の寸法(縦撮りは回転で入れ替わる)。drawSource / colormatch と同じ扱い */
  const rot = (((clip.rotation || 0) % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const sw = swapped ? clip.height : clip.width;
  const sh = swapped ? clip.width : clip.height;

  /* cover で埋めるのに要る倍率。いちばん大きな枠に合わせる */
  let need = 0;
  for (const p of panes) need = Math.max(need, Math.max(p.w / sw, p.h / sh));
  /* 水平補正は隅を隠すぶんズームするので、その余白を見込む(drawSource の z と同式) */
  if (MC.S.horizonOn && clip.rot) {
    const th = Math.abs(clip.rot * Math.PI / 180);
    need *= Math.max((sw * Math.cos(th) + sh * Math.sin(th)) / sw,
                     (sw * Math.sin(th) + sh * Math.cos(th)) / sh);
  }
  /* ★ ここで倍率に余裕(×1.02)を掛けてはいけない。4K→スイッチングは need=0.5 
     ちょうどなので、2%足すだけで 1958x1102 という半端な寸法になり、
     優さんの指定した「FHD」から外れる。足りなさは**寸法を偶数へ切り上げる**
     ことで防ぐ(cover は1pxでも足りないと拡大されるため、切り捨ては禁物) */
  need = Math.min(1, need);
  if (!(need > 0) || !isFinite(need)) return null;

  /* ★ 作るのは4K級(画素が1/4以下まで落ちる素材)だけ(2026-08-06 優さん実機)。
     当初は中間帯(1/4〜1/2)も損得の見積り式で通していたが、FHD×縦型3分割
     (画素35%)が「作る」判定になり、**FHD素材3本の再エンコード(数分)が
     おまかせの途中に割り込んだ**。しかもおまかせ画面のチェックリストに
     この工程の段が無く、表示は「色をそろえる」に丸が付いたまま止まって見えた。
     「FHDの優さんの環境では何も起きない」という約束が縦型で破れていた。
     見積り式は実測に裏付けが無い(gain=3.5は仮置き)ので、確実に得な
     4K級だけに絞る ─ 4K×スイッチング=25%、4K×縦型=8.8%はどちらも通る */
  const px = need * need;
  if (px > MC.proxy.TUNE.alwaysBelow) return null;

  /* 偶数へ切り上げ(H.264 のクロマが奇数を嫌う)。
     ※ clip.width/height は <video> の videoWidth/Height = **回転適用済みの表示寸法**。
       clip.rotation は現状誰も代入しない(常に undefined→rot=0)ので swap は
       発火しない ─ それで正しい。将来 clip.rotation を埋めるなら、表示寸法との
       二重スワップに注意(2026-08-06 レビューP2-6) */
  const even = v => Math.max(2, Math.ceil(v / 2) * 2);   // 切り上げ(足りないと拡大される)
  const w = even(clip.width * need), h = even(clip.height * need);
  if (w >= clip.width && h >= clip.height) return null;   // 縮まないなら意味がない

  const [tIn, tOut] = MC.trimRange();
  const off = clip.offset || 0;
  const t0 = Math.max(0, tIn - off - MC.proxy.PAD_SEC);
  const t1 = Math.min(clip.duration, tOut - off + MC.proxy.PAD_SEC);
  if (!(t1 - t0 > 1)) return null;

  const fps = MC.exporter.FPS || 30;
  const bitrate = Math.max(3e6, Math.min(12e6, Math.round(w * h * fps * MC.proxy.TUNE.bpp)));
  return { w, h, scale: need, bitrate, t0, t1, srcW: clip.width, srcH: clip.height, rot };
};

/* ---------- いま持っているプロキシを使ってよいか ----------
   ★ ここが唯一の門。false なら黙って元ファイルを使う(エラーにしない) */
MC.proxy.usable = clip => {
  if (MC.proxy.off()) return false;
  const P = clip && clip.proxy;
  if (!P || !P.file) return false;
  const now = MC.proxy.specFor(clip);
  /* いま作る価値が無い(= 枠が大きくなった)なら、持っている物も足りない可能性がある。
     拡大が起きないことを実際の倍率で確かめる */
  const needNow = now ? now.scale : MC.proxy._scaleNeeded(clip);
  if (needNow == null) return false;
  if (needNow > P.scale * 1.02) return false;        // 拡大が起きる = 使わない
  const [tIn, tOut] = MC.trimRange();
  const off = clip.offset || 0;
  /* 先頭側に甘さを持たせない(2026-08-06 レビューP2-2)。P.t0 より手前の
     フレームはプロキシに存在しないので、0.05秒の許容がそのまま黒コマになる */
  if (tIn - off < P.t0 - 0.001 || tOut - off > P.t1 + 0.05) return false;  // 窓の外
  return true;
};

/* specFor がゲートで null を返した場合でも「必要な倍率」だけは知りたい */
MC.proxy._scaleNeeded = clip => {
  const panes = MC.proxy.paneRects(clip.id);
  if (!panes.length) return null;
  const rot = (((clip.rotation || 0) % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const sw = swapped ? clip.height : clip.width;
  const sh = swapped ? clip.width : clip.height;
  let need = 0;
  for (const p of panes) need = Math.max(need, Math.max(p.w / sw, p.h / sh));
  return Math.min(1, need * 1.02);
};

/* ---------- 後片付け ---------- */
MC.proxy.dispose = clip => {
  const P = clip && clip.proxy;
  if (!P) return;
  clip.proxy = null;
  if (P.name) {
    MC.proxy._live.delete(P.name);
    MC.exporter.opfsRemove(P.name).catch(() => {});
  }
};
MC.proxy.disposeAll = () => {
  for (const c of MC.S.clips) MC.proxy.dispose(c);
};

/* ---------- 1本ぶんの変換 ----------
   exporter の _exportVideoPart から、複数カメラ・drawComposite・ライブ表示・
   ウォーターマークを外したもの。ここは**1本の素材を縮めて書き直すだけ**。
   音声は入れない(muxer に audio を渡さない) ─ 音は必ず元ファイルから取る */
MC.proxy.build = async (clip, spec, prog) => {
  const name = MC.proxy.PREFIX + MC.proxy._key(clip, spec) + ".mp4";
  const t0 = performance.now();
  const opfs = await MC.exporter.opfsCreate(name);
  if (!opfs) return null;
  MC.proxy._live.add(name);
  let src = null, dec = null, venc = null, ok = false;
  try {
    src = new MZ_MP4.MP4Source(clip.file);
    await src.init();
    const vt = src.videoTrack();
    if (!vt) throw new Error("映像トラックがありません");
    const cfg = src.videoDecoderConfig();
    const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!sup.supported) throw new Error("デコード非対応: " + cfg.codec);
    /* 元の回転は**ここで焼き込む**。書き出す側は rotation=0 として素直に読める */
    const rot = src.rotationOf(vt);
    const tsOff = src.editOffsetSec(vt) || 0;

    const muxer = new Mp4Muxer.Muxer({
      target: opfs.target,
      video: { codec: "avc", width: spec.w, height: spec.h },
      fastStart: false,
    });
    let vencErr = null;
    venc = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); } catch (e) { vencErr = vencErr || e; }
      },
      error: e => { vencErr = e; },
    });
    /* ★ fps は決め打ちしない(2026-08-06 レビューP2-1)。60fps素材で30を仮定すると
       ビットレート予算が半分(画質半減)・進捗が2倍速で100%に張り付く */
    let fps = 30;
    try {
      const d = vt.duration / vt.timescale;
      if (d > 0 && vt.nb_samples > 1) fps = Math.min(120, Math.max(10, Math.round(vt.nb_samples / d)));
    } catch (_) {}
    const bitrate = Math.max(3e6, Math.min(12e6, Math.round(spec.bitrate * fps / 30)));
    const baseCfg = { codec: "avc1.640028", width: spec.w, height: spec.h,
                      bitrate, framerate: fps };
    let vcfg = { ...baseCfg, hardwareAcceleration: "prefer-hardware" };
    try {
      const s = await MC.exporter.withTimeout(
        VideoEncoder.isConfigSupported(vcfg), 15000, "縮小版の形を決める処理");
      if (!s || !s.supported) vcfg = baseCfg;
    } catch (_) { vcfg = baseCfg; }
    venc.configure(vcfg);

    const canvas = MC.exporter.makeCanvas(spec.w, spec.h);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";

    /* 元素材を素直に読み下す。合成もカット割りも無いので、
       出てきたフレームをそのまま縮めて詰めるだけ */
    const cursor = src.cursor(vt.id);
    cursor.seek(Math.max(0, spec.t0 + tsOff));
    const frames = [];
    dec = new VideoDecoder({
      output: f => frames.push(f),
      error: e => { vencErr = vencErr || e; },
    });
    dec.configure(cfg);
    let needKey = true, eof = false, wrote = 0;
    /* ★ 1コマ目の実時刻。muxer は既定(strict)で「先頭チャンクの ts は 0」を
       要求して throw する(2026-08-06 レビューP0)。spec.t0 は任意の実数で、
       フレーム格子に乗らないため t0>0 だと先頭 ts が必ず非0になり、
       **トリム開始が素材先頭から1.5秒より奥=おまかせの主戦場で、
       プロキシが一度も作られないまま無言で素通し**していた。
       実際に書いた1コマ目を基準(コンテナ0)にし、その値を t0 として返す ─
       読む側(VideoPipe の tsOff=-t0)は返した t0 しか見ないので整合する */
    let baseSec = null;
    const total = Math.max(1, Math.round((spec.t1 - spec.t0) * fps));

    while (!eof || frames.length) {
      if (MC.exporter.cancelFlag || MC.ui._autoCancel) throw new Error("キャンセルしました");
      if (vencErr) throw vencErr;
      /* 読み込み: デコーダとフレームの水位を見ながら足す */
      while (!eof && dec.decodeQueueSize < 6 && frames.length < 4) {
        const { value: s, done } = await cursor.next();
        if (done) { eof = true; break; }
        if (needKey && !s.is_sync) continue;    // 設定直後はキーフレームから
        needKey = false;
        dec.decode(new EncodedVideoChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: Math.round(s.cts / s.timescale * 1e6),
          duration: Math.round(s.duration / s.timescale * 1e6),
          data: s.data,
        }));
      }
      if (!frames.length) {
        if (eof) { await dec.flush().catch(() => {}); if (!frames.length) break; }
        else { await MC.yield(); continue; }
      }
      const f = frames.shift();
      const fSec = f.timestamp / 1e6 - tsOff;
      if (fSec < spec.t0 - 0.001) { f.close(); continue; }       // 窓の手前は捨てる
      if (fSec > spec.t1 + 0.001) { f.close(); eof = true; break; }
      if (baseSec === null) baseSec = fSec;
      while (venc.encodeQueueSize > 6) {
        if (MC.exporter.cancelFlag || MC.ui._autoCancel) throw new Error("キャンセルしました");
        await MC.waitDequeue(venc);
      }
      while ((MC.exporter._pendCount || 0) > 3) {
        if (MC.exporter.cancelFlag || MC.ui._autoCancel) throw new Error("キャンセルしました");
        await MC.yield();
      }
      /* 回転を焼き込みながら縮小。以後この素材は rotation=0 で扱える */
      ctx.save();
      ctx.translate(spec.w / 2, spec.h / 2);
      if (rot) ctx.rotate(rot * Math.PI / 180);
      const swapped = rot === 90 || rot === 270;
      const dw = swapped ? spec.h : spec.w, dh = swapped ? spec.w : spec.h;
      ctx.drawImage(f, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      f.close();
      const vf = new VideoFrame(canvas, {
        timestamp: Math.max(0, Math.round((fSec - baseSec) * 1e6)),
        duration: Math.round(1e6 / fps),
      });
      try { venc.encode(vf, { keyFrame: wrote % fps === 0 }); }   // GOP1秒(再シークを軽く)
      catch (e) { vf.close(); throw e; }
      vf.close();
      wrote++;
      if (prog && wrote % 10 === 0) prog(Math.min(1, wrote / total));
      if (wrote % 10 === 0) await MC.yield();
    }
    for (const f of frames) f.close();
    frames.length = 0;
    await venc.flush();
    if (vencErr) throw vencErr;
    muxer.finalize();
    const file = await MC.exporter.opfsFinalizeWorker(name);
    if (!file || !file.size) throw new Error("縮小版が空でした");
    if (baseSec === null) throw new Error("範囲内に1コマも無かった");
    ok = true;
    const ms = Math.round(performance.now() - t0);
    MC.log(`proxy: ${clip.name} → ${spec.w}x${spec.h} `
      + `${(file.size / 1e6).toFixed(0)}MB ${wrote}コマ ${ms}ms`);
    MC.proxy.lastBuildMs = (MC.proxy.lastBuildMs || 0) + ms;
    return { file, name, w: spec.w, h: spec.h, scale: spec.scale,
             t0: baseSec, t1: spec.t1, bytes: file.size, buildMs: ms };
  } catch (e) {
    MC.log(`proxy: ${clip.name} の縮小版を作れませんでした(元のまま進みます): `
      + ((e && e.message) || e));
    return null;
  } finally {
    try { if (dec && dec.state !== "closed") dec.close(); } catch (_) {}
    try { if (venc && venc.state !== "closed") venc.close(); } catch (_) {}
    if (!ok) {
      MC.proxy._live.delete(name);
      try { await MC.exporter.opfsAbortWorker(); } catch (_) {}
      MC.exporter.opfsRemove(name).catch(() => {});
    }
  }
};

/* ファイル名。素材と寸法と窓が変われば別の名前になる */
MC.proxy._key = (clip, spec) => {
  const s = `${clip.name}|${clip.file && clip.file.size}|${clip.file && clip.file.lastModified}`;
  let hn = 5381;
  for (let i = 0; i < s.length; i++) hn = ((hn * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${hn.toString(36)}_${spec.w}x${spec.h}_${Math.round(spec.t0)}_${Math.round(spec.t1)}`;
};

/* ---------- 3本ぶんをまとめて用意する ----------
   ★ 直列。同時に走らせるとデコーダ3本+エンコーダ3本になり、
     いま避けている状態そのものになる */
MC.proxy.ensureAll = async (p, stepNo) => {
  if (MC.proxy.off()) return;
  /* 書き出し中は絶対に走らせない(2026-08-06 レビューP2-7)。OPFSのwriterは
     1本しか持てず、並走すると即破壊。UI層(_busy)の慣習に頼らず自衛する */
  if (MC.exporter.running || MC.exporter.recording) return;
  if (!MC.exporter.opfsSupported || !MC.exporter.opfsSupported()) return;
  const targets = [];
  for (const c of MC.S.clips) {
    if (MC.proxy.usable(c)) continue;          // 使える物を既に持っている
    MC.proxy.dispose(c);                       // 古い物は捨ててから
    const spec = MC.proxy.specFor(c);
    if (spec) targets.push({ clip: c, spec });
  }
  if (!targets.length) return;

  /* 容量。**完成品の見込みも足してから**判断する ─
     プロキシで埋めて書き出し本体が入らなくなるのが最悪 */
  let budget = MC.proxy.BUDGET;
  try {
    const est = await navigator.storage.estimate();
    if (est && isFinite(est.quota)) {
      const free = est.quota - (est.usage || 0) - (MC.exporter.estimateBytes() || 0) * 1.15;
      budget = Math.min(budget, Math.max(0, free * 0.5));
    }
  } catch (_) {}
  /* 得の大きい順に、予算に入るぶんだけ */
  targets.sort((a, b) => a.spec.scale - b.spec.scale);
  const plan = [];
  let sum = 0;
  for (const t of targets) {
    const bytes = (t.spec.t1 - t.spec.t0) * t.spec.bitrate / 8;
    if (sum + bytes > budget) {
      MC.log(`proxy: 容量が足りないので ${t.clip.name} は元のまま使います`);
      continue;
    }
    sum += bytes; plan.push(t);
  }
  if (!plan.length) return;

  let i = 0;
  for (const t of plan) {
    i++;
    if (p) p.step(stepNo, `映像を軽くしています…(${i}/${plan.length})`)
            .pulse(`映像を軽くしています…(${i}/${plan.length})`);
    /* おまかせ画面のチェックリストにも同じ進捗を流す(2026-08-07 レビューP0)。
       MZPドックは全画面の下に隠れており、ここへ流さないと変換の数分間
       バーが止まって見える */
    if (MC.ui && MC.ui.autoStage) {
      MC.ui.autoStage.step("proxy", `${i} / ${plan.length} 本目`);
    }
    const r = await MC.proxy.build(t.clip, t.spec, fr => {
      if (p) p.pulse(`映像を軽くしています…(${i}/${plan.length})`,
                     { sub: `${Math.round(fr * 100)}%` });
      if (MC.ui && MC.ui.autoStage) MC.ui.autoStage.progress((i - 1 + fr) / plan.length);
    });
    if (r) t.clip.proxy = r;
  }
};
