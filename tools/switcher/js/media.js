"use strict";
/* ============ クリップ読み込み・メタデータ・サムネイル ============ */

MC.media = { nextId: 1 };

/* 中身の先頭バイトでコンテナ形式を見分ける。
   拡張子とMIMEは端末が勝手に付けるので信用できない。
   MP4/MOV以外は取り込みの時点で断る: 書き出しの最後で
   「解析できません」と言われるのが最悪のため(2026-07-22 広報レビュー) */
MC.media.sniffContainer = async f => {
  try {
    const buf = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    if (buf.length < 12) return { ok: false, kind: "壊れたファイル" };
    const tag = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
    // MP4/MOVは必ず「サイズ+アトム名」で始まる(古いMOVはftyp以外もある)
    if (["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot", "uuid"].includes(tag)) {
      return { ok: true };
    }
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return { ok: false, kind: "WebM/MKV形式" };
    }
    const head4 = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    if (head4 === "RIFF") return { ok: false, kind: "AVI形式" };
    if (head4 === "OggS") return { ok: false, kind: "Ogg形式" };
    return { ok: false, kind: "MP4/MOV以外の形式" };
  } catch (_) {
    return { ok: true };   // 読めなかったら従来どおり先へ(ここで足止めしない)
  }
};

MC.media.addFiles = async files => {
  if (MC.media._adding) {
    MC.ui.toast("いま選んだ動画を端末内に準備しています。終わってから追加してください");
    return;
  }
  MC.media._adding = true;
  const queue = Array.isArray(files) ? files : Array.from(files || []);
  if (MC.storageDiag) MC.storageDiag.beforeImport(queue);
  let added = 0;
  const skipped = [];   // 動画として扱えず見送ったファイル(最後にまとめて知らせる)
  let photoBlocked = 0; // おまかせに写真が混ざった数(最後に1行で知らせる)
  MC.media._importNote = null;   // 常設の断り書きは取り込みのたびに仕切り直す
  try {
  for (let fileIndex = 0; fileIndex < queue.length; fileIndex++) {
    let f = queue[fileIndex];
    if (!f) continue;
    const isImage = /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name);
    if (isImage) {
      /* ★ おまかせは動画のみ(2026-08-02 優さん指示「おまかせでは、写真は
         選べないようにしよう」)。accept は選択の窓しか守れず、ドラッグ&
         ドロップと「すべてを表示」はここへ届くので、取り込みの入口にも番人。
         黙って捨てず、ループ後に1行だけ知らせる。こだわり(proタブ)は従来どおり */
      if (MC.ui._autoFlow && MC.ui._setupTab !== "pro") { photoBlocked++; queue[fileIndex] = null; continue; }
      // 画像・写真は縦型動画作成でのみ取り込める
      if (MC.S.mode !== "vertical") { MC.ui.toast("画像・写真は「縦型動画作成」でのみ使えます"); queue[fileIndex] = null; continue; }
      if (await MC.media.addImageFile(f)) added++;
      queue[fileIndex] = null;
      continue;
    }
    /* ★ 黙って捨てない。ここを素通りさせていたため、学校のビデオカメラの
       AVCHD(.MTS)などをドロップすると**エラーも出ずに何も起きず**、
       「壊れている」と判断されて二度と開かれない(2026-07-31 顧問レビュー)。
       ドラッグ&ドロップは accept 属性を通らないので実際に起きる */
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v)$/i.test(f.name)) { skipped.push(f.name); queue[fileIndex] = null; continue; }
    const sniff = await MC.media.sniffContainer(f);
    if (!sniff.ok) { skipped.push(`${f.name}（${sniff.kind}）`); queue[fileIndex] = null; continue; }
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (MC.S.clips.some(c => MC.clipKey(c) === key)) { MC.ui.toast(`${f.name} は読み込み済みです`); queue[fileIndex] = null; continue; }
    if (MC.media.slotClips().length >= 3) { MC.ui.toast("素材は3つまでです"); break; }
    /* Safariから受け取ったFileはここより先へ渡さない。OPFSへ1本ずつ移し、
       サイズ検証後のFileを既存エンジンへ渡す。OPFSが使えない/失敗した端末は
       sourceStoreが元Fileを返すため、従来経路のまま続けられる。 */
    const original = { name: f.name, size: f.size, lastModified: f.lastModified, type: f.type };
    let lastPct = -10;
    MC.media._importProgress = { current: fileIndex + 1, total: queue.length, pct: 0 };
    if (MC.ui.renderClips) MC.ui.renderClips();
    const staged = MC.sourceStore ? await MC.sourceStore.stage(f, {
      source: fileIndex + 1,
      onProgress: ratio => {
        const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        if (pct < lastPct + 10 && pct !== 100) return;
        lastPct = pct;
        MC.media._importProgress = { current: fileIndex + 1, total: queue.length, pct };
        if (MC.ui.renderClips) MC.ui.renderClips();
      },
    }) : { file: f, storage: "file", name: "", fallback: true };
    queue[fileIndex] = null;
    f = null; // 以後、picker由来のFileをこの関数から参照しない
    if (!staged || staged.aborted || !staged.file) continue;
    const sourceFile = staged.file;
    const clip = {
      id: MC.media.nextId++, file: sourceFile,
      name: original.name, size: original.size, lastModified: original.lastModified,
      mimeType: original.type || sourceFile.type || "",
      sourceStorage: staged.storage, sourceOpfsName: staged.name || "",
      url: URL.createObjectURL(sourceFile),
      video: document.createElement("video"),
      duration: 0, width: 0, height: 0,
      offset: 0, confidence: null, syncMethod: "未同期",
      pan: 0.5, role: "auto", freq: "auto", rig: "auto",
      audio8k: null, stats: null, thumb: null, hasAudio: null,
    };
    const v = clip.video;
    v.src = clip.url; v.muted = true; v.playsInline = true;
    v.setAttribute("playsinline", "");  // iOS Safariは属性も必要
    v.preload = MC.isIOS ? "metadata" : "auto";  // iPhoneのメモリ節約
    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error("動画として読み込めません(コーデック非対応の可能性)"));
      });
    } catch (e) {
      MC.ui.toast(`⚠ ${original.name}: ${e.message}`);
      URL.revokeObjectURL(clip.url);
      clip.file = null; clip.video = null;
      if (MC.sourceStore) MC.sourceStore.releaseClip(clip);
      continue;
    }
    /* ★ 断るときは必ず逃げ道を添える(2026-08-05)。
       2026-07-31 の4団体レビューでは、ここで maxVideoSec(5分)を見ていたため
       8分半のランスルーを撮った人が「短く切り出してからお試しください」と
       言われ、その切り出す道具はツールの中に無い、という行き止まりだった。
       そこで一度は入口を技術的な天井(20分/40分)まで開けた。
       ★ 2026-08-05、優さんの決定で入口をプランの壁へ戻した(スマホ5分/PC15分)。
         つまり8分半のランスルーは**スマホでは通らない**。
         行き止まりに戻さないための条件は「断る」ことではなく
         **次にどうすればよいかを同時に言う**こと ─ スマホには
         「パソコンで開くと15分まで」を必ず添える。QAがこの一文を見張る */
    if (MC.media.tooLong(v.duration)) {
      /* ★ 「約5分は取り込めません ─ 5分まで」の自己矛盾を作らない(2026-08-06
         レビューP1)。上限超えで一番多いのは5分00〜29秒 ─ 分に丸めると
         上限と同じ数字になって嘘に見える。分+秒で実際の長さを言う */
      const durMin = Math.floor(v.duration / 60);
      let durSec = Math.round(v.duration % 60);
      const durLabel = durSec >= 60 ? `${durMin + 1}分`
        : `${durMin}分${durSec ? durSec + "秒" : ""}`;
      /* ★ 逃げ道は MZ_LIMITS.sourceUpgradeHint() に聞く(2026-08-05 レビュー反映)。
         以前はここで `MZ_LIMITS.mobile` だけを見て「パソコンで開くと15分まで」と
         直書きしていた ─ 15分になるのは**登録×パソコン**だけなので、
         ゲストには嘘だった(ゲストはパソコンでも5分)。さらに条件が mobile だけ
         だったため、**パソコンのゲストには逃げ道が1つも出ず**行き止まりだった。 */
      MC.ui.toast(`⚠ ${original.name} は${durLabel}です。`
        + `この端末で扱えるのは1本${MZ_LIMITS.sourceLimitLabel}までです。`
        + MZ_LIMITS.sourceUpgradeHint()
        + "長い録画は、先に前半・後半などに分けてからお試しください");
      /* ★ トーストは3.5秒で消える ─ まとめて選んだ人は理由を読み切れず、
         「なぜ入らなかったのか」だけが残る(2026-08-06 保護者レビューP0)。
         同じ内容+具体的な切り方を、取り込み枠の下に**消えない形**でも置く
         (描画は renderClips。次の取り込みで上書き・成功だけなら消える) */
      MC.media._importNote = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> `
        + `${MC.ui.esc(original.name)}（${durLabel}）は取り込めませんでした ─ `
        + `この端末で扱えるのは1本${MC.ui.esc(MZ_LIMITS.sourceLimitLabel)}までです。`
        + MC.ui.esc(MZ_LIMITS.sourceUpgradeHint())
        + `<b>短くするには:</b> iPhoneの写真アプリで動画を開き、`
        + `「編集」で黄色い枠の端をドラッグ → ✓ →「ビデオを保存」を選択`;
      URL.revokeObjectURL(clip.url);
      clip.file = null; clip.video = null;
      if (MC.sourceStore) MC.sourceStore.releaseClip(clip);
      continue;
    }
    clip.duration = v.duration;
    clip.width = v.videoWidth;
    clip.height = v.videoHeight;
    clip.restored = MC.restoreClipState(clip);
    MC.S.clips.push(clip);
    if (MC.storageDiag) MC.storageDiag.clipLoaded(clip);
    added++;
    MC.media.makeThumb(clip);  // 非同期・完了後にカード再描画
  }
  /* まとめて1回だけ知らせる(1本ごとにトーストを出すと、まとめて選んだ人の
     画面が流れて何も読めない) */
  if (skipped.length) {
    const head = skipped.length === 1 ? skipped[0] : `${skipped[0]} ほか${skipped.length - 1}件`;
    MC.ui.toast(`⚠ ${head} は動画として読み込めませんでした。`
      + "iPhoneやカメラで撮った MP4 / MOV をお使いください"
      + "（ビデオカメラのAVCHD(.MTS)は、カメラの設定をMP4記録に変えると使えます）");
  }
  if (photoBlocked) {
    MC.ui.toast("おまかせでは写真は使えません（動画のみ）。写真はこだわりでどうぞ");
  }
  if (added) MC.media.afterChange();
  /* 何も足せず断り書きだけが立ったときも描き直す ─ afterChange が走らないと
     renderClips が呼ばれず、常設の断り書きが画面に出ない */
  else if (MC.media._importNote && MC.ui.renderClips) MC.ui.renderClips();
  } finally {
    queue.fill(null);
    MC.media._adding = false;
    MC.media._importProgress = null;
    if (MC.ui.renderClips) MC.ui.renderClips();
  }
};

/* 入口の門番。**技術的な天井(maxSourceSec)**だけを見る ─ プランの壁
   (maxVideoSec)を見てはいけない(門前払いに戻る)。1つの関数にしてあるのは、
   QAがこの判定を直接叩いて、Drive巻き戻りで1行だけ旧版に戻る事故を
   捕まえられるようにするため(2026-07-31 5巡目P1) */
MC.media.tooLong = sec => sec > MZ_LIMITS.maxSourceSec;

/* スロット(動画1/2/3)に入る素材 = 音声のみ以外 */
MC.media.slotClips = () => MC.S.clips.filter(c => !c.isAudio);

/* 画像・写真クリップ(縦型のみ)。duration=0でタイムライン長には影響させず、常に表示できる素材 */
MC.media.addImageFile = f => new Promise(resolve => {
  const key = `${f.name}|${f.size}|${f.lastModified}`;
  if (MC.S.clips.some(c => MC.clipKey(c) === key)) { MC.ui.toast(`${f.name} は読み込み済みです`); return resolve(false); }
  if (MC.media.slotClips().length >= 3) { MC.ui.toast("素材は3つまでです"); return resolve(false); }
  const nImg = MC.S.clips.filter(c => c.isImage).length;
  if (nImg + 1 > MZ_LIMITS.maxPhotos) { MC.ui.toast(`写真は一度に${MZ_LIMITS.maxPhotos}枚までです`); return resolve(false); }
  const img = new Image();
  const url = URL.createObjectURL(f);
  img.onload = () => {
    const clip = {
      id: MC.media.nextId++, file: f,
      name: f.name, size: f.size, lastModified: f.lastModified,
      url, img, isImage: true, video: null,
      duration: 0, width: img.naturalWidth, height: img.naturalHeight,
      offset: 0, confidence: null, syncMethod: "静止画",
      pan: 0.5, role: "auto",
      audio8k: null, stats: null, thumb: null, hasAudio: false,
    };
    // サムネイル
    const cv = document.createElement("canvas");
    cv.width = 168; cv.height = 100;
    const s = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
    cv.getContext("2d").drawImage(img, (cv.width - img.naturalWidth * s) / 2,
      (cv.height - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    clip.thumb = cv.toDataURL("image/jpeg", 0.7);
    MC.S.clips.push(clip);
    MC.media.afterChange();
    resolve(true);
  };
  img.onerror = () => {
    MC.ui.toast(`⚠ ${f.name}: 画像として読み込めません`);
    URL.revokeObjectURL(url);
    resolve(false);
  };
  img.src = url;
});

/* 別録り音源の取り込み(addAudioFile)は廃止(2026-07-24 優さん指示)。
   音声はカメラの中から「音声を選ぶ」フェーズで選ぶ */

MC.media.makeThumb = async clip => {
  const v = clip.video;
  try {
    v.currentTime = Math.min(3, clip.duration * 0.1);
    await new Promise((res, rej) => { v.onseeked = res; v.onerror = rej; setTimeout(res, 3000); });
    const cv = document.createElement("canvas");
    cv.width = 168; cv.height = 100;
    const s = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    cv.getContext("2d").drawImage(v, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    clip.thumb = cv.toDataURL("image/jpeg", 0.7);
    v.currentTime = 0;
  } catch (e) { /* サムネ失敗は無視 */ }
  MC.ui.renderClips();
  /* 取り込みが終わったら、そのまま**軽い動き判定**まで進める(2026-08-06 優さん実機
     「取り込み時に自動判定されていない」)。素材の確認画面は本解析より前に出るので、
     ここで測らないと2軸の選択肢は永久に「自動判定」のまま。
     ・失敗しても取り込みは成功のまま(判定は付加価値)
     ・1本ずつ順番に(同時に走らせると seek が競合し、端末も重くなる) */
  MC.media.queueQuick(clip);
};

/* 軽い判定を1本ずつ順番に流す(同時に走らせると seek が競合し、端末も重くなる) */
MC.media.queueQuick = clip => {
  MC.media._quickQueue = (MC.media._quickQueue || Promise.resolve())
    .then(() => MC.visual.quickProbe(clip))
    .then(q => { if (q) { clip.quickVisual = q; MC.ui.renderClips(); } })
    .catch(() => {});
};

/* 容量診断で「アプリ側が握っている素材参照を外した後」を測る前の待ち合わせ。
   quickProbe は同じ video/File を一時的に持つため、キューが終わる前に外したとは
   名乗らない。15秒で終わらない場合は診断側が中断を報告し、無理に破棄しない。 */
MC.media.waitForIdle = (ms = 15000) => new Promise(resolve => {
  const q = (MC.media._quickQueue || Promise.resolve()).then(() => true, () => true);
  const t = setTimeout(() => resolve(false), Math.max(0, Number(ms) || 0));
  q.then(ok => { clearTimeout(t); resolve(ok); });
});

/* ★ 見送られた軽い判定を、手が空いたときに拾い直す(2026-08-07 未解決P2)。
   quickProbe は 再生中・おまかせ中・書き出し中 は黙って見送る。ところが
   本解析は director(mode==="switch")からしか走らないので、縦型・ワイプでは
   見送られた素材の2軸が**二度と**測られず「自動判定」のまま固定される ─
   狙いだった縦型ユーザーがいちばん当たる帯だった。
   ・拾うのは _quickTried の無い素材だけ(測って駄目だった素材は拾わない)
   ・仕上げ画面はここから描き直さない ─ 本人が選んでいる最中の値を
     axisInitial 経由で巻き戻す危険がある(ui.js の renderClips 注記と同じ罠)。
     finishAxesMap は画面を開くたびに作り直すので、次に開けば反映される
   ・QUICK_MAX_TRY は無限ループの保険(引き金は本人の操作なので通常1回で足りる) */
MC.media.QUICK_MAX_TRY = 8;
MC.media.retryQuick = () => {
  if (!window.MC || !MC.visual || !MC.visual.quickProbe) return 0;
  /* 手が空いているときだけ。塞がっていれば次の引き金に任せる ─
     ここで積むと、見送られて _quickRetry だけが減る */
  if (MC.S && MC.S.playing) return 0;
  if (MC.ui && MC.ui._busy) return 0;
  if (MC.exporter && (MC.exporter.running || MC.exporter.recording)) return 0;
  const todo = ((MC.S && MC.S.clips) || []).filter(c =>
    c && !c.isImage && !c.isAudio && c.video
    && !c._quickTried && !c.visual && !c.quickVisual
    && (c._quickRetry || 0) < MC.media.QUICK_MAX_TRY);
  for (const c of todo) { c._quickRetry = (c._quickRetry || 0) + 1; MC.media.queueQuick(c); }
  return todo.length;
};

MC.media.removeClip = (id, opt = {}) => {
  const i = MC.S.clips.findIndex(c => c.id === id);
  if (i < 0) return;
  MC.ui.resetEasyDone();   // 素材が変わったら「書き出すだけ」状態を解除
  const c = MC.S.clips[i];
  /* 背景はプレビューと別のvideo/Object URLを使う。素材参照を切る前に、
     背景専用URLだけを確実に破棄する。clip.urlはbackground側で触らない。 */
  if (window.MC && MC.background) MC.background.detachClip(c.id);
  try { c.video.pause(); } catch (e) {}
  if (window.MC && MC.proxy) MC.proxy.dispose(c);   // 縮小版も一緒に片付ける
  URL.revokeObjectURL(c.url);
  /* OPFSエントリだけ先に消しても、File/VideoがBlobを握ったままでは実容量が
     回収されない。参照を切ってから素材ストアへ削除を頼む。 */
  c.file = null; c.video = null; c.url = "";
  if (window.MC && MC.sourceStore) MC.sourceStore.releaseClip(c);
  MC.S.clips.splice(i, 1);
  MC.S.slots = MC.S.slots.map(s => (s === id ? null : s));
  if (MC.S.audioClipId === id) MC.S.audioClipId = null;
  if (MC.S.refClipId === id) MC.S.refClipId = null;
  if (MC.S.wipeMainId === id) MC.S.wipeMainId = null;
  if (MC.S.wipeClipId === id) MC.S.wipeClipId = null;
  if (MC.S.wipeClipId2 === id) MC.S.wipeClipId2 = null;
  if (!opt.deferAfterChange) MC.media.afterChange(opt);
};

/* クリップ増減後の既定値決め: スロット自動割当・レイアウト・音声・基準 */
MC.media.afterChange = (opt = {}) => {
  const slotClips = MC.media.slotClips();   // 音声のみを除いた素材(動画・画像)
  const n = slotClips.length;
  // 空スロットへ未割当クリップを順に入れる(音声のみはスロットに入れない)。
  // 空きが無ければ「同じ素材の2回目」(2素材時の上下同一の複製)を新しい素材で置き換える
  const assigned = new Set(MC.S.slots.filter(x => x != null));
  slotClips.forEach(c => {
    if (assigned.has(c.id)) return;
    let idx = MC.S.slots.findIndex(s => s == null);
    if (idx < 0) {
      const seen = new Set();
      for (let i = 0; i < MC.S.slots.length; i++) {
        if (seen.has(MC.S.slots[i])) { idx = i; break; }
        seen.add(MC.S.slots[i]);
      }
    }
    if (idx >= 0) { MC.S.slots[idx] = c.id; assigned.add(c.id); }
  });
  // レイアウト既定: 縦型は3分割縦積みが基本。素材2つなら一番上と下を同じにする
  const allowSplit = MC.ui.modeConf().layouts.includes("single");
  const cutMode = ["switch", "wipe"].includes(MC.S.layoutId);
  if (allowSplit && !cutMode) {
    if (n === 1) MC.S.layoutId = "single";
    else if (n === 2) {
      if (!["v2", "v3", "big2"].includes(MC.S.layoutId)) MC.S.layoutId = "v3";
      /* ★ おまかせ×縦型×2本(2026-08-02 優さん指示)。
         「最初に選んだのをセンター。2つめを上下に」= 3段の中央=1本目/上下=2本目。
         従来は slots[2]=slots[0] の複製だけで [1本目,2本目,1本目] になり、
         中央に来るのは**2本目**だった(指示と上下が逆)。
         こだわり(proタブ)は従来どおり自由選択なので触らない。
         判定は media.addFiles の写真の門番と同じ2条件に揃える */
      if (MC.S.layoutId === "v3" && MC.ui._autoFlow && MC.ui._setupTab !== "pro") {
        MC.S.slots = [slotClips[1].id, slotClips[0].id, slotClips[1].id];
      } else if (MC.S.layoutId === "v3" && MC.S.slots[2] == null) {
        MC.S.slots[2] = MC.S.slots[0];
      }
    } else if (n >= 3 && !["v3", "big2"].includes(MC.S.layoutId)) MC.S.layoutId = "v3";
  }
  const firstVideo = MC.S.clips.find(c => !c.isImage);   // 音声既定は音の出る素材から
  // stats が揃うまでの暫定。解析後は renderAudio が「おすすめ」に差し替える
  if (MC.S.audioClipId == null && firstVideo) MC.S.audioClipId = firstVideo.id;
  if (MC.S.refClipId == null && firstVideo) MC.S.refClipId = firstVideo.id;
  if (MC.S.wipeMainId == null && firstVideo) MC.S.wipeMainId = firstVideo.id;   // ワイプのメイン既定(2026-07-24)
  if (MC.S.wipeClipId == null && n) {
    const sub = slotClips.find(c => c.id !== MC.S.wipeMainId) || slotClips[0];
    MC.S.wipeClipId = sub.id;   // 小窓1の既定=メイン以外の先頭
  }
  /* 小窓2の既定(2026-08-02 優さん指示: こだわりのワイプは ①メイン ②右下 ③左下)。
     動画が3本そろったら、残りの1本を左下(wipePos2の既定="bl")の小窓2へ。
     2本以下なら従来どおり右下のみ(nullのまま)。手で「（なし）」へ戻した場合も、
     素材が増減したときだけここで入り直す(描画は layout.js の既存 wipeClipId2 経路) */
  if (MC.S.wipeClipId2 == null && n >= 3) {
    const third = slotClips.find(c => !c.isImage
      && c.id !== MC.S.wipeMainId && c.id !== MC.S.wipeClipId);
    if (third) MC.S.wipeClipId2 = third.id;
  }
  MC.restoreCutList();
  MC.restoreTrim();
  MC.preview.applyMute();
  MC.saveState();
  /* 前回と同じ動画が戻ってきたなら、演奏の範囲(showIn/showOut)は捨てない。
     渡さずに呼んでいたため、直前の restoreTrim() が戻した値を
     この行が消し、次の保存で localStorage ごと壊していた(2026-07-31) */
  MC.ui.resetEasyDone(MC.restoreInfo.trim || MC.restoreInfo.cuts);
  MC.ui.renderAll();
  if (window.MC && MC.background) MC.background.refresh();
  /* 診断の「素材参照を外す」は、全素材を捨てることだけが目的。
     その最中に自走・仕上げダイアログを予約させない。 */
  if (!opt.suppressNextAction) MC.ui.focusNextAction();
  /* 何がどこまで戻ったかを、実際の結果だけで伝える。
     以前は cutList の有無だけを見て「書き出し範囲も復元」と言っており、
     事実と違うことがあった(2026-07-21 レビュー指摘) */
  MC.restoreInfo.sync = MC.S.clips.filter(c => c.restored).length;
  MC.ui.renderRestoreNote();
};
