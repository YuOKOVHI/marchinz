"use strict";
/* ============ クリエイターツール共通: サイトの上下(YouTubeページと同じ) ============
   3ツール(Switcher/ReAngle/Privacy)へ、ブランドヘッダー+グローバルナビと
   サイト標準フッター(バナー+リンク集+コピーライト)を差し込む。
   「無料・すべて端末内」の帯はページ下部(フッター直前)へ移す。
   ツールはSPAではないため、リンクはすべて絶対パス(/#...)にする。 */

window.MZSiteChrome = (() => {
  const NAV = [
    ["/#top", "TOP"],
    ["/#community/events", "コミュニティ"],
    ["/#videos", "大会動画"],
    ["/#youtube", "YouTube"],
    ["/#webmagazine", "メディア"],
    ["/#creators", "クリエイター"],
    ["/#ops", "運営"],
  ];

  const FOOT_COLS = [
    [["/#top", "TOP"], ["/#videos", "大会動画"], ["/#youtube", "YouTube"],
     ["/#webmagazine", "メディア"], ["/#creators", "クリエイター"]],
    [["/#community/events", "イベント"], ["/#community/moments", "モーメント"],
     ["/#community/board", "掲示板"], ["/#community/notes", "ノート"], ["/#profile", "マイページ"]],
    [["/#ops", "運営について"], ["/#terms", "利用規約"], ["/#privacy", "プライバシーポリシー"]],
  ];

  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M18.9 2h3.68l-8.04 9.19L24 22h-7.41l-5.8-7.58L4.16 22H.47l8.6-9.83L0 2h7.6l5.24 6.91L18.9 2zm-1.29 17.8h2.04L6.49 4.1H4.3L17.61 19.8z" fill="currentColor"></path></svg>';

  /* ログイン状態の表示。ツールはFirebase SDKを読まない設計なので、本体
     auth.jsがlocalStorageへ書く印(limits.jsが読んでいるのと同じ)を見る。
     未ログイン=「はじめての方/ログイン」、ログイン中=「マイページ」1つだけ
     (会員か管理者かはここでは区別しない。ログインしている事実だけを見せる)。 */
  function loggedIn() {
    const L = window.MZ_LIMITS;
    return Boolean(L && (L.member || L.admin));
  }

  /* アバターと名前。auth.js がログイン時に mz_member_v1 へ書いた値を読む。
     まだ無い(旧版でログインしたまま等)ときはプレースホルダ+名前なしで出す */
  const AVATAR_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' rx='20' fill='%231e3a5f'/%3E%3C/svg%3E";
  function memberProfile() {
    try {
      const raw = JSON.parse(localStorage.getItem("mz_member_v1") || "null");
      return { name: (raw && raw.name) || "", avatar: (raw && raw.avatar) || "" };
    } catch (_) { return { name: "", avatar: "" }; }
  }

  /* ヘッダー右側: 本体(index.html)のログイン表示と同じ構成。
     アバター+名前=マイページへ / ハンバーガー型ボタン=アカウントメニュー。
     プロフィール編集・設定・ログアウトは本体のマイページでしかできないため、
     メニューの行き先はすべて本体へのリンクにする */
  function headerAuthHtml() {
    if (loggedIn()) {
      const p = memberProfile();
      return '<div class="mzsc-user-area">'
        + '<a href="/#profile" class="mzsc-user" aria-label="マイプロフィールを表示">'
        + `<img class="mzsc-user-avatar" src="${esc(p.avatar || AVATAR_FALLBACK)}" alt="" width="40" height="40" decoding="async" onerror="this.src='${AVATAR_FALLBACK}'">`
        + (p.name ? `<span class="mzsc-user-name">${esc(p.name)}</span>` : "")
        + '</a>'
        + '<div class="mzsc-acct-wrap">'
        + '<button type="button" class="mzsc-acct-btn" id="mzscAcctBtn" aria-expanded="false"'
        + ' aria-haspopup="menu" aria-controls="mzscAcctMenu" aria-label="アカウントメニューを開く">'
        + '<span class="mzsc-acct-burger" aria-hidden="true"><span></span><span></span><span></span></span></button>'
        + '<div id="mzscAcctMenu" class="mzsc-acct-menu" role="menu" hidden>'
        + '<a href="/#profile" role="menuitem">プロフィールを見る</a>'
        + '<a href="/#profile?tab=base" role="menuitem"><i class="fa-solid fa-drum" aria-hidden="true"></i> MarchinZ Days(練習記録)</a>'
        + '<a href="/#profile" role="menuitem">設定・ログアウト(マイページ)</a>'
        + '</div></div></div>';
    }
    return '<a href="/#signup" class="mzsc-brand-btn mzsc-brand-btn--primary">はじめての方</a>'
      + '<a href="/#login" class="mzsc-brand-btn">ログイン</a>';
  }

  /* ドロワー内は場所が狭いのでボタン型のまま */
  function authAreaHtml() {
    if (loggedIn()) {
      return '<a href="/#profile" class="mzsc-brand-btn mzsc-brand-btn--primary">'
        + '<i class="fa-solid fa-user" aria-hidden="true"></i> マイページ</a>';
    }
    return '<a href="/#signup" class="mzsc-brand-btn mzsc-brand-btn--primary">はじめての方</a>'
      + '<a href="/#login" class="mzsc-brand-btn">ログイン</a>';
  }

  /* ヘッダー: ブランド + グローバルナビ(TOPと同じ並び) */
  function headerHtml() {
    const nav = NAV.map(([href, label]) =>
      `<a href="${href}"${href === "/#creators" ? ' class="on"' : ""}>${esc(label)}</a>`).join("");
    const auth = headerAuthHtml();
    return `
<header class="mzsc-brand">
  <div class="mzsc-brand-inner">
    <div>
      <a href="/#top" class="mzsc-brand-logo" aria-label="MarchinZ ホームへ">
        <img src="/logo/marchinz-logo.png" alt="MarchinZ / マーチンズ" width="224" decoding="async" onerror="this.style.display='none'">
      </a>
      <p class="mzsc-brand-tagline">残す、見つける、盛り上げる！<br>マーチングコミュニティ「マーチンズ/MarchinZ」</p>
    </div>
    <div class="mzsc-brand-right">${auth}</div>
    <button type="button" class="mzsc-burger" id="mzscBurger" aria-label="メニューを開く" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>
<nav class="mzsc-nav" aria-label="サイト内ページ"><div class="mzsc-nav-inner">${nav}</div></nav>
<div class="mzsc-drawer" id="mzscDrawer" hidden>
  <button type="button" class="mzsc-drawer-bd" data-mzsc-close aria-label="メニューを閉じる"></button>
  <div class="mzsc-drawer-panel" role="dialog" aria-modal="true" aria-label="サイトメニュー">
    <button type="button" class="mzsc-drawer-close" data-mzsc-close aria-label="閉じる">×</button>
    <div class="mzsc-drawer-cta">${authAreaHtml()}</div>
    <p class="mzsc-drawer-label">映像ツール</p>
    <nav class="mzsc-drawer-nav">
      <a href="/tools/vlog/"><i class="fa-solid fa-film" aria-hidden="true"></i> MarchinZ Vlog（開発中）</a>
      <a href="/tools/switcher/"><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> MarchinZ Switcher</a>
      <a href="/tools/reangle/"><i class="fa-solid fa-vector-square" aria-hidden="true"></i> MarchinZ ReAngle</a>
      <a href="/tools/privacy/"><i class="fa-solid fa-user-shield" aria-hidden="true"></i> MarchinZ Privacy</a>
    </nav>
    <p class="mzsc-drawer-label">ページ一覧</p>
    <nav class="mzsc-drawer-nav">${NAV.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join("")}
      <a href="/#profile">マイページ</a>
    </nav>
  </div>
</div>`;
  }

  /* ============ 版番(data-mz-version) ============
     正本は本体 index.html の <html data-mz-version> の1箇所だけ。ツールの
     ページは属性を持たないので、本体から読み取って自分の <html> へ注入する
     (二重管理にするとズレるため)。フッターと Switcher のエラーログ(ui.js)が
     この属性を参照する。取得完了までは前回取得値(localStorage)でつなぐ。 */
  const VER_KEY = "mzscSiteVersion";
  const copyHtml = ver =>
    `©️ MarchinZ 2026${ver ? ` <span lang="en">ver. ${esc(ver)}</span>` : ""}`;

  function setVersion(ver) {
    if (!ver) return;
    document.documentElement.setAttribute("data-mz-version", ver);
    try { localStorage.setItem(VER_KEY, ver); } catch (_) {}
    // フッターが版番なし/旧値で描画済みなら差し替える
    const copy = document.querySelector(".mzsc-foot-copy");
    if (copy) copy.innerHTML = copyHtml(ver);
  }

  async function syncVersion() {
    if (document.documentElement.getAttribute("data-mz-version")) return;
    try { setVersion(localStorage.getItem(VER_KEY)); } catch (_) {}
    try {
      // 属性は本体 index.html の先頭数十バイトにあるので、最初のチャンクだけ読んで打ち切る
      const res = await fetch("/index.html", { cache: "no-store" });
      const reader = res.body.getReader();
      const { value } = await reader.read();
      reader.cancel().catch(() => {});
      const m = new TextDecoder().decode(value || new Uint8Array())
        .match(/data-mz-version="([^"]+)"/);
      if (m) setVersion(m[1]);
    } catch (_) { /* オフライン・file://等。localStorageの値のままにする */ }
  }

  /* フッター: サイト標準(YouTubeページ等と同じ)= バナー + リンク集 + コピーライト */
  function footerHtml() {
    const cols = FOOT_COLS.map(col =>
      `<div class="mzsc-foot-col">${col.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join("")}</div>`).join("");
    const ver = document.documentElement.getAttribute("data-mz-version");
    return `
<footer class="mzsc-foot">
  <div class="mzsc-foot-banners">
    <a href="https://www.amazon.co.jp/kindle-dbs/hz/signup?tag=hamamasu-22" target="_blank" rel="noopener noreferrer">
      <img src="/images/manga/kindle-unlimited-banner.png" alt="Kindle Unlimited 30日間無料体験バナー" loading="lazy" onerror="this.style.display='none'">
    </a>
    <a href="https://artlist.io/referral/9e958a5d-8272-4c71-95d9-12ce5704a7dc" target="_blank" rel="noopener noreferrer">
      <img src="/images/creators/artlist-logo.png" alt="Artlist ロゴ" loading="lazy" onerror="this.style.display='none'">
    </a>
    <a href="https://x.com/marchinz2026" target="_blank" rel="noopener noreferrer" class="mzsc-x-link" aria-label="MarchinZ公式Xを開く" title="MarchinZ公式Xを開く">${X_SVG}</a>
  </div>
  <nav class="mzsc-foot-grid" aria-label="サイト内ページとポリシー">${cols}</nav>
  <p class="mzsc-foot-copy">${copyHtml(ver)}</p>
</footer>`;
  }

  /* ツールのページへ差し込む。
     toolId: "switcher" | "reangle" | "privacy"(相互リンクで自分を外すため) */
  function mount(toolId) {
    syncVersion(); // localStorage分は同期で反映→フッター描画に間に合う。fetch分は後追い差し替え
    const body = document.body;
    // ヘッダーは既存のツールバー(.topbar / header)より前へ
    const head = document.createElement("div");
    head.innerHTML = headerHtml();
    body.insertBefore(head, body.firstChild);
    // フッターは既存の <footer> を置き換える(無ければ末尾へ)
    const old = document.querySelector("body > footer");
    const foot = document.createElement("div");
    foot.innerHTML = footerHtml();
    if (old) old.replaceWith(foot); else body.appendChild(foot);
    // 「無料・すべて端末内で処理」はページの下(フッター直前)へ(2026-07-19 優さん指定)
    const disc = document.querySelector(".beta-disclaimer");
    if (disc) body.insertBefore(disc, foot);
    wireDrawer();
    wireAcctMenu();
    wireVlogGate();
  }

  /* アカウントメニュー(ログイン中のみ存在)。外側タップ・Escで閉じる */
  function wireAcctMenu() {
    const btn = document.getElementById("mzscAcctBtn");
    const menu = document.getElementById("mzscAcctMenu");
    if (!btn || !menu) return;
    const setOpen = open => {
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    btn.addEventListener("click", ev => { ev.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener("click", ev => {
      if (!menu.hidden && !ev.target.closest(".mzsc-acct-wrap")) setOpen(false);
    });
    document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !menu.hidden) setOpen(false); });
  }

  /* MarchinZ Vlog は開発中のため管理者(+手元環境)のみ。
     それ以外のクリックは止めて、開発中であることを告げる(2026-07-21 優さん指示)。
     判定は毎クリック時に行う(読み込み時に固定するとログイン直後に反映されない) */
  function vlogAllowed() {
    const L = window.MZ_LIMITS;
    return Boolean(L && L.unlimited);   // 管理者ログイン or localhost等の手元環境
  }

  function miniToast(msg) {
    let el = document.getElementById("mzscToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "mzscToast";
      el.className = "mzsc-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(miniToast._t);
    miniToast._t = setTimeout(() => el.classList.remove("on"), 3400);
  }

  function wireVlogGate() {
    document.addEventListener("click", ev => {
      const a = ev.target.closest('a[href^="/tools/vlog"]');
      if (!a || vlogAllowed()) return;
      ev.preventDefault();
      ev.stopPropagation();
      miniToast("開発中です。お待ち下さい。");
    }, true);   // capture: ドロワーの「クリックで閉じる」より先に判定する
  }

  /* モバイルのメニュー開閉(本体サイトのドロワーと同じ役割) */
  function wireDrawer() {
    const burger = document.getElementById("mzscBurger");
    const drawer = document.getElementById("mzscDrawer");
    if (!burger || !drawer) return;
    let prevOverflow = null;
    const setOpen = open => {
      drawer.hidden = !open;
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      // 開く前の値を覚えて戻す(他の箇所が指定していても巻き添えで消さない)
      if (open) {
        if (prevOverflow === null) prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
      } else if (prevOverflow !== null) {
        document.documentElement.style.overflow = prevOverflow;
        prevOverflow = null;
      }
    };
    burger.addEventListener("click", () => setOpen(drawer.hidden));
    drawer.querySelectorAll("[data-mzsc-close]").forEach(b => b.addEventListener("click", () => setOpen(false)));
    drawer.querySelectorAll("a").forEach(a => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !drawer.hidden) setOpen(false); });
  }

  return { mount };
})();

document.addEventListener("DOMContentLoaded", () => {
  const id = document.body.getAttribute("data-mz-tool");
  if (id) MZSiteChrome.mount(id);
});
