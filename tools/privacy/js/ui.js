"use strict";
/* ============ UI配線 ============ */

MZ.ui = {};
const $ = id => document.getElementById(id);

MZ.ui.toast = msg => {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(MZ.ui._toastTm);
  MZ.ui._toastTm = setTimeout(() => el.classList.remove("show"), 4000);
};

MZ.ui.fmtTime = s => {
  s = Math.max(0, s || 0);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

MZ.ui.setStatus = (txt, ready) => {
  const el = $("statusPill");
  el.textContent = txt;
  el.classList.toggle("ready", !!ready);
};

MZ.ui.fmtSize = bytes =>
  bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1e3))}KB`;

MZ.ui.isImageFile = f =>
  /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name);
MZ.ui.isVideoFile = f =>
  /video|quicktime/.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);

MZ.ui.disposeClip = () => {
  const c = MZ.S.clip;
  if (!c) return;
  MZ.preview.stop();
  if (c.video) { try { c.video.pause(); } catch (e) {} c.video.remove(); }
  if (c.img && c.img.close) { try { c.img.close(); } catch (e) {} }
  URL.revokeObjectURL(c.url);
  MZ.S.clip = null;
  MZ.S.manualBoxes = [];
};

MZ.ui._enterEditor = (name, kind) => {
  document.body.dataset.kind = kind;
  $("dropSection").hidden = true;
  $("editorSection").hidden = false;
  $("doneCard").hidden = true;
  $("clipName").textContent = name;
  $("exportBtn").textContent = kind === "image"
    ? "モザイクをかけて画像を保存" : "モザイクをかけて動画を保存";
  MZ.ui.setStep(1);
};

/* ---- 範囲選択フェーズ(60秒超・インスタ風トリム) ---- */
MZ.ui.enterRangePhase = () => {
  const clip = MZ.S.clip;
  document.body.dataset.kind = "video";
  $("dropSection").hidden = true;
  $("editorSection").hidden = true;
  $("rangeSection").hidden = false;
  MZ.S.rangeStart = 0;
  MZ.S.rangeDur = Math.min(15, clip.duration);   // 初期は15秒ぶん
  // 範囲プレビューのキャンバスをクリップ比率に
  const cv = $("rangeCanvas");
  const s = Math.min(1, 640 / Math.max(clip.width, clip.height));
  cv.width = Math.max(2, Math.round(clip.width * s));
  cv.height = Math.max(2, Math.round(clip.height * s));
  MZ.ui._updateRangeUi(false);
  void MZ.ui._buildStrip();   // フィルムストリップ生成(完了後に選択フレーム表示)
};

/* ラベルと選択窓を現在の範囲に合わせて描き直す。seekVideo=大プレビューのフレームも更新 */
MZ.ui._updateRangeUi = (seekVideo, whichEnd) => {
  const clip = MZ.S.clip;
  if (!clip) return;
  const end = MZ.rangeEnd();
  $("rangeLabel").textContent =
    `${MZ.ui.fmtTime(MZ.S.rangeStart)} 〜 ${MZ.ui.fmtTime(end)}（${Math.round(end - MZ.S.rangeStart)}秒）`;
  // 選択窓とシェードの位置(%)
  const l = (MZ.S.rangeStart / clip.duration) * 100;
  const w = ((end - MZ.S.rangeStart) / clip.duration) * 100;
  $("trimWindow").style.left = `${l}%`;
  $("trimWindow").style.width = `${w}%`;
  $("trimShadeL").style.left = "0";
  $("trimShadeL").style.width = `${l}%`;
  $("trimShadeR").style.left = `${l + w}%`;
  $("trimShadeR").style.width = `${Math.max(0, 100 - l - w)}%`;
  if (seekVideo) MZ.ui._requestFrame(whichEnd === "r" ? end : MZ.S.rangeStart);
};

/* 大プレビューへのフレーム表示要求(常に最新の要求だけを実行) */
MZ.ui._requestFrame = t => {
  MZ.ui._framePending = t;
  if (MZ.ui._frameBusy || MZ.ui._stripBusy) return;
  MZ.ui._frameBusy = true;
  const v = MZ.S.clip.video;
  const step = () => {
    const want = MZ.ui._framePending;
    MZ.ui._framePending = null;
    v.onseeked = () => {
      const cv = $("rangeCanvas");
      MZ.drawFrame(cv.getContext("2d"), v, v.videoWidth, v.videoHeight, 0, cv.width, cv.height);
      if (MZ.ui._framePending != null) step();
      else { v.onseeked = null; MZ.ui._frameBusy = false; }
    };
    v.currentTime = want;
  };
  step();
};

/* フィルムストリップ: 動画から10コマを等間隔で抜き出して並べる(インスタ風) */
MZ.ui._buildStrip = async () => {
  const clip = MZ.S.clip;
  const strip = $("stripCanvas");
  const host = $("trimStrip");
  const N = 10;
  const gen = (MZ.ui._stripGen = (MZ.ui._stripGen || 0) + 1);
  MZ.ui._stripBusy = true;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.max(2, Math.round(host.clientWidth * dpr));
  const ch = Math.max(2, Math.round(host.clientHeight * dpr));
  strip.width = cw; strip.height = ch;
  const ctx = strip.getContext("2d");
  ctx.fillStyle = "#1a2029";
  ctx.fillRect(0, 0, cw, ch);
  const v = clip.video;
  const tileW = cw / N;
  try {
    for (let i = 0; i < N; i++) {
      if (gen !== MZ.ui._stripGen || !MZ.S.clip) return;   // 中断(別素材へ)
      const t = clip.duration * (i + 0.5) / N;
      await new Promise(res => {
        v.onseeked = () => { v.onseeked = null; res(); };
        v.currentTime = t;
        setTimeout(res, 1200);   // シークが返らない環境への保険
      });
      if (gen !== MZ.ui._stripGen || !MZ.S.clip) return;
      // コマをカバー配置(縦を合わせて中央を切り出し)
      const vw = v.videoWidth, vh = v.videoHeight;
      const scale = ch / vh;
      const sw = Math.min(vw, tileW / scale);
      ctx.drawImage(v, (vw - sw) / 2, 0, sw, vh, i * tileW, 0, tileW, ch);
    }
  } finally {
    if (gen === MZ.ui._stripGen) {
      MZ.ui._stripBusy = false;
      // 生成完了後、選択位置のフレームを大プレビューへ
      if (MZ.S.clip) MZ.ui._requestFrame(MZ.ui._framePending != null ? MZ.ui._framePending : MZ.S.rangeStart);
    }
  }
};

/* 選択窓のドラッグ(インスタ同様: 左右の取っ手で伸縮・枠の中で移動・外側タップでジャンプ) */
MZ.ui._wireTrim = () => {
  const host = $("trimStrip");
  const MIN = 10, MAX = 60;
  let mode = null, x0 = 0, s0 = 0, d0 = 0;
  host.addEventListener("pointerdown", e => {
    const clip = MZ.S.clip;
    if (!clip) return;
    const rect = host.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const handle = e.target.closest("[data-trim]");
    const end = MZ.rangeEnd();
    if (handle) {
      mode = handle.dataset.trim;   // "l" | "r"
    } else {
      const inWin = frac * clip.duration >= MZ.S.rangeStart && frac * clip.duration <= end;
      if (!inWin) {
        // 窓の外タップ: 窓の中心をそこへジャンプ(インスタと同じ)
        MZ.S.rangeStart = Math.max(0, Math.min(clip.duration - MZ.S.rangeDur,
          frac * clip.duration - MZ.S.rangeDur / 2));
      }
      mode = "move";
    }
    x0 = e.clientX; s0 = MZ.S.rangeStart; d0 = MZ.S.rangeDur;
    host.setPointerCapture(e.pointerId);
    MZ.ui._updateRangeUi(true, mode === "r" ? "r" : "l");
    e.preventDefault();
  });
  host.addEventListener("pointermove", e => {
    const clip = MZ.S.clip;
    if (!mode || !clip) return;
    const rect = host.getBoundingClientRect();
    const dt = (e.clientX - x0) / rect.width * clip.duration;
    if (mode === "move") {
      MZ.S.rangeStart = Math.max(0, Math.min(clip.duration - d0, s0 + dt));
    } else if (mode === "l") {
      const end = s0 + d0;   // 右端は固定
      const ns = Math.max(Math.max(0, end - MAX), Math.min(end - MIN, s0 + dt));
      MZ.S.rangeStart = ns;
      MZ.S.rangeDur = end - ns;
    } else {   // "r": 左端は固定
      const ne = Math.max(s0 + MIN, Math.min(Math.min(clip.duration, s0 + MAX), s0 + d0 + dt));
      MZ.S.rangeDur = ne - s0;
    }
    MZ.ui._updateRangeUi(true, mode === "r" ? "r" : "l");
    e.preventDefault();
  });
  const up = e => {
    if (!mode) return;
    mode = null;
    try { host.releasePointerCapture(e.pointerId); } catch (err) {}
    MZ.ui._updateRangeUi(true, "l");   // 離したら開始位置のフレームへ戻す
  };
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
};

/* 範囲確定→エディタへ(シークバーを範囲にマッピング) */
MZ.ui.enterEditorWithRange = () => {
  const clip = MZ.S.clip;
  $("rangeSection").hidden = true;
  MZ.ui._enterEditor(clip.name, "video");
  const end = MZ.rangeEnd();
  $("seekBar").min = String(MZ.S.rangeStart);
  $("seekBar").max = String(end);
  $("seekBar").value = String(MZ.S.rangeStart);
  clip.video.currentTime = MZ.S.rangeStart;
  $("reRangeBtn").hidden = clip.duration <= 60;
  MZ.preview.setClip(clip);
  MZ.ui.updateTime();
};

/* ---- ステップウィザード(1:確認 / 2:調整 / 3:保存) ---- */
MZ.ui.setStep = n => {
  n = Math.max(1, Math.min(3, n | 0));
  MZ.S.step = n;
  document.querySelectorAll("#stepper [data-step]").forEach(b => {
    const bn = parseInt(b.dataset.step, 10);
    b.classList.toggle("on", bn === n);
    b.classList.toggle("done", bn < n);
  });
  $("panelStep1").hidden = n !== 1;
  $("panelStep2").hidden = n !== 2;
  $("panelStep3").hidden = n !== 3;
};

/* ①ステップの検出状態カード(モデル準備 → 現在の検出人数をライブ表示) */
MZ.ui.updateDetectStatus = () => {
  const el = $("detectStatus");
  if (!el || !MZ.S.clip) return;
  el.classList.remove("ok", "ng", "busy");
  if (!MZ.detect.detector) {
    el.classList.add("busy");
    el.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 顔検出AIを準備しています…';
    return;
  }
  const n = (MZ.preview.boxes || []).length;
  if (n > 0) {
    el.classList.add("ok");
    el.innerHTML = `<i class="fa-solid fa-circle-check"></i> いまの画面で ${n} 人の顔にモザイクをかけています。`;
  } else {
    el.classList.add("ng");
    el.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> いまの画面では顔が見つかっていません。顔が映る位置に再生・シークして確認してください。';
  }
};

/* ---- プレビューのタップでマスクを追加/削除 ----
   ①手動マスクの上 → そのマスクを削除(トグル)
   ②タップ周辺を高倍率で顔検出 → 見つかれば追跡マスクとして追加
   ③見つからなければ、その場所に固定マスクを追加(検出ボックスの平均サイズ) */
MZ.ui.onCanvasTap = e => {
  const clip = MZ.S.clip;
  if (!clip || MZ.exporter.running) return;
  const cv = $("previewCanvas");
  const r = cv.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width;
  const ny = (e.clientY - r.top) / r.height;
  if (!isFinite(nx) || !isFinite(ny) || nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

  // ① 手動マスクのトグル削除
  const hit = MZ.S.manualBoxes.findIndex(b =>
    nx > b.x - b.w * 0.2 && nx < b.x + b.w * 1.2 && ny > b.y - b.h * 0.2 && ny < b.y + b.h * 1.2);
  if (hit >= 0) {
    MZ.S.manualBoxes.splice(hit, 1);
    MZ.ui.toast("タップしたマスクを外しました");
    MZ.preview.imageDirty = true;
    return;
  }
  // 自動検出済みの顔の上は何もしない(既にかかっている)
  if ((MZ.preview.boxes || []).some(b =>
    nx > b.x && nx < b.x + b.w && ny > b.y && ny < b.y + b.h)) return;

  // ② 周辺を高倍率で検出
  const src = clip.kind === "image" ? clip.img : clip.video;
  const rw = clip.kind === "image" ? clip.width : clip.video.videoWidth;
  const rh = clip.kind === "image" ? clip.height : clip.video.videoHeight;
  let found = null;
  try { found = MZ.detect.probeAt(src, rw, rh, 0, nx, ny); } catch (err) { MZ.log("probeAt:", err.message); }
  if (found) {
    if (clip.kind === "image") {
      MZ.preview.boxes.push(found);
    } else {
      // 追跡トラックとして追加(以後は行進の動きにも追従)
      MZ.preview.tracker.tracks.push({
        id: MZ.preview.tracker.nextId++,
        box: { x: found.x, y: found.y, w: found.w, h: found.h },
        vx: 0, vy: 0, lastT: clip.video.currentTime, lastSeen: clip.video.currentTime,
        matched: true, matchedRecently: true,
      });
    }
    MZ.ui.toast("顔を見つけてマスクを追加しました");
    return;
  }
  // ③ 固定マスク(近くの検出サイズに合わせる。無ければ画面幅5%)
  const ref = (MZ.preview.boxes || [])[0];
  const w = ref ? ref.w : 0.05;
  const h = ref ? ref.h : 0.05 * (cv.width / cv.height);
  MZ.S.manualBoxes.push({ x: nx - w / 2, y: ny - h / 2, w, h });
  MZ.ui.toast("この場所にマスクを追加しました(もう一度タップで外せます)");
  MZ.preview.imageDirty = true;
};

/* ---- 読み込み: 拡張子/MIMEで写真・動画を振り分け ---- */
MZ.ui.loadFile = async file => {
  if (!file) throw new Error("ファイルがありません");
  MZ.ui.disposeClip();
  return MZ.ui.isImageFile(file) ? MZ.ui._loadImage(file) : MZ.ui._loadVideo(file);
};

MZ.ui._loadImage = async file => {
  const url = URL.createObjectURL(file);
  let img, W, H;
  try {
    // EXIF回転を反映(iPhone写真対策)。iOS17+はここで成功
    img = await createImageBitmap(file, { imageOrientation: "from-image" });
    W = img.width; H = img.height;
  } catch (e) {
    // HEIC/古いSafari等: <img>で読み込む(Safariは描画時にEXIF回転を自動適用)
    MZ.log("createImageBitmap失敗→<img>フォールバック:", e.message);
    img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error("この画像を読み込めません"));
      el.src = url;
    }).catch(err => { URL.revokeObjectURL(url); throw err; });
    W = img.naturalWidth; H = img.naturalHeight;
  }
  MZ.S.clip = { file, url, img, kind: "image", name: file.name, width: W, height: H };
  MZ.log(`loaded image: ${file.name} ${W}x${H}`);
  MZ.ui._enterEditor(file.name, "image");
  MZ.preview.setClip(MZ.S.clip);
};

MZ.ui._loadVideo = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.className = "hidden-video";
  document.body.appendChild(video);
  video.onerror = () => reject(new Error("この動画を再生できません"));
  video.onloadedmetadata = () => {
    if (video.duration > 600.5) {
      URL.revokeObjectURL(url);
      video.remove();
      reject(new Error(`動画は10分までです(この動画は${Math.round(video.duration / 60)}分)。短く切り出してからお試しください`));
      return;
    }
    MZ.S.clip = {
      file, url, video, kind: "video",
      name: file.name,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    MZ.log(`loaded video: ${file.name} ${video.videoWidth}x${video.videoHeight} ${video.duration.toFixed(1)}s`);
    if (video.duration > 60) {
      MZ.ui.enterRangePhase();
    } else {
      MZ.S.rangeStart = 0;
      MZ.S.rangeDur = video.duration;
      MZ.ui.enterEditorWithRange();
    }
    resolve();
  };
  video.src = url;
});

MZ.ui.updateTime = () => {
  const c = MZ.S.clip;
  if (!c || c.kind !== "video") return;
  const rs = c.duration > 60 ? MZ.S.rangeStart : 0;
  const re = c.duration > 60 ? MZ.rangeEnd() : c.duration;
  $("timeLabel").textContent =
    `${MZ.ui.fmtTime(Math.max(0, c.video.currentTime - rs))} / ${MZ.ui.fmtTime(re - rs)}`;
  if (!MZ.ui._seeking) $("seekBar").value = c.video.currentTime;
  $("playBtn").innerHTML = c.video.paused
    ? '<i class="fa-solid fa-play"></i> 再生'
    : '<i class="fa-solid fa-pause"></i> 一時停止';
};

/* ---- 書き出し ---- */
MZ.ui.startExport = async () => {
  if (MZ.exporter.running) return;
  const btn = $("exportBtn");
  btn.disabled = true;
  $("progressWrap").hidden = false;
  $("doneCard").hidden = true;
  if (MZ.S.clip.video) MZ.S.clip.video.pause();
  try {
    if (!MZ.detect.detector) {
      $("progressText").textContent = "顔検出モデルを準備中…";
      await MZ.detect.init();
    }
    const res = await MZ.exporter.run((p, txt) => {
      $("progressBar").style.width = `${Math.round(p * 100)}%`;
      $("progressText").textContent = txt;
    });
    MZ.ui.showDone(res);
  } catch (e) {
    MZ.log("export error:", e.message);
    MZ.ui.toast(e.message === "キャンセルしました" ? "書き出しを中止しました" : `⚠ ${e.message}`);
  } finally {
    btn.disabled = false;
    $("progressWrap").hidden = true;
    $("progressBar").style.width = "0%";
  }
};

/* 書き出し完了カードの表示。iOS(共有可)は「保存」ボタンのタップで初めて保存する */
MZ.ui.showDone = res => {
  const kindWord = MZ.S.clip && MZ.S.clip.kind === "image" ? "写真" : "動画";
  const share = MZ.exporter.shareMode();
  $("doneCard").hidden = false;
  $("saveBtn").innerHTML = share ? `<i class="fa-solid fa-arrow-up-from-bracket"></i> ${kindWord}を保存` : "もう一度保存";
  if (share) {
    $("doneText").textContent = `準備できました(${MZ.ui.fmtSize(res.blob.size)})`;
    $("doneNote").textContent = `「${kindWord}を保存」を押すと、共有シートから写真(カメラロール)やファイルに保存できます。`;
    MZ.ui.toast("✔ 準備できました。保存を押してください");
  } else {
    $("doneText").textContent = `「${res.name}」を保存しました(${MZ.ui.fmtSize(res.blob.size)})`;
    $("doneNote").textContent = "ダウンロードに保存されています。";
    MZ.ui.toast("✔ 書き出しが完了しました");
  }
};

/* 保存の実行。iOSはWeb Shareで写真/ファイルへ、それ以外はダウンロード */
MZ.ui.saveResult = async () => {
  const r = MZ.exporter.lastResult;
  if (!r) return;
  if (MZ.exporter.shareMode()) {
    try {
      const file = new File([r.blob], r.name, { type: r.type || r.blob.type });
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === "AbortError") return;         // ユーザーがキャンセル
      MZ.log("share失敗→ダウンロード:", e && e.message);
      MZ.exporter.triggerDownload(r.blob, r.name);        // 最後の手段
    }
  } else {
    MZ.exporter.triggerDownload(r.blob, r.name);
  }
};

/* ---- 起動 ---- */
window.addEventListener("DOMContentLoaded", async () => {
  MZ.preview.init();

  // ファイル選択+ドラッグ&ドロップ
  $("pickBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = e => { if (e.target.files[0]) MZ.ui.loadFile(e.target.files[0]).catch(err => MZ.ui.toast(`⚠ ${err.message}`)); };
  const dz = $("dropSection");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag");
    const f = [...e.dataTransfer.files].find(f => MZ.ui.isImageFile(f) || MZ.ui.isVideoFile(f));
    if (f) MZ.ui.loadFile(f).catch(err => MZ.ui.toast(`⚠ ${err.message}`));
    else MZ.ui.toast("動画または写真を入れてください");
  });

  // 再生コントロール
  const togglePlay = () => {
    const v = MZ.S.clip && MZ.S.clip.video;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  };
  $("playBtn").onclick = togglePlay;
  $("previewCanvas").addEventListener("click", e => MZ.ui.onCanvasTap(e));
  $("seekBar").addEventListener("input", e => {
    MZ.ui._seeking = true;
    if (MZ.S.clip) MZ.S.clip.video.currentTime = parseFloat(e.target.value);
  });
  $("seekBar").addEventListener("change", () => { MZ.ui._seeking = false; });
  setInterval(MZ.ui.updateTime, 250);

  // 設定
  const bindRange = (id, key, labelId, fmt) => {
    const el = $(id);
    el.addEventListener("input", () => {
      MZ.S[key] = parseFloat(el.value);
      $(labelId).textContent = fmt(MZ.S[key]);
    });
    el.value = MZ.S[key];
    $(labelId).textContent = fmt(MZ.S[key]);
  };
  bindRange("strengthRange", "strength", "strengthVal", v => `${v}`);
  bindRange("expandRange", "expand", "expandVal", v => `${v}%`);
  bindRange("holdRange", "hold", "holdVal", v => `${v.toFixed(1)}秒`);
  document.querySelectorAll("#typeSeg button").forEach(b => {
    b.onclick = () => {
      MZ.S.type = b.dataset.type;
      document.querySelectorAll("#typeSeg button").forEach(x => x.classList.toggle("on", x === b));
    };
  });
  $("deepChk").onchange = e => { MZ.S.deep = e.target.checked; MZ.preview.imageDirty = true; };
  $("deepChk").checked = MZ.S.deep;
  $("resSel").onchange = e => { MZ.S.res = e.target.value; };

  // 範囲選択フェーズ(インスタ風トリム)
  MZ.ui._wireTrim();
  $("rangeOkBtn").onclick = () => MZ.ui.enterEditorWithRange();
  $("rangeBackBtn").onclick = () => {
    MZ.ui.disposeClip();
    $("rangeSection").hidden = true;
    $("dropSection").hidden = false;
    $("fileInput").value = "";
  };
  $("reRangeBtn").onclick = () => {
    if (MZ.exporter.running) return MZ.ui.toast("書き出し中です");
    MZ.preview.stop();
    if (MZ.S.clip.video) MZ.S.clip.video.pause();
    $("editorSection").hidden = true;
    // 現在の範囲値を保ったまま選び直し画面へ
    $("rangeSection").hidden = false;
    MZ.ui._updateRangeUi(false);
    void MZ.ui._buildStrip();
  };

  // ステップウィザード
  document.querySelectorAll("#stepper [data-step]").forEach(b => {
    b.onclick = () => MZ.ui.setStep(parseInt(b.dataset.step, 10));
  });
  $("toStep2Btn").onclick = () => MZ.ui.setStep(2);
  $("toStep3Btn").onclick = () => MZ.ui.setStep(3);
  $("backTo1Btn").onclick = () => MZ.ui.setStep(1);
  $("backTo2Btn").onclick = () => MZ.ui.setStep(2);
  setInterval(() => { if (MZ.S.clip && MZ.S.step === 1) MZ.ui.updateDetectStatus(); }, 400);

  $("exportBtn").onclick = MZ.ui.startExport;
  $("saveBtn").onclick = MZ.ui.saveResult;
  $("cancelBtn").onclick = () => { MZ.exporter.cancelFlag = true; };
  $("backBtn").onclick = () => {
    if (MZ.exporter.running) return MZ.ui.toast("書き出し中です");
    MZ.ui.disposeClip();
    $("editorSection").hidden = true;
    $("rangeSection").hidden = true;
    $("doneCard").hidden = true;
    $("dropSection").hidden = false;
    $("fileInput").value = "";
  };

  // 能力チェック+検出モデル準備
  await MZ.exporter.probeCaps().catch(() => {});
  MZ.ui.setStatus("顔検出AIを準備中…", false);
  MZ.detect.init().then(() => {
    MZ.ui.setStatus(MZ.caps.h264 ? "準備OK(高速書き出し対応)" : "準備OK(実時間書き出し)", true);
  }).catch(e => {
    MZ.ui.setStatus("顔検出を読み込めませんでした", false);
    MZ.ui.toast(`⚠ 顔検出の初期化に失敗: ${e.message}`);
  });

  if (MZ.testMode) MZ.ui.runTest();
});

/* 自動検証(?test): test.mp4を読み込み→書き出し→/saveへPUT */
MZ.ui.runTest = async () => {
  try {
    await MZ.detect.init();
    const r = await fetch("test.mp4");
    if (!r.ok) throw new Error("test.mp4がありません");
    const b = await r.blob();
    await MZ.ui.loadFile(new File([b], "test.mp4", { type: "video/mp4" }));
    await new Promise(r2 => setTimeout(r2, 400));
    await MZ.ui.startExport();
    MZ.log("TEST DONE");
  } catch (e) {
    MZ.log("TEST FAILED:", e.message);
  }
};
