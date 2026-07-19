"use strict";
/* ============ クリエイターツール共通: サイトの上下(TOPと同じ導線) ============
   3ツール(Switcher/ReAngle/Privacy)のヘッダー(ブランド+グローバルナビ)と
   フッター(「MarchinZで、できること。」+サイトフッター)を同じ内容で差し込む。
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

  /* TOPの「マーチンズ/MarchinZで、できること。」と同じ3項目 */
  const CAN = [
    {
      title: "参加/観戦の記録を、すぐに残せる。",
      links: [["/#community/events", "MarchinZ Log"], ["/#community/notes", "MarchinZ Note"]],
      desc: "マーチングイベントの記録を、観戦・出演・チームスタッフ・運営、自分の形で残せる「MarchinZ Log」。写真付きの「MarchinZ Note」も作成できます。",
    },
    {
      title: "動画を見つけて、シェア。",
      links: [["/#videos", "大会動画"], ["/#youtube", "YouTube"]],
      desc: "大会動画やYouTube チャンネルの検索。団体/チームごとに、気に入った動画をまとめて友人・仲間・家族にURLでシェアできます。",
    },
    {
      title: "コミュニティで、熱気を広げられる。",
      links: [["/#community/board", "MarchinZ Board"]],
      desc: "募集・告知・質問などテーマ別の掲示板。ショウの余韻を次の楽しみへつなぐ場です。",
    },
  ];

  const FOOT_COLS = [
    [["/#top", "TOP"], ["/#videos", "大会動画"], ["/#youtube", "YouTube"],
     ["/#webmagazine", "メディア"], ["/#creators", "クリエイター"]],
    [["/#community/events", "イベント"], ["/#community/moments", "モーメント"],
     ["/#community/board", "掲示板"], ["/#community/notes", "ノート"], ["/#profile", "マイページ"]],
    [["/#ops", "運営について"], ["/#terms", "利用規約"], ["/#privacy", "プライバシーポリシー"]],
  ];

  /* 3ツールの相互リンク(自分は出さない) */
  const TOOLS = [
    ["switcher", "/tools/switcher/", "Switcher（同期・カット割）"],
    ["reangle", "/tools/reangle/", "ReAngle（正面補正）"],
    ["privacy", "/tools/privacy/", "Privacy（顔モザイク）"],
  ];

  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M18.9 2h3.68l-8.04 9.19L24 22h-7.41l-5.8-7.58L4.16 22H.47l8.6-9.83L0 2h7.6l5.24 6.91L18.9 2zm-1.29 17.8h2.04L6.49 4.1H4.3L17.61 19.8z" fill="currentColor"></path></svg>';

  /* ヘッダー: ブランド + グローバルナビ(TOPと同じ並び) */
  function headerHtml() {
    const nav = NAV.map(([href, label]) =>
      `<a href="${href}"${href === "/#creators" ? ' class="on"' : ""}>${esc(label)}</a>`).join("");
    return `
<header class="mzsc-brand">
  <div class="mzsc-brand-inner">
    <div>
      <a href="/#top" class="mzsc-brand-logo" aria-label="MarchinZ ホームへ">
        <img src="/logo/marchinz-logo.png" alt="MarchinZ / マーチンズ" width="224" decoding="async" onerror="this.style.display='none'">
      </a>
      <p class="mzsc-brand-tagline">残す、見つける、盛り上げる！<br>マーチングコミュニティ「マーチンズ/MarchinZ」</p>
    </div>
    <div class="mzsc-brand-right">
      <a href="/#signup" class="mzsc-brand-btn mzsc-brand-btn--primary">はじめての方</a>
      <a href="/#login" class="mzsc-brand-btn">ログイン</a>
    </div>
  </div>
</header>
<nav class="mzsc-nav" aria-label="サイト内ページ"><div class="mzsc-nav-inner">${nav}</div></nav>`;
  }

  /* フッター: 「できること」+ バナー + リンク集 + コピーライト */
  function footerHtml(toolId) {
    const cans = CAN.map(c => `
      <li class="mzsc-can-item">
        <h3>${esc(c.title)}</h3>
        <div class="mzsc-can-links">${c.links.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join("")}</div>
        <p>${esc(c.desc)}</p>
      </li>`).join("");
    const cols = FOOT_COLS.map(col =>
      `<div class="mzsc-foot-col">${col.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join("")}</div>`).join("");
    const others = TOOLS.filter(t => t[0] !== toolId)
      .map(([, href, label]) => `<a href="${href}">${esc(label)}</a>`).join(" ／ ");
    const ver = document.documentElement.getAttribute("data-mz-version");
    return `
<footer class="mzsc-foot">
  <section class="mzsc-can">
    <div class="mzsc-can-inner">
      <h2>マーチンズ/MarchinZで、できること。</h2>
      <p class="mzsc-can-sub">プレイヤーもファンもチームスタッフも運営も。役割を問わず「マーチングの熱量」を形に残していきます。</p>
      <ul class="mzsc-can-grid">${cans}</ul>
    </div>
  </section>
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
  <p class="mzsc-foot-tools">つづけて使う: ${others}</p>
  <p class="mzsc-foot-copy">©️ MarchinZ 2026${ver ? ` <span lang="en">ver. ${esc(ver)}</span>` : ""}</p>
</footer>`;
  }

  /* ツールのページへ差し込む。
     toolId: "switcher" | "reangle" | "privacy"(相互リンクで自分を外すため) */
  function mount(toolId) {
    const body = document.body;
    // ヘッダーは既存のツールバー(.topbar / header)より前へ
    const head = document.createElement("div");
    head.innerHTML = headerHtml();
    body.insertBefore(head, body.firstChild);
    // フッターは既存の <footer> を置き換える(無ければ末尾へ)
    const old = document.querySelector("body > footer");
    const foot = document.createElement("div");
    foot.innerHTML = footerHtml(toolId);
    if (old) old.replaceWith(foot); else body.appendChild(foot);
  }

  return { mount };
})();

document.addEventListener("DOMContentLoaded", () => {
  const id = document.body.getAttribute("data-mz-tool");
  if (id) MZSiteChrome.mount(id);
});
