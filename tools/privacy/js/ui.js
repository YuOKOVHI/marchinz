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
    MZ.S.clip = {
      file, url, video, kind: "video",
      name: file.name,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    MZ.log(`loaded video: ${file.name} ${video.videoWidth}x${video.videoHeight} ${video.duration.toFixed(1)}s`);
    MZ.ui._enterEditor(file.name, "video");
    $("seekBar").max = video.duration;
    $("seekBar").value = 0;
    MZ.preview.setClip(MZ.S.clip);
    MZ.ui.updateTime();
    resolve();
  };
  video.src = url;
});

MZ.ui.updateTime = () => {
  const c = MZ.S.clip;
  if (!c || c.kind !== "video") return;
  $("timeLabel").textContent = `${MZ.ui.fmtTime(c.video.currentTime)} / ${MZ.ui.fmtTime(c.duration)}`;
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
  $("previewCanvas").onclick = togglePlay;
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
