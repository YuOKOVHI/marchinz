"use strict";
/* ============ クリエイターツール共通: MarchinZウォーターマーク ============
   書き出し映像とプレビューへ控えめにロゴを載せる(Switcher / ReAngle)。

   フルHD基準の設定値(解像度に比例スケール)。ロゴは透過PNG(背景なし)で
   右上の隅ぎりぎりに置く(2026-07-19 優さん指定):
   - 横(1920×1080): 幅110px、右16px・上16px、不透明度35%
   - 縦(1080×1920): 幅90px、右12px・上24px、不透明度35% */

window.MZWM = (() => {
  const SPEC = {
    landscape: { w: 110, right: 16, top: 16, refW: 1920 },
    portrait:  { w: 90,  right: 12, top: 24, refW: 1080 },
  };
  const ALPHA = 0.35;
  const img = new Image();
  let ready = false;
  const SRC = new URL("/tools/shared/marchinz-wm.png", location.href).href;
  let tries = 0;
  img.onload = () => { ready = true; };
  img.onerror = () => {
    /* ★ 読めないままだと draw が黙って素通りし「ロゴ無しの完成品」になる。
       v1.99.3 で「ロゴが表示されます」と全員に掲示したため、静かな失敗は
       嘘になる(2026-08-06)。少し待って読み直し(3回まで)、それでも駄目なら
       whenReady() が false を返して書き出し側が事前に言えるようにする */
    if (tries < 3) {
      tries += 1;
      setTimeout(() => { img.src = `${SRC}?retry=${tries}`; }, 800 * tries);
    }
  };
  img.src = SRC;

  /* 書き出し直前の確認用。ready になったら即 true、timeoutMs 待っても
     駄目なら false(呼ぶ側が「ロゴなしになります」と断る) */
  function whenReady(timeoutMs = 3000) {
    if (ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (ready) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 >= timeoutMs) { clearInterval(iv); resolve(false); }
      }, 100);
    });
  }

  /* キャンバス(W×H)の右上へ描く。プレビュー/書き出しの両方から毎フレーム呼べる軽さ */
  function draw(ctx, W, H) {
    if (!ready || !W || !H) return;
    const sp = W >= H ? SPEC.landscape : SPEC.portrait;
    const s = W / sp.refW;
    const w = sp.w * s;
    const h = w * img.naturalHeight / img.naturalWidth;
    ctx.save();
    ctx.globalAlpha = ALPHA;
    ctx.drawImage(img, W - w - sp.right * s, sp.top * s, w, h);
    ctx.restore();
  }

  /* DOMオーバーレイ(WebGL直描きのプレビュー用)。
     コンテナ=プレビューを包む position:relative の要素。W/H=映像のピクセル寸法 */
  function overlay(container, W, H) {
    if (!container) return;
    let el = container.querySelector(".mzwm-overlay");
    if (!W || !H) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("img");
      el.className = "mzwm-overlay";
      el.src = img.src;
      el.alt = "";
      el.style.cssText =
        "position:absolute; pointer-events:none; opacity:" + ALPHA + "; z-index:5;";
      container.appendChild(el);
    }
    const sp = W >= H ? SPEC.landscape : SPEC.portrait;
    el.style.width = (sp.w / sp.refW * 100) + "%";
    el.style.right = (sp.right / sp.refW * 100) + "%";
    el.style.top = (sp.top * (W / sp.refW) / H * 100) + "%";
  }

  return { draw, overlay, whenReady, get ready() { return ready; } };
})();
