"use strict";
/* ============ UI配線 ============ */

RA.ui = {};
const $ = id => document.getElementById(id);

RA.ui.toast = msg => {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(RA.ui._toastTm);
  RA.ui._toastTm = setTimeout(() => el.classList.remove("show"), 4000);
};

RA.ui.fmtTime = s => {
  s = Math.max(0, s || 0);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

RA.ui.setStatus = (txt, ready) => {
  const el = $("statusPill");
  el.textContent = txt;
  el.classList.toggle("ready", !!ready);
};

RA.ui.fmtSize = bytes =>
  bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1e3))}KB`;

RA.ui.isVideoFile = f =>
  /video|quicktime/.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);

RA.ui.disposeClip = () => {
  const c = RA.S.clip;
  if (!c) return;
  RA.preview.stop();
  if (c.video) { try { c.video.pause(); } catch (e) {} c.video.remove(); }
  URL.revokeObjectURL(c.url);
  RA.S.clip = null;
  RA.S.corners = null;
};

/* ---- 読み込み ---- */
RA.ui.loadFile = file => {
  if (!file) return Promise.reject(new Error("ファイルがありません"));
  if (!RA.ui.isVideoFile(file)) return Promise.reject(new Error("動画ファイルを選んでください"));
  RA.ui.disposeClip();
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.muted = false;
    video.crossOrigin = "anonymous";
    video.className = "hidden-video";
    document.body.appendChild(video);
    video.onerror = () => reject(new Error("この動画を再生できません"));
    video.onloadedmetadata = () => {
      if (video.duration > MZ_LIMITS.maxVideoSec) {
        URL.revokeObjectURL(url);
        video.remove();
        reject(new Error(`この動画は約${Math.round(video.duration / 60)}分です。`
          + (MZ_LIMITS.member ? "動画は12分までです。" : "ゲストは5分・無料登録で12分まで使えます。")
          + "見せたい場面だけ短く切り出してからお試しください"));
        return;
      }
      RA.S.clip = {
        file, url, video,
        name: file.name,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      RA.log(`loaded: ${file.name} ${video.videoWidth}x${video.videoHeight} ${video.duration.toFixed(1)}s`);
      $("dropSection").hidden = true;
      $("editorSection").hidden = false;
      $("doneCard").hidden = true;
      $("clipName").textContent = file.name;
      $("seekBar").max = video.duration;
      $("seekBar").value = 0;
      RA.preview.setClip(RA.S.clip);
      RA.ui.setStep(1);
      RA.ui.updateTime();
      // rAFはバックグラウンドタブで発火しないためsetTimeoutで(レイアウト確定後に実行)
      setTimeout(() => {
        RA.corners.resize();
        RA.ui.autoDetect().then(resolve, resolve);
      }, 0);
    };
    video.src = url;
  });
};

/* 床の自動検出(初期配置)。冒頭のままなら床が見やすい位置へ少しシークしてから走らせる。
   ユーザーが自分でシークしていた場合はそのフレームで検出する(「演技者が少ない
   フレームにシークすると合わせやすい」のヒントどおりに使えるように) */
RA.ui.autoDetect = async () => {
  const c = RA.S.clip;
  if (!c) return;
  RA.ui.setDetectStatus("busy");
  const v = c.video;
  const t = v.currentTime > 0.2 ? v.currentTime : Math.min(1.0, c.duration * 0.1);
  if (Math.abs(v.currentTime - t) > 0.05) {
    v.currentTime = t;
    await new Promise(r => {
      const done = () => { v.removeEventListener("seeked", done); r(); };
      v.addEventListener("seeked", done);
      setTimeout(done, 1500);
    });
  }
  let q = null;
  try { q = RA.detect.floorQuad(v); } catch (e) { RA.log("detect error:", e.message); }
  RA.S.corners = q || RA.presetCorners();
  RA.corners.draw();
  RA.ui.setDetectStatus(q ? "ok" : "ng");
};

RA.ui.updateTime = () => {
  const c = RA.S.clip;
  if (!c) return;
  $("timeLabel").textContent = `${RA.ui.fmtTime(c.video.currentTime)} / ${RA.ui.fmtTime(c.duration)}`;
  if (!RA.ui._seeking) $("seekBar").value = c.video.currentTime;
  $("playBtn").innerHTML = c.video.paused
    ? '<i class="fa-solid fa-play"></i> 再生'
    : '<i class="fa-solid fa-pause"></i> 一時停止';
};

/* ---- ステップウィザード(1:四角 / 2:調整 / 3:保存) ---- */
RA.ui.setStep = n => {
  n = Math.max(1, Math.min(3, n | 0));
  RA.S.step = n;
  RA.S.editCorners = n === 1;   // 四角合わせ中だけ無補正ソース+ハンドル表示
  $("panelStep1").hidden = n !== 1;
  $("panelStep2").hidden = n !== 2;
  $("panelStep3").hidden = n !== 3;
  RA.corners.draw();
  if (n === 2) setTimeout(() => RA.ui.buildPresetThumbs(), 60);  // 補正表示に切り替わってから
  if (window.MZJourney) MZJourney.refresh();   // ジャーニーバーへ即時反映
};

/* ---- ジャーニーバー(動画→四角→見え方→保存 の現在地表示) ---- */
/* stickyプレビューがジャーニーバーの下に潜らないよう、実高さをCSS変数へ */
RA.ui.trackJourneyHeight = () => {
  const bar = document.querySelector(".mzj");
  if (!bar) return;
  const apply = () => document.documentElement.style.setProperty("--mzj-h", `${Math.ceil(bar.getBoundingClientRect().height) + 6}px`);
  apply();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(apply).observe(bar);
  window.addEventListener("orientationchange", () => setTimeout(apply, 300));
};

RA.ui.initJourney = () => {
  MZJourney.init({
    container: document.querySelector("main"),
    phases: [
      { id: "pick",    label: "動画",         hint: "斜めから撮った動画を選んでください" },
      { id: "corners", label: "四角を合わせる", hint: "床の四角を合わせるほど仕上がりがきれいです" },
      { id: "tune",    label: "見え方",       hint: "補正の強さ・見せ方を整えます" },
      { id: "save",    label: "保存",         hint: "「書き出して保存」を押してください" },
    ],
    doneHint: "保存できました。続けて別の動画もどうぞ",
    autoState: () => {
      if ($("editorSection").hidden) return { current: "pick", done: [] };
      const map = { 1: "corners", 2: "tune", 3: "save" };
      const done = ["pick"];
      if (RA.S.step >= 2) done.push("corners");
      if (RA.S.step >= 3) done.push("tune");
      if (!$("doneCard").hidden) done.push("save");
      return { current: map[RA.S.step] || "corners", done };
    },
    canSelect: id => id !== "pick" && $("editorSection").hidden === false,
    onSelect: id => RA.ui.setStep({ corners: 1, tune: 2, save: 3 }[id]),
  });
};

/* 自動検出の状態表示(①ステップ内) */
RA.ui.setDetectStatus = state => {
  const el = $("detectStatus");
  if (!el) return;
  el.classList.remove("ok", "ng", "busy");
  if (state === "busy") {
    el.classList.add("busy");
    el.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 床の四角を自動検出しています…';
  } else if (state === "ok") {
    el.classList.add("ok");
    el.innerHTML = '<i class="fa-solid fa-circle-check"></i> 自動検出しました。ズレていたら青い点をドラッグして直せます。';
  } else {
    el.classList.add("ng");
    el.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> 自動では見つかりませんでした。青い点を床の四隅に合わせてください。明るい場面にシークして「自動検出をやり直す」と見つかることもあります。';
  }
};

/* カラープリセットのサムネイル生成。
   メインのWebGLレンダラで各プリセットを実描画→小canvasへ縮小コピーするので、
   サムネ=実際の適用結果と完全一致する。最後に現在の設定へ戻す */
RA.ui.buildPresetThumbs = () => {
  const clip = RA.S.clip;
  const host = $("presetRow");
  if (!clip || !host || !RA.preview.renderer) return;
  const glCanvas = $("previewCanvas");
  if (!glCanvas.width) return;
  const off = RA.S.compare || RA.S.editCorners;
  const M = RA.H.buildMatrix({
    corners: RA.S.corners || RA.presetCorners(),
    sMain: off ? 0 : (RA.S.viewMode === "top" ? 1 : RA.S.sMain),
    sPersp: off ? 0 : (RA.S.viewMode === "top" ? RA.S.sTop : 0),
    tilt: off ? 0 : RA.S.tilt,
    viewX: off ? 0 : RA.S.viewX,
    zoom: off ? 1 : RA.S.zoom,
    panY: off ? 0 : RA.S.panY,
    dispW: clip.width, dispH: clip.height,
  });
  RA.preview.renderer.upload(clip.video);
  host.querySelectorAll(".preset-item").forEach(item => {
    const id = item.dataset.preset;
    const thumb = item.querySelector("canvas");
    if (!thumb) return;
    // preserveDrawingBuffer:false でも「render直後の同期drawImage」なら確実に取れる
    RA.preview.renderer.render(M, { ...RA.fx(id), sharp: 0 });
    thumb.getContext("2d").drawImage(glCanvas, 0, 0, thumb.width, thumb.height);
  });
  RA.preview.renderer.render(M, RA.fx());  // 現在の設定へ戻す
};

/* プリセット行のDOM構築(初回のみ) */
RA.ui.initPresetRow = () => {
  const host = $("presetRow");
  if (!host || host.childElementCount) return;
  RA.PRESETS.forEach(([id, label]) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "preset-item" + (RA.S.preset === id ? " on" : "");
    item.dataset.preset = id;
    item.setAttribute("role", "radio");
    item.setAttribute("aria-checked", RA.S.preset === id ? "true" : "false");
    const cv = document.createElement("canvas");
    cv.width = 120;
    cv.height = 68;
    item.appendChild(cv);
    const nm = document.createElement("span");
    nm.textContent = label;
    item.appendChild(nm);
    item.addEventListener("click", () => {
      RA.S.preset = id;
      host.querySelectorAll(".preset-item").forEach(b => {
        const on = b === item;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    });
    host.appendChild(item);
  });
};

/* ---- 書き出し ---- */
RA.ui.startExport = async () => {
  if (RA.exporter.running) return;
  if (RA.S.editCorners) RA.ui.setStep(3);  // 実時間録画はプレビューを録るため補正表示に
  RA.S.compare = false;
  const btn = $("exportBtn");
  btn.disabled = true;
  $("progressWrap").hidden = false;
  $("doneCard").hidden = true;
  if (RA.S.clip.video) RA.S.clip.video.pause();
  try {
    const res = await RA.exporter.run((p, txt) => {
      $("progressBar").style.width = `${Math.round(p * 100)}%`;
      $("progressText").textContent = txt;
    });
    RA.ui.showDone(res);
  } catch (e) {
    RA.log("export error:", e.message);
    RA.ui.toast(e.message === "キャンセルしました" ? "書き出しを中止しました" : `⚠ ${e.message}`);
  } finally {
    btn.disabled = false;
    $("progressWrap").hidden = true;
    $("progressBar").style.width = "0%";
  }
};

/* 書き出し完了カード。iOS(共有可)は「保存」ボタンのタップで初めて保存する */
RA.ui.showDone = res => {
  const share = RA.exporter.shareMode();
  $("doneCard").hidden = false;
  $("saveBtn").textContent = share ? "動画を保存" : "もう一度保存";
  if (share) {
    $("doneText").textContent = `準備できました(${RA.ui.fmtSize(res.blob.size)})`;
    $("doneNote").textContent = "「動画を保存」を押すと、共有シートから写真(カメラロール)やファイルに保存できます。";
    RA.ui.toast("✔ 準備できました。保存を押してください");
  } else {
    $("doneText").textContent = `「${res.name}」を保存しました(${RA.ui.fmtSize(res.blob.size)})`;
    $("doneNote").textContent = "ダウンロードに保存されています。";
    RA.ui.toast("✔ 書き出しが完了しました");
  }
};

/* 保存の実行。iOSはWeb Shareで写真/ファイルへ、それ以外はダウンロード */
RA.ui.saveResult = async () => {
  const r = RA.exporter.lastResult;
  if (!r) return;
  if (RA.exporter.shareMode()) {
    try {
      const file = new File([r.blob], r.name, { type: r.type || r.blob.type });
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === "AbortError") return;         // ユーザーがキャンセル
      RA.log("share失敗→ダウンロード:", e && e.message);
      RA.exporter.triggerDownload(r.blob, r.name);        // 最後の手段
    }
  } else {
    RA.exporter.triggerDownload(r.blob, r.name);
  }
};

/* ---- 起動 ---- */
window.addEventListener("DOMContentLoaded", async () => {
  RA.preview.init();
  RA.corners.init();
  RA.ui.initJourney();
  RA.ui.trackJourneyHeight();
  RA.testHomography();

  // ファイル選択+ドラッグ&ドロップ
  $("pickBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = e => {
    if (e.target.files[0]) RA.ui.loadFile(e.target.files[0]).catch(err => RA.ui.toast(`⚠ ${err.message}`));
  };
  const dz = $("dropSection");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag");
    const f = [...e.dataTransfer.files].find(f => RA.ui.isVideoFile(f));
    if (f) RA.ui.loadFile(f).catch(err => RA.ui.toast(`⚠ ${err.message}`));
    else RA.ui.toast("動画ファイルを入れてください");
  });

  // 再生コントロール
  const togglePlay = () => {
    const v = RA.S.clip && RA.S.clip.video;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  };
  $("playBtn").onclick = togglePlay;
  $("seekBar").addEventListener("input", e => {
    RA.ui._seeking = true;
    if (RA.S.clip) RA.S.clip.video.currentTime = parseFloat(e.target.value);
  });
  $("seekBar").addEventListener("change", () => {
    RA.ui._seeking = false;
    if (RA.S.step === 2) {
      clearTimeout(RA.ui._thumbTm);
      RA.ui._thumbTm = setTimeout(() => RA.ui.buildPresetThumbs(), 350);
    }
  });
  setInterval(RA.ui.updateTime, 250);

  // ステッパー(タップでも移動可)+ステップ遷移ボタン
  document.querySelectorAll("#stepper [data-step]").forEach(b => {
    b.onclick = () => RA.ui.setStep(parseInt(b.dataset.step, 10));
  });
  $("toStep2Btn").onclick = () => RA.ui.setStep(2);
  $("toStep3Btn").onclick = () => RA.ui.setStep(3);
  $("backTo1Btn").onclick = () => RA.ui.setStep(1);
  $("backTo2Btn").onclick = () => RA.ui.setStep(2);

  // カラープリセット行
  RA.ui.initPresetRow();

  // 四隅パネル
  $("redetectBtn").onclick = () => RA.ui.autoDetect();
  $("resetBtn").onclick = () => { RA.S.corners = RA.presetCorners(); RA.corners.draw(); };

  // 補正パネル
  const bindRange = (id, key, labelId, fromUi, fmt) => {
    const el = $(id);
    el.addEventListener("input", () => {
      RA.S[key] = fromUi(parseFloat(el.value));
      $(labelId).textContent = fmt(RA.S[key]);
    });
    $(labelId).textContent = fmt(RA.S[key]);
  };
  // 補正強度スライダーはモードで書き込み先を変える(front→sMain / top→sTop)
  const strengthEl = $("strengthRange");
  const strengthKey = () => (RA.S.viewMode === "top" ? "sTop" : "sMain");
  const paintStrength = () => {
    strengthEl.value = String(Math.round(RA.S[strengthKey()] * 100));
    $("strengthVal").textContent = `${Math.round(RA.S[strengthKey()] * 100)}%`;
    $("strengthLabel").textContent =
      RA.S.viewMode === "top" ? "俯瞰の起こし具合" : "真正面へ（左右の視点補正）";
  };
  strengthEl.addEventListener("input", () => {
    RA.S[strengthKey()] = parseFloat(strengthEl.value) / 100;
    $("strengthVal").textContent = `${Math.round(RA.S[strengthKey()] * 100)}%`;
  });
  paintStrength();

  // 俯瞰モードはUIから撤去(2026-07-19)。ロジックとURLパラメータ p= は隠し機能として残す

  bindRange("viewRange", "viewX", "viewVal", v => v / 100,
    v => (v === 0 ? "中央" : `${v > 0 ? "右" : "左"}へ ${Math.round(Math.abs(v) * 100)}`));
  bindRange("tiltRange", "tilt", "tiltVal", v => v, v => `${v > 0 ? "+" : ""}${v.toFixed(1)}°`);
  bindRange("zoomRange", "zoom", "zoomVal", v => v / 100, v => `×${v.toFixed(2)}`);
  bindRange("panRange", "panY", "panVal", v => v / 100, v => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
  bindRange("sharpRange", "sharp", "sharpVal", v => v / 100, v => `${Math.round(v * 100)}%`);
  $("fillEdgeChk").addEventListener("change", e => { RA.S.fillEdge = e.target.checked; });
  $("gridChk").addEventListener("change", e => {
    RA.S.grid = e.target.checked;
    RA.corners.draw();
  });
  $("resSel").onchange = e => { RA.S.res = e.target.value; };

  // 元を見る(長押し比較)
  const cmp = $("compareBtn");
  const cmpOn = e => { RA.S.compare = true; cmp.classList.add("on"); e.preventDefault(); };
  const cmpOff = () => { RA.S.compare = false; cmp.classList.remove("on"); };
  cmp.addEventListener("pointerdown", cmpOn);
  cmp.addEventListener("pointerup", cmpOff);
  cmp.addEventListener("pointercancel", cmpOff);
  cmp.addEventListener("pointerleave", cmpOff);

  $("exportBtn").onclick = RA.ui.startExport;
  $("saveBtn").onclick = RA.ui.saveResult;
  $("cancelBtn").onclick = () => { RA.exporter.cancelFlag = true; };
  $("backBtn").onclick = () => {
    if (RA.exporter.running) return RA.ui.toast("書き出し中です");
    RA.ui.disposeClip();
    $("editorSection").hidden = true;
    $("doneCard").hidden = true;
    $("dropSection").hidden = false;
    $("fileInput").value = "";
  };

  // 能力チェック
  await RA.exporter.probeCaps().catch(() => {});
  RA.ui.setStatus(RA.caps.h264 ? "準備OK(高速書き出し対応)" : "準備OK(実時間書き出し)", true);

  if (RA.testMode) RA.ui.runTest();
});

/* 自動検証(?test): test.mp4を読み込み→パラメータ適用→書き出し→/saveへPUT
   ?corners=x,y;x,y;x,y;x,y(正規化・TL,TR,BR,BL) ?s=強度0〜100 */
RA.ui.runTest = async () => {
  try {
    const r = await fetch("test.mp4");
    if (!r.ok) throw new Error("test.mp4がありません");
    const b = await r.blob();
    await RA.ui.loadFile(new File([b], "test.mp4", { type: "video/mp4" }));
    const params = new URLSearchParams(location.search);
    if (params.get("corners")) {
      RA.S.corners = params.get("corners").split(";").map(s => {
        const [x, y] = s.split(",").map(Number);
        return { x, y };
      });
      RA.corners.draw();
    }
    if (params.get("s") != null) {
      RA.S.sMain = parseFloat(params.get("s")) / 100;
      $("strengthRange").value = params.get("s");
    }
    if (params.get("p") != null) {
      // p= 指定は俯瞰モードでの起こし具合
      RA.S.viewMode = "top";
      RA.S.sTop = parseFloat(params.get("p")) / 100;
    }
    if (params.get("t") != null) {
      RA.S.tilt = parseFloat(params.get("t"));
    }
    if (params.get("vx") != null) {
      RA.S.viewX = parseFloat(params.get("vx")) / 100;
    }
    if (params.get("c") != null && RA.PRESETS.some(pr => pr[0] === params.get("c"))) {
      RA.S.preset = params.get("c");
    }
    if (params.get("sh") != null) {
      RA.S.sharp = parseFloat(params.get("sh")) / 100;
    }
    if (params.get("fill") != null) {
      RA.S.fillEdge = params.get("fill") !== "0";
      $("fillEdgeChk").checked = RA.S.fillEdge;
    }
    if (params.get("grid") != null) {
      RA.S.grid = params.get("grid") !== "0";
      $("gridChk").checked = RA.S.grid;
      RA.corners.draw();
    }
    await new Promise(r2 => setTimeout(r2, 400));
    await RA.ui.startExport();
    RA.log("TEST DONE");
  } catch (e) {
    RA.log("TEST FAILED:", e.message);
  }
};
