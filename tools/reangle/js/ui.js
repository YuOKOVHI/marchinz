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
      RA.ui.setTab("corners");
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

/* 床の自動検出(初期配置)。床が見やすい位置へ少しシークしてから走らせる */
RA.ui.autoDetect = async () => {
  const c = RA.S.clip;
  if (!c) return;
  const v = c.video;
  const t = Math.min(1.0, c.duration * 0.1);
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
  RA.ui.toast(q
    ? "床を検出しました。四隅をドラッグして微調整してください"
    : "床の四隅にハンドルをドラッグして合わせてください");
};

RA.ui.updateTime = () => {
  const c = RA.S.clip;
  if (!c) return;
  $("timeLabel").textContent = `${RA.ui.fmtTime(c.video.currentTime)} / ${RA.ui.fmtTime(c.duration)}`;
  if (!RA.ui._seeking) $("seekBar").value = c.video.currentTime;
  $("playBtn").textContent = c.video.paused ? "▶ 再生" : "⏸ 一時停止";
};

/* ---- タブ(四隅 / 補正) ---- */
RA.ui.setTab = name => {
  RA.S.editCorners = name === "corners";
  document.querySelectorAll("#tabSeg button").forEach(b =>
    b.classList.toggle("on", b.dataset.tab === name));
  $("panelCorners").hidden = name !== "corners";
  $("panelAdjust").hidden = name !== "adjust";
  RA.corners.draw();
};

/* ---- 書き出し ---- */
RA.ui.startExport = async () => {
  if (RA.exporter.running) return;
  if (RA.S.editCorners) RA.ui.setTab("adjust");  // 実時間録画はプレビューを録るため補正表示に
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
  $("seekBar").addEventListener("change", () => { RA.ui._seeking = false; });
  setInterval(RA.ui.updateTime, 250);

  // タブ
  document.querySelectorAll("#tabSeg button").forEach(b => {
    b.onclick = () => RA.ui.setTab(b.dataset.tab);
  });

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
  bindRange("strengthRange", "strength", "strengthVal", v => v / 100, v => `${Math.round(v * 100)}%`);
  bindRange("zoomRange", "zoom", "zoomVal", v => v / 100, v => `×${v.toFixed(2)}`);
  bindRange("panRange", "panY", "panVal", v => v / 100, v => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
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
      RA.S.strength = parseFloat(params.get("s")) / 100;
      $("strengthRange").value = params.get("s");
    }
    await new Promise(r2 => setTimeout(r2, 400));
    await RA.ui.startExport();
    RA.log("TEST DONE");
  } catch (e) {
    RA.log("TEST FAILED:", e.message);
  }
};
