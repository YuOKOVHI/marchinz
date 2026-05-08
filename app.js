/**
 * MarchinZ — 大会動画検索・おすすめ・シェア
 * データ: data.json / data.inline.js（CSV は sync_csv_to_json で生成）
 */
(() => {
  const PAGE_SIZE_OPTIONS = [5, 10, 30, 50, 100];
  const SEARCH_DEBOUNCE_MS = 250;
  const RECENT_SEARCH_IDLE_MS = 3000;
  /** おすすめ候補の内部上限（表示は recommendVisibleCount で制御） */
  const RECOMMEND_POOL_MAX = 100;
  const RECOMMEND_INITIAL = 3;
  const RECOMMEND_FIRST_EXPAND = 10;
  const RECOMMEND_STEP = 10;
  const SHARE_X_SUFFIX = " @marchinz2026";
  const SHARE_PUBLIC_BASE_URL = "https://marchinz.netlify.app";
  const LS_KEY_RECENT_SEARCHES = "marchinz_recent_searches_v1";
  /** 動画カード行の「シェアする」（検索結果シェアと同じ CTA 配色） */
  const ROW_SHARE_BTN_CLASS = "btn-share-search btn-marchinz-spotlight share-toggle";

  /** 一覧の並べ替えキー（data-sort・URL の sort= と一致） */
  const SORT_KEYS = ["配信日", "団体/チーム", "配信元"];
  const INITIAL_RANDOM_TEAMS = ["YOKOHAMA ROBINS", "インスタントコー", "GENESIS", "THE FOCUS"];
  const INITIAL_RANDOM_TEAM_SET = new Set(INITIAL_RANDOM_TEAMS);

  const state = {
    rows: [],
    filtered: [],
    sortKey: "配信日",
    sortDir: "desc",
    tab: "マーチング団体等",
    /** 1 始まり */
    page: 1,
    /** 一覧の1ページあたり件数 */
    pageSize: 10,
    /** 「もっと見る」で同一ページ内に追加したバッチ数（1バッチ＝表示件数ぶん） */
    listLoadMoreExtra: 0,
    /** カードの団体名クリック時のみ。検索入力で解除 */
    exactOrgTeam: null,
    exactEvent: null,
    /** 一覧表示パネル（団体/チーム名）を開いているか */
    browseOpen: false,
    /** おすすめで表示する件数（検索のたびに RECOMMEND_INITIAL に戻す） */
    recommendVisibleCount: RECOMMEND_INITIAL,
    /** 表示中タグで手動除外した団体/チーム名 */
    excludedOrgTeams: new Set(),
    recentSearches: [],
  };

  /** 団体/チーム名 ↔ URL 用の短い安定 ID（`data` 読み込み後に `rebuildMarchinzOrgMaps` で構築） */
  let marchinzOrgIdToName = new Map();
  let marchinzNameToOrgId = new Map();

  const $ = (sel) => document.querySelector(sel);
  const collatorJa = new Intl.Collator("ja", { sensitivity: "base" });

  /** 日本語→英語→数字 の順。marchinz-sort.js を優先（未読込時は JA Collation で代替） */
  function compareScriptOrder(a, b) {
    if (
      typeof MarchinZSort !== "undefined" &&
      MarchinZSort &&
      typeof MarchinZSort.compare === "function"
    ) {
      return MarchinZSort.compare(a, b);
    }
    return collatorJa.compare(String(a), String(b));
  }

  const videoList = $("#video-list");
  const resultsSkeleton = $("#results-skeleton");
  const resultsPanel = $("#results-panel");
  const pageVideos = $("#page-videos");
  const qTeam = $("#q-team");
  const qEvent = $("#q-event");
  const qFree = $("#q-free");
  const optMatchExact = $("#opt-match-exact");
  const optCrossBoth = $("#opt-cross-both");
  const mix3Notice = $("#mix3-notice");
  const browseByOrg = $("#browse-by-org");
  const browseByOrgLabel = $("#browse-by-org-label");
  const browseByOrgCount = $("#browse-by-org-count");
  const browseButtonList = $("#browse-button-list");
  const pageFirst = $("#page-first");
  const pagePrev = $("#page-prev");
  const pageNext = $("#page-next");
  const pageLast = $("#page-last");
  const paginationStatus = $("#pagination-status");
  const pageSizeSelect = $("#page-size");
  const videoListMoreBtn = $("#video-list-more");
  const videoResultMoreWrap = $("#video-result-more-wrap");
  const visibleOrgs = $("#visible-orgs");
  const recommendSection = $("#recommend-section");
  const recommendList = $("#recommend-list");
  const recommendMoreBtn = $("#recommend-more");
  const btnResetSearch = $("#btn-reset-search");
  const shareSearchBtns = () => document.querySelectorAll("[data-marchinz-search-share]");
  const btnResetRecentSearches = $("#btn-reset-recent-searches");
  const recentSearchesEl = $("#recent-searches");

  function updateMix3NoticeVisibility() {
    if (!mix3Notice) return;
    const inVideosPage = !pageVideos || pageVideos.hidden === false;
    const threecrossTab = document.getElementById("tab-threecross");
    const show = inVideosPage && threecrossTab?.getAttribute("aria-selected") === "true";
    mix3Notice.hidden = !show;
  }

  /** サイトでは非表示だがシェア文などで利用 */
  function rowDisplayName(row) {
    return row["動画での表示名"] ?? row["チーム名"] ?? row["団体"] ?? "";
  }

  /** 表の1列目。空の行はサイトでは出さない */
  function rowOrgTeam(row) {
    return row["団体/チーム名"] ?? row["団体名"] ?? "";
  }

  /** CSV の団体 ID（空ならブラウザ側で名前から決定論 ID にフォールバック） */
  function rowOrgId(row) {
    return String(row["団体ID"] ?? "").trim();
  }

  function marchinzCsvOrgIdValid(id) {
    const s = String(id || "").trim();
    if (!s || s.length > 48) return false;
    return /^[A-Za-z0-9_-]+$/.test(s);
  }

  const DEFAULT_CHANNEL_NAME = "マーチング祭";
  const DEFAULT_CHANNEL_URL = "https://www.youtube.com/@marching-matsuri";

  function rowChannelName(row) {
    const n = String(row["動画配信元"] ?? "").trim();
    return n || DEFAULT_CHANNEL_NAME;
  }

  function rowChannelUrl(row) {
    const u = String(row["動画配信元URL"] ?? "").trim();
    return u || DEFAULT_CHANNEL_URL;
  }

  /** @type {{ byUrl: Map<string,string>; byChannelId: Map<string,string>; byName: Map<string,string> } | null} */
  let youtubeLogoIndexes = null;

  /** YouTube チャンネルページ URL をホスト＋パスで正規化（一覧CSVと大会動画CSVの表記ゆれを吸収） */
  function normalizeYoutubeChannelUrlKey(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    let href = s;
    if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
    try {
      const u = new URL(href);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      let path = (u.pathname || "/").replace(/\/+$/, "");
      const stripTail = [
        "/videos",
        "/featured",
        "/about",
        "/shorts",
        "/streams",
        "/live",
        "/playlists",
        "/community",
      ];
      for (let i = 0; i < 4; i += 1) {
        let cut = false;
        for (const seg of stripTail) {
          if (path.toLowerCase().endsWith(seg)) {
            path = path.slice(0, -seg.length).replace(/\/+$/, "");
            cut = true;
            break;
          }
        }
        if (!cut) break;
      }
      path = path.toLowerCase();
      return `${host}${path}`;
    } catch {
      return "";
    }
  }

  /** チャンネル名のゆらぎ吸収（一覧の正式名 ↔ CSV の短縮名） */
  function normalizeBroadcasterNameKey(raw) {
    return String(raw ?? "")
      .normalize("NFKC")
      .replace(/[\s\u3000]+/g, "")
      .replace(/[®™♪♫・]/g, "")
      .toLowerCase();
  }

  /** Google CDN のロゴ URL を読み込み安定な解像度パラメータへ統一 */
  function upgradeYoutubeAvatarUrl(url) {
    let u = String(url ?? "").trim();
    if (!u || !/^https?:\/\//i.test(u)) return "";
    if (/yt\d?\.googleusercontent\.com/i.test(u)) {
      u = u.replace(
        /=s\d+(?:-c-k-c[^=&]*)?(?=&|$)/i,
        "=s176-c-k-c0x00ffffff-no-rj",
      );
    }
    return u.slice(0, 2048);
  }

  /** 404 等のとき段階的に別解像度を試す（1 回目失敗で次 URL へ） */
  function youtubeAvatarFallbackUrls(primary) {
    const u = String(primary ?? "").trim();
    if (!u) return [];
    const out = [];
    const seen = new Set();
    const push = (x) => {
      const t = String(x ?? "").trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };
    push(u);
    if (/yt\d?\.googleusercontent\.com/i.test(u)) {
      push(
        u.replace(
          /=s\d+(?:-c-k-c[^=&]*)?(?=&|$)/i,
          "=s88-c-k-c0x00ffffff-no-rj",
        ),
      );
      push(
        u.replace(
          /=s\d+(?:-c-k-c[^=&]*)?(?=&|$)/i,
          "=s48-c-k-c0x00ffffff-no-rj",
        ),
      );
      push(
        u.replace(
          /=s\d+(?:-c-k-c[^=&]*)?(?=&|$)/i,
          "=s0",
        ),
      );
    }
    return out;
  }

  function extractYoutubeChannelIdFromUrl(raw) {
    const m = String(raw ?? "").match(/\/channel\/(UC[\w-]{10,33})\b/i);
    return m ? m[1].toUpperCase() : "";
  }

  function getYoutubeLogoIndexes() {
    if (youtubeLogoIndexes) return youtubeLogoIndexes;
    const byUrl = new Map();
    const byChannelId = new Map();
    const byName = new Map();
    const rows = window.__YOUTUBE_LIST_ROWS;
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const curl = String(r["チャンネルURL"] ?? "").trim();
        const logoRaw = String(
          r["ロゴ画像URL"] ?? r["\ufeffロゴ画像URL"] ?? "",
        ).trim();
        if (!/^https?:\/\//i.test(logoRaw)) continue;
        const logo = upgradeYoutubeAvatarUrl(logoRaw);
        const kUrl = normalizeYoutubeChannelUrlKey(curl);
        if (kUrl && logo) byUrl.set(kUrl, logo);
        const cid = extractYoutubeChannelIdFromUrl(curl);
        if (cid && logo) byChannelId.set(cid, logo);
        const nm = String(r["チャンネル名"] ?? "").trim();
        const nk = nm ? normalizeBroadcasterNameKey(nm) : "";
        if (nk && logo) byName.set(nk, logo);
      }
    }
    youtubeLogoIndexes = { byUrl, byChannelId, byName };
    return youtubeLogoIndexes;
  }

  /** 頭文字：記号・括弧書きを避け、グレーム単位で先頭の読みやすい1文字 */
  function channelAvatarInitial(displayName) {
    let s = String(displayName ?? "").normalize("NFKC").trim();
    if (!s) return "?";
    s = s.replace(/^[\s【（\[〝『]+/u, "").trim();
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      try {
        const seg = new Intl.Segmenter("ja", { granularity: "grapheme" });
        for (const { segment } of seg.segment(s)) {
          const t = segment.trim();
          if (!t) continue;
          if (/^[\p{P}\p{S}]/u.test(t)) continue;
          return t.slice(0, 1);
        }
      } catch {
        //
      }
    }
    const first = [...s][0];
    return first || "?";
  }

  /** 行の明示 URL → YouTube 一覧（URL・チャンネルID・チャンネル名の順でフォールバック） */
  function rowChannelLogoUrl(row) {
    for (const key of [
      "動画配信元ロゴURL",
      "配信元ロゴURL",
      "\ufeff動画配信元ロゴURL",
    ]) {
      const s = String(row[key] ?? "").trim();
      if (/^https?:\/\//i.test(s)) return upgradeYoutubeAvatarUrl(s);
    }
    const ch = rowChannelUrl(row);
    if (!ch) return "";
    const idx = getYoutubeLogoIndexes();
    const nk = normalizeYoutubeChannelUrlKey(ch);
    let logo = (nk && idx.byUrl.get(nk)) || "";
    if (!logo) {
      const cid = extractYoutubeChannelIdFromUrl(ch);
      if (cid) logo = idx.byChannelId.get(cid) || "";
    }
    if (!logo) {
      const kn = normalizeBroadcasterNameKey(rowChannelName(row));
      if (kn) {
        logo = idx.byName.get(kn) || "";
        if (!logo && kn.length >= 4) {
          const hits = [];
          for (const [k, v] of idx.byName.entries()) {
            if (k.includes(kn) || kn.includes(k)) hits.push(v);
          }
          if (hits.length === 1) logo = hits[0];
        }
      }
    }
    return logo || "";
  }

  function rowCategory(row) {
    if (row["分類"]) return row["分類"];
    const title = row["大会名"] || "";
    const cf = title.toLowerCase();
    if (cf.includes("mix3") || title.includes("スリークロス")) {
      return "スリークロスチーム";
    }
    return "マーチング団体等";
  }

  function isDrumcorpsFunTvChannelRow(row) {
    return String(rowChannelName(row) || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .includes("drumcorpsfuntv");
  }

  /**
   * DrumcorpsfunTV × 注目チーム（INITIAL_RANDOM 相当）向け：決勝／WINNERS を
   * 「出場チーム紹介」等の前に並べるためのスコア。0 は「このルール対象外」。
   */
  function drumcorpsFinalVsIntroBonus(row) {
    if (!isDrumcorpsFunTvChannelRow(row)) return 0;
    const org = String(rowOrgTeam(row) ?? "").trim();
    if (!INITIAL_RANDOM_TEAM_SET.has(org)) return 0;
    const raw = String(row["大会名"] ?? "").normalize("NFKC");
    const tl = raw.toLowerCase();
    if (/出場チーム紹介/.test(raw) || /\d{4}\s*横浜\s*[｜|]\s*出場チーム/.test(raw)) return -120;
    const looksFinal =
      /決勝|最終戦|決勝戦|ファイナル|winner'?s\s*show|ウィナーズ|winners|\bfinal\b|ＦＩＮＡＬ/.test(raw) ||
      /決勝|最終戦|決勝戦|ファイナル|winner'?s\s*show|ウィナーズ|winners|\bfinal\b/.test(tl);
    if (!looksFinal && /チーム紹介/.test(raw)) return -70;
    if (looksFinal) return 140;
    if (/準決勝/.test(raw)) return 75;
    if (/ダイジェスト|digest|\[digest/.test(tl)) return 28;
    if (/エキシビジョン|エキシビション|ガラ|ショーケース/.test(raw)) return 20;
    return 36;
  }

  /** 主キーが同順位のときのみ。どちらかが対象外(0)なら触らない（他配信源の順を固定） */
  function drumcorpsFinalIntroPairCmp(a, b) {
    const sa = drumcorpsFinalVsIntroBonus(a);
    const sb = drumcorpsFinalVsIntroBonus(b);
    if (sa === 0 || sb === 0) return 0;
    if (sa !== sb) return sb - sa;
    return 0;
  }

  function isVisibleRow(row) {
    return String(rowOrgTeam(row) ?? "").trim() !== "";
  }

  function rowsInCurrentTab() {
    return state.rows.filter((r) => rowCategory(r) === state.tab && isVisibleRow(r));
  }

  /** 分類タブごとの行（おすすめで「逆側」を優先するときに使用） */
  function rowsInCategory(category) {
    return state.rows.filter((r) => rowCategory(r) === category && isVisibleRow(r));
  }

  function sortBrowseStrings(arr) {
    const uniq = [...new Set(arr)];
    return uniq.sort((a, b) => compareScriptOrder(String(a), String(b)));
  }

  function uniqOrgNamesForTab() {
    const set = new Set();
    for (const r of rowsInCurrentTab()) {
      const v = rowOrgTeam(r).trim();
      if (v) set.add(v);
    }
    return sortBrowseStrings([...set]);
  }

  function renderBrowsePanel() {
    if (!browseButtonList || !browseByOrg) return;

    const mainLabel = state.tab === "スリークロスチーム" ? "チーム一覧表示" : "団体一覧表示";
    const countUnit = state.tab === "スリークロスチーム" ? "チーム" : "団体";
    const browseN = uniqOrgNamesForTab().length;
    if (browseByOrgLabel) browseByOrgLabel.textContent = mainLabel;
    if (browseByOrgCount) browseByOrgCount.textContent = `${browseN}${countUnit}`;
    browseByOrg.setAttribute("aria-label", `${mainLabel}（${browseN}${countUnit}）`);

    if (!state.browseOpen) {
      browseButtonList.hidden = true;
      browseButtonList.innerHTML = "";
      browseByOrg.setAttribute("aria-expanded", "false");
      browseByOrg.classList.remove("browse-trigger-active");
      return;
    }

    const currentCategory = state.tab;
    const values = sortBrowseStrings(
      rowsInCategory(currentCategory)
        .map((r) => rowOrgTeam(r).trim())
        .filter(Boolean)
    );
    browseButtonList.innerHTML = "";
    for (const val of values) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "browse-chip";
      b.textContent = val;
      b.title = val;
      b.addEventListener("click", () => {
        cancelSearchDebounce();
        state.exactOrgTeam = val;
        state.exactEvent = null;
        if (qTeam) qTeam.value = val;
        if (qEvent) qEvent.value = "";
        if (qFree) qFree.value = "";
        state.browseOpen = false;
        applyFilter();
        renderBrowsePanel();
      });
      browseButtonList.appendChild(b);
    }

    browseButtonList.hidden = false;
    browseByOrg.setAttribute("aria-expanded", "true");
    browseByOrg.classList.add("browse-trigger-active");
  }

  function shareText(row) {
    const orgTeam = rowOrgTeam(row);
    const display = rowDisplayName(row);
    const ev = row["大会名"] ?? "";
    const url = row["URL"] ?? "";
    let line1 = orgTeam;
    if (orgTeam && display && display !== orgTeam) {
      line1 = `${orgTeam}（${display}）`;
    } else if (!orgTeam) {
      line1 = display;
    }
    return `${line1}\n${ev}\n${url}\nマーチンズからシェアしました♪`;
  }

  /**
   * クリックの同一スタック内で実行する同期コピー（Safari / iOS で Clipboard API が遅延失敗する場合の対策）
   */
  function tryExecCommandCopy(t) {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.cssText =
        "position:fixed;left:0;top:0;width:2px;height:2px;padding:0;border:0;outline:0;opacity:0;";
      ta.setAttribute("aria-hidden", "true");
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, t.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function copyText(t) {
    if (tryExecCommandCopy(t)) {
      return Promise.resolve();
    }
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(t);
    }
    return Promise.reject(new Error("copy unavailable"));
  }

  function loadJsonStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJsonStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }

  function setSearchOverlay(_show) {}

  function trackEvent(name, payload = {}) {
    const k = `marchinz_metric_${name}`;
    try {
      const c = Number.parseInt(localStorage.getItem(k) || "0", 10) || 0;
      localStorage.setItem(k, String(c + 1));
    } catch {
      // ignore local metric failure
    }
    if (typeof window.plausible === "function") {
      window.plausible(name, { props: payload });
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", name, payload);
    }
  }
  window.MarchinZTrackEvent = trackEvent;

  function currentSearchState() {
    return {
      team: (qTeam?.value ?? "").trim(),
      event: (qEvent?.value ?? "").trim(),
      free: (qFree?.value ?? "").trim(),
      tab: state.tab,
      sortKey: state.sortKey,
      sortDir: state.sortDir,
    };
  }

  function applySavedSearchCriteria(c) {
    if (!c) return;
    cancelSearchDebounce();
    clearExactFilters();
    clearExcludedOrgs();
    state.tab = c.tab === "スリークロスチーム" ? "スリークロスチーム" : "マーチング団体等";
    state.sortKey = SORT_KEYS.includes(c.sortKey) ? c.sortKey : "配信日";
    state.sortDir = c.sortDir === "asc" ? "asc" : "desc";
    if (qTeam) qTeam.value = c.team || "";
    if (qEvent) qEvent.value = c.event || "";
    if (qFree) qFree.value = c.free || "";
    document.querySelectorAll('.tabs button[role="tab"]').forEach((b) => {
      const cat = b.getAttribute("data-category");
      b.setAttribute("aria-selected", cat === state.tab ? "true" : "false");
    });
    applyFilter();
    renderBrowsePanel();
  }

  function pushRecentSearch() {
    const c = currentSearchState();
    if (!c.team && !c.event && !c.free) return;
    const label = [c.team, c.event, c.free].filter(Boolean).join(" / ");
    if (!label) return;
    const dedup = state.recentSearches.filter((x) => x.label !== label);
    state.recentSearches = [{ id: `${Date.now()}`, label, criteria: c }, ...dedup].slice(0, 10);
    saveJsonStorage(LS_KEY_RECENT_SEARCHES, state.recentSearches);
    renderRecentSearches();
    trackEvent("search_executed", { label });
    trackEvent("search_run", { tab: state.tab, has_team: Boolean(c.team), has_event: Boolean(c.event), has_free: Boolean(c.free) });
  }

  function renderSearchList(target, arr, emptyText) {
    if (!target) return;
    target.innerHTML = "";
    if (!arr.length) {
      const p = document.createElement("p");
      p.className = "search-presets-empty";
      p.textContent = emptyText;
      target.appendChild(p);
      return;
    }
    for (const item of arr) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "browse-chip";
      b.textContent = item.label;
      b.title = item.label;
      b.addEventListener("click", () => applySavedSearchCriteria(item.criteria));
      target.appendChild(b);
    }
  }

  function renderRecentSearches() {
    renderSearchList(recentSearchesEl, state.recentSearches, "最近検索した単語はまだありません。");
  }

  function openShare(kind, row) {
    const text = shareText(row);
    const url = row["URL"] || "";
    const enc = encodeURIComponent(text);
    const encUrl = encodeURIComponent(url);

    switch (kind) {
      case "copy":
        trackEvent("share_click", { kind, target: "card" });
        copyText(text)
          .then(() => alert("コピーしました"))
          .catch(() => alert("コピーに失敗しました。"));
        break;
      case "x": {
        trackEvent("share_click", { kind, target: "card" });
        const textX = `${text}${SHARE_X_SUFFIX}`;
        const encX = encodeURIComponent(textX);
        window.open(
          `https://twitter.com/intent/tweet?text=${encX}`,
          "_blank",
          "noopener,noreferrer"
        );
        break;
      }
      case "line":
        trackEvent("share_click", { kind, target: "card" });
        window.open(`https://line.me/R/msg/text/?${enc}`, "_blank", "noopener,noreferrer");
        break;
      case "facebook":
        trackEvent("share_click", { kind, target: "card" });
        window.open(
          `https://www.facebook.com/sharer/sharer.php?u=${encUrl}&quote=${enc}`,
          "_blank",
          "noopener,noreferrer"
        );
        break;
      case "instagram": {
        trackEvent("share_click", { kind, target: "card" });
        const notifyCopyOk = () => {
          alert(
            "シェア用の文をコピーしました。\nInstagramで新規投稿を開き、キャプションに貼り付けてください。"
          );
        };
        const notifyCopyFail = () => {
          alert(
            "クリップボードにコピーできませんでした。表示された文を手動でコピーしてください。"
          );
        };
        const runCopy = () => {
          copyText(text).then(notifyCopyOk).catch(notifyCopyFail);
        };

        if (typeof navigator.share === "function") {
          const shareData = { text };
          const canTry =
            typeof navigator.canShare !== "function" || navigator.canShare(shareData);
          if (canTry) {
            navigator
              .share(shareData)
              .catch((err) => {
                if (err && err.name === "AbortError") return;
                runCopy();
              });
          } else {
            runCopy();
          }
        } else {
          runCopy();
        }
        break;
      }
      default:
        break;
    }
  }

  /** カード共通のシェア UI */
  function buildShareWrapForRow(row) {
      const wrap = document.createElement("div");
      wrap.className = "share-wrap";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = ROW_SHARE_BTN_CLASS;
      btn.textContent = "シェアする";
      const menu = document.createElement("div");
      menu.className = "share-menu";
      menu.hidden = true;
      const items = [
        ["copy", "リンクをコピー"],
        ["x", "Xでシェア"],
        ["line", "LINEでシェア"],
      ["instagram", "Instagramでシェア"],
        ["facebook", "Facebookでシェア"],
      ];
      for (const [k, label] of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openShare(k, row);
          menu.hidden = true;
        });
        menu.appendChild(b);
      }
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const willOpen = menu.hidden;
        document.querySelectorAll(".share-menu").forEach((m) => {
          m.hidden = true;
        });
        menu.hidden = !willOpen;
      });
      wrap.appendChild(btn);
      wrap.appendChild(menu);
    return wrap;
  }

  function normalize(s) {
    return (s || "").toString().toLowerCase();
  }

  function normalizeLoose(s) {
    return normalize(s).normalize("NFKC").replace(/\s+/g, "");
  }

  function hasTheFocusToken(s) {
    return normalizeLoose(s).includes("thefocus");
  }

  function sortValue(row, key) {
    if (key === "団体/チーム" || key === "団体/チーム名") return rowOrgTeam(row);
    if (key === "配信元" || key === "動画配信元") return rowChannelName(row);
    return row[key] ?? "";
  }

  /** 共有・履歴用の短いクエリキー。団体は `o=団体ID`（CSV「団体ID」優先・空なら団体名から導出）、従来の tab / team / t も readUrlState で読める */
  const SHARE_C_TO_TAB = { m: "マーチング団体等", x: "スリークロスチーム" };
  const SHARE_SORT_TO_S = { 配信日: "dt", "団体/チーム": "tm", 配信元: "ch" };
  const SHARE_S_TO_SORT = { dt: "配信日", tm: "団体/チーム", ch: "配信元" };

  function searchParamsToCompactQuery(p) {
    return p.toString().replace(/%20/g, "+");
  }

  function hashStringFnv1a32(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** 団体名から衝突しにくい短い ID（クエリ `o=` 用） */
  function marchinzStableOrgIdForName(name) {
    return `o${hashStringFnv1a32(`mzorg|${name}`).toString(36)}`;
  }

  function rebuildMarchinzOrgMaps() {
    marchinzOrgIdToName = new Map();
    marchinzNameToOrgId = new Map();
    for (const row of state.rows) {
      const name = rowOrgTeam(row).trim();
      const oid = rowOrgId(row);
      if (!oid || !marchinzCsvOrgIdValid(oid)) continue;
      if (name) {
        marchinzNameToOrgId.set(name, oid);
        const cur = marchinzOrgIdToName.get(oid);
        if (!marchinzOrgIdToName.has(oid) || !String(cur || "").trim()) {
          marchinzOrgIdToName.set(oid, name);
        }
      } else if (!marchinzOrgIdToName.has(oid)) {
        marchinzOrgIdToName.set(oid, "");
      }
    }
    const takenIds = new Set(marchinzOrgIdToName.keys());
    const names = new Set();
    for (const row of state.rows) {
      const n = rowOrgTeam(row).trim();
      if (n) names.add(n);
    }
    for (const name of names) {
      if (marchinzNameToOrgId.has(name)) continue;
      let id = marchinzStableOrgIdForName(name);
      let salt = 0;
      while (takenIds.has(id) && marchinzOrgIdToName.get(id) !== name) {
        salt += 1;
        id = marchinzStableOrgIdForName(`${name}\x00${salt}`);
      }
      takenIds.add(id);
      if (!marchinzOrgIdToName.has(id) && name) marchinzOrgIdToName.set(id, name);
      marchinzNameToOrgId.set(name, id);
    }
  }

  /** URL クエリから検索・タブ・並べ替えを復元。戻り値: URL に page があればその番号、なければ null */
  function readUrlState() {
    const p = new URLSearchParams(window.location.search);
    const tab = p.get("tab");
    const cTab = p.get("c");
    if (tab === "マーチング団体等" || tab === "スリークロスチーム") {
      state.tab = tab;
      document.querySelectorAll('.tabs button[role="tab"]').forEach((b) => {
        const cat = b.getAttribute("data-category");
        b.setAttribute("aria-selected", cat === tab ? "true" : "false");
      });
    } else if (cTab === "m" || cTab === "x") {
      const t = SHARE_C_TO_TAB[cTab];
      if (t) {
        state.tab = t;
        document.querySelectorAll('.tabs button[role="tab"]').forEach((b) => {
          const cat = b.getAttribute("data-category");
          b.setAttribute("aria-selected", cat === t ? "true" : "false");
        });
      }
    }
    if (qTeam) {
      const oid = p.get("o");
      if (oid && marchinzOrgIdToName.has(oid)) {
        qTeam.value = marchinzOrgIdToName.get(oid) || "";
      } else if (p.has("team") || p.has("t")) {
        const teamQ = p.has("team") ? p.get("team") : p.get("t");
        qTeam.value = teamQ ?? "";
      }
    }
    const eventQ = p.has("event") ? p.get("event") : p.get("e");
    if (qEvent && (p.has("event") || p.has("e"))) qEvent.value = eventQ ?? "";
    const freeQ = p.has("free") ? p.get("free") : p.get("f");
    if (qFree && (p.has("free") || p.has("f"))) qFree.value = freeQ ?? "";
    const sort = p.has("sort") ? p.get("sort") : p.get("s");
    if (sort) {
      if (SHARE_S_TO_SORT[sort]) {
        state.sortKey = SHARE_S_TO_SORT[sort];
      } else if (SORT_KEYS.includes(sort)) {
        state.sortKey = sort;
      } else if (sort === "動画配信元" || sort === "大会") {
        state.sortKey = "配信元";
      } else if (sort === "団体/チーム名") {
        state.sortKey = "団体/チーム";
      }
    }
    const dir = p.has("dir") ? p.get("dir") : p.get("d");
    if (dir === "asc" || dir === "desc") state.sortDir = dir;
    const ps = p.get("pageSize") ?? p.get("z");
    if (ps) {
      const n = Number.parseInt(ps, 10);
      if (PAGE_SIZE_OPTIONS.includes(n)) {
        state.pageSize = n;
        if (pageSizeSelect) pageSizeSelect.value = String(n);
      }
    }
    const pg = p.has("page") ? p.get("page") : p.get("p");
    if (pg) {
      const n = Math.max(1, parseInt(pg, 10) || 1);
      return n;
    }
    return null;
  }

  /**
   * 現在の検索状態を短いクエリで URL に反映（共有・replaceState 共通）。
   * フロー: `load` → `rebuildMarchinzOrgMaps` → `readUrlState`（`o` は CSV 団体 ID 優先の逆引き）。
   * 共有: `buildShareUrl` / `syncUrlState` はここ経由。団体は `marchinzNameToOrgId` があれば `o=`、なければ `t=`。
   */
  function buildShareSearchParams() {
    const p = new URLSearchParams();
    if (state.tab === "スリークロスチーム") {
      p.set("c", "x");
    } else if (state.tab !== "マーチング団体等") {
      p.set("tab", state.tab);
    }
    const team = (qTeam?.value ?? "").trim();
    const event = (qEvent?.value ?? "").trim();
    const free = (qFree?.value ?? "").trim();
    if (team) {
      const oid = marchinzNameToOrgId.get(team);
      if (oid) p.set("o", oid);
      else p.set("t", team);
    }
    if (event) p.set("e", event);
    if (free) p.set("f", free);
    if (state.sortKey !== "配信日") {
      const sc = SHARE_SORT_TO_S[state.sortKey];
      if (sc) p.set("s", sc);
      else p.set("s", state.sortKey);
    }
    if (state.sortDir !== "desc") p.set("d", state.sortDir);
    if (state.page > 1) p.set("p", String(state.page));
    if (state.pageSize !== 10) p.set("z", String(state.pageSize));
    return p;
  }

  function syncUrlState() {
    const p = buildShareSearchParams();
    const qs = searchParamsToCompactQuery(p);
    const hash = window.location.hash || "#top";
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${hash}`;
    history.replaceState(null, "", newUrl);
  }

  function buildShareUrl() {
    const p = buildShareSearchParams();
    const qs = searchParamsToCompactQuery(p);
    const hash = window.location.hash || "#top";
    if (window.location.protocol === "file:") {
      const fileName = window.location.pathname.split("/").pop() || "index.html";
      const base = String(SHARE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
      if (base) {
        return `${base}/${fileName}${qs ? `?${qs}` : ""}${hash}`;
      }
      return `${fileName}${qs ? `?${qs}` : ""}${hash}`;
    }
    return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}${hash}`;
  }

  /**
   * 検索シェアと同じく、公開サイト基準の絶対 URL（`#profile?…` など hash 全体を渡す）
   * @param {string} hashWithLeadingHash 例: `#profile?uid=…&tab=videos&mylist=…`
   */
  function buildAbsoluteUrlForHash(hashWithLeadingHash) {
    const h = String(hashWithLeadingHash || "#top").startsWith("#")
      ? String(hashWithLeadingHash)
      : `#${hashWithLeadingHash}`;
    if (window.location.protocol === "file:") {
      const fileName = window.location.pathname.split("/").pop() || "index.html";
      const base = String(SHARE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
      if (base) {
        return `${base}/${fileName}${h}`;
      }
      return `${fileName}${h}`;
    }
    return `${window.location.origin}${window.location.pathname}${h}`;
  }

  function currentSearchSummary() {
    const parts = [];
    const team = (qTeam?.value ?? "").trim();
    const event = (qEvent?.value ?? "").trim();
    const free = (qFree?.value ?? "").trim();
    if (team) parts.push(team);
    if (event) parts.push(event);
    if (free) parts.push(free);
    return parts.length ? parts.join(" / ") : "現在の検索条件";
  }

  function searchShareText() {
    const summary = currentSearchSummary();
    const url = buildShareUrl();
    const count = state.filtered.length;
    return `「${summary}」の動画一覧（${count}件）。マーチンズで作成。\n${url}`;
  }

  /** X 用: 1 行目の末尾にのみ @marchinz2026（改行より前）。以降の行（URL 等）はそのまま。 */
  function tweetTextWithXHandleOnFirstLine(fullText) {
    const i = fullText.indexOf("\n");
    if (i === -1) return `${fullText}${SHARE_X_SUFFIX}`;
    return `${fullText.slice(0, i)}${SHARE_X_SUFFIX}${fullText.slice(i)}`;
  }

  /**
   * @param {string} kind
   * @param {string} text
   * @param {string} url
   * @param {"search" | "mylist" | "mll"} analyticsTarget
   */
  function openSearchLikeShare(kind, text, url, analyticsTarget) {
    const target = analyticsTarget || "search";
    const enc = encodeURIComponent(text);
    const encUrl = encodeURIComponent(url);
    switch (kind) {
      case "copy":
        trackEvent("share_click", { kind, target });
        copyText(text)
          .then(() => alert("コピーしました"))
          .catch(() => alert("コピーに失敗しました。"));
        break;
      case "x": {
        trackEvent("share_click", { kind, target });
        const textX =
          target === "search" || target === "mylist" || target === "mll"
            ? tweetTextWithXHandleOnFirstLine(text)
            : `${text}${SHARE_X_SUFFIX}`;
        const encX = encodeURIComponent(textX);
        window.open(`https://twitter.com/intent/tweet?text=${encX}`, "_blank", "noopener,noreferrer");
        break;
      }
      case "line":
        trackEvent("share_click", { kind, target });
        window.open(`https://line.me/R/msg/text/?${enc}`, "_blank", "noopener,noreferrer");
        break;
      case "facebook":
        trackEvent("share_click", { kind, target });
        window.open(
          `https://www.facebook.com/sharer/sharer.php?u=${encUrl}&quote=${enc}`,
          "_blank",
          "noopener,noreferrer"
        );
        break;
      case "instagram": {
        trackEvent("share_click", { kind, target });
        const notifyCopyOk = () => {
          alert(
            "シェア用の文をコピーしました。\nInstagramで新規投稿を開き、キャプションに貼り付けてください。"
          );
        };
        const notifyCopyFail = () => {
          alert("クリップボードにコピーできませんでした。表示された文を手動でコピーしてください。");
        };
        const runCopy = () => copyText(text).then(notifyCopyOk).catch(notifyCopyFail);
        if (typeof navigator.share === "function") {
          const shareData = { text };
          const canTry =
            typeof navigator.canShare !== "function" || navigator.canShare(shareData);
          if (canTry) {
            navigator
              .share(shareData)
              .catch((err) => {
                if (err && err.name === "AbortError") return;
                runCopy();
              });
          } else {
            runCopy();
          }
        } else {
          runCopy();
        }
        break;
      }
      default:
        break;
    }
  }

  function openSearchShare(kind) {
    syncUrlState();
    openSearchLikeShare(kind, searchShareText(), buildShareUrl(), "search");
  }

  /**
   * 検索結果シェアと同型のドロップダウン（固定の文面・URL）
   * @param {HTMLButtonElement} btn
   * @param {string} shareText
   * @param {string} shareUrl
   * @param {"mylist"|"mll"} [shareTarget="mylist"] X シェア時のメンション挿入ルール用
   */
  function setupSearchLikeShareMenuForButton(btn, shareText, shareUrl, shareTarget = "mylist") {
    if (!btn || btn.closest(".share-wrap")) return;
    const parent = btn.parentElement;
    if (!parent) return;
    const wrap = document.createElement("div");
    wrap.className = "share-wrap search-share-wrap";
    parent.insertBefore(wrap, btn);
    wrap.appendChild(btn);

    btn.classList.add("share-toggle");
    const menu = document.createElement("div");
    menu.className = "share-menu";
    menu.hidden = true;
    const items = [
      ["copy", "リンクをコピー"],
      ["x", "Xでシェア"],
      ["line", "LINEでシェア"],
      ["instagram", "Instagramでシェア"],
      ["facebook", "Facebookでシェア"],
    ];
    for (const [k, label] of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openSearchLikeShare(k, shareText, shareUrl, shareTarget);
        menu.hidden = true;
      });
      menu.appendChild(b);
    }
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll(".share-menu").forEach((m) => {
        m.hidden = true;
      });
      menu.hidden = !willOpen;
    });
    wrap.appendChild(menu);
  }

  function setupSearchShareMenuForButton(btn) {
    if (!btn || btn.closest(".share-wrap")) return;
    const parent = btn.parentElement;
    if (!parent) return;
    const wrap = document.createElement("div");
    wrap.className = "share-wrap search-share-wrap";
    parent.insertBefore(wrap, btn);
    wrap.appendChild(btn);

    btn.classList.add("share-toggle");
    const menu = document.createElement("div");
    menu.className = "share-menu";
    menu.hidden = true;
    const items = [
      ["copy", "リンクをコピー"],
      ["x", "Xでシェア"],
      ["line", "LINEでシェア"],
      ["instagram", "Instagramでシェア"],
      ["facebook", "Facebookでシェア"],
    ];
    for (const [k, label] of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openSearchShare(k);
        menu.hidden = true;
      });
      menu.appendChild(b);
    }
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll(".share-menu").forEach((m) => {
        m.hidden = true;
      });
      menu.hidden = !willOpen;
    });
    wrap.appendChild(menu);
  }

  function setupSearchShareMenus() {
    shareSearchBtns().forEach((btn) => setupSearchShareMenuForButton(btn));
  }

  let searchDebounceTimer = null;
  let recentSearchTimer = null;

  function cancelSearchDebounce() {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    if (recentSearchTimer !== null) {
      clearTimeout(recentSearchTimer);
      recentSearchTimer = null;
    }
    setSearchOverlay(false);
  }

  function applyFilter() {
    state.recommendVisibleCount = RECOMMEND_INITIAL;
    const t = normalize((qTeam?.value ?? "").trim());
    const e = normalize((qEvent?.value ?? "").trim());
    const f = normalize((qFree?.value ?? "").trim());
    const selectedOrg = String(state.exactOrgTeam ?? "").trim();
    const isFocusQuery = hasTheFocusToken(qTeam?.value ?? "");
    const isFocusSelected = hasTheFocusToken(selectedOrg);
    const crossTabFocusMode = isFocusQuery || isFocusSelected;
    const hasSearchOrExact =
      crossTabFocusMode ||
      Boolean(t) ||
      Boolean(e) ||
      Boolean(f) ||
      state.exactOrgTeam !== null ||
      state.exactEvent !== null;
    const crossTabSearchMode = Boolean(optCrossBoth?.checked ?? true) && hasSearchOrExact;

    const useExactMatch = Boolean(optMatchExact?.checked);

    const sourceRows = crossTabSearchMode
      ? state.rows.filter((row) => isVisibleRow(row))
      : state.rows.filter((row) => rowCategory(row) === state.tab && isVisibleRow(row));

    state.filtered = sourceRows.filter((row) => {
      const orgTeam = normalize(rowOrgTeam(row));
      const display = normalize(rowDisplayName(row));
      const ev = normalize(row["大会名"]);
      const rawOrg = String(rowOrgTeam(row) ?? "").trim();
      const rawEvent = String(row["大会名"] ?? "").trim();
      const rowIsFocus = hasTheFocusToken(rawOrg) || hasTheFocusToken(rowDisplayName(row));

      if (state.excludedOrgTeams.has(rawOrg)) return false;

      if (state.exactOrgTeam !== null) {
        if (isFocusSelected) {
          if (rawOrg !== state.exactOrgTeam && !rowIsFocus) return false;
        } else if (rawOrg !== state.exactOrgTeam) {
          return false;
        }
      } else if (t) {
        const teamMatched = useExactMatch
          ? orgTeam === t || display === t
          : orgTeam.includes(t) || display.includes(t);
        if (!teamMatched) return false;
      }

      if (crossTabFocusMode && !state.exactOrgTeam && t && hasTheFocusToken(t) && !rowIsFocus) {
        return false;
      }

      if (state.exactEvent !== null) {
        if (rawEvent !== state.exactEvent) return false;
      } else if (e) {
        const eventMatched = useExactMatch ? ev === e : ev.includes(e);
        if (!eventMatched) return false;
      }

      const hay = normalize(
        [
          row["種別"],
          rowCategory(row),
          rowDisplayName(row),
          rowOrgTeam(row),
          row["配信日"],
          row["大会名"],
          row["URL"],
          rowChannelName(row),
          row["動画配信元URL"],
        ].join(" ")
      );
      if (f && !hay.includes(f)) return false;
      return true;
    });
    if (shouldUseInitialRandom()) {
      const matsuriOnly = state.filtered.filter((row) => isMarchingMatsuriVideo(row));
      state.filtered = applyInitialRandomOrder(matsuriOnly);
    } else {
      sortRows();
    }
    state.page = 1;
    state.listLoadMoreExtra = 0;
    document.querySelectorAll(".result-sort-bar button[data-sort]").forEach((btn) => {
      btn.classList.remove("sorted-asc", "sorted-desc");
      if (btn.getAttribute("data-sort") === state.sortKey) {
        btn.classList.add(state.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
    updateMix3NoticeVisibility();
    render();
    renderRecommendations();
  }

  function hasActiveListFilter() {
    if (state.exactOrgTeam !== null || state.exactEvent !== null) return true;
    if (
      (qTeam?.value ?? "").trim() ||
      (qEvent?.value ?? "").trim() ||
      (qFree?.value ?? "").trim()
    ) {
      return true;
    }
    return false;
  }

  function cmp(a, b, key) {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (key === "配信日") {
      const da = va || "0000-00-00";
      const db = vb || "0000-00-00";
      return da.localeCompare(db);
    }
    return compareScriptOrder(String(va), String(vb));
  }

  function sortRows() {
    const key = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    state.filtered.sort((a, b) => {
      const prim = cmp(a, b, key) * dir;
      if (prim !== 0) return prim;
      return drumcorpsFinalIntroPairCmp(a, b);
    });
  }

  function shuffleArray(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function shouldUseInitialRandom() {
    if (state.exactOrgTeam !== null || state.exactEvent !== null) return false;
    if ((qTeam?.value ?? "").trim()) return false;
    if ((qEvent?.value ?? "").trim()) return false;
    if ((qFree?.value ?? "").trim()) return false;
    if (state.excludedOrgTeams.size > 0) return false;
    return true;
  }

  function isMarchingMatsuriVideo(row) {
    const name = normalize(rowChannelName(row));
    const url = normalize(rowChannelUrl(row));
    if (name.includes("マーチング祭")) return true;
    if (url.includes("marching-matsuri")) return true;
    return false;
  }

  function applyInitialRandomOrder(rows) {
    const required = [];
    const usedUrls = new Set();
    const randomizedTeams = shuffleArray(INITIAL_RANDOM_TEAMS);
    for (const team of randomizedTeams) {
      const candidates = rows.filter((r) => String(rowOrgTeam(r) || "").trim() === team);
      if (!candidates.length) continue;
      const sortedByPref = [...candidates].sort((a, b) => {
        const ca = drumcorpsFinalVsIntroBonus(a);
        const cb = drumcorpsFinalVsIntroBonus(b);
        if (ca === cb) return 0;
        if (ca === 0) return 1;
        if (cb === 0) return -1;
        return cb - ca;
      });
      const bestPref = drumcorpsFinalVsIntroBonus(sortedByPref[0]);
      const pool =
        bestPref !== 0
          ? candidates.filter((r) => drumcorpsFinalVsIntroBonus(r) === bestPref)
          : candidates;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      const urlKey = String(picked["URL"] || "").trim();
      if (!urlKey || usedUrls.has(urlKey)) continue;
      required.push(picked);
      usedUrls.add(urlKey);
    }
    const remaining = shuffleArray(
      rows.filter((r) => {
        const urlKey = String(r["URL"] || "").trim();
        return urlKey && !usedUrls.has(urlKey);
      })
    );
    return [...required, ...remaining];
  }

  function normalizeForSim(s) {
    return String(s || "").normalize("NFKC").trim().toLowerCase();
  }

  function diceCoefficient(a, b) {
    const na = normalizeForSim(a);
    const nb = normalizeForSim(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.length < 2 || nb.length < 2) {
      return na.includes(nb) || nb.includes(na) ? 0.75 : 0;
    }
    const bigrams = (s) => {
      const arr = [];
      for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
      return arr;
    };
    const A = bigrams(na);
    const B = bigrams(nb);
    const map = new Map();
    for (const x of B) map.set(x, (map.get(x) || 0) + 1);
    let inter = 0;
    for (const x of A) {
      const c = map.get(x);
      if (c > 0) {
        inter++;
        map.set(x, c - 1);
      }
    }
    return (2 * inter) / (A.length + B.length);
  }

  function orgSimilarity(ref, candidate) {
    const d = diceCoefficient(ref, candidate);
    const na = normalizeForSim(ref);
    const nb = normalizeForSim(candidate);
    if (!na || !nb) return d;
    let bonus = 0;
    if (na !== nb) {
      if (na.includes(nb) || nb.includes(na)) bonus += 0.12;
      let i = 0;
      while (i < na.length && i < nb.length && na[i] === nb[i]) i++;
      bonus += Math.min(0.12, i * 0.015);
    }
    return Math.min(1, d + bonus);
  }

  function eventSimilarityToSet(refEvents, ev) {
    if (!refEvents.length || !ev) return 0;
    let best = 0;
    for (const re of refEvents) {
      best = Math.max(best, diceCoefficient(re, ev));
      const pa = re.split("｜")[0];
      const pb = ev.split("｜")[0];
      if (pa && pb) best = Math.max(best, diceCoefficient(pa, pb));
    }
    return best;
  }

  function referenceOrgForRecommendations() {
    if (state.exactOrgTeam) return state.exactOrgTeam;
    if (state.filtered.length) return rowOrgTeam(state.filtered[0]);
    return (qTeam?.value ?? "").trim();
  }

  function referenceEventsForRecommendations() {
    const out = [];
    const seen = new Set();
    if (state.exactEvent) {
      seen.add(state.exactEvent);
      out.push(state.exactEvent);
    }
    for (const r of state.filtered) {
      const ev = String(r["大会名"] ?? "").trim();
      if (ev && !seen.has(ev)) {
        seen.add(ev);
        out.push(ev);
      }
    }
    const qe = (qEvent?.value ?? "").trim();
    if (qe && !seen.has(qe)) out.push(qe);
    return out;
  }

  function referenceDatesForRecommendations() {
    const out = [];
    const seen = new Set();
    for (const r of state.filtered) {
      const d = String(r["配信日"] ?? "").trim();
      if (d && !seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    }
    return out;
  }

  /**
   * 検索結果一覧に含まれる URL は除外し、最大 RECOMMEND_POOL_MAX 件まで候補化。
   * 優先: いまのタブと逆側（マーチング閲覧→スリークロスを先に、スリークロス閲覧→マーチングを先に）。
   * 各プール内: 同じ配信日（別団体）→ 同じ大会（別団体）→ 似ている大会（別団体）。
   */
  function computeRecommendations() {
    const otherCategory =
      state.tab === "スリークロスチーム" ? "マーチング団体等" : "スリークロスチーム";
    const rowsPreferred = rowsInCategory(otherCategory);
    const rowsFallback = rowsInCurrentTab();

    const excluded = new Set(
      state.filtered.map((r) => String(r["URL"] ?? "").trim()).filter(Boolean)
    );
    const refEvents = referenceEventsForRecommendations();
    const refDates = referenceDatesForRecommendations();
    const excludedOrgs = new Set(
      state.filtered.map((r) => String(rowOrgTeam(r) ?? "").trim()).filter(Boolean)
    );

    const picked = [];
    const pickedUrls = new Set();

    function tryAdd(row) {
      const u = String(row["URL"] ?? "").trim();
      const org = String(rowOrgTeam(row) ?? "").trim();
      if (!u || pickedUrls.has(u) || excluded.has(u)) return false;
      if (org && excludedOrgs.has(org)) return false;
      pickedUrls.add(u);
      picked.push(row);
      return true;
    }

    function runPhases(tabRows) {
      if (!tabRows.length) return;

      if (picked.length < RECOMMEND_POOL_MAX && refDates.length) {
        const sameDate = tabRows
          .filter((row) => {
            const d = String(row["配信日"] ?? "").trim();
            return d && refDates.includes(d);
          })
          .sort((a, b) => cmp(a, b, "配信日") * -1);
        for (const row of sameDate) {
          if (picked.length >= RECOMMEND_POOL_MAX) return;
          tryAdd(row);
        }
      }

      if (picked.length < RECOMMEND_POOL_MAX && refEvents.length) {
        const sameEv = tabRows
          .filter((row) => {
            const ev = String(row["大会名"] ?? "").trim();
            return ev && refEvents.includes(ev);
          })
          .sort((a, b) => cmp(a, b, "配信日") * -1);
        for (const row of sameEv) {
          if (picked.length >= RECOMMEND_POOL_MAX) return;
          tryAdd(row);
        }
      }

      if (picked.length < RECOMMEND_POOL_MAX && refEvents.length) {
        const evScored = tabRows
          .map((row) => {
            const ev = String(row["大会名"] ?? "").trim();
            if (!ev) return null;
            const sim = eventSimilarityToSet(refEvents, ev);
            return { row, sim };
          })
          .filter(Boolean)
          .filter((x) => x.sim >= 0.12)
          .sort((a, b) => {
            if (b.sim !== a.sim) return b.sim - a.sim;
            return cmp(a.row, b.row, "配信日") * -1;
          });

        for (const { row } of evScored) {
          if (picked.length >= RECOMMEND_POOL_MAX) return;
          tryAdd(row);
        }
      }

      if (picked.length < RECOMMEND_POOL_MAX && refEvents.length) {
        const evScored = tabRows
          .map((row) => {
            const ev = String(row["大会名"] ?? "").trim();
            if (!ev) return null;
            const sim = eventSimilarityToSet(refEvents, ev);
            return { row, sim };
          })
          .filter(Boolean)
          .filter((x) => x.sim >= 0.06)
          .sort((a, b) => {
            if (b.sim !== a.sim) return b.sim - a.sim;
            return cmp(a.row, b.row, "配信日") * -1;
          });

        for (const { row } of evScored) {
          if (picked.length >= RECOMMEND_POOL_MAX) return;
          tryAdd(row);
        }
      }
    }

    runPhases(rowsPreferred);
    if (picked.length < RECOMMEND_POOL_MAX) {
      runPhases(rowsFallback);
    }

    return picked.slice(0, RECOMMEND_POOL_MAX);
  }

  /** YouTube の動画 ID を URL から取り出す（取れなければ null） */
  function youtubeVideoIdFromUrl(urlStr) {
    const s = String(urlStr ?? "").trim();
    if (!s) return null;
    try {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      if (host === "youtu.be") {
        const id = u.pathname.split("/").filter(Boolean)[0];
        return id && /^[\w-]{11}$/.test(id) ? id : null;
      }
      if (host.includes("youtube.com")) {
        if (u.pathname.startsWith("/embed/")) {
          const id = u.pathname.split("/")[2];
          return id && /^[\w-]{11}$/.test(id) ? id : null;
        }
        if (u.pathname.startsWith("/shorts/")) {
          const id = u.pathname.split("/")[2];
          return id && /^[\w-]{11}$/.test(id) ? id : null;
        }
        if (u.pathname.startsWith("/live/")) {
          const parts = u.pathname.split("/").filter(Boolean);
          const id = parts[0] === "live" ? parts[1] : null;
          return id && /^[\w-]{11}$/.test(id) ? id : null;
        }
        const v = u.searchParams.get("v");
        if (v && /^[\w-]{11}$/.test(v)) return v;
      }
    } catch {
      return null;
    }
    return null;
  }

  function youtubeThumbnailUrl(urlStr) {
    const id = youtubeVideoIdFromUrl(urlStr);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  }

  /**
   * URL末尾が `=<数字>s` なら、その部分だけ強調色で表示する。
   * 例: `...&t=9032s` の `=9032s`
   * @param {HTMLAnchorElement} a
   * @param {string} urlText
   */
  function renderUrlLineWithTimeAccent(a, urlText) {
    const raw = String(urlText || "");
    const m = raw.match(/=(\d+s)$/);
    if (!m || m.index == null) {
      a.textContent = raw;
      return;
    }
    const at = m.index;
    const pre = raw.slice(0, at);
    const accent = raw.slice(at);
    if (pre) a.appendChild(document.createTextNode(pre));
    const span = document.createElement("span");
    span.className = "recommend-item-url-accent";
    span.textContent = accent;
    a.appendChild(span);
  }

  function mobileOS() {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) return "android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
    return null;
  }

  /**
   * スマホでは YouTube リンクを優先的に公式アプリで開く（失敗時は Web にフォールバック）
   */
  function preferYouTubeApp(anchor, urlStr) {
    if (!anchor || !urlStr) return;
    const id = youtubeVideoIdFromUrl(urlStr);
    const os = mobileOS();
    if (!id || !os) return;
    anchor.addEventListener("click", (ev) => {
      trackEvent("video_open", { platform: "youtube_app_attempt" });
      ev.preventDefault();
      const webUrl = urlStr;
      const appUrl =
        os === "android"
          ? `intent://www.youtube.com/watch?v=${id}#Intent;package=com.google.android.youtube;scheme=https;end`
          : `youtube://watch?v=${id}`;
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        window.location.href = webUrl;
      }, 700);
      try {
        window.location.href = appUrl;
      } finally {
        window.setTimeout(() => {
          if (done) return;
          done = true;
          clearTimeout(timer);
        }, 1200);
      }
    });
  }

  function enhanceVideoLink(anchor, urlStr) {
    if (!anchor || !urlStr) return;
    anchor.addEventListener("click", () => {
      trackEvent("video_open", { platform: "web" });
    });
    preferYouTubeApp(anchor, urlStr);
  }

  /** 検索結果グリッドの列数（styles.css のブレークポイントと一致） */
  function getVideoResultGridColumnCount() {
    try {
      if (window.matchMedia("(min-width: 1200px)").matches) return 3;
      if (window.matchMedia("(min-width: 900px)").matches) return 2;
    } catch {
      //
    }
    return 1;
  }

  /**
   * おすすめ・検索結果の共通カード（サムネ＋本文左／シェア中央）
   * @param {{ rootTag?: 'li'|'div' }} [options]
   */
  function buildVideoCard(row, options = {}) {
    const rootTag = options.rootTag === "div" ? "div" : "li";
    const rootEl = document.createElement(rootTag);
    rootEl.className = "recommend-item";
    const orgTeam = rowOrgTeam(row);
    const eventTitle = String(row["大会名"] ?? "").trim();
    const urlStr = String(row["URL"] ?? "").trim();
    const dateStr = String(row["配信日"] ?? "").trim();
    const chName = rowChannelName(row);

    const chNameNorm = String(chName || "").toLowerCase();
    if (chNameNorm.includes("drumcorpsfuntv")) {
      rootEl.classList.add("recommend-item--drum");
    } else if (chNameNorm.includes("マーチング祭")) {
      rootEl.classList.add("recommend-item--marching");
    }

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "recommend-item-thumb-wrap";
    const thumbSrc = youtubeThumbnailUrl(urlStr);

    if (thumbSrc && urlStr) {
      const a = document.createElement("a");
      a.href = urlStr;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "recommend-item-thumb-link";
      a.title = "動画を開く";
      enhanceVideoLink(a, urlStr);
      const img = document.createElement("img");
      img.className = "recommend-item-thumb";
      img.src = thumbSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        a.remove();
        if (urlStr) {
          const fallback = document.createElement("a");
          fallback.href = urlStr;
          fallback.target = "_blank";
          fallback.rel = "noopener noreferrer";
          fallback.className = "recommend-item-thumb-fallback";
          fallback.title = "動画を開く";
          fallback.setAttribute("aria-label", "動画を開く");
          enhanceVideoLink(fallback, urlStr);
          thumbWrap.appendChild(fallback);
        } else {
          thumbWrap.classList.add("recommend-item-thumb-wrap--empty");
        }
      });
      a.appendChild(img);
      thumbWrap.appendChild(a);
    } else if (urlStr) {
      const fallback = document.createElement("a");
      fallback.href = urlStr;
      fallback.target = "_blank";
      fallback.rel = "noopener noreferrer";
      fallback.className = "recommend-item-thumb-fallback";
      fallback.title = "動画を開く";
      fallback.setAttribute("aria-label", "動画を開く");
      enhanceVideoLink(fallback, urlStr);
      thumbWrap.appendChild(fallback);
    } else if (thumbSrc) {
      const img = document.createElement("img");
      img.className = "recommend-item-thumb";
      img.src = thumbSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        thumbWrap.classList.add("recommend-item-thumb-wrap--empty");
        img.remove();
      });
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.classList.add("recommend-item-thumb-wrap--empty");
    }

    const body = document.createElement("div");
    body.className = "recommend-item-body";

    const ytInfoRow = document.createElement("div");
    ytInfoRow.className = "recommend-item-yt-info-row";

    const chUrlForRow = String(rowChannelUrl(row) ?? "").trim();

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "recommend-item-yt-avatar-wrap";
    const avTag = chUrlForRow ? "a" : "span";
    const avatarEl = document.createElement(avTag);
    avatarEl.className = "recommend-item-yt-avatar";
    if (chUrlForRow) {
      avatarEl.href = chUrlForRow;
      avatarEl.target = "_blank";
      avatarEl.rel = "noopener noreferrer";
      avatarEl.title = "配信元チャンネルを開く";
    }
    const avLetter = document.createElement("span");
    avLetter.className = "recommend-item-yt-avatar-letter";
    avLetter.textContent = channelAvatarInitial(chName);

    const logoUrl = rowChannelLogoUrl(row);
    const logoAttempts = youtubeAvatarFallbackUrls(logoUrl);
    if (logoAttempts.length) {
      avatarEl.classList.add("recommend-item-yt-avatar--has-img");
      const avImg = document.createElement("img");
      avImg.className = "recommend-item-yt-avatar-img";
      avImg.src = logoAttempts[0];
      avImg.alt = "";
      avImg.loading = "lazy";
      avImg.decoding = "async";
      avImg.referrerPolicy = "no-referrer";
      let attemptIdx = 0;
      avImg.addEventListener("error", () => {
        attemptIdx += 1;
        if (attemptIdx < logoAttempts.length) {
          avImg.src = logoAttempts[attemptIdx];
          return;
        }
        avImg.remove();
        avatarEl.classList.remove("recommend-item-yt-avatar--has-img");
        if (!avatarEl.querySelector(".recommend-item-yt-avatar-letter")) {
          avatarEl.appendChild(avLetter);
        }
      });
      avatarEl.appendChild(avImg);
    } else {
      avatarEl.appendChild(avLetter);
    }
    avatarWrap.appendChild(avatarEl);

    const textStack = document.createElement("div");
    textStack.className = "recommend-item-yt-text-stack";

    const headRow = document.createElement("div");
    headRow.className = "recommend-item-head-row";

    const orgLabel = String(orgTeam ?? "").trim() || rowDisplayName(row);
    const searchTeamVal = String(orgTeam ?? "").trim() || String(rowDisplayName(row) ?? "").trim();

    const orgSearchWrap = document.createElement("span");
    orgSearchWrap.className = "recommend-item-org-search-wrap";

    const orgEl = document.createElement("span");
    orgEl.className = "recommend-item-org";
    orgEl.textContent = orgLabel;
    orgSearchWrap.appendChild(orgEl);

    if (searchTeamVal) {
      const teamSearchBtn = document.createElement("button");
      teamSearchBtn.type = "button";
      teamSearchBtn.className = "recommend-item-team-search-btn btn-share-search btn-marchinz-spotlight";
      const teamSearchLabel =
        state.tab === "スリークロスチーム" ? "このチームの動画を検索" : "この団体の動画を検索";
      teamSearchBtn.textContent = teamSearchLabel;
      teamSearchBtn.setAttribute("aria-label", teamSearchLabel);
      teamSearchBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        trackEvent("card_team_search", { tab: state.tab });
        cancelSearchDebounce();
        clearExactFilters();
        clearExcludedOrgs();
        state.browseOpen = false;
        if (qTeam) qTeam.value = searchTeamVal;
        onSearchInput();
        qTeam?.focus({ preventScroll: true });
        document.getElementById("results-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      orgSearchWrap.appendChild(teamSearchBtn);
    }

    headRow.appendChild(orgSearchWrap);
    textStack.appendChild(headRow);

    if (eventTitle || urlStr) {
      const evP = document.createElement("p");
      evP.className = "recommend-item-event";
      if (urlStr) {
        const evLink = document.createElement("a");
        evLink.href = urlStr;
        evLink.target = "_blank";
        evLink.rel = "noopener noreferrer";
        evLink.className = "recommend-item-event-link";
        if (chNameNorm.includes("drumcorpsfuntv")) {
          evLink.classList.add("recommend-item-event-link--drum");
        } else if (chNameNorm.includes("マーチング祭")) {
          evLink.classList.add("recommend-item-event-link--marching");
        }
        evLink.title = "動画を開く";
        evLink.textContent = eventTitle || "動画を開く";
        enhanceVideoLink(evLink, urlStr);
        evP.appendChild(evLink);
      } else {
        const plain = document.createElement("span");
        plain.className = "recommend-item-event-plain";
        plain.textContent = eventTitle;
        evP.appendChild(plain);
      }
      textStack.appendChild(evP);
    }

    /** 配信元（小さめラベル）＋ チャンネル名 · 配信日 */
    if (dateStr || chName) {
      const metaLine = document.createElement("p");
      metaLine.className = "recommend-item-yt-meta-line";
      const metaPrefix = document.createElement("span");
      metaPrefix.className = "recommend-item-yt-meta-prefix";
      metaPrefix.textContent = "配信元\u3000";
      metaLine.appendChild(metaPrefix);
      if (chUrlForRow && chName) {
        const chLink = document.createElement("a");
        chLink.href = chUrlForRow;
        chLink.target = "_blank";
        chLink.rel = "noopener noreferrer";
        chLink.className = "recommend-item-yt-meta-channel";
        chLink.title = "配信元チャンネルを開く";
        chLink.textContent = chName;
        metaLine.appendChild(chLink);
        if (dateStr) {
          metaLine.appendChild(document.createTextNode(` · ${dateStr}`));
        }
      } else if (chName) {
        metaLine.appendChild(document.createTextNode(chName));
        if (dateStr) {
          metaLine.appendChild(document.createTextNode(` · ${dateStr}`));
        }
      } else if (dateStr) {
        metaLine.appendChild(document.createTextNode(dateStr));
      }
      textStack.appendChild(metaLine);
    }

    if (urlStr) {
      const urlA = document.createElement("a");
      urlA.href = urlStr;
      urlA.target = "_blank";
      urlA.rel = "noopener noreferrer";
      urlA.className = "recommend-item-url-line";
      renderUrlLineWithTimeAccent(urlA, urlStr);
      enhanceVideoLink(urlA, urlStr);
      textStack.appendChild(urlA);
    }

    ytInfoRow.appendChild(avatarWrap);
    ytInfoRow.appendChild(textStack);
    body.appendChild(ytInfoRow);

    const actions = document.createElement("div");
    actions.className = "recommend-item-actions";
    const actionRow = document.createElement("div");
    actionRow.className = "recommend-item-action-row";

    const mylistBtn = document.createElement("button");
    mylistBtn.type = "button";
    mylistBtn.className = "btn-mll-mylist-add";
    mylistBtn.textContent = "マイリストに追加";
    const syncMylistBtn = () => {
      const mod = window.MarchinZVideoMylist;
      const user = window.MLL_AUTH?.getUser?.();
      if (!urlStr) {
        mylistBtn.disabled = true;
        mylistBtn.textContent = "マイリストに追加";
        mylistBtn.title = "";
        return;
      }
      if (!mod) {
        mylistBtn.disabled = true;
        mylistBtn.textContent = "マイリストに追加";
        mylistBtn.title = "";
        return;
      }
      const inAny = mod.hasUrl?.(urlStr) ?? false;
      if (!user?.id) {
        mylistBtn.disabled = false;
        mylistBtn.textContent = "マイリストに追加";
        mylistBtn.title = "タップするとログイン／新規登録ページへ進みマイリストに保存できます（Google）";
        return;
      }
      mylistBtn.disabled = false;
      mylistBtn.textContent = "マイリストに追加";
      mylistBtn.title = inAny ? "すでに保存した動画も、別のリストに追加できます" : "マーチンズのマイリストに保存";
    };
    syncMylistBtn();
    mylistBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!urlStr || !window.MarchinZVideoMylist) return;
      const user = window.MLL_AUTH?.getUser?.();
      if (!user?.id) {
        window.MarchinZVideoMylist.requestLoginThenAdd(row);
        return;
      }
      if (mylistBtn.disabled) return;
      void window.MarchinZVideoMylist.openAddDialog(row);
    });
    actionRow.appendChild(mylistBtn);
    actionRow.appendChild(buildShareWrapForRow(row));
    actions.appendChild(actionRow);

    rootEl.appendChild(thumbWrap);
    rootEl.appendChild(body);
    rootEl.appendChild(actions);

    return rootEl;
  }

  /** グリッド末尾の空セル用：次の1件のチラ見せ＋白ベール＋もっと見る */
  function buildVideoPeekSlot(peekRow, moreBtn) {
    const peekLi = document.createElement("li");
    peekLi.className = "video-result-peek-slot";
    const stack = document.createElement("div");
    stack.className = "video-result-peek-stack";
    const card = buildVideoCard(peekRow, { rootTag: "div" });
    card.classList.add("video-result-peek-card");
    card.setAttribute("aria-hidden", "true");
    const veil = document.createElement("div");
    veil.className = "video-result-peek-veil";
    veil.setAttribute("aria-hidden", "true");
    stack.appendChild(card);
    stack.appendChild(veil);
    if (moreBtn) {
      moreBtn.classList.add("video-result-peek-more-btn");
      stack.appendChild(moreBtn);
    }
    peekLi.appendChild(stack);
    return peekLi;
  }

  function appendRecommendListItem(row) {
    recommendList.appendChild(buildVideoCard(row));
  }

  function renderRecommendations() {
    if (!recommendSection || !recommendList) return;
    // Temporarily disable recommendation UI entirely.
    recommendSection.hidden = true;
    recommendList.innerHTML = "";
    if (recommendMoreBtn) recommendMoreBtn.hidden = true;
    return;

    if (!hasActiveListFilter()) {
      recommendSection.hidden = true;
      recommendList.innerHTML = "";
      if (recommendMoreBtn) recommendMoreBtn.hidden = true;
      return;
    }

    const picks = computeRecommendations();
    if (!picks.length) {
      recommendSection.hidden = true;
      recommendList.innerHTML = "";
      if (recommendMoreBtn) recommendMoreBtn.hidden = true;
      return;
    }

    const visibleCap = Math.min(state.recommendVisibleCount, picks.length);
    const slice = picks.slice(0, visibleCap);

    recommendSection.hidden = false;
    recommendList.innerHTML = "";
    for (const row of slice) {
      appendRecommendListItem(row);
    }

    if (recommendMoreBtn) {
      recommendMoreBtn.hidden = visibleCap >= picks.length;
    }
  }

  function totalFilteredPages() {
    const n = state.filtered.length;
    const ps = state.pageSize;
    return Math.max(1, Math.ceil(n / ps));
  }

  function renderVisibleOrgsLine() {
    if (!visibleOrgs) return;
    if (!hasActiveListFilter() && state.excludedOrgTeams.size === 0) {
      visibleOrgs.hidden = true;
      visibleOrgs.innerHTML = "";
      return;
    }
    const names = [];
    const seen = new Set();
    for (const row of state.filtered) {
      const v = String(rowOrgTeam(row) ?? "").trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      names.push(v);
    }
    if (!names.length) {
      visibleOrgs.hidden = true;
      visibleOrgs.innerHTML = "";
      return;
    }
    visibleOrgs.hidden = false;
    visibleOrgs.innerHTML = "";

    const label = document.createElement("p");
    label.className = "visible-orgs-label";
    label.textContent = "表示中の団体/チーム";
    visibleOrgs.appendChild(label);

    const tags = document.createElement("div");
    tags.className = "visible-orgs-tags";
    for (const name of names) {
      const chip = document.createElement("div");
      chip.className = "visible-orgs-chip";
      const nameSpan = document.createElement("span");
      nameSpan.className = "visible-orgs-chip-name";
      nameSpan.textContent = name;
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "visible-orgs-tag-remove";
      clearBtn.dataset.org = name;
      clearBtn.title = "この団体/チームの動画を一覧から外す";
      clearBtn.setAttribute("aria-label", `${name} の動画を表示から外す`);
      clearBtn.innerHTML = '<span class="visible-orgs-tag-remove-x" aria-hidden="true">\u00d7</span>';
      chip.appendChild(nameSpan);
      chip.appendChild(clearBtn);
      tags.appendChild(chip);
    }
    visibleOrgs.appendChild(tags);
  }

  function render() {
    if (pageSizeSelect) {
      pageSizeSelect.value = String(state.pageSize);
    }

    const total = state.filtered.length;
    const totalPages = totalFilteredPages();
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    const ps = state.pageSize;
    const start = (state.page - 1) * ps;
    const take = ps * (1 + state.listLoadMoreExtra);
    const pageRows = state.filtered.slice(start, start + take);
    const moreAvailable =
      total > 0 && start + pageRows.length < total;
    const peekRow = moreAvailable
      ? state.filtered[start + pageRows.length]
      : null;
    const gridCols = getVideoResultGridColumnCount();
    const rem = pageRows.length % gridCols;
    const emptySlots = rem === 0 ? 0 : gridCols - rem;
    const useInlinePeek = Boolean(
      moreAvailable && peekRow && emptySlots > 0,
    );

    if (videoList) {
      if (
        videoListMoreBtn &&
        videoList.contains(videoListMoreBtn) &&
        videoResultMoreWrap
      ) {
        videoResultMoreWrap.appendChild(videoListMoreBtn);
      }
      videoList.replaceChildren();
      for (const row of pageRows) {
        videoList.appendChild(buildVideoCard(row));
      }
      if (useInlinePeek && peekRow && videoListMoreBtn) {
        videoList.appendChild(
          buildVideoPeekSlot(peekRow, videoListMoreBtn),
        );
      }
    }
    if (videoListMoreBtn) {
      if (!useInlinePeek && videoResultMoreWrap) {
        videoListMoreBtn.classList.remove("video-result-peek-more-btn");
        videoResultMoreWrap.appendChild(videoListMoreBtn);
      }
      videoListMoreBtn.hidden = !moreAvailable;
      videoListMoreBtn.title = moreAvailable
        ? `「表示件数」の ${ps} 件ぶん、さらに表示します`
        : "";
    }
    if (videoResultMoreWrap) {
      videoResultMoreWrap.hidden =
        Boolean(useInlinePeek) || !moreAvailable;
    }
    const visibleAll = state.rows.filter((r) => isVisibleRow(r)).length;
    $("#count").textContent = `表示 ${total} 件（ 全体 ${visibleAll} 件）`;
    renderVisibleOrgsLine();

    if (paginationStatus) {
      if (total === 0) {
        paginationStatus.textContent = "該当なし";
      } else {
        const from = start + 1;
        const to = start + pageRows.length;
        paginationStatus.innerHTML = `ページ ${state.page} / ${totalPages}<span class="pagination-status-sub">（${from}〜${to} 件目を表示）</span>`;
      }
    }
    const atFirst = state.page <= 1;
    const atLast = state.page >= totalPages || total === 0;
    [pageFirst, pagePrev].forEach((btn) => {
      if (btn) btn.disabled = atFirst || total === 0;
    });
    [pageNext, pageLast].forEach((btn) => {
      if (btn) btn.disabled = atLast || total === 0;
    });
    syncUrlState();
  }

  function setResultsLoading(loading) {
    setSearchOverlay(loading);
    if (resultsSkeleton) {
      resultsSkeleton.hidden = !loading;
      resultsSkeleton.setAttribute("aria-busy", loading ? "true" : "false");
    }
    if (videoList) videoList.hidden = loading;
    if (resultsPanel) resultsPanel.setAttribute("aria-busy", loading ? "true" : "false");
    const dis = loading;
    [pageFirst, pagePrev, pageNext, pageLast, pageSizeSelect, videoListMoreBtn].forEach(
      (el) => {
        if (el) el.disabled = dis;
      },
    );
    document.querySelectorAll(".result-sort-bar button[data-sort]").forEach((btn) => {
      btn.disabled = dis;
    });
    shareSearchBtns().forEach((b) => {
      b.disabled = dis;
    });
    document.querySelectorAll('.tabs button[role="tab"]').forEach((btn) => {
      btn.disabled = dis;
    });
    if (browseByOrg) browseByOrg.disabled = dis;
  }

  function goToPage(p) {
    cancelSearchDebounce();
    const tp = totalFilteredPages();
    const anchorBefore = resultsPanel ? resultsPanel.getBoundingClientRect().top : null;
    state.listLoadMoreExtra = 0;
    state.page = Math.max(1, Math.min(p, tp));
    render();
    if (anchorBefore !== null) {
      const anchorAfter = resultsPanel.getBoundingClientRect().top;
      const delta = anchorAfter - anchorBefore;
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      }
    }
  }

  function setupSortHeaders() {
    document.querySelectorAll(".result-sort-bar button[data-sort]").forEach((btn) => {
      btn.setAttribute("tabindex", "0");
      btn.setAttribute("title", "クリックで並べ替え");
      const runSort = () => {
        cancelSearchDebounce();
        const key = btn.getAttribute("data-sort");
        if (!key || !SORT_KEYS.includes(key)) return;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = key === "配信日" ? "desc" : "asc";
        }
        applyFilter();
      };
      btn.addEventListener("click", runSort);
      btn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          runSort();
        }
      });
    });
  }

  function loadDataJsonWithXhr(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "text";
      xhr.onload = () => {
        const canUseBody = xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300);
        if (!canUseBody) {
          reject(new Error("data.json を読めません"));
          return;
        }
        const text = xhr.responseText || "";
        if (!text.trim()) {
          reject(new Error("data.json を読めません"));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("data.json を読めません"));
          }
          return;
        }
        if (xhr.status === 0) {
          // file:// で開いた場合は status=0 でも本文が取得できるケースがある
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("data.json を読めません"));
          }
          return;
        }
        reject(new Error("data.json を読めません"));
      };
      xhr.onerror = () => reject(new Error("data.json を読めません"));
      xhr.send();
    });
  }

  function dataJsonCandidates() {
    const p = window.location.pathname || "/";
    const hasTrailingSlash = p.endsWith("/");
    const last = p.split("/").pop() || "";
    const dir = hasTrailingSlash ? p : last.includes(".") ? p.slice(0, p.lastIndexOf("/") + 1) : `${p}/`;
    const abs = `${window.location.origin}${dir}data.json`;
    return [...new Set(["data.json", "./data.json", abs])];
  }

  function loadInlineDataScript() {
    if (window.__MARCHINZ_DATA && Array.isArray(window.__MARCHINZ_DATA.rows)) {
      return Promise.resolve(window.__MARCHINZ_DATA);
    }
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "data.inline.js?v=1.7.48";
      script.async = true;
      script.onload = () => resolve(window.__MARCHINZ_DATA || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  async function loadDataJson() {
    const inline = await loadInlineDataScript();
    if (inline && Array.isArray(inline.rows)) return inline;
    if (window.__MARCHINZ_DATA && Array.isArray(window.__MARCHINZ_DATA.rows)) {
      return window.__MARCHINZ_DATA;
    }
    const candidates = dataJsonCandidates();
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && Array.isArray(data.rows)) return data;
      } catch {
        // next candidate
      }
      try {
        const data = await loadDataJsonWithXhr(url);
        if (data && Array.isArray(data.rows)) return data;
      } catch {
        // next candidate
      }
    }
    if (window.__MARCHINZ_DATA && Array.isArray(window.__MARCHINZ_DATA.rows)) {
      return window.__MARCHINZ_DATA;
    }
    if (window.location.protocol === "file:") {
      for (const url of candidates) {
        try {
          const data = await loadDataJsonWithXhr(url);
          if (data && Array.isArray(data.rows)) return data;
        } catch {
          // next candidate
        }
      }
    }
    throw new Error("data.json を読めません");
  }

  async function load() {
    setResultsLoading(true);
    try {
      const data = await loadDataJson();
      const metaEl = $("#data-fetch-meta");
      if (metaEl) {
        metaEl.hidden = true;
        metaEl.textContent = "";
      }
      const raw = data.rows || [];
      const keys = [
        "種別",
        "分類",
        "動画での表示名",
        "チーム名",
        "団体/チーム名",
        "団体ID",
        "団体名",
        "配信日",
        "大会名",
        "URL",
        "動画配信元",
        "動画配信元URL",
        "動画配信元ロゴURL",
        "配信元ロゴURL",
      ];
      state.rows = raw.map((row) => {
        const o = {};
        for (const k of keys) {
          const v = row[k];
          o[k] = v == null ? "" : String(v).trim();
        }
        return o;
      });
      state.filtered = [...state.rows];
      rebuildMarchinzOrgMaps();
      const urlPage = readUrlState();
      applyFilter();
      if (urlPage !== null) {
        const tp = totalFilteredPages();
        state.page = Math.min(urlPage, Math.max(1, tp));
        render();
      }
      renderBrowsePanel();
      const errEl = $("#load-err");
      if (errEl) errEl.textContent = "";
    } finally {
      setResultsLoading(false);
    }
  }

  function clearExactFilters() {
    state.exactOrgTeam = null;
    state.exactEvent = null;
  }

  function clearExcludedOrgs() {
    state.excludedOrgTeams.clear();
  }

  function resetSearchResults() {
    cancelSearchDebounce();
    clearExactFilters();
    clearExcludedOrgs();
    state.browseOpen = false;
    if (qTeam) qTeam.value = "";
    if (qEvent) qEvent.value = "";
    if (qFree) qFree.value = "";
    if (optMatchExact) optMatchExact.checked = false;
    if (optCrossBoth) optCrossBoth.checked = true;
    applyFilter();
    renderBrowsePanel();
    setSearchOverlay(false);
  }

  function onSearchInput() {
    clearExactFilters();
    clearExcludedOrgs();
    state.browseOpen = false;
    applyFilter();
    renderBrowsePanel();
    setSearchOverlay(false);
  }

  function onSearchInputDebounced() {
    cancelSearchDebounce();
    setSearchOverlay(true);
    searchDebounceTimer = window.setTimeout(() => {
      searchDebounceTimer = null;
      onSearchInput();
      if (recentSearchTimer !== null) {
        clearTimeout(recentSearchTimer);
      }
      recentSearchTimer = window.setTimeout(() => {
        recentSearchTimer = null;
        pushRecentSearch();
      }, RECENT_SEARCH_IDLE_MS);
    }, SEARCH_DEBOUNCE_MS);
  }

  if (qTeam) qTeam.addEventListener("input", onSearchInputDebounced);
  if (qEvent) qEvent.addEventListener("input", onSearchInputDebounced);
  if (qFree) qFree.addEventListener("input", onSearchInputDebounced);
  if (optMatchExact) {
    optMatchExact.addEventListener("change", () => {
      onSearchInputDebounced();
    });
  }
  if (optCrossBoth) {
    optCrossBoth.addEventListener("change", () => {
      onSearchInputDebounced();
    });
  }

  if (recommendMoreBtn) {
    recommendMoreBtn.addEventListener("click", () => {
      const v = state.recommendVisibleCount;
      if (v < RECOMMEND_FIRST_EXPAND) {
        state.recommendVisibleCount = RECOMMEND_FIRST_EXPAND;
      } else {
        state.recommendVisibleCount = v + RECOMMEND_STEP;
      }
      renderRecommendations();
    });
  }

  if (videoListMoreBtn) {
    videoListMoreBtn.addEventListener("click", () => {
      cancelSearchDebounce();
      state.listLoadMoreExtra += 1;
      render();
    });
  }

  let lastVideoGridCols = getVideoResultGridColumnCount();
  let videoGridResizeTimer = null;
  window.addEventListener("resize", () => {
    if (videoGridResizeTimer) window.clearTimeout(videoGridResizeTimer);
    videoGridResizeTimer = window.setTimeout(() => {
      videoGridResizeTimer = null;
      const c = getVideoResultGridColumnCount();
      if (c !== lastVideoGridCols) {
        lastVideoGridCols = c;
        if (state.rows.length) render();
      }
    }, 200);
  });

  if (browseByOrg) {
    browseByOrg.addEventListener("click", () => {
      state.browseOpen = !state.browseOpen;
      renderBrowsePanel();
    });
  }

  if (visibleOrgs) {
    visibleOrgs.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".visible-orgs-tag-remove[data-org]");
      if (!btn) return;
      const org = String(btn.dataset.org ?? "").trim();
      if (!org) return;
      state.excludedOrgTeams.add(org);
      applyFilter();
    });
  }

  if (pageFirst) {
    pageFirst.addEventListener("click", () => goToPage(1));
  }
  if (pagePrev) {
    pagePrev.addEventListener("click", () => goToPage(state.page - 1));
  }
  if (pageNext) {
    pageNext.addEventListener("click", () => goToPage(state.page + 1));
  }
  if (pageLast) {
    pageLast.addEventListener("click", () => goToPage(totalFilteredPages()));
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      cancelSearchDebounce();
      const v = Number.parseInt(pageSizeSelect.value, 10);
      if (!PAGE_SIZE_OPTIONS.includes(v)) return;
      state.pageSize = v;
      state.page = 1;
      state.listLoadMoreExtra = 0;
      render();
    });
  }

  document.querySelectorAll('.tabs button[role="tab"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.getAttribute("data-category");
      if (!cat) return;
      cancelSearchDebounce();
      state.tab = cat;
      clearExactFilters();
      clearExcludedOrgs();
      document.querySelectorAll('.tabs button[role="tab"]').forEach((b) => {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      applyFilter();
      renderBrowsePanel();
    });
  });

  document.addEventListener("click", (ev) => {
    if (ev.target.closest?.(".share-wrap")) return;
    document.querySelectorAll(".share-menu").forEach((m) => {
      m.hidden = true;
    });
  });

  state.recentSearches = loadJsonStorage(LS_KEY_RECENT_SEARCHES, []);
  renderRecentSearches();

  setupSearchShareMenus();

  window.MarchinZShareMenu = {
    buildAbsoluteUrlForHash,
    mylistShareText(listTitle, url) {
      const t = String(listTitle || "マイリスト").trim() || "マイリスト";
      return `動画リスト「${t}」。マーチンズで作成。\n${url}`;
    },
    /**
     * @param {string} displayName
     * @param {{ watch: number; perform: number; team_staff: number; ops: number }} counts
     * @param {string} url
     */
    mllProfileShareText(displayName, counts, url) {
      const name = String(displayName || "ユーザー").trim() || "ユーザー";
      const w = Number(counts?.watch) || 0;
      const p = Number(counts?.perform) || 0;
      const t = Number(counts?.team_staff) || 0;
      const o = Number(counts?.ops) || 0;
      return `${name}のMarchinZ Log。これまで${w}回観戦、${p}回出演、${t}回チームスタッフ、運営側で${o}回。マーチングイベントに参加。\n${url}`;
    },
    setupSearchLikeShareMenuForButton,
  };

  window.addEventListener("marchinz-mylist-updated", () => {
    render();
  });
  window.addEventListener("mll-auth-changed", () => {
    render();
  });

  if (btnResetSearch) {
    btnResetSearch.addEventListener("click", () => {
      resetSearchResults();
    });
  }

  if (btnResetRecentSearches) {
    btnResetRecentSearches.addEventListener("click", () => {
      state.recentSearches = [];
      saveJsonStorage(LS_KEY_RECENT_SEARCHES, state.recentSearches);
      renderRecentSearches();
    });
  }

  window.addEventListener("popstate", () => {
    if (!state.rows.length) return;
    const urlPage = readUrlState();
    applyFilter();
    if (urlPage !== null) {
      const tp = totalFilteredPages();
      state.page = Math.min(urlPage, Math.max(1, tp));
      render();
    }
    renderBrowsePanel();
  });
  window.addEventListener("hashchange", () => {
    updateMix3NoticeVisibility();
  });

  window.addEventListener("pageshow", () => {});
  window.addEventListener("beforeunload", () => {});

  setupSortHeaders();

  function resetVideosPageToDefaultTab() {
    state.tab = "マーチング団体等";
    document.querySelectorAll('#page-videos nav.tabs[role="tablist"] button[role="tab"]').forEach((b) => {
      const cat = b.getAttribute("data-category");
      if (!cat) return;
      b.setAttribute("aria-selected", cat === state.tab ? "true" : "false");
    });
    cancelSearchDebounce();
    clearExactFilters();
    clearExcludedOrgs();
    if (state.rows.length) {
      applyFilter();
      renderBrowsePanel();
    } else {
      updateMix3NoticeVisibility();
    }
  }
  window.__marchinzResetVideosSearchTab = resetVideosPageToDefaultTab;
  if (window.__marchinzPendingVideosReset) {
    window.__marchinzPendingVideosReset = false;
    resetVideosPageToDefaultTab();
  }

  load().catch(() => {
    const errEl = $("#load-err");
    if (errEl) errEl.textContent = "";
  });
})();
