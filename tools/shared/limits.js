"use strict";
/* ============ クリエイターツール共通: 取り込み制限 ============
   3段階: ゲスト(動画10分・写真1枚) < 登録ユーザー(動画20分・写真5枚)
        < 管理者ログイン・手元環境(上限なし)。
   Privacyの動画は作業範囲方式(最大60秒を選ぶ)のため、誰でも10分まで。

   本体サイト(auth.js)が管理者ログイン時に localStorage へ印を書き、
   ツール側(同一オリジン)はそれを読むだけ。ツールにFirebase SDKを読ませない
   (ツールは端末内完結・軽量が売りのため)。
   開発中(localhost / file:// で開いているとき)も同じく上限なしで動かす。

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

  // 登録ユーザー(ログイン中)の印。本体サイトのauth.jsがログイン時に書き、ログアウトで消す
  let member = false;
  try {
    const raw = JSON.parse(localStorage.getItem("mz_member_v1") || "null");
    member = Boolean(raw && raw.member && Date.now() - (raw.ts || 0) < MAX_AGE_MS);
  } catch (e) { member = false; }

  // 手元で開いているとき(開発・動作確認用)。本番ドメインでは決してtrueにならない。
  // 私用IPは「10.example.com」のような外部ドメインを拾わないよう、IPv4の形を確かめてから判定する
  const host = location.hostname;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  const privateIp = Boolean(ip) && (
    ip[1] === "10"
    || (ip[1] === "192" && ip[2] === "168")
    || (ip[1] === "172" && Number(ip[2]) >= 16 && Number(ip[2]) <= 31)
  );
  const local = location.protocol === "file:"
    || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
    || /\.local$/i.test(host)
    || privateIp;

  const unlimited = admin || local;
  const L = {
    admin, local, member, unlimited,
    // ReAngle/Switcher: ゲスト5分・登録12分(2026-07-19改定)
    maxVideoSec: unlimited ? Infinity : member ? 720.5 : 300.5,
    videoLimitLabel: member ? "12分" : "5分",   // エラーメッセージ用
    // Privacyの動画は誰でも10分(モザイク作業は選んだ範囲だけのため)
    maxPrivacyVideoSec: unlimited ? Infinity : 600.5,
    maxPhotos: unlimited ? Infinity : member ? 5 : 1,   // 一度に扱える写真の枚数
    maxRangeSec: unlimited ? Infinity : 60,      // Privacyでモザイク作業できる範囲
    minRangeSec: 10,
  };

  /* 上限なし: 上限の文言([data-limit-note])を隠して帯を出す。
     登録ユーザー: 文言を data-limit-note-member の内容(静的テキスト)に差し替える */
  L.applyToDom = () => {
    if (!L.unlimited) {
      if (L.member) {
        document.querySelectorAll("[data-limit-note-member]").forEach(el => {
          el.textContent = el.getAttribute("data-limit-note-member");
        });
      }
      return;
    }
    document.querySelectorAll("[data-limit-note]").forEach(el => { el.hidden = true; });
    if (document.getElementById("adminLimitBadge")) return;
    const p = document.createElement("p");
    p.id = "adminLimitBadge";
    p.className = "admin-limit-badge";
    p.innerHTML = L.admin
      ? '<i class="fa-solid fa-unlock"></i> 管理者としてログイン中のため、長さ・枚数の上限なしで取り込めます。'
      : '<i class="fa-solid fa-laptop-code"></i> 手元の環境で開いているため、長さ・枚数の上限なしで取り込めます。';
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
