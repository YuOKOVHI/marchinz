"use strict";
/* ============ クリエイターツール共通: 取り込み制限 ============
   通常ユーザーは端末の負荷を考えて上限を設けるが、管理者(auth-config.jsのadminEmails)
   でログイン中は上限なしで扱えるようにする。

   本体サイト(auth.js)が管理者ログイン時に localStorage へ印を書き、
   ツール側(同一オリジン)はそれを読むだけ。ツールにFirebase SDKを読ませない
   (ツールは端末内完結・軽量が売りのため)。

   ※この上限はあくまで端末の負荷・誤操作を防ぐための目安で、秘密を守る仕組みではない。
     長尺・大量の素材はブラウザのメモリを使い切って落ちることがある。 */

window.MZ_LIMITS = (() => {
  const KEY = "mz_admin_unlimited_v1";
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // 印は30日で失効(共有端末での置き去り対策)
  let admin = false;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    admin = Boolean(raw && raw.admin && Date.now() - (raw.ts || 0) < MAX_AGE_MS);
  } catch (e) { admin = false; }

  const L = {
    admin,
    maxVideoSec: admin ? Infinity : 600.5,   // 取り込める動画の長さ(通常10分)
    maxPhotos: admin ? Infinity : 4,         // 一度に扱える写真の枚数
    maxRangeSec: admin ? Infinity : 60,      // Privacyでモザイク作業できる範囲(通常60秒)
    minRangeSec: 10,
  };

  /* 管理者のとき: 上限を書いた文言([data-limit-note])を隠し、代わりに帯を出す */
  L.applyToDom = () => {
    if (!L.admin) return;
    document.querySelectorAll("[data-limit-note]").forEach(el => { el.hidden = true; });
    if (document.getElementById("adminLimitBadge")) return;
    const p = document.createElement("p");
    p.id = "adminLimitBadge";
    p.className = "admin-limit-badge";
    p.innerHTML = '<i class="fa-solid fa-unlock"></i> 管理者としてログイン中のため、長さ・枚数の上限なしで取り込めます。';
    const host = document.querySelector("main") || document.body;
    host.insertBefore(p, host.firstChild);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", L.applyToDom, { once: true });
  } else {
    L.applyToDom();
  }
  return L;
})();
