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

  /** カードメタ行用（2025-11-24 → 2025/11/24） */
  function formatVideoMetaDate(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
    const slash = s.replace(/-/g, "/");
    const parts = slash.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (parts) {
      const mm = String(parts[2]).padStart(2, "0");
      const dd = String(parts[3]).padStart(2, "0");
      return `${parts[1]}/${mm}/${dd}`;
    }
    return slash;
  }
  const SHARE_PUBLIC_BASE_URL = "https://marchinz.netlify.app";
  const LS_KEY_RECENT_SEARCHES = "marchinz_recent_searches_v1";
  /** 動画カード行の「シェアする」（検索結果シェアと同じ CTA 配色） */
  const ROW_SHARE_BTN_CLASS = "btn-share-search btn-marchinz-spotlight share-toggle";

  /** 一覧の並べ替えキー（data-sort・URL の sort= と一致） */
  const SORT_KEYS = ["配信日", "団体/チーム"];
  const VIDEO_SOURCE_FILTER_DEFAULT_LABEL = "配信元";
  const VIDEO_SOURCE_FILTER_LABELS = {
    matsuri: "マーチング祭",
    drumcorps: "DrumcorpsfunTV",
  };
  /** 大会動画・初期表示で必ず先頭に試す団体（順固定・各1動画・最大3枠）。動画が無い団体はスキップ。 */
  const INITIAL_RANDOM_PRIORITY_SLOTS = 3;
  const INITIAL_RANDOM_PRIORITY_TEAMS = [
    "インスタントコー",
    "YOKOHAMA ROBINS",
    "THE FOCUS",
  ];
  const INITIAL_RANDOM_TEAM_SET = new Set(INITIAL_RANDOM_PRIORITY_TEAMS);

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
    /** 配信元絞り込み（""=すべて, "matsuri"=マーチング祭, "drumcorps"=DrumcorpsfunTV） */
    sourceFilter: "",
    /** 配信年での絞り込み（null=すべて, "2026" など西暦4桁の文字列） */
    yearFilter: null,
    recentSearches: [],
  };

  /** 団体/チーム名 ↔ URL 用の短い安定 ID（`data` 読み込み後に `rebuildMarchinzOrgMaps` で構築） */
  let marchinzOrgIdToName = new Map();
  let marchinzNameToOrgId = new Map();

  /** 一覧オーバーレイに載せる全団体/チーム名（タブ切替・開き直しで更新） */
  let browseOrgOverlayFullNames = [];

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
  const mix3AboutChipWrap = $("#mix3-about-chip-wrap");
  const mix3AboutOverlay = $("#mix3-about-overlay");
  const mix3AboutOpen = $("#mix3-about-open");
  const MIX3_ABOUT_VIDEO_URL = "https://www.youtube.com/watch?v=zasYJQQ_yd8&t=289s";
  const MIX3_ABOUT_VIDEO_ID = "zasYJQQ_yd8";
  const videoSourceFilterBtn = $("#video-source-filter-btn");
  const videoSourceFilterMenu = $("#video-source-filter-menu");
  let videoSourceFilterMenuOpen = false;
  const browseByOrg = $("#browse-by-org");
  const browseByOrgLabel = $("#browse-by-org-label");
  const browseByOrgCount = $("#browse-by-org-count");
  const browseButtonList = $("#browse-button-list");
  const browseOrgOverlay = $("#browse-org-overlay");
  const browseOrgOverlayHeading = $("#browse-org-overlay-heading");
  const browseOrgOverlayCount = $("#browse-org-overlay-count");
  const browseOrgFilterInput = $("#browse-org-filter");
  const browseOrgClose = $("#browse-org-close");
  const browseOrgSwitchCategory = $("#browse-org-switch-category");
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

  function rowMatchesVideoSourceFilter(row) {
    if (!state.sourceFilter) return true;
    if (state.sourceFilter === "matsuri") return isMarchingMatsuriVideo(row);
    if (state.sourceFilter === "drumcorps") return isDrumcorpsFunTvChannelRow(row);
    return true;
  }

  function setVideoSourceFilterButtonLabel(text) {
    if (!videoSourceFilterBtn) return;
    let label = videoSourceFilterBtn.querySelector(".video-source-filter-label");
    if (!label) {
      label = document.createElement("span");
      label.className = "video-source-filter-label";
      videoSourceFilterBtn.appendChild(label);
    }
    label.textContent = text;
  }

  function syncVideoSourceFilterButton() {
    if (!videoSourceFilterBtn) return;
    const active = Boolean(state.sourceFilter);
    const label =
      VIDEO_SOURCE_FILTER_LABELS[state.sourceFilter] || VIDEO_SOURCE_FILTER_DEFAULT_LABEL;
    setVideoSourceFilterButtonLabel(label);
    videoSourceFilterBtn.classList.toggle("video-source-filter-btn--active", active);
    videoSourceFilterBtn.setAttribute("aria-expanded", videoSourceFilterMenuOpen ? "true" : "false");
    if (videoSourceFilterMenu) {
      videoSourceFilterMenu.querySelectorAll(".video-source-filter-item").forEach((item) => {
        const v = item.getAttribute("data-source") || "";
        const on = v ? state.sourceFilter === v : !state.sourceFilter;
        item.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
  }

  function closeVideoSourceFilterMenu() {
    videoSourceFilterMenuOpen = false;
    if (videoSourceFilterMenu) videoSourceFilterMenu.hidden = true;
    syncVideoSourceFilterButton();
  }

  function toggleVideoSourceFilterMenu() {
    if (!videoSourceFilterMenu || !videoSourceFilterBtn) return;
    if (videoSourceFilterMenuOpen) {
      closeVideoSourceFilterMenu();
      return;
    }
    videoSourceFilterMenuOpen = true;
    videoSourceFilterMenu.hidden = false;
    syncVideoSourceFilterButton();
  }

  function setMix3AboutOverlayOpen(open) {
    if (!mix3AboutOverlay) return;
    mix3AboutOverlay.hidden = !open;
    mix3AboutOverlay.setAttribute("aria-hidden", open ? "false" : "true");
    document.documentElement.classList.toggle("mix3-about-active", open);
    document.body.classList.toggle("mix3-about-active", open);
    if (open) {
      const closeBtn = mix3AboutOverlay.querySelector(".community-compose-close-btn");
      if (closeBtn instanceof HTMLElement) closeBtn.focus();
    }
  }

  function updateMix3NoticeVisibility() {
    if (!mix3Notice && !mix3AboutChipWrap) return;
    const inVideosPage = !pageVideos || pageVideos.hidden === false;
    const threecrossTab = document.getElementById("tab-threecross");
    const show = inVideosPage && threecrossTab?.getAttribute("aria-selected") === "true";
    if (mix3Notice) mix3Notice.hidden = !show;
    if (mix3AboutChipWrap) mix3AboutChipWrap.hidden = !show;
    if (!show) setMix3AboutOverlayOpen(false);
  }

  function escapeMix3AboutOverlay(ev) {
    if (ev.key !== "Escape") return;
    if (!mix3AboutOverlay || mix3AboutOverlay.hidden) return;
    ev.preventDefault();
    setMix3AboutOverlayOpen(false);
  }

  if (mix3AboutOpen) {
    mix3AboutOpen.addEventListener("click", () => setMix3AboutOverlayOpen(true));
  }

  document.querySelectorAll("[data-mix3-about-close]").forEach((btn) => {
    btn.addEventListener("click", () => setMix3AboutOverlayOpen(false));
  });
  document.addEventListener("keydown", escapeMix3AboutOverlay, true);

  const mix3AboutVideoPlay = document.getElementById("mix3-about-video-play");
  const mix3AboutVideoThumb = document.getElementById("mix3-about-video-thumb");
  if (mix3AboutVideoThumb instanceof HTMLImageElement) {
    mix3AboutVideoThumb.addEventListener("error", () => {
      if (mix3AboutVideoThumb.dataset.fallbackApplied === "1") return;
      mix3AboutVideoThumb.dataset.fallbackApplied = "1";
      mix3AboutVideoThumb.src = `https://i.ytimg.com/vi/${MIX3_ABOUT_VIDEO_ID}/hqdefault.jpg`;
    });
  }
  if (mix3AboutVideoPlay) {
    mix3AboutVideoPlay.addEventListener("click", () => {
      const url = mix3AboutVideoPlay.getAttribute("data-yt-url") || MIX3_ABOUT_VIDEO_URL;
      if (window.MarchinZYouTubePlayer?.openEmbed) {
        window.MarchinZYouTubePlayer.openEmbed(url, {
          titleHint: "【後夜祭5】スリークロス熱狂の夜！スペシャル対談LIVE！",
        });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
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
  // 実行時リフレッシュでロゴが増えたら索引を作り直す(古い索引が残ると
  // 新チャンネルのロゴだけ頭文字表示のままになる)
  document.addEventListener("mz:data-refreshed", () => { youtubeLogoIndexes = null; });

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

  function setVideosBrowseOverlayScrollLock(open) {
    if (open) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
  }

  function normalizeBrowseOrgFilter(s) {
    return String(s || "")
      .normalize("NFKC")
      .trim()
      .toLowerCase();
  }

  function updateBrowseOverlaySwitchButton() {
    if (!browseOrgSwitchCategory) return;
    const label =
      state.tab === "スリークロスチーム" ? "マーチング等" : "MIX3";
    browseOrgSwitchCategory.textContent = label;
    browseOrgSwitchCategory.setAttribute(
      "aria-label",
      state.tab === "スリークロスチーム"
        ? "団体一覧（マーチング等）に切り替え"
        : "チーム一覧（MIX3）に切り替え"
    );
  }

  function switchVideosCategoryTab(category) {
    if (!category || category === state.tab) return;
    cancelSearchDebounce();
    state.tab = category;
    clearExactFilters();
    clearExcludedOrgs();
    document.querySelectorAll('.tabs button[role="tab"]').forEach((b) => {
      const cat = b.getAttribute("data-category");
      b.setAttribute("aria-selected", cat === category ? "true" : "false");
    });
    applyFilter();
    renderBrowsePanel();
  }

  function updateBrowseOverlayHead() {
    if (!browseOrgOverlayHeading || !browseOrgOverlayCount) return;
    const listHead = state.tab === "スリークロスチーム" ? "チーム一覧" : "団体一覧";
    const countUnit = state.tab === "スリークロスチーム" ? "チーム" : "団体";
    const n = browseOrgOverlayFullNames.length;
    browseOrgOverlayHeading.textContent = listHead;
    browseOrgOverlayCount.textContent = `（${n}${countUnit}）`;
    browseOrgOverlayCount.setAttribute("aria-label", `全${n}${countUnit}`);
  }

  function renderBrowseOverlayChips() {
    if (!browseButtonList) return;
    const raw = (browseOrgFilterInput?.value ?? "").trim();
    const needle = normalizeBrowseOrgFilter(raw);
    const filtered = needle
      ? browseOrgOverlayFullNames.filter((v) => normalizeBrowseOrgFilter(v).includes(needle))
      : browseOrgOverlayFullNames;

    browseButtonList.innerHTML = "";
    for (const val of filtered) {
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
        logVideoSearchUgc({ force: true });
        renderBrowsePanel();
      });
      browseButtonList.appendChild(b);
    }
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
      browseOrgOverlayFullNames = [];
      browseByOrg.setAttribute("aria-expanded", "false");
      browseByOrg.classList.remove("browse-trigger-active");
      if (browseOrgOverlay) browseOrgOverlay.hidden = true;
      setVideosBrowseOverlayScrollLock(false);
      return;
    }

    const currentCategory = state.tab;
    const values = sortBrowseStrings(
      rowsInCategory(currentCategory)
        .map((r) => rowOrgTeam(r).trim())
        .filter(Boolean)
    );
    browseOrgOverlayFullNames = values;
    if (browseOrgFilterInput) {
      browseOrgFilterInput.value = "";
    }
    updateBrowseOverlayHead();
    updateBrowseOverlaySwitchButton();
    renderBrowseOverlayChips();

    if (browseOrgOverlay) browseOrgOverlay.hidden = false;
    setVideosBrowseOverlayScrollLock(true);

    browseButtonList.hidden = false;
    browseButtonList.scrollTop = 0;
    browseByOrg.setAttribute("aria-expanded", "true");
    browseByOrg.classList.add("browse-trigger-active");

    window.requestAnimationFrame(() => {
      browseOrgFilterInput?.focus({ preventScroll: true });
    });
  }

  function shareText(row) {
    const orgTeam = rowOrgTeam(row);
    const display = rowDisplayName(row);
    const ev = row["大会名"] ?? "";
    const url = youtubeWatchUrlWithForcedStart(String(row["URL"] ?? ""));
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

  /** @type {(name: string, payload?: Record<string, unknown>) => void} */
  function trackEvent(name, payload = {}) {
    if (typeof window.MarchinZTrackEvent === "function") {
      window.MarchinZTrackEvent(name, payload);
    }
  }

  /**
   * Instagram 用: URL のみコピー（Web から Instagram 投稿 API はない）
   * @param {string} url
   * @param {"search" | "mylist" | "mll" | "card"} analyticsTarget
   */
  function shareInstagramLinkOnly(url, analyticsTarget) {
    const link = String(url || "").trim();
    if (!link) {
      MZToast.err("リンクがありません。");
      return;
    }
    trackEvent("share_click", { kind: "instagram", target: analyticsTarget });
    const notifyCopyOk = () => {
      MZToast.ok("リンクをコピーしました。\nInstagramで新規投稿を開き、キャプションに貼り付けてください。");
    };
    const notifyCopyFail = () => {
      MZToast.err("クリップボードにコピーできませんでした。リンクを手動でコピーしてください。");
    };
    const runCopy = () => copyText(link).then(notifyCopyOk).catch(notifyCopyFail);

    if (typeof navigator.share === "function") {
      const shareData = { url: link };
      const canTry =
        typeof navigator.canShare !== "function" || navigator.canShare(shareData);
      if (canTry) {
        navigator
          .share(shareData)
          .catch((err) => {
            if (err && err.name === "AbortError") return;
            runCopy();
          });
        return;
      }
    }
    runCopy();
  }

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
    const url = youtubeWatchUrlWithForcedStart(String(row["URL"] || ""));
    const enc = encodeURIComponent(text);
    const encUrl = encodeURIComponent(url);

    switch (kind) {
      case "copy":
        trackEvent("share_click", { kind, target: "card" });
        copyText(text)
          .then(() => MZToast.ok("コピーしました"))
          .catch(() => MZToast.err("コピーに失敗しました。"));
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
      case "instagram":
        shareInstagramLinkOnly(url, "card");
        break;
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
      btn.setAttribute("aria-label", "この動画をシェア");
      btn.setAttribute("aria-expanded", "false");
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
          btn.setAttribute("aria-expanded", "false");
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
        btn.setAttribute("aria-expanded", String(willOpen));
      });
      wrap.appendChild(btn);
      wrap.appendChild(menu);
    return wrap;
  }

  /** カタカナ→ひらがな折りたたみ。検索側と行側の双方に掛けて、かな表記ゆれを吸収する */
  function foldKanaToHiragana(s) {
    return String(s).replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  function normalize(s) {
    return foldKanaToHiragana((s || "").toString().normalize("NFKC").toLowerCase());
  }

  /** 団体/チームの部分一致（表記ゆれ吸収・チップ並び用） */
  function normalizeTeamSearchKey(s) {
    return foldKanaToHiragana(
      String(s ?? "")
        .trim()
        .normalize("NFKC")
        .toLowerCase()
    );
  }

  /** 表示中チップの並び: 完全一致 > 接頭 > 接尾(例: Nana→KaeNana) > その他の部分一致 */
  function scoreOrgChipForTeamQuery(orgRaw, dispRaw, qk) {
    if (!qk) return 0;
    const org = normalizeTeamSearchKey(orgRaw);
    const disp = normalizeTeamSearchKey(dispRaw);
    let best = 0;
    if (org === qk || disp === qk) best = 100;
    if (org.startsWith(qk) || disp.startsWith(qk)) best = Math.max(best, 85);
    if (org.endsWith(qk) || disp.endsWith(qk)) best = Math.max(best, 72);
    if (org.includes(qk) || disp.includes(qk)) best = Math.max(best, 50);
    return best;
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
  const SHARE_SORT_TO_S = { 配信日: "dt", "団体/チーム": "tm" };
  const SHARE_S_TO_SORT = { dt: "配信日", tm: "団体/チーム" };

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
      } else if (sort === "団体/チーム名") {
        state.sortKey = "団体/チーム";
      }
    }
    const src = p.get("src");
    if (src === "m" || src === "matsuri") state.sourceFilter = "matsuri";
    else if (src === "d" || src === "drumcorps") state.sourceFilter = "drumcorps";
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
    const ex = p.get("ex");
    if (ex) {
      state.excludedOrgTeams = new Set(ex.split("|").map((s) => s.trim()).filter(Boolean));
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
  /* いま出ている団体が1つだけで、かつ**その名前で検索し直しても1つのまま**なら
     その団体名を返す(2026-08-04 優さん指示)。
     ★ 他団体の名前がこの名前を含んでいる場合(「X」と「X ジュニア」のような関係)は
       検索し直すと相手も戻ってくるので null を返し、除外リストのURLを保つ。
       照合は applyFilter と同じ normalizeTeamSearchKey / includes を使う ─
       ここで別の判定を書くと「URLを開いたら結果が違う」が起きる */
  function soleVisibleOrgTeam() {
    if (state.exactOrgTeam !== null) return null;
    const orgs = new Set(
      state.filtered.map((r) => String(rowOrgTeam(r) ?? "").trim()).filter(Boolean)
    );
    if (orgs.size !== 1) return null;
    const only = [...orgs][0];
    const key = normalizeTeamSearchKey(only);
    if (!key) return null;
    for (const row of state.rows) {
      const org = String(rowOrgTeam(row) ?? "").trim();
      if (!org || org === only) continue;
      if (
        normalizeTeamSearchKey(org).includes(key) ||
        normalizeTeamSearchKey(rowDisplayName(row)).includes(key)
      ) {
        return null;
      }
    }
    return only;
  }

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
    if (state.sourceFilter === "matsuri") p.set("src", "m");
    else if (state.sourceFilter === "drumcorps") p.set("src", "d");
    if (state.page > 1) p.set("p", String(state.page));
    if (state.pageSize !== 10) p.set("z", String(state.pageSize));
    if (state.excludedOrgTeams.size > 0) {
      /* ★ 他の団体を消して1団体だけになったら、その団体のURLにする
         (2026-08-04 優さん指示「他の団体を削除したら、URLも変更するように」)。
         「検索語 + 消した団体の一覧」のままだと:
           ・共有された人にはURLを見ても何の団体か分からない
           ・消した団体の**名前が変わると除外が黙って外れ**、また出てくる
             (名前で照合しているため)
           ・団体が増えるほどURLが伸びる
         1団体に絞れているなら、その団体のURLで同じ結果を再現できる */
      const only = soleVisibleOrgTeam();
      if (only) {
        p.delete("t");
        p.delete("o");
        const oid = marchinzNameToOrgId.get(only);
        if (oid) p.set("o", oid);
        else p.set("t", only);
      } else {
        p.set("ex", [...state.excludedOrgTeams].join("|"));
      }
    }
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
    let url;
    if (window.location.protocol === "file:") {
      const fileName = window.location.pathname.split("/").pop() || "index.html";
      const base = String(SHARE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
      if (base) {
        url = `${base}/${fileName}${qs ? `?${qs}` : ""}${hash}`;
      } else {
        url = `${fileName}${qs ? `?${qs}` : ""}${hash}`;
      }
    } else {
      url = `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}${hash}`;
    }
    /* ★ openExternalBrowser=1 は付けない(2026-08-04 優さん指示「なるべく短くしたい」)。
       あれは LINE 独自のパラメータで、LINEのトークから開いたときだけ
       アプリ内ブラウザではなく Safari/Chrome を起動させる印。
       ・シェアされたリンクの用途は**見ること**(動画一覧・プロフィール・マイリスト)で、
         これは LINE のアプリ内ブラウザでも普通に動く
       ・困るのは ログイン / ホーム画面に追加 / オフラインキャッシュ で、
         そこは「アプリ内ブラウザで開かれている」と気づいた時点で
         site-nav.js の案内バーと auth.js の「URLをコピー」が
         **付きのURL**を渡して逃がす(＝必要な場面には残してある)
       ・外部ブラウザへ飛ばすと LINE に戻りにくくなる副作用もあるので、
         全部のシェアに一律で付ける方が不利
       共有URLが24文字短くなる */
    return url;
  }

  /**
   * 検索シェアと同じく、公開サイト基準の絶対 URL（`#profile?…` など hash 全体を渡す）
   * @param {string} hashWithLeadingHash 例: `#profile?uid=…&tab=videos&mylist=…`
   */
  function buildAbsoluteUrlForHash(hashWithLeadingHash) {
    const h = String(hashWithLeadingHash || "#top").startsWith("#")
      ? String(hashWithLeadingHash)
      : `#${hashWithLeadingHash}`;
    let url;
    if (window.location.protocol === "file:") {
      const fileName = window.location.pathname.split("/").pop() || "index.html";
      const base = String(SHARE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
      if (base) {
        url = `${base}/${fileName}${h}`;
      } else {
        url = `${fileName}${h}`;
      }
    } else {
      url = `${window.location.origin}${window.location.pathname}${h}`;
    }
    // openExternalBrowser=1 は付けない(理由は buildShareUrl のコメント)
    return url;
  }

  /** @param {string} urlStr @returns {string} */
  function withOpenExternalBrowserParam(urlStr) {
    const fn = window.MarchinZUrlShare?.withOpenExternalBrowserParam;
    if (typeof fn === "function") return fn(urlStr);
    return String(urlStr || "").trim();
  }

  function currentSearchSummary() {
    const parts = [];
    const team = (qTeam?.value ?? "").trim() || String(state.exactOrgTeam ?? "").trim();
    const event = (qEvent?.value ?? "").trim() || String(state.exactEvent ?? "").trim();
    const free = (qFree?.value ?? "").trim();
    if (team) parts.push(team);
    if (event) parts.push(event);
    if (free) parts.push(free);
    return parts.length ? parts.join(" / ") : "現在の検索条件";
  }

  /** @param {{ force?: boolean }} [opts] */
  function logVideoSearchUgc(opts) {
    if (!window.MarchinZAdminUgcLog?.recordVideoSearch) return;
    const query = currentSearchSummary();
    if (!query || query === "現在の検索条件") return;
    syncUrlState();
    const href = (window.location.hash || "#videos").trim() || "#videos";
    window.MarchinZAdminUgcLog.recordVideoSearch({
      query,
      targetHref: href,
      force: Boolean(opts?.force),
    });
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
    if (target === "search" && window.MarchinZAdminUgcLog?.recordSearchShare) {
      const shareQuery = currentSearchSummary();
      if (shareQuery && shareQuery !== "現在の検索条件") {
        const shareLabels = {
          copy: "リンクをコピー",
          x: "X",
          line: "LINE",
          instagram: "Instagram",
          facebook: "Facebook",
        };
        syncUrlState();
        const shareHref = (window.location.hash || "#videos").trim() || "#videos";
        window.MarchinZAdminUgcLog.recordSearchShare({
          query: shareQuery,
          channel: kind,
          channelLabel: shareLabels[kind] || kind,
          targetHref: shareHref,
        });
      }
    }
    const enc = encodeURIComponent(text);
    const encUrl = encodeURIComponent(url);
    switch (kind) {
      case "copy":
        trackEvent("share_click", { kind, target });
        copyText(text)
          .then(() => MZToast.ok("コピーしました"))
          .catch(() => MZToast.err("コピーに失敗しました。"));
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
      case "line": {
        trackEvent("share_click", { kind, target });
        /* ★ LINEへ送るときだけ openExternalBrowser=1 を付ける(2026-08-04 優さん判断)。
           行き先が LINE だと確定している**唯一の経路**で、この印が実際に効くのはここだけ ─
           LINEのトークから開いたとき、アプリ内ブラウザではなく Safari/Chrome が起動する。
           アプリ内ブラウザだと ログイン / ホーム画面に追加 / オフラインキャッシュ が
           使えないので、LINEから来た人はここで外へ出しておく。
           ほかの経路(コピー・X・Facebook)は行き先が分からないので付けない ─
           付けても無視されるだけでURLが24文字伸びる(2026-08-04 「なるべく短く」)。
           ★ 本文に埋まっているURLを差し替える。url が空/変化なしのときは本文をそのまま */
        const urlLine = withOpenExternalBrowserParam(url);
        const textLine = url && urlLine !== url ? text.split(url).join(urlLine) : text;
        window.open(
          `https://line.me/R/msg/text/?${encodeURIComponent(textLine)}`,
          "_blank",
          "noopener,noreferrer"
        );
        break;
      }
      case "facebook":
        trackEvent("share_click", { kind, target });
        window.open(
          `https://www.facebook.com/sharer/sharer.php?u=${encUrl}&quote=${enc}`,
          "_blank",
          "noopener,noreferrer"
        );
        break;
      case "instagram":
        shareInstagramLinkOnly(url, target);
        break;
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

  /** 年フィルタチップ: 現在のタブ/検索/絞込み(年フィルタ自体を除く)に該当する行の配信年からチップを生成(降順)。クリックでトグル */
  function renderYearChips(rows) {
    const wrap = $("#video-year-chips");
    if (!wrap) return;
    const sourceForYears = rows ?? state.rows;
    const years = [...new Set(sourceForYears.map((row) => String(row["配信日"] ?? "").slice(0, 4)))]
      .filter((y) => /^\d{4}$/.test(y))
      .filter((y) => Number(y) >= 2018) // 2017以前は対象動画が少ないためチップを出さない
      .sort((a, b) => b.localeCompare(a));
    wrap.replaceChildren();
    if (!years.length) {
      wrap.hidden = true;
      return;
    }
    const label = document.createElement("span");
    label.className = "mz-year-chips-label";
    label.textContent = "年で絞り込み";
    wrap.appendChild(label);
    for (const y of years) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mz-year-chip";
      btn.dataset.year = y;
      btn.textContent = y;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        state.yearFilter = state.yearFilter === y ? null : y;
        renderYearChipActiveState();
        applyFilter();
        render();
      });
      wrap.appendChild(btn);
    }
    wrap.hidden = false;
    renderYearChipActiveState();
  }

  function renderYearChipActiveState() {
    document.querySelectorAll("#video-year-chips .mz-year-chip").forEach((btn) => {
      const active = btn.dataset.year === state.yearFilter;
      btn.classList.toggle("mz-year-chip--active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function applyFilter() {
    state.recommendVisibleCount = RECOMMEND_INITIAL;
    const teamQ = normalizeTeamSearchKey((qTeam?.value ?? "").trim());
    const e = normalize((qEvent?.value ?? "").trim());
    const f = normalize((qFree?.value ?? "").trim());
    const selectedOrg = String(state.exactOrgTeam ?? "").trim();
    const isFocusQuery = hasTheFocusToken(qTeam?.value ?? "");
    const isFocusSelected = hasTheFocusToken(selectedOrg);
    const crossTabFocusMode = isFocusQuery || isFocusSelected;
    const hasSearchOrExact =
      crossTabFocusMode ||
      Boolean(teamQ) ||
      Boolean(e) ||
      Boolean(f) ||
      state.exactOrgTeam !== null ||
      state.exactEvent !== null;
    const crossTabSearchMode = Boolean(optCrossBoth?.checked ?? true) && hasSearchOrExact;

    const useExactMatch = Boolean(optMatchExact?.checked);

    const sourceRows = crossTabSearchMode
      ? state.rows.filter((row) => isVisibleRow(row))
      : state.rows.filter((row) => rowCategory(row) === state.tab && isVisibleRow(row));

    const filterPredicate = (row, { skipYear = false } = {}) => {
      const orgTeam = normalize(rowOrgTeam(row));
      const display = normalize(rowDisplayName(row));
      const ev = normalize(row["大会名"]);
      const rawOrg = String(rowOrgTeam(row) ?? "").trim();
      const rawEvent = String(row["大会名"] ?? "").trim();
      const rowIsFocus = hasTheFocusToken(rawOrg) || hasTheFocusToken(rowDisplayName(row));

      if (state.excludedOrgTeams.has(rawOrg)) return false;

      if (!skipYear && state.yearFilter && String(row["配信日"] ?? "").slice(0, 4) !== state.yearFilter) {
        return false;
      }

      if (state.exactOrgTeam !== null) {
        if (isFocusSelected) {
          if (rawOrg !== state.exactOrgTeam && !rowIsFocus) return false;
        } else if (rawOrg !== state.exactOrgTeam) {
          return false;
        }
      } else if (teamQ) {
        const orgK = normalizeTeamSearchKey(rowOrgTeam(row));
        const dispK = normalizeTeamSearchKey(rowDisplayName(row));
        const teamMatched = useExactMatch
          ? orgK === teamQ || dispK === teamQ
          : orgK.includes(teamQ) || dispK.includes(teamQ);
        if (!teamMatched) return false;
      }

      if (
        crossTabFocusMode &&
        !state.exactOrgTeam &&
        teamQ &&
        hasTheFocusToken(qTeam?.value ?? "") &&
        !rowIsFocus
      ) {
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
      if (!rowMatchesVideoSourceFilter(row)) return false;
      return true;
    };

    state.filtered = sourceRows.filter((row) => filterPredicate(row));
    renderYearChips(sourceRows.filter((row) => filterPredicate(row, { skipYear: true })));
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
    syncVideoSourceFilterButton();
    if (hasSearchOrExact && window.MarchinZTrackEvent) {
      const bucket = window.MarchinZAnalytics?.searchResultBucket?.(state.filtered.length) ?? "0";
      window.MarchinZTrackEvent("search_result_view", {
        tab: state.tab,
        has_team: Boolean(teamQ),
        has_event: Boolean(e),
        has_free: Boolean(f),
        result_bucket: bucket,
      });
      if (state.filtered.length === 0) {
        window.MarchinZTrackEvent("search_result_empty", {
          team: (qTeam?.value ?? "").trim(),
          free: (qFree?.value ?? "").trim(),
          tab: state.tab,
        });
      }
    }
    render();
    renderRecommendations();
  }

  function hasActiveListFilter() {
    if (state.sourceFilter) return true;
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
    const key = SORT_KEYS.includes(state.sortKey) ? state.sortKey : "配信日";
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
    if (state.sourceFilter) return false;
    return true;
  }

  function isMarchingMatsuriVideo(row) {
    const name = normalize(rowChannelName(row));
    const url = normalize(rowChannelUrl(row));
    if (name.includes("マーチング祭")) return true;
    if (url.includes("marching-matsuri")) return true;
    return false;
  }

  /** @param {object[]} rows @param {string} team */
  function pickRandomVideoForPriorityTeam(rows, team) {
    const candidates = rows.filter((r) => String(rowOrgTeam(r) || "").trim() === team);
    if (!candidates.length) return null;
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
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  function applyInitialRandomOrder(rows) {
    const required = [];
    const usedUrls = new Set();
    const usedTeams = new Set();
    for (const team of INITIAL_RANDOM_PRIORITY_TEAMS) {
      if (required.length >= INITIAL_RANDOM_PRIORITY_SLOTS) break;
      if (usedTeams.has(team)) continue;
      const picked = pickRandomVideoForPriorityTeam(rows, team);
      if (!picked) continue;
      const urlKey = String(picked["URL"] || "").trim();
      if (!urlKey || usedUrls.has(urlKey)) continue;
      required.push(picked);
      usedUrls.add(urlKey);
      usedTeams.add(team);
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

  /** @param {string} token @returns {number} */
  function parseYoutubeTimeSeconds(token) {
    const s = String(token || "").trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const hm = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
    if (hm) {
      return (
        (parseInt(hm[1] || "0", 10) || 0) * 3600 +
        (parseInt(hm[2] || "0", 10) || 0) * 60 +
        (parseInt(hm[3] || "0", 10) || 0)
      );
    }
    const m = s.match(/^(\d+)s?$/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  /** @param {string} urlStr @returns {number} */
  function youtubeEmbedStartSeconds(urlStr) {
    try {
      const u = new URL(urlStr);
      const hash = u.hash.replace(/^#/, "");
      if (/^t=/i.test(hash)) {
        const fromHash = parseYoutubeTimeSeconds(hash.slice(2));
        if (fromHash > 0) return fromHash;
      }
      const t = u.searchParams.get("t") || u.searchParams.get("start");
      return t ? parseYoutubeTimeSeconds(t) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * YouTube 本家で「続きから再生」より URL の秒数を優先しやすい watch URL
   * （クエリ t= とハッシュ #t= の両方を付与）
   * @param {string} urlStr
   * @returns {string}
   */
  function youtubeWatchUrlWithForcedStart(urlStr) {
    const raw = String(urlStr || "").trim();
    if (!raw) return raw;
    const id = youtubeVideoIdFromUrl(raw);
    if (!id) return raw;
    const start = youtubeEmbedStartSeconds(raw);
    const watch = new URL("https://www.youtube.com/watch");
    watch.searchParams.set("v", id);
    if (start > 0) {
      watch.searchParams.set("t", `${start}s`);
      watch.hash = `t=${start}s`;
    }
    return watch.toString();
  }

  function subscribeYouTubeEmbedListening() {
    if (!youtubeEmbedIframe?.contentWindow) return;
    if (!youtubeEmbedIframe.id) youtubeEmbedIframe.id = "mz-youtube-embed-iframe";
    youtubeEmbedIframe.contentWindow.postMessage(
      JSON.stringify({
        event: "listening",
        id: youtubeEmbedIframe.id,
        channel: "widget",
      }),
      "*"
    );
  }

  /** @type {boolean} */
  let youtubeEmbedQualityBootstrapped = false;

  /** @param {number} [startSec=0] */
  function applyYouTubeEmbedPlayerBootstrap(startSec = 0) {
    if (!youtubeEmbedIframe) return;
    youtubeEmbedQualityBootstrapped = false;
    const bootstrap = () => {
      if (!youtubeEmbedIframe?.contentWindow) return;
      const payload = (func, args) =>
        youtubeEmbedIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
      subscribeYouTubeEmbedListening();
      if (!youtubeEmbedQualityBootstrapped) {
        payload("setPlaybackQuality", ["hd720"]);
        youtubeEmbedQualityBootstrapped = true;
      }
      if (startSec > 0) payload("seekTo", [startSec, true]);
      payload("playVideo", []);
    };
    youtubeEmbedIframe.addEventListener("load", bootstrap, { once: true });
    window.setTimeout(bootstrap, 700);
    window.setTimeout(bootstrap, 1500);
  }

  /** @type {HTMLDivElement | null} */
  let youtubeEmbedOverlayEl = null;
  /** @type {HTMLDivElement | null} */
  let youtubeEmbedFrameWrap = null;
  /** @type {HTMLIFrameElement | null} */
  let youtubeEmbedIframe = null;
  /** @type {HTMLHeadingElement | null} */
  let youtubeEmbedTitleEl = null;
  /** @type {HTMLAnchorElement | null} */
  let youtubeEmbedOpenExternal = null;
  /** @type {Element | null} */
  let youtubeEmbedReturnAnchor = null;

  /** @param {string} urlStr @param {{ titleHint?: string, anchor?: Element | null }} [opts] */
  function resolveYouTubeEmbedTitle(urlStr, opts = {}) {
    const skip = new Set(["動画", "動画を開く", "YouTubeで見る", "YouTube動画"]);
    const hint = String(opts.titleHint || "").trim();
    if (hint && !skip.has(hint)) return hint;

    const anchor = opts.anchor;
    if (anchor instanceof HTMLElement) {
      const card = anchor.closest(".recommend-item, .youtube-thumb-item, .prof-mylist-recommend-item");
      const fromCard = card
        ?.querySelector(
          ".recommend-item-event-link, .recommend-item-event-plain, .recommend-item-url-line, .youtube-thumb-title"
        )
        ?.textContent?.trim();
      if (fromCard && !skip.has(fromCard)) return fromCard;
    }

    const id = youtubeVideoIdFromUrl(urlStr);
    if (id) {
      for (const row of state.rows || []) {
        if (youtubeVideoIdFromUrl(String(row.URL || "")) !== id) continue;
        const t = String(row["大会名"] || "").trim();
        if (t) return t;
      }
    }
    return "YouTube動画";
  }

  function onYoutubeEmbedKeydown(ev) {
    if (ev.key !== "Escape") return;
    if (!youtubeEmbedOverlayEl || youtubeEmbedOverlayEl.hidden) return;
    if (youtubeEmbedMini) return; // ミニプレイヤー中はモーダルではないのでEscで閉じない
    closeYouTubeEmbedModal();
  }

  /* ---------- ミニプレイヤー(2026-07-23 優さん指示「再生システムの改善」) ----------
     モーダルを畳んでも再生を続け、右下の小窓でサイトを回遊できる。
     iframe の src を触らない(=再生を切らない)のが肝。閉じる(×)だけが停止 */
  /** @type {boolean} */
  let youtubeEmbedMini = false;

  function minimizeYouTubeEmbedModal() {
    if (!youtubeEmbedOverlayEl || youtubeEmbedOverlayEl.hidden || youtubeEmbedMini) return;
    youtubeEmbedMini = true;
    youtubeEmbedOverlayEl.classList.add("mz-yt-mini");
    applyMiniGeometry();
    youtubeEmbedOverlayEl.setAttribute("aria-modal", "false");
    document.documentElement.classList.remove("mz-youtube-embed-open"); // スクロール解放
    const t = youtubeEmbedOverlayEl.querySelector(".mz-yt-mini-bar-title");
    if (t && youtubeEmbedTitleEl) t.textContent = youtubeEmbedTitleEl.textContent;
  }

  function restoreYouTubeEmbedModal() {
    if (!youtubeEmbedOverlayEl || !youtubeEmbedMini) return;
    youtubeEmbedMini = false;
    youtubeEmbedOverlayEl.classList.remove("mz-yt-mini");
    youtubeEmbedOverlayEl.setAttribute("aria-modal", "true");
    clearMiniGeometry();
    document.documentElement.classList.add("mz-youtube-embed-open");
  }

  /* 小窓の寸法・位置はインラインで確定させる。
     フルサイズ用の `width:100%` 等が後方の @media にあり、クラス側では
     詳細度を上げても負けたため(2026-07-23 実測) */
  function miniDialogEl() {
    return youtubeEmbedOverlayEl?.querySelector(".mz-dialog") || null;
  }
  function applyMiniGeometry() {
    const d = miniDialogEl();
    if (!d) return;
    const w = Math.round(Math.max(200, Math.min(320, window.innerWidth * 0.62)));
    d.style.setProperty("position", "fixed", "important");
    d.style.setProperty("width", w + "px", "important");
    d.style.setProperty("max-width", w + "px", "important");
    d.style.setProperty("left", "auto", "important");
    d.style.setProperty("top", "auto", "important");
    d.style.setProperty("right", "12px", "important");
    d.style.setProperty(
      "bottom",
      "calc(var(--mz-tabbar-h, 0px) + env(safe-area-inset-bottom, 0px) + 12px)",
      "important"
    );
    d.style.setProperty("max-height", "none", "important");
  }
  function clearMiniGeometry() {
    const d = miniDialogEl();
    if (!d) return;
    ["position", "width", "max-width", "left", "top", "right", "bottom", "max-height"]
      .forEach((k) => d.style.removeProperty(k));
  }

  function showYouTubeEmbedFullscreenHint() {
    const msg = "全画面は動画内の右のアイコンから";
    if (typeof window.MarchinZEphemeralMessage === "function") {
      window.MarchinZEphemeralMessage(msg);
      return;
    }
    console.info("[MarchinZYouTubePlayer]", msg);
  }

  /** @param {Element} el */
  function requestElementFullscreen(el) {
    const fn =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      /** @type {any} */ (el).msRequestFullscreen ||
      /** @type {any} */ (el).mozRequestFullScreen;
    if (!fn) return Promise.reject(new Error("fullscreen unsupported"));
    const ret = fn.call(el);
    return ret && typeof ret.then === "function" ? ret : Promise.resolve();
  }

  async function requestYouTubeEmbedFullscreen() {
    const targets = [youtubeEmbedFrameWrap, youtubeEmbedIframe].filter(Boolean);
    for (const target of targets) {
      try {
        await requestElementFullscreen(/** @type {Element} */ (target));
        return;
      } catch {
        /* 次の要素（iframe 等）を試す */
      }
    }
    showYouTubeEmbedFullscreenHint();
  }

  function closeYouTubeEmbedModal() {
    if (!youtubeEmbedOverlayEl) return;
    const wasMini = youtubeEmbedMini;
    youtubeEmbedMini = false;
    youtubeEmbedOverlayEl.classList.remove("mz-yt-mini");
    youtubeEmbedOverlayEl.setAttribute("aria-modal", "true");
    clearMiniGeometry();
    const returnAnchor = wasMini ? null : youtubeEmbedReturnAnchor; // ミニからの×は現在地に留まる
    youtubeEmbedReturnAnchor = null;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit =
        document.exitFullscreen?.bind(document) ||
        document.webkitExitFullscreen?.bind(document) ||
        /** @type {any} */ (document).msExitFullscreen?.bind(document);
      try {
        exit?.();
      } catch {
        /* ignore */
      }
    }
    youtubeEmbedOverlayEl.hidden = true;
    document.documentElement.classList.remove("mz-youtube-embed-open");
    if (youtubeEmbedIframe) youtubeEmbedIframe.src = "about:blank";
    if (returnAnchor instanceof Element) {
      requestAnimationFrame(() => {
        returnAnchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  function ensureYoutubeEmbedOverlay() {
    if (youtubeEmbedOverlayEl) return youtubeEmbedOverlayEl;

    const overlay = document.createElement("div");
    overlay.id = "mz-youtube-embed-overlay";
    overlay.className = "mz-dialog-overlay mz-youtube-embed-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "mz-youtube-embed-title");

    const dialog = document.createElement("div");
    dialog.className = "mz-dialog mz-dialog--youtube-embed";

    const head = document.createElement("div");
    head.className = "mz-dialog-head";
    const title = document.createElement("h2");
    title.id = "mz-youtube-embed-title";
    title.className = "mz-dialog-title mz-youtube-embed-title";
    title.textContent = "YouTube動画";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mz-dialog-close-btn";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";
    head.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "mz-dialog-body mz-youtube-embed-body";
    const frameWrap = document.createElement("div");
    frameWrap.className = "mz-youtube-embed-frame-wrap";
    const iframe = document.createElement("iframe");
    iframe.className = "mz-youtube-embed-frame";
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    );
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.title = "YouTube動画";
    frameWrap.appendChild(iframe);
    body.appendChild(frameWrap);

    const foot = document.createElement("div");
    foot.className = "mz-dialog-foot mz-youtube-embed-foot";
    const qualityHint = document.createElement("p");
    qualityHint.className = "mz-youtube-embed-quality-hint";
    qualityHint.textContent = "画質はプレイヤー内の ⚙️ から変更できます";
    const footActions = document.createElement("div");
    footActions.className = "mz-youtube-embed-foot-actions";
    const miniBtn = document.createElement("button");
    miniBtn.type = "button";
    miniBtn.className = "mz-youtube-embed-mini-btn";
    miniBtn.innerHTML = '<i class="fa-solid fa-down-left-and-up-right-to-center" aria-hidden="true"></i> 小さくして見る';
    const fullscreenBtn = document.createElement("button");
    fullscreenBtn.type = "button";
    fullscreenBtn.className = "mz-youtube-embed-fullscreen-btn";
    fullscreenBtn.textContent = "全画面表示 ⛶";
    const openExt = document.createElement("a");
    openExt.className = "mz-youtube-embed-open-external";
    openExt.target = "_blank";
    openExt.rel = "noopener noreferrer";
    openExt.textContent = "YouTubeで開く";
    footActions.append(miniBtn, fullscreenBtn, openExt);
    foot.append(qualityHint, footActions);

    /* ミニプレイヤーの小窓ヘッダー(縮小中だけCSSで表示)。
       動画部分は iframe がタップを取るので、操作はこのバーに集める */
    const miniBar = document.createElement("div");
    miniBar.className = "mz-yt-mini-bar";
    const miniTitle = document.createElement("span");
    miniTitle.className = "mz-yt-mini-bar-title";
    const miniExpand = document.createElement("button");
    miniExpand.type = "button";
    miniExpand.className = "mz-yt-mini-bar-btn";
    miniExpand.setAttribute("aria-label", "大きく戻す");
    miniExpand.innerHTML = '<i class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i>';
    const miniClose = document.createElement("button");
    miniClose.type = "button";
    miniClose.className = "mz-yt-mini-bar-btn";
    miniClose.setAttribute("aria-label", "再生をやめて閉じる");
    miniClose.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    miniBar.append(miniTitle, miniExpand, miniClose);

    dialog.append(miniBar, head, body, foot);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    closeBtn.addEventListener("click", closeYouTubeEmbedModal);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeYouTubeEmbedModal();
    });
    document.addEventListener("keydown", onYoutubeEmbedKeydown);

    fullscreenBtn.addEventListener("click", () => {
      void requestYouTubeEmbedFullscreen();
    });

    miniBtn.addEventListener("click", minimizeYouTubeEmbedModal);
    window.addEventListener("resize", () => { if (youtubeEmbedMini) applyMiniGeometry(); }, { passive: true });
    miniExpand.addEventListener("click", restoreYouTubeEmbedModal);
    miniClose.addEventListener("click", closeYouTubeEmbedModal);

    /* ヘッダーを下へスワイプ→ミニプレイヤー(YouTubeアプリと同じ操作感)。
       iframe上のスワイプは取れないので、掴めるのはヘッダーだけ */
    let swipeY = null;
    head.addEventListener("touchstart", (ev) => {
      if (youtubeEmbedMini || ev.touches.length !== 1) return;
      swipeY = ev.touches[0].clientY;
    }, { passive: true });
    head.addEventListener("touchmove", (ev) => {
      if (swipeY == null) return;
      const dy = ev.touches[0].clientY - swipeY;
      dialog.style.transform = dy > 0 ? `translateY(${Math.min(dy, 160)}px)` : "";
    }, { passive: true });
    head.addEventListener("touchend", (ev) => {
      if (swipeY == null) return;
      const dy = (ev.changedTouches[0]?.clientY ?? swipeY) - swipeY;
      swipeY = null;
      dialog.style.transform = "";
      if (dy > 80) minimizeYouTubeEmbedModal();
    });

    youtubeEmbedOverlayEl = overlay;
    youtubeEmbedFrameWrap = frameWrap;
    youtubeEmbedIframe = iframe;
    youtubeEmbedTitleEl = title;
    youtubeEmbedOpenExternal = openExt;
    return overlay;
  }

  /**
   * YouTube 動画をサイト内 iframe モーダルで再生（Universal Links / アプリ強制起動を回避）
   * @param {string} urlStr
   * @param {{ titleHint?: string, anchor?: Element | null }} [opts]
   */
  function openYouTubeEmbedModal(urlStr, opts = {}) {
    const raw = String(urlStr || "").trim();
    const id = youtubeVideoIdFromUrl(raw);
    if (!id) {
      trackEvent("video_open", { platform: "web_fallback" });
      window.open(raw, "_blank", "noopener,noreferrer");
      return;
    }
    youtubeEmbedReturnAnchor = opts.anchor instanceof Element ? opts.anchor : null;
    const overlay = ensureYoutubeEmbedOverlay();
    if (youtubeEmbedMini) restoreYouTubeEmbedModal(); // ミニ再生中に別の動画を開いたら全画面へ戻す
    const titleText = resolveYouTubeEmbedTitle(raw, opts);
    if (youtubeEmbedTitleEl) youtubeEmbedTitleEl.textContent = titleText;
    if (youtubeEmbedIframe) youtubeEmbedIframe.title = titleText;
    const start = youtubeEmbedStartSeconds(raw);
    const params = new URLSearchParams({
      autoplay: "1",
      controls: "1",
      rel: "0",
      modestbranding: "1",
      playsinline: "1",
      vq: "hd720",
      enablejsapi: "1",
      origin: window.location.origin,
    });
    if (start > 0) params.set("start", String(start));
    if (youtubeEmbedIframe) {
      youtubeEmbedIframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
    }
    applyYouTubeEmbedPlayerBootstrap(start);
    if (youtubeEmbedOpenExternal) youtubeEmbedOpenExternal.href = youtubeWatchUrlWithForcedStart(raw);
    overlay.hidden = false;
    document.documentElement.classList.add("mz-youtube-embed-open");
    trackEvent("video_open", { platform: "embed_modal" });
  }

  function enhanceVideoLink(anchor, urlStr) {
    if (!anchor || !urlStr) return;
    const id = youtubeVideoIdFromUrl(urlStr);
    if (!id) {
      anchor.addEventListener("click", () => {
        trackEvent("video_open", { platform: "web" });
      });
      return;
    }
    const watchUrl = youtubeWatchUrlWithForcedStart(urlStr);
    anchor.href = watchUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.dataset.ytEmbed = "1";
    anchor.addEventListener("click", (ev) => {
      ev.preventDefault();
      openYouTubeEmbedModal(urlStr, { anchor });
    });
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
    const dateStr = formatVideoMetaDate(row["配信日"]);
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
        state.tab === "スリークロスチーム" ? "このチームを検索" : "この団体を検索";
      teamSearchBtn.setAttribute("aria-label", teamSearchLabel);
      teamSearchBtn.title = teamSearchLabel;
      teamSearchBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass mz-ui-icon" aria-hidden="true"></i><span class="recommend-item-team-search-label">${teamSearchLabel}</span>`;
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
          metaLine.appendChild(document.createTextNode(` ${dateStr}`));
        }
      } else if (chName) {
        metaLine.appendChild(document.createTextNode(chName));
        if (dateStr) {
          metaLine.appendChild(document.createTextNode(` ${dateStr}`));
        }
      } else if (dateStr) {
        metaLine.appendChild(document.createTextNode(dateStr));
      }
      textStack.appendChild(metaLine);
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
    const renderMylistButton = (label) => {
      mylistBtn.replaceChildren();
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-bookmark mz-ui-icon";
      icon.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "btn-mll-mylist-add-label";
      text.textContent = label;
      mylistBtn.append(icon, text);
      mylistBtn.setAttribute("aria-label", label);
    };
    renderMylistButton("マイリストに追加");
    const syncMylistBtn = () => {
      const mod = window.MarchinZVideoMylist;
      const user = window.MLL_AUTH?.getUser?.();
      if (!urlStr) {
        mylistBtn.disabled = true;
        renderMylistButton("マイリストに追加");
        mylistBtn.title = "";
        return;
      }
      if (!mod) {
        mylistBtn.disabled = true;
        renderMylistButton("マイリストに追加");
        mylistBtn.title = "";
        return;
      }
      const inAny = mod.hasUrl?.(urlStr) ?? false;
      if (!user?.id) {
        mylistBtn.disabled = false;
        renderMylistButton("マイリストに追加");
        mylistBtn.title = "タップするとログイン／新規登録ページへ進みマイリストに保存できます（Google）";
        return;
      }
      mylistBtn.disabled = false;
      renderMylistButton(inAny ? "別のマイリストにも追加" : "マイリストに追加");
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

  /** もっと見るで同一ページに残りがすべて載ったときは、現在ページが最終ページ */
  function effectiveTotalPages(slice) {
    const base = totalFilteredPages();
    if (!slice || slice.total === 0) return 1;
    if (slice.start + slice.displayedCount >= slice.total) return state.page;
    return base;
  }

  /** 現在ページの一覧スライス（もっと見るの追加分・末尾1件の通常表示を含む） */
  function computeVideoListPageSlice() {
    const total = state.filtered.length;
    const ps = state.pageSize;
    const start = (state.page - 1) * ps;
    const remaining = Math.max(0, total - start);
    const take = Math.min(ps * (1 + state.listLoadMoreExtra), remaining);
    let pageRows = state.filtered.slice(start, start + take);
    let moreAvailable = remaining > 0 && pageRows.length < remaining;
    let peekRow = moreAvailable ? state.filtered[start + pageRows.length] : null;
    const gridCols = getVideoResultGridColumnCount();
    let rem = pageRows.length % gridCols;
    let emptySlots = rem === 0 ? 0 : gridCols - rem;
    if (moreAvailable && remaining - pageRows.length === 1) {
      pageRows = state.filtered.slice(start, remaining);
      moreAvailable = false;
      peekRow = null;
      rem = pageRows.length % gridCols;
      emptySlots = rem === 0 ? 0 : gridCols - rem;
    }
    const useInlinePeek = Boolean(moreAvailable && peekRow && emptySlots > 0);
    return {
      total,
      ps,
      start,
      remaining,
      pageRows,
      moreAvailable,
      peekRow,
      gridCols,
      emptySlots,
      useInlinePeek,
      displayedCount: pageRows.length,
    };
  }

  function formatPaginationStatus(slice) {
    const { total, ps, start, displayedCount, remaining } = slice;
    const totalPages = effectiveTotalPages(slice);
    const from = start + 1;
    const to = start + displayedCount;
    const expanded = state.listLoadMoreExtra > 0 || displayedCount > ps;
    const allOnPage = displayedCount >= remaining;
    let sub;
    if (expanded || allOnPage) {
      sub = `（${displayedCount}件を表示 / 該当${total}件）`;
    } else {
      sub = `（${from}〜${to} 件目 / 該当${total}件）`;
    }
    return `ページ ${state.page} / ${totalPages}<span class="pagination-status-sub">${sub}</span>`;
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

    const chipQuery = normalizeTeamSearchKey((qTeam?.value ?? "").trim());
    if (chipQuery && state.exactOrgTeam === null) {
      const dispForOrg = (orgName) => {
        const hit = state.filtered.find((row) => String(rowOrgTeam(row) ?? "").trim() === orgName);
        return hit ? String(rowDisplayName(hit) ?? "").trim() : "";
      };
      names.sort((a, b) => {
        const sb = scoreOrgChipForTeamQuery(b, dispForOrg(b), chipQuery);
        const sa = scoreOrgChipForTeamQuery(a, dispForOrg(a), chipQuery);
        if (sb !== sa) return sb - sa;
        return compareScriptOrder(a, b);
      });
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

    const baseTotalPages = totalFilteredPages();
    if (state.page > baseTotalPages) state.page = baseTotalPages;
    if (state.page < 1) state.page = 1;

    const slice = computeVideoListPageSlice();
    const {
      total,
      ps,
      start,
      pageRows,
      moreAvailable,
      peekRow,
      useInlinePeek,
      displayedCount,
    } = slice;

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
      videoListMoreBtn.disabled = !moreAvailable;
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
        paginationStatus.innerHTML = formatPaginationStatus(slice);
      }
    }
    const atFirst = state.page <= 1;
    const totalPages = effectiveTotalPages(slice);
    const atLast =
      total === 0 || start + displayedCount >= total || state.page >= totalPages;
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
    if (videoSourceFilterBtn) videoSourceFilterBtn.disabled = dis;
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

  function setupVideoSourceFilter() {
    if (!videoSourceFilterBtn || !videoSourceFilterMenu) return;
    syncVideoSourceFilterButton();
    videoSourceFilterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleVideoSourceFilterMenu();
    });
    videoSourceFilterMenu.querySelectorAll(".video-source-filter-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const v = item.getAttribute("data-source") || "";
        state.sourceFilter = v === "matsuri" || v === "drumcorps" ? v : "";
        closeVideoSourceFilterMenu();
        cancelSearchDebounce();
        applyFilter();
      });
    });
    document.addEventListener("click", (e) => {
      if (!videoSourceFilterMenuOpen) return;
      const t = e.target;
      if (videoSourceFilterBtn?.contains(t) || videoSourceFilterMenu?.contains(t)) return;
      closeVideoSourceFilterMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && videoSourceFilterMenuOpen) closeVideoSourceFilterMenu();
    });
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
      renderYearChips();
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
    state.yearFilter = null;
    renderYearChipActiveState();
    applyFilter();
    renderBrowsePanel();
    setSearchOverlay(false);
  }

  function onSearchInput() {
    clearExactFilters();
    clearExcludedOrgs();
    state.browseOpen = false;
    applyFilter();
    logVideoSearchUgc({ force: true });
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

  if (browseOrgFilterInput) {
    browseOrgFilterInput.addEventListener("input", () => {
      if (!state.browseOpen) return;
      renderBrowseOverlayChips();
      browseButtonList.scrollTop = 0;
    });
  }

  if (browseOrgSwitchCategory) {
    browseOrgSwitchCategory.addEventListener("click", () => {
      const next =
        state.tab === "スリークロスチーム" ? "マーチング団体等" : "スリークロスチーム";
      switchVideosCategoryTab(next);
    });
  }

  if (browseOrgClose) {
    browseOrgClose.addEventListener("click", () => {
      state.browseOpen = false;
      renderBrowsePanel();
      browseByOrg?.focus({ preventScroll: true });
    });
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !state.browseOpen) return;
    ev.preventDefault();
    state.browseOpen = false;
    renderBrowsePanel();
    browseByOrg?.focus({ preventScroll: true });
  });

  window.__marchinzCloseVideosBrowseOverlay = () => {
    if (!state.browseOpen) return;
    state.browseOpen = false;
    renderBrowsePanel();
  };

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
      switchVideosCategoryTab(cat);
    });
  });

  document.addEventListener("click", (ev) => {
    if (ev.target.closest?.(".share-wrap")) return;
    document.querySelectorAll(".share-menu").forEach((m) => {
      m.hidden = true;
    });
  });

  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target.closest?.(
        "a.recommend-item-thumb-link, a.youtube-thumb-link, a.user-profile-mylist-thumb-link, a.recommend-item-url-line"
      );
      if (!a || a.dataset.ytEmbed === "1" || a.dataset.ytEmbedSkip === "1") return;
      const href = a.getAttribute("href") || "";
      if (!youtubeVideoIdFromUrl(href)) return;
      ev.preventDefault();
      openYouTubeEmbedModal(href, { anchor: a });
    },
    true
  );

  state.recentSearches = loadJsonStorage(LS_KEY_RECENT_SEARCHES, []);
  renderRecentSearches();

  setupSearchShareMenus();

  window.MarchinZShareMenu = {
    buildAbsoluteUrlForHash,
    withOpenExternalBrowserParam,
    mylistShareText(listTitle, url, kind = "videos") {
      const t = String(listTitle || "マイリスト").trim() || "マイリスト";
      const k = kind === "yt" ? "yt" : "videos";
      const label = k === "yt" ? "YouTubeマイリスト" : "大会動画マイリスト";
      return `「${t}」の${label}。\n${url}\nマーチンズからシェアしました♪`;
    },
    /**
     * @param {string} displayName
     * @param {{ watch: number; perform: number; team_staff: number; ops: number }} counts
     * @param {string} url
     */
    mllProfileShareText(displayName, counts, url) {
      const name = String(displayName || "ユーザー").trim() || "ユーザー";
      const R = window.MarchinZMllRole;
      const order = R?.PROFILE_ROLE_ORDER || ["watch", "perform", "team_staff", "ops"];
      /** @type {string[]} */
      const parts = [];
      for (const k of order) {
        const c = Number(counts?.[k]) || 0;
        if (c <= 0) continue;
        const piece = R?.formatYearRoleCountJa ? R.formatYearRoleCountJa(k, c) : "";
        if (piece) parts.push(piece);
      }
      const tally = parts.length ? `これまで${parts.join("、")}。` : "";
      return `${name}のMarchinZ Log。${tally}\n${url}`;
    },
    /** @param {string} noteTitle @param {string} url */
    noteShareText(noteTitle, url) {
      const t = String(noteTitle || "MarchinZ Note").trim() || "MarchinZ Note";
      return `「${t}」のMarchinZ Note。\n${url}\nマーチンズからシェアしました♪`;
    },
    /** @param {string} threadTitle @param {string} url */
    boardShareText(threadTitle, url) {
      const t = String(threadTitle || "MarchinZ Board 話題").trim() || "MarchinZ Board 話題";
      return `「${t}」のMarchinZ Board 話題。\n${url}\nマーチンズからシェアしました♪`;
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
  setupVideoSourceFilter();

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

  window.MarchinZYouTubePlayer = {
    openEmbed: openYouTubeEmbedModal,
    close: closeYouTubeEmbedModal,
    minimize: minimizeYouTubeEmbedModal,
    restore: restoreYouTubeEmbedModal,
    watchUrlWithForcedStart: youtubeWatchUrlWithForcedStart,
  };

  if (window.MarchinZInAppBrowser?.init) {
    window.MarchinZInAppBrowser.init();
  }
})();
