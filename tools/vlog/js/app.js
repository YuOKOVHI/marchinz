"use strict";
/* ============ MarchinZ Vlog: 起動 ============ */

MV.probeCaps = async () => {
  const c = MV.caps;
  c.webcodecs = typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
  if (c.webcodecs) {
    try {
      const v = await VideoEncoder.isConfigSupported({
        codec: "avc1.42001f", width: MV.W, height: MV.H,
        bitrate: 8e6, framerate: MV.FPS,
      });
      c.h264 = !!(v && v.supported);
    } catch (_) { c.h264 = false; }
    try {
      const a = await AudioEncoder.isConfigSupported({
        codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000,
      });
      c.aac = !!(a && a.supported);
    } catch (_) { c.aac = false; }
  }
  if (typeof MediaRecorder !== "undefined") {
    // SafariはWebM非対応。MP4を先に試す(iOSでは video/mp4 になる)
    for (const m of ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]) {
      if (MediaRecorder.isTypeSupported(m)) { c.recMime = m; break; }
    }
  }
  const badge = document.getElementById("capsBadge");
  if (badge) {
    badge.textContent = (c.h264 && c.aac) ? "高速書き出しに対応"
      : c.recMime ? "書き出しは実時間で処理します" : "この端末では書き出せません";
  }
  MV.log(`caps: h264=${c.h264} aac=${c.aac} rec=${c.recMime || "なし"}`);
};

MV.boot = async () => {
  MV.restoreState();
  MV.ui.init();
  await MV.probeCaps();
  MV.log("MarchinZ Vlog 起動");
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", MV.boot, { once: true });
} else {
  MV.boot();
}
