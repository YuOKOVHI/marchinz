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
     セッションで原理的に使えない。だから起動時の掃除は**据え置き窓を無視して消す** */

const MCproxy = {};
MC.proxy = MCproxy;

MC.proxy.PREFIX = "mzprox_";
MC.proxy.PAD_SEC = 1.5;        // トリムが後で微調整されても窓が生き残るための余白
MC.proxy.BUDGET = 600e6;       // 3本ぶんの上限(超えたら効果の小さい素材から諦める)

/* 実測でしか決められない値はここへ集めて、URLで上書きできるようにする */
MC.proxy.TUNE = {
  minShrink: 0.5,     // 画素がこの比より小さくならないなら作らない(need*need で判定)
  alwaysBelow: 0.25,  // 画素がこれ以下まで落ちるなら、条件を問わず作る
  minGain: 1.3,     // 見込みの得がこれ未満なら作らない
  colorGain: 3.5,   // 色そろえONのとき、GL転送+mipmapが効く倍率の見積り
  bpp: 0.09,        // ビットレート = 画素 × fps × これ
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

  /* 画素が半分にもならないなら、変換にかけた時間を取り戻せない */
  const px = need * need;
  if (px > MC.proxy.TUNE.minShrink) return null;

  /* ★ 画素が1/4以下まで落ちるなら、条件を問わず作る(2026-08-06)。
     4K×縦型v3 は 8.8% まで落ちる ─ ここを「色そろえOFFだから」と見送るのは
     明らかに損。得を計算で見極めるのは**中間帯(1/4〜1/2)だけ**にする。
     中間帯では、描かれる回数と色そろえの有無が効き幅を左右する */
  if (px > MC.proxy.TUNE.alwaysBelow) {
    const gain = panes.length * (MC.S.colorOn ? MC.proxy.TUNE.colorGain : 1)
               + (MC.LAYOUTS[MC.S.layoutId].type === "switch" ? 1 : 0);
    if (gain * (1 - px) < MC.proxy.TUNE.minGain) return null;
  }

  /* 実ピクセル(回転前)へ戻して偶数へ。H.264 のクロマが奇数を嫌う */
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
  if (tIn - off < P.t0 - 0.05 || tOut - off > P.t1 + 0.05) return false;  // 窓の外
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
    const fps = 30;
    const baseCfg = { codec: "avc1.640028", width: spec.w, height: spec.h,
                      bitrate: spec.bitrate, framerate: fps };
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
      while (venc.encodeQueueSize > 6) await MC.waitDequeue(venc);
      while ((MC.exporter._pendCount || 0) > 3) await MC.yield();
      /* 回転を焼き込みながら縮小。以後この素材は rotation=0 で扱える */
      const fw = f.displayWidth || f.codedWidth, fh = f.displayHeight || f.codedHeight;
      ctx.save();
      ctx.translate(spec.w / 2, spec.h / 2);
      if (rot) ctx.rotate(rot * Math.PI / 180);
      const swapped = rot === 90 || rot === 270;
      const dw = swapped ? spec.h : spec.w, dh = swapped ? spec.w : spec.h;
      ctx.drawImage(f, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      f.close();
      const vf = new VideoFrame(canvas, {
        timestamp: Math.round((fSec - spec.t0) * 1e6), duration: Math.round(1e6 / fps),
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
    ok = true;
    const ms = Math.round(performance.now() - t0);
    MC.log(`proxy: ${clip.name} → ${spec.w}x${spec.h} `
      + `${(file.size / 1e6).toFixed(0)}MB ${wrote}コマ ${ms}ms`);
    MC.proxy.lastBuildMs = (MC.proxy.lastBuildMs || 0) + ms;
    return { file, name, w: spec.w, h: spec.h, scale: spec.scale,
             t0: spec.t0, t1: spec.t1, bytes: file.size, buildMs: ms };
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
    const r = await MC.proxy.build(t.clip, t.spec, fr => {
      if (p) p.pulse(`映像を軽くしています…(${i}/${plan.length})`,
                     { sub: `${Math.round(fr * 100)}%` });
    });
    if (r) t.clip.proxy = r;
  }
};
