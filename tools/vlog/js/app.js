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

/* 開発中ゲート: 管理者(+手元環境)以外にはツールを開かない(2026-07-21)。
   リンク側でも止めているが、URL直打ちはここでしか止められない */
MV.showDevGate = () => {
  const ws = document.getElementById("workspace");
  if (ws) ws.style.display = "none";
  let gate = document.getElementById("mvDevGate");
  if (!gate) {
    gate = document.createElement("div");
    gate.id = "mvDevGate";
    gate.style.cssText = "max-width:520px;margin:56px auto;padding:32px 20px;text-align:center;";
    gate.innerHTML = '<p style="font-size:42px;margin:0 0 12px"><i class="fa-solid fa-hammer" aria-hidden="true"></i></p>'
      + '<h2 style="font-size:20px;margin:0 0 10px">開発中です。お待ち下さい。</h2>'
      + '<p style="color:rgba(12,15,20,0.65);font-size:14px;line-height:1.7;margin:0 0 20px">MarchinZ Vlog はただいま開発中です。<br>公開までもうしばらくお待ちください。</p>'
      + '<p><a href="/#creators-heading" style="font-weight:700">← クリエイターツール一覧へ戻る</a></p>';
    const anchor = document.getElementById("workspace");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(gate, anchor);
    else document.body.appendChild(gate);
  }
  gate.style.display = "";
};

MV.boot = async () => {
  if (!(window.MZ_LIMITS && MZ_LIMITS.unlimited)) {
    MV.showDevGate();
    MV.log("開発中ゲート: 管理者以外のため起動を止めました");
    return;
  }
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
