"use strict";

/* 取り込んだ演奏を編集席の背景にだけ使う。
   - プレビューの clip.video / clip.url / currentTime には一切触れない
   - 背景専用 video と Object URL は常に1組だけ
   - OFF、重い処理、タブ非表示、視差軽減時は decode/loop まで止める */
MC.background = (() => {
  const PREF_KEY = "marchcut_background_v1";
  const B = {
    preferred: true,
    clipId: null,
    objectUrl: "",
    fileRef: null,
    inited: false,
    disposed: false,
    ready: false,
    playPending: false,
    timer: 0,
    reduceQuery: null,
  };

  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved === "0") B.preferred = false;
    if (saved === "1") B.preferred = true;
  } catch (_) {}

  const el = () => document.getElementById("mzBgVideo");
  const toggle = () => document.getElementById("bgToggle");
  const state = () => document.getElementById("bgToggleState");
  const clips = () => (window.MC && MC.S && MC.S.clips) || [];
  const firstVideo = () => clips().find(c => c && !c.isImage && !c.isAudio && c.file) || null;

  B.isReduced = () => !!(B.reduceQuery && B.reduceQuery.matches);
  B.isBusy = () => !!(
    document.hidden
    || B.isReduced()
    || (MC.S && MC.S.playing)
    || (MC.ui && (MC.ui._busy || (MC.ui.autoStage && MC.ui.autoStage._analyzing)))
    || (MC.exporter && (MC.exporter.running || MC.exporter.recording))
    || document.body.classList.contains("mz-export-open")
  );

  B.pause = () => {
    const video = el();
    if (!video) return;
    try { video.pause(); } catch (_) {}
    document.body.classList.remove("mz-bg-playing");
  };

  B.dropSource = () => {
    const video = el();
    B.pause();
    if (video) {
      try { video.removeAttribute("src"); } catch (_) {}
      try { video.load(); } catch (_) {}
      video.classList.remove("ready");
    }
    if (B.objectUrl) {
      try { URL.revokeObjectURL(B.objectUrl); } catch (_) {}
    }
    B.objectUrl = "";
    B.clipId = null;
    B.fileRef = null;
    B.ready = false;
    B.playPending = false;
  };

  B.useClip = clip => {
    const video = el();
    if (!video || !clip || !clip.file) return false;
    if (B.clipId === clip.id && B.fileRef === clip.file && B.objectUrl) return true;
    B.dropSource();
    try {
      B.objectUrl = URL.createObjectURL(clip.file);
      B.clipId = clip.id;
      B.fileRef = clip.file;
      video.src = B.objectUrl;
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.load();
      return true;
    } catch (_) {
      B.dropSource();
      return false;
    }
  };

  B.render = () => {
    const clip = firstVideo();
    const hasVideo = !!clip;
    const blocked = hasVideo && B.preferred && B.isBusy();
    const button = toggle();
    const label = state();
    if (button) {
      button.hidden = !hasVideo;
      button.disabled = !hasVideo;
      button.setAttribute("aria-checked", String(hasVideo && B.preferred));
      button.classList.toggle("on", hasVideo && B.preferred);
      button.title = B.isReduced()
        ? "端末の『視差効果を減らす』設定に合わせて停止しています"
        : "背景演出だけで、書き出す動画には入りません";
    }
    if (label) label.textContent = !B.preferred ? "OFF" : blocked ? "停止中" : "ON";
    document.body.classList.toggle("mz-bg-on", hasVideo && B.preferred);
    document.body.classList.toggle("mz-bg-paused", blocked);
  };

  B.reconcile = () => {
    if (!B.inited || B.disposed) return;
    const clip = firstVideo();
    if (!clip) {
      if (B.objectUrl) B.dropSource();
      B.render();
      return;
    }
    if (!B.preferred) {
      /* OFFは一時停止ではなく、srcと専用Object URLまで外す。 */
      if (B.objectUrl) B.dropSource();
      B.render();
      return;
    }
    if (!B.useClip(clip)) {
      B.render();
      return;
    }
    const video = el();
    if (B.isBusy()) {
      B.pause();
      B.render();
      return;
    }
    B.render();
    if (!video || !video.paused || B.playPending) return;
    B.playPending = true;
    let played;
    try { played = video.play(); } catch (_) { played = null; }
    Promise.resolve(played).then(() => {
      if (!B.isBusy() && B.preferred) document.body.classList.add("mz-bg-playing");
    }).catch(() => {}).finally(() => { B.playPending = false; });
  };

  B.set = on => {
    B.preferred = !!on;
    try { localStorage.setItem(PREF_KEY, B.preferred ? "1" : "0"); } catch (_) {}
    if (!B.preferred) B.dropSource();
    B.render();
    B.reconcile();
  };

  B.refresh = () => {
    if (B.disposed) return;
    B.reconcile();
  };

  B.detachClip = id => {
    if (id != null && id === B.clipId) B.dropSource();
    B.render();
  };

  B.dispose = () => {
    B.disposed = true;
    if (B.timer) clearInterval(B.timer);
    B.timer = 0;
    B.dropSource();
    const button = toggle();
    if (button) button.hidden = true;
    document.body.classList.remove("mz-bg-on", "mz-bg-paused", "mz-bg-playing");
  };

  B.init = () => {
    if (B.inited) return;
    B.inited = true;
    B.disposed = false;
    B.reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const video = el();
    const button = toggle();
    if (video) {
      video.addEventListener("loadeddata", () => {
        B.ready = true;
        video.classList.add("ready");
        B.render();
      });
      video.addEventListener("emptied", () => {
        B.ready = false;
        video.classList.remove("ready");
      });
    }
    if (button) button.addEventListener("click", () => B.set(!B.preferred));
    document.addEventListener("visibilitychange", B.reconcile);
    if (B.reduceQuery) {
      if (B.reduceQuery.addEventListener) B.reduceQuery.addEventListener("change", B.reconcile);
      else if (B.reduceQuery.addListener) B.reduceQuery.addListener(B.reconcile);
    }
    B.timer = setInterval(B.reconcile, 400);
    B.reconcile();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", B.init, { once: true });
  else B.init();
  window.addEventListener("pagehide", B.dispose, { once: true });
  return B;
})();
