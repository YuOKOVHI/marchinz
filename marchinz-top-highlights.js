/*
 * marchinz-top-highlights.js (v2.21.5)
 * トップページ(#page-mll)に「新着の大会動画」「YouTube 新着」「今週のマーチング(AIダイジェスト)」を描画する。
 * データ源はすべて既存の inline データ(window.__MARCHINZ_DATA / __YOUTUBE_LIST_ROWS / __MARCHINZ_DIGEST)。
 * データが無い・壊れている場合はセクションを hidden のまま残し、他機能へ影響しない。
 */
(function () {
  "use strict";

  var FRESH_LIMIT = 4;
  var YT_LIMIT = 4;
  var MEDIA_NOTE_LIMIT = 2;      /* TOP「メディア」の note 枠 */
  var MEDIA_LAUNDRY_LIMIT = 1;   /* 同 Laundry Day!! 枠 */
  var MEDIA_MARCHING_LIVE_LIMIT = 1; /* 同「マーチング配信」枠 */

  function extractVideoId(url) {
    if (!url) return null;
    var m = String(url).match(/[?&]v=([\w-]{6,})/) || String(url).match(/youtu\.be\/([\w-]{6,})/);
    return m ? m[1] : null;
  }

  function thumbUrl(videoId) {
    return videoId ? "https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg" : null;
  }

  function parseDate(s) {
    if (!s) return 0;
    var t = Date.parse(String(s).replace(/\//g, "-"));
    return isNaN(t) ? 0 : t;
  }

  function daysAgoLabel(ts) {
    if (!ts) return "";
    var diff = Math.floor((Date.now() - ts) / 86400000);
    if (diff <= 0) return "今日";
    if (diff === 1) return "昨日";
    if (diff < 30) return diff + "日前";
    var d = new Date(ts);
    return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* YouTubeのURLならサイト内プレイヤー(app.jsのモーダル)で開く。
     プレイヤーが無い/YouTube以外(note等)は通常のリンク遷移のまま(2026-07-23 優さん指示) */
  function wireInSitePlayer(a, url, titleHint) {
    if (!extractVideoId(url)) return;
    a.addEventListener("click", function (e) {
      var P = window.MarchinZYouTubePlayer;
      if (!P || !P.openEmbed) return;   // フォールバック: そのままYouTubeへ
      e.preventDefault();
      P.openEmbed(url, { titleHint: titleHint || "", anchor: a });
    });
  }

  function buildVideoCard(opts) {
    var a = el("a", "mz-video-card");
    a.href = opts.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    wireInSitePlayer(a, opts.url, opts.title);

    var thumbWrap = el("div", "mz-video-card-thumb-wrap");
    if (opts.thumb) {
      var img = el("img", "mz-video-card-thumb");
      img.src = opts.thumb;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      thumbWrap.appendChild(img);
    }
    if (opts.badge) thumbWrap.appendChild(el("span", "mz-video-card-badge", opts.badge));
    a.appendChild(thumbWrap);

    var body = el("div", "mz-video-card-body");
    body.appendChild(el("p", "mz-video-card-title", opts.title));
    if (opts.channelName) {
      var ch = el("p", "mz-video-card-channel");
      if (opts.channelLogo) {
        var logo = el("img", "mz-video-card-channel-logo");
        logo.src = opts.channelLogo;
        logo.alt = "";
        logo.loading = "lazy";
        ch.appendChild(logo);
      }
      /* 素のテキストノードだとCSSで掴めない(省略記号を当てられない)ので span に包む。
         1行に省略するのはメディア帯だけで、他の帯の見た目は変えない */
      ch.appendChild(el("span", "mz-video-card-channel-name", opts.channelName));
      body.appendChild(ch);
    }
    if (opts.meta) body.appendChild(el("p", "mz-video-card-meta", opts.meta));
    a.appendChild(body);
    return a;
  }

  /* TOPの新着大会動画は、海外とPOVを合計2本までに制限する。
     国内の新着を主役に保ちつつ、選ばれた動画は配信日の新しい順で表示する。 */
  function selectFreshChampionshipRows(sourceRows, limit) {
    var seen = {};
    var uniqueRows = sourceRows
      .slice()
      .sort(function (a, b) {
        return parseDate(b["配信日"]) - parseDate(a["配信日"]);
      })
      .filter(function (row) {
        var id = extractVideoId(row["URL"]);
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
    var selected = [];
    var selectedIds = {};
    var overseasOrPovCount = 0;

    function isOverseasOrPov(row) {
      var category = String(row["分類"] || "").trim();
      return category === "海外" || category === "POV";
    }

    function add(row) {
      if (!row || selected.length >= limit) return;
      var id = extractVideoId(row["URL"]);
      if (!id || selectedIds[id]) return;
      if (isOverseasOrPov(row) && overseasOrPovCount >= 2) return;
      selectedIds[id] = true;
      selected.push(row);
      if (isOverseasOrPov(row)) overseasOrPovCount += 1;
    }
    uniqueRows.forEach(add);

    return selected
      .slice(0, limit)
      .sort(function (a, b) {
        return parseDate(b["配信日"]) - parseDate(a["配信日"]);
      });
  }

  function renderFreshVideos() {
    var grid = document.getElementById("mz-top-video-grid");
    var data = window.__MARCHINZ_DATA;
    if (!grid || !data || !Array.isArray(data.rows) || !data.rows.length) return;

    var rows = selectFreshChampionshipRows(data.rows, FRESH_LIMIT);
    if (!rows.length) return;

    var newestTs = parseDate(rows[0]["配信日"]);
    rows.forEach(function (row, i) {
      var ts = parseDate(row["配信日"]);
      grid.appendChild(
        buildVideoCard({
          url: row["URL"],
          thumb: thumbUrl(extractVideoId(row["URL"])),
          badge: i === 0 || (newestTs && ts === newestTs) ? "NEW" : "",
          title: row["大会名"] || row["団体/チーム名"] || "大会動画",
          meta: [row["動画配信元"], daysAgoLabel(ts)].filter(Boolean).join(" ・ "),
        })
      );
    });
    grid.hidden = false;
    var section = grid.closest("[data-mz-top-section]");
    if (section) section.hidden = false;
  }

  function renderYoutubeFresh() {
    var grid = document.getElementById("mz-top-yt-grid");
    var rows = window.__YOUTUBE_LIST_ROWS;
    if (!grid || !Array.isArray(rows) || !rows.length) return;

    var sorted = rows
      .slice()
      .filter(function (r) {
        return extractVideoId(r["最新動画URL"]);
      })
      .sort(function (a, b) {
        return parseDate(b["最新動画配信日"]) - parseDate(a["最新動画配信日"]);
      });
    /* ★ 海外は最後に1枠だけ・残りは日本(2026-08-06 優さん指示)。
       カテゴリの正本は site-nav.js の名簿(__MZ_YT_CATEGORY_OF の窓口)。
       窓口が無い/海外に新着が無いときは、日本だけで4枠を埋める */
    var catOf = window.__MZ_YT_CATEGORY_OF || function () { return ""; };
    var overseas = sorted.filter(function (r) {
      return catOf(r["チャンネルURL"]) === "海外";
    }).slice(0, 1);
    var japan = sorted.filter(function (r) {
      return catOf(r["チャンネルURL"]) !== "海外";
    });
    /* ★ 枠は確保するが、並びは日付順に戻す(2026-08-06 優さん指示
       「海外は必ず1つ入れるけど、時系列は他と実際の順にして(最後尾固定を解除)」)。
       末尾固定は「新着一覧なのに最後だけ古い」という並びの嘘になっていた。
       選ぶとき: 海外1本ぶんの席を空けて日本を詰める(=必ず1枠は入る)
       見せるとき: 選ばれた顔ぶれを配信日の新しい順に並べ直す */
    var items = japan
      .slice(0, overseas.length ? YT_LIMIT - 1 : YT_LIMIT)
      .concat(overseas)
      .sort(function (a, b) {
        return parseDate(b["最新動画配信日"]) - parseDate(a["最新動画配信日"]);
      });
    if (!items.length) return;

    items.forEach(function (r) {
      grid.appendChild(
        buildVideoCard({
          url: r["最新動画URL"],
          thumb: thumbUrl(extractVideoId(r["最新動画URL"])),
          /* 海外は「必ず1枠を確保している」と分かる印(2026-08-06)。
             並びは日付順に戻したので位置では伝わらない ─ 印だけが伝える */
          badge: catOf(r["チャンネルURL"]) === "海外" ? "海外" : "",
          title: r["最新動画タイトル"] || "最新動画",
          channelName: r["チャンネル名"] || "",
          channelLogo: r["ロゴ画像URL"] || "",
          meta: daysAgoLabel(parseDate(r["最新動画配信日"])),
        })
      );
    });
    grid.hidden = false;
    var section = grid.closest("[data-mz-top-section]");
    if (section) section.hidden = false;
  }

  /* 「2025 / 9」→「2025年9月号」。日付ではなく“号”だと分かる形にそろえる */
  function issueLabel(raw) {
    var m = String(raw || "").match(/(\d{4})\s*\/\s*(\d{1,2})/);
    return m ? m[1] + "年" + Number(m[2]) + "月号" : String(raw || "").trim();
  }

  /* メディアページ(#page-webmagazine)の Laundry Day!! グリッドから新しい順に limit 枚を読む。

     ★ 号のデータは index.html のカードが正本。ここに号数や表紙のリストを別に持つと
       必ずどちらかが古くなるので、二重管理しない。#page-webmagazine は hidden だが
       DOM には常にあるので、TOPを見ている状態でもそのまま読める。
     ★ 新刊が出たときは index.html にカードを1枚足すだけで、TOPにも自動で出る。 */
  function laundryTopItems(limit) {
    var grid = document.getElementById("laundry-grid");
    if (!grid) return [];
    var cards = grid.querySelectorAll("a.magazine-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var title = card.querySelector(".magazine-title");
      if (!card.href || !title || !title.textContent.trim()) continue;
      var label = title.textContent.trim();
      var volM = label.match(/vol\.\s*(\d+)/i);
      var img = card.querySelector(".magazine-thumb img");
      var meta = card.querySelector(".magazine-meta");
      out.push({
        vol: volM ? parseInt(volM[1], 10) : -1,
        url: card.href,
        /* 属性の生値を使う(相対パス + ?v= のまま同じページで読ませる) */
        thumb: img ? img.getAttribute("src") : "",
        title: label,
        badge: "フリーマガジン",
        /* タイトルが「Laundry Day!! vol.10」なので、ここは発行元だけ。
           誌名を二度書くと375pxで2行に折れる */
        channelName: "NPO法人マーチング祭",
        meta: issueLabel(meta ? meta.textContent : ""),
        publishedAt: parseDate(String(meta ? meta.textContent : "").replace(/\s/g, "") + "/1"),
      });
    }
    /* ★ DOMの並び順に頼らない。カードを末尾に足しても最新号が出るように号数で降順。 */
    out.sort(function (a, b) { return b.vol - a.vol; });
    if (out.length < limit) {
      /* 黙って note だけの帯になるのを防ぐ(マークアップが変わった合図) */
      console.warn("[MarchinZ] 新着メディア: Laundry Day!! を " + out.length + " 件しか読めませんでした");
    }
    return out.slice(0, limit);
  }

  function marchingLiveTopItems(limit) {
    var rows = Array.isArray(window.__YOUTUBE_LIST_ROWS) ? window.__YOUTUBE_LIST_ROWS : [];
    var row = rows.find(function (r) {
      return String(r["チャンネルURL"] || "") === "https://www.youtube.com/@genetube2018";
    });
    if (!row || !row["最新動画URL"]) return [];
    return [{
      url: row["最新動画URL"],
      thumb: thumbUrl(extractVideoId(row["最新動画URL"])),
      title: row["最新動画タイトル"] || "じぇねTUBE 最新動画",
      badge: "マーチング配信",
      channelName: row["チャンネル名"] || "じぇねTUBE_マーチング情報",
      channelLogo: row["ロゴ画像URL"] || "",
      meta: daysAgoLabel(parseDate(row["最新動画配信日"])),
      publishedAt: parseDate(row["最新動画配信日"]),
    }].slice(0, limit);
  }

  /* TOPの「メディア」バンド。note 2件、Laundry Day!! 1件、マーチング配信 1件を
     発行・配信の新しい順に混ぜて見せる。各コンテンツの正本はそれぞれの一覧DOM/名簿に残す。
     DOM の id が mz-top-note-* のままなのは、CSS(スマホ2×2の指定)を巻き込まないため。 */
  function renderTopMedia() {
    var grid = document.getElementById("mz-top-note-grid");
    if (!grid) return;
    var notes = Array.isArray(window.__MARCHINZ_NOTES) ? window.__MARCHINZ_NOTES : [];
    var items = notes
      .slice()
      .sort(function (a, b) { return parseDate(b.pubDate) - parseDate(a.pubDate); })
      .slice(0, MEDIA_NOTE_LIMIT)
      .map(function (n) {
        return {
          url: n.url,
          thumb: n.thumb,
          title: n.title || "note",
          badge: "note",
          channelName: n.accountLabel || "",
          meta: daysAgoLabel(parseDate(n.pubDate)),
          publishedAt: parseDate(n.pubDate),
        };
      })
      .concat(laundryTopItems(MEDIA_LAUNDRY_LIMIT))
      .concat(marchingLiveTopItems(MEDIA_MARCHING_LIVE_LIMIT))
      .sort(function (a, b) { return (b.publishedAt || 0) - (a.publishedAt || 0); });
    if (!items.length) return;
    grid.replaceChildren();
    items.forEach(function (it) {
      grid.appendChild(buildVideoCard(it));
    });
    grid.hidden = false;
    var section = grid.closest("[data-mz-top-section]");
    if (section) section.hidden = false;
  }

  function renderDigest() {
    var box = document.getElementById("mz-top-digest");
    var digest = window.__MARCHINZ_DIGEST;
    if (!box || !digest || !digest.text) return;
    var card = el("div", "mz-digest-card");
    card.appendChild(el("p", "mz-digest-label", "今週のマーチング"));
    var textEl = el("p", "mz-digest-text", String(digest.text));
    card.appendChild(textEl);
    if (digest.generated_at) {
      card.appendChild(el("p", "mz-digest-date", "AIによる自動生成 ・ " + String(digest.generated_at).slice(0, 10)));
    }
    box.appendChild(card);
    box.hidden = false;
    var section = box.closest("[data-mz-top-section]");
    if (section) section.hidden = false;
  }

  var EVENTS_LIMIT = 8;
  var MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  function eventKindSlug(kind) {
    switch (kind) {
      case "演奏会": return "ensoukai";
      case "大会": return "taikai";
      case "イベント": return "event";
      case "一般": return "ippan";
      case "高校": return "koukou";
      case "中学生以下": return "chuugaku";
      case "カラーガード": return "colourguard";
      case "海外": return "kaigai";
      default: return "other";
    }
  }

  function buildEventCard(ev) {
    var ts = parseDate(ev.date);
    var d = ts ? new Date(ts) : null;
    var slug = eventKindSlug(ev.kind);
    var a = el("a", "mz-event-card mz-event-card--kind-" + slug);
    a.href = "#community/events";
    a.setAttribute("data-page", "community");

    var dateBox = el("div", "mz-event-card-date");
    dateBox.appendChild(el("span", "mz-event-card-month", d ? MONTHS[d.getMonth()] : ""));
    dateBox.appendChild(el("span", "mz-event-card-day", d ? String(d.getDate()) : "-"));
    a.appendChild(dateBox);

    var body = el("div", "mz-event-card-body");
    var topRow = el("div", "mz-event-card-toprow");
    if (ev.kind) topRow.appendChild(el("span", "mz-event-card-kind", ev.kind));
    body.appendChild(topRow);
    body.appendChild(el("p", "mz-event-card-title", ev.title || "（無題）"));
    var venue = String(ev.venue_pref || "").trim();
    if (venue) {
      var v = el("p", "mz-event-card-venue");
      v.appendChild(el("span", "mz-event-card-venue-pin", "📍"));
      v.appendChild(document.createTextNode(venue));
      body.appendChild(v);
    }
    a.appendChild(body);
    return a;
  }

  function todayKey() {
    var n = new Date();
    return (
      n.getFullYear() +
      "-" +
      String(n.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(n.getDate()).padStart(2, "0")
    );
  }

  /* ---------- マップ吹き出しの参加予定者アイコン(イベントページと同じ顔集合) ---------- */

  var topFaceProfileCache = {}; // uid -> {avatar, withdrawn, visMll, showMll}
  var FACE_ATTENDEE_EVENT_CAP = 30; // attendees を読むイベント数の上限(TOP を軽く保つ)

  function topGetDb() {
    try { return (window.MLL_AUTH && window.MLL_AUTH.getDb && window.MLL_AUTH.getDb()) || null; }
    catch (e) { return null; }
  }

  /** 対象 uid のプロフィールを最小限だけロード(avatar と公開判定)。キャッシュ利用 */
  function loadFaceProfiles(db, uids) {
    var need = uids.filter(function (u) { return u && !topFaceProfileCache[u]; });
    return Promise.all(
      need.map(function (uid) {
        return db.collection("mll_profiles").doc(uid).get()
          .then(function (snap) {
            var p = (snap && snap.data && snap.data()) || {};
            topFaceProfileCache[uid] = {
              avatar: String(p.avatar_url || "").trim(),
              withdrawn: Boolean(p.withdrawn),
              visMll: String(p.section_vis_mll || "public"),
              showMll: p.like_show_mll !== false,
            };
          })
          .catch(function () {
            topFaceProfileCache[uid] = { avatar: "", withdrawn: false, visMll: "public", showMll: true };
          });
      }),
    );
  }

  /** イベント配列に faces/faces_total を付与(公開MLLログ + 直近の参加登録)。イベントMAPの getMllPublicFaceUids 相当 */
  function attachEventFaces(mapEvents) {
    var db = topGetDb();
    var role = window.MarchinZMllRole;
    if (!db || !role || !role.queryMllLogsForFeed) return Promise.resolve(mapEvents);

    var today = todayKey();
    var uidsByEventId = {}; // eventId -> Set(uid)
    function add(eid, uid) {
      if (!eid || !uid) return;
      (uidsByEventId[eid] = uidsByEventId[eid] || {})[uid] = 1;
    }

    var viewer = null;
    try { viewer = (window.MLL_AUTH.getUser && window.MLL_AUTH.getUser()) || null; } catch (e) { /* noop */ }

    // ① 公開 MLL ログ(1クエリで全イベント分)を calendar_event_id で紐付け
    var logsP = role.queryMllLogsForFeed(db, viewer && viewer.id).then(function (rows) {
      (rows || []).forEach(function (x) {
        if (String(x.visibility || "").trim() === "private") return;
        add(String(x.calendar_event_id || "").trim(), String(x.user_id || "").trim());
      });
    }).catch(function () { /* 権限やオフラインは無視 */ });

    // ② 直近イベント(参加登録が意味を持つ未来イベント)の attendees を読む
    var upcomingIds = mapEvents
      .filter(function (ev) { return String(ev.date || "").slice(0, 10) >= today; })
      .map(function (ev) { return String(ev.id || "").trim(); })
      .filter(Boolean)
      .slice(0, FACE_ATTENDEE_EVENT_CAP);
    var attP = Promise.all(upcomingIds.map(function (eid) {
      return db.collection("mll_calendar_events").doc(eid).collection("attendees").get()
        .then(function (sub) { sub.forEach(function (d) { add(eid, d.id); }); })
        .catch(function () { /* noop */ });
    }));

    return Promise.all([logsP, attP]).then(function () {
      var allUids = {};
      Object.keys(uidsByEventId).forEach(function (eid) {
        Object.keys(uidsByEventId[eid]).forEach(function (u) { allUids[u] = 1; });
      });
      return loadFaceProfiles(db, Object.keys(allUids)).then(function () {
        mapEvents.forEach(function (ev) {
          var set = uidsByEventId[String(ev.id || "").trim()];
          if (!set) { ev.faces = []; ev.faces_total = 0; return; }
          // イベントページの公開判定と同じ: 退会/非公開/非表示を除外
          var uids = Object.keys(set).filter(function (u) {
            var pr = topFaceProfileCache[u];
            if (!pr) return true;
            return !pr.withdrawn && pr.visMll !== "private" && pr.showMll !== false;
          });
          ev.faces = uids.slice(0, 8).map(function (u) { return (topFaceProfileCache[u] || {}).avatar || ""; });
          ev.faces_total = uids.length;
        });
        return mapEvents;
      });
    });
  }

  function renderUpcomingEvents(rows) {
    var grid = document.getElementById("mz-top-events-grid");
    if (!grid) return;
    var today = todayKey();
    var notTrashed = rows.filter(function (ev) {
      return String(ev.status || "").trim() !== "trashed";
    });
    var upcoming = notTrashed
      .filter(function (ev) {
        var date = String(ev.date || "").slice(0, 10);
        return date && date >= today;
      })
      .sort(function (a, b) {
        return String(a.date).localeCompare(String(b.date));
      })
      .slice(0, EVENTS_LIMIT);
    try {
      renderDashCountdown(upcoming);
    } catch (e) {
      if (window.console && console.warn) console.warn("[mz-top-highlights] dash", e);
    }
    if (!upcoming.length) return;
    grid.replaceChildren();
    upcoming.forEach(function (ev) {
      grid.appendChild(buildEventCard(ev));
    });
    grid.hidden = false;
    var section = grid.closest("[data-mz-top-section]");
    if (section) section.hidden = false;
    // マップの表示判定(offsetParent)はセクションが見える状態になってから行う。
    // ピンの落下アニメが二度走らないよう、参加者データを読んでから一度だけ描画する
    // (イベントページと同じ方式)。顔ロードが遅い/失敗しても最大2.5秒で顔なし描画にフォールバック。
    var drawn = false;
    var drawMap = function () {
      if (drawn) return;
      drawn = true;
      try {
        window.MarchinZEventMapTop?.refresh(notTrashed);
      } catch (e) {
        if (window.console && console.warn) console.warn("[mz-top-highlights] map", e);
      }
    };
    var fallback = window.setTimeout(drawMap, 2500);
    attachEventFaces(notTrashed)
      .catch(function (e) {
        if (window.console && console.warn) console.warn("[mz-top-highlights] faces", e);
      })
      .then(function () {
        window.clearTimeout(fallback);
        drawMap();
      });
  }

  /* ---------- ヒーロー・ダッシュボード ---------- */

  var KIND_COLORS = {
    演奏会: ["#7c3aed", "#f1eafe"], 大会: ["#1e4fd6", "#e8f1fe"], イベント: ["#92400e", "#fbeacb"],
    一般: ["#0f7a6c", "#e2f5f1"], 高校: ["#be185d", "#fce7f0"], 中学生以下: ["#2563a8", "#e6f0fa"],
    カラーガード: ["#c2410c", "#fdeae0"], 海外: ["#475569", "#eef1f5"],
  };
  var WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

  function showHeroDash() {
    var dash = document.getElementById("mz-hero-dash");
    if (!dash) return null;
    // v1.34: キービジュアル(.mll-lp-hero-art)は隠さず、画像の下にダッシュボードを併記する
    dash.hidden = false;
    return dash;
  }

  function renderDashStatic() {
    var dash = document.getElementById("mz-hero-dash");
    if (!dash) return;

    var dateEl = document.getElementById("mz-dash-date");
    if (dateEl) {
      var now = new Date();
      dateEl.textContent =
        now.getMonth() + 1 + "/" + now.getDate() + "(" + WEEKDAYS_JA[now.getDay()] + ")";
    }

    var rows = (window.__MARCHINZ_DATA && window.__MARCHINZ_DATA.rows) || [];
    var seen = {};
    rows.forEach(function (r) {
      var id = extractVideoId(r["URL"]);
      if (id) seen[id] = 1;
    });
    var videoCount = Object.keys(seen).length;
    var ytRows = Array.isArray(window.__YOUTUBE_LIST_ROWS) ? window.__YOUTUBE_LIST_ROWS : [];

    var sv = document.getElementById("mz-dash-stat-videos");
    if (sv && videoCount) sv.textContent = String(videoCount);
    var sc = document.getElementById("mz-dash-stat-channels");
    if (sc && ytRows.length) sc.textContent = String(ytRows.length);

    var latest = ytRows
      .filter(function (r) { return extractVideoId(r["最新動画URL"]); })
      .sort(function (a, b) { return parseDate(b["最新動画配信日"]) - parseDate(a["最新動画配信日"]); })[0];
    if (latest) {
      var link = document.getElementById("mz-dash-video");
      var thumb = document.getElementById("mz-dash-video-thumb");
      var title = document.getElementById("mz-dash-video-title");
      if (link && thumb && title) {
        link.href = latest["最新動画URL"];
        thumb.src = thumbUrl(extractVideoId(latest["最新動画URL"]));
        title.textContent = latest["最新動画タイトル"] || "最新動画";
        link.hidden = false;
        // ヒーローの最新動画もサイト内プレイヤーで。再描画で重複しないよう onclick 代入
        link.onclick = function (e) {
          var P = window.MarchinZYouTubePlayer;
          if (!P || !P.openEmbed) return;
          e.preventDefault();
          P.openEmbed(latest["最新動画URL"], { titleHint: latest["最新動画タイトル"] || "最新動画", anchor: link });
        };
      }
    }

    // 最新の note 記事(両アカウント混合の先頭)。データは marchinz-notes.inline.js
    var note = (Array.isArray(window.__MARCHINZ_NOTES) ? window.__MARCHINZ_NOTES : [])
      .slice()
      .sort(function (a, b) { return parseDate(b.pubDate) - parseDate(a.pubDate); })[0];
    if (note) {
      var noteLink = document.getElementById("mz-dash-note");
      var noteThumb = document.getElementById("mz-dash-note-thumb");
      var noteTitle = document.getElementById("mz-dash-note-title");
      if (noteLink && noteTitle) {
        noteLink.href = note.url;
        if (noteThumb && note.thumb) noteThumb.src = note.thumb;
        noteTitle.textContent = note.title || "note";
        noteLink.hidden = false;
      }
    }

    if (videoCount || ytRows.length || latest || note) showHeroDash();
  }

  function renderDashCountdown(upcoming) {
    var box = document.getElementById("mz-dash-countdown");
    if (!box) return;
    var se = document.getElementById("mz-dash-stat-events");
    if (se) se.textContent = String(upcoming.length);
    var ev = upcoming[0];
    if (!ev) return;
    var ts = parseDate(ev.date);
    if (!ts) return;
    var days = Math.max(0, Math.round((ts - new Date(new Date().toDateString()).getTime()) / 86400000));
    var daysEl = document.getElementById("mz-dash-days");
    var unitEl = box.querySelector(".mz-dash-count-unit");
    if (daysEl) daysEl.textContent = days === 0 ? "今日" : String(days);
    if (unitEl) unitEl.textContent = days === 0 ? "開催!" : "日後";
    var titleEl = document.getElementById("mz-dash-ev-title");
    if (titleEl) titleEl.textContent = ev.title || "(無題)";
    var kindEl = document.getElementById("mz-dash-ev-kind");
    if (kindEl) {
      kindEl.textContent = ev.kind || "";
      kindEl.hidden = !ev.kind;
      var c = KIND_COLORS[ev.kind];
      if (c) {
        kindEl.style.color = c[0];
        kindEl.style.background = c[1];
      }
    }
    var prefEl = document.getElementById("mz-dash-ev-pref");
    if (prefEl) {
      // UIアイコンはFAモノクロ統一(📍カラー絵文字の置換、CLAUDE.md 必須ルール6)
      prefEl.replaceChildren();
      if (ev.venue_pref) {
        prefEl.innerHTML = '<i class="fa-solid fa-location-dot" aria-hidden="true"></i> ';
        prefEl.appendChild(document.createTextNode(ev.venue_pref));
      }
    }
    var dEl = document.getElementById("mz-dash-ev-date");
    if (dEl) {
      var d = new Date(ts);
      dEl.textContent = d.getMonth() + 1 + "/" + d.getDate() + "(" + WEEKDAYS_JA[d.getDay()] + ")";
    }
    box.hidden = false;
    showHeroDash();
  }

  var eventsLoaded = false;

  function loadUpcomingEvents() {
    if (eventsLoaded) return;
    var db = null;
    try {
      db = window.MLL_AUTH && window.MLL_AUTH.getDb && window.MLL_AUTH.getDb();
    } catch (e) {
      db = null;
    }
    if (!db) return;
    eventsLoaded = true;
    db.collection("mll_calendar_events")
      .orderBy("date", "desc")
      .limit(400)
      .get()
      .then(function (snap) {
        var rows = [];
        snap.forEach(function (doc) {
          var x = doc.data() || {};
          rows.push({
            id: doc.id,
            kind: String(x.kind || ""),
            date: String(x.date || ""),
            title: String(x.title || ""),
            venue_pref: String(x.venue_pref || "").trim(),
            status: String(x.status || ""),
          });
        });
        renderUpcomingEvents(rows);
      })
      .catch(function (err) {
        eventsLoaded = false;
        if (window.console && console.warn) console.warn("[mz-top-highlights] events", err);
      });
  }

  function init() {
    try {
      renderDashStatic();
      renderDigest();
      renderFreshVideos();
      renderYoutubeFresh();
      renderTopMedia();
      loadUpcomingEvents();
      // 練習ツール(メトロノーム/チューナー)ブロック。ログイン不要(v1.34)
      window.MarchinZBase?.mountTools?.(document.getElementById("mz-top-tools"));

      // 入口ブロックの「メトロノーム&チューナー」等、同ページ内アンカーへスムーズスクロール
      // (SPAのハッシュ遷移を止めて、ログイン不要のTOPツールへその場で移動する)
      document.querySelectorAll("[data-mz-scroll]").forEach(function (a) {
        a.addEventListener("click", function (e) {
          var target = document.getElementById(a.getAttribute("data-mz-scroll"));
          if (!target) return;
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      // Firebase 初期化が遅れて getDb() が null のときは、認証確定イベントで再試行
      window.addEventListener("mll-auth-changed", loadUpcomingEvents);
      var tries = 0;
      var timer = setInterval(function () {
        if (eventsLoaded || ++tries > 20) {
          clearInterval(timer);
          return;
        }
        loadUpcomingEvents();
      }, 400);
    } catch (err) {
      if (window.console && console.warn) console.warn("[mz-top-highlights]", err);
    }
  }

  // 実行時データリフレッシュ(marchinz-data-refresh.js)後の再描画。
  // renderFreshVideos/renderYoutubeFresh/renderDigest は追記型のため、先に空にしてから再実行する
  document.addEventListener("mz:data-refreshed", function () {
    try {
      ["mz-top-video-grid", "mz-top-yt-grid", "mz-top-note-grid", "mz-top-digest"].forEach(function (id) {
        var n = document.getElementById(id);
        if (n) n.replaceChildren();
      });
      renderDashStatic();
      renderDigest();
      renderFreshVideos();
      renderYoutubeFresh();
      renderTopMedia();
    } catch (err) {
      if (window.console && console.warn) console.warn("[mz-top-highlights] refresh", err);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
