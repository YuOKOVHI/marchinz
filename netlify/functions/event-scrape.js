"use strict";
/**
 * イベントページのURLから登録フォームの中身を推定して返す(v2)。
 * イベント登録フォームの「URLから自動入力」用(ブラウザからは他サイトを直接fetchできないため
 * サーバ側で取得する)。返すのは抽出済みフィールドのみで、HTML本体は返さない。
 *
 * GET /.netlify/functions/event-scrape?url=https://...
 * → { ok, title, date, end_date, dates, time, venue_name, pref, kind, via }
 *   dates    … 見つかった開催日候補(最大6)。複数公演のページでは利用者に選ばせる
 *   end_date … 「7/20〜21」のような期間表記の終わり
 *   time     … 開演時刻 "HH:MM"(開演が無ければ開始/開場で代用)
 *
 * v2 (2026-07-22) の要点:
 *   - 文字コード検出。旧版は UTF-8 決め打ちで、日本のイベントページに多い
 *     Shift_JIS だと文字化けして抽出が全滅していた(効果が一番大きい修正)
 *   - JSON-LD から endDate / location.name / addressRegion も読む
 *   - 日付は候補を複数返す。勝手に1つ目へ決めない
 *   - 解析は parseEventHtml() に純関数として分離(Node の無い開発機でも
 *     ブラウザにフィクスチャを食わせて検証できるようにするため)
 */

const PREFS = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=0",
    },
    body: JSON.stringify(body),
  };
}

/** SSRF対策: ローカル/プライベート宛の取得を拒否する */
function isPrivateHost(host) {
  const h = String(host || "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "[::1]" || h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe80")) return true;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
}

function pad2(n) { return String(n).padStart(2, "0"); }

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/* ---------- 文字コード ----------
   ヘッダの charset → meta の charset の順に見る。Shift_JIS / EUC-JP の
   ページはまだ現役(自治体・ホール・吹連系に多い)。UTF-8決め打ちだった
   旧版はここで全滅していた */
function detectCharset(contentType, bytes) {
  const fromHeader = /charset=([\w-]+)/i.exec(String(contentType || ""));
  if (fromHeader) return fromHeader[1].toLowerCase();
  // meta は ASCII 互換領域に書かれるので、素朴に1バイトずつ覗けば拾える
  let head = "";
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
  const m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
    || /content=["'][^"']*charset=([\w-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : "utf-8";
}

function decodeBody(buf, contentType) {
  const bytes = new Uint8Array(buf);
  const label = detectCharset(contentType, bytes);
  let text;
  try {
    text = new TextDecoder(label).decode(bytes);
  } catch {
    text = new TextDecoder("utf-8").decode(bytes);   // 不明ラベルはUTF-8で読む
  }
  // 長さの上限は「文字」で切る。バイトで切ると多バイト文字の途中を割る
  return text.length > 800000 ? text.slice(0, 800000) : text;
}

/* ---------- 日付 ----------
   候補を集めて返す。決めるのは人。
   ・年つき(2026年7月20日 / 2026/7/20 / 2026-07-20)を優先
   ・「2026年7月20日〜21日」のような続き表記は同じ年月の日として展開
   ・年なし(7月20日)は未来解釈(過ぎていれば翌年) */
function collectDates(text) {
  const found = [];
  const push = (s) => { if (s && !found.includes(s) && found.length < 6) found.push(s); };

  const reFull = /(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/g;
  let m;
  while ((m = reFull.exec(text))) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    push(isoDate(y, mo, d));
    // 直後の「〜21」「・21日」「,22」を同じ年月の日として拾う(期間・複数公演)
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const t = /^[^0-9]{0,6}[〜～\-・,、]\s*(\d{1,2})\s*日?/.exec(tail);
    if (t) push(isoDate(y, mo, Number(t[1])));
  }

  if (!found.length) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const y = now.getFullYear();
    const reMd = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
    while ((m = reMd.exec(text))) {
      let s = isoDate(y, Number(m[1]), Number(m[2]));
      if (s && s < today) s = isoDate(y + 1, Number(m[1]), Number(m[2]));
      push(s);
    }
  }
  return found;
}

/** 「7/20(土)〜7/21(日)」「7月20日〜21日」を期間として読む。無ければ null */
function findRange(text, year) {
  const re = /(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?\s*(?:[（(][^）)]{1,3}[）)])?\s*[〜～]\s*(?:(\d{1,2})\s*[月/]\s*)?(\d{1,2})\s*日?/;
  const m = re.exec(text);
  if (!m) return null;
  const mo1 = Number(m[1]), d1 = Number(m[2]);
  const mo2 = m[3] ? Number(m[3]) : mo1;
  const d2 = Number(m[4]);
  const a = isoDate(year, mo1, d1);
  const b = isoDate(year, mo2, d2);
  if (a && b && a < b) return { start: a, end: b };
  return null;
}

/* ---------- 時刻 ----------
   開演を最優先、無ければ開始/スタート、最後に開場。
   「開演 18:00」「開演18時30分」「18時開演」の形に対応 */
function findTime(text) {
  const labels = ["開演", "開始", "スタート", "開場"];
  for (const label of labels) {
    let m = new RegExp(label + "[^0-9]{0,6}(\\d{1,2})\\s*[:時]\\s*(\\d{1,2})?").exec(text);
    if (!m) m = new RegExp("(\\d{1,2})\\s*[:時]\\s*(\\d{1,2})?\\s*" + label).exec(text);
    if (m) {
      const h = Number(m[1]);
      const mi = m[2] == null ? 0 : Number(m[2]);
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return `${pad2(h)}:${pad2(mi)}`;
    }
  }
  return "";
}

/* ---------- 会場名 ---------- */
function cleanVenueName(s) {
  let v = decodeEntities(String(s || "")).replace(/\s+/g, " ").trim();
  v = v.replace(/[（(][^）)]*[）)]\s*$/, "").trim();   // 末尾の(住所)や(最寄駅)を落とす
  v = v.replace(/\s*(開場|開演|開始|入場|受付|チケット).*$/, "").trim();   // 続く時刻情報を切る
  if (v.length < 2 || v.length > 60) return "";
  if (PREFS.includes(v)) return "";                   // 都道府県名だけなら会場名ではない
  return v;
}

function findVenueName(text) {
  // 2語目は数字を含むもの(開場12:30 等の時刻情報)を拾わない
  const re = /(?:会場|開催場所|会場名|場所)\s*[：:]\s*([^\s、。｜|]{2,40}(?:\s[^\s、。｜|0-9]{1,20})?)/;
  const m = re.exec(text);
  return m ? cleanVenueName(m[1]) : "";
}

/* ---------- JSON-LD ---------- */
function findJsonLdEvent(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let parsed;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = [];
    (Array.isArray(parsed) ? parsed : [parsed]).forEach((n) => {
      if (n && Array.isArray(n["@graph"])) nodes.push(...n["@graph"]);
      else if (n) nodes.push(n);
    });
    const ev = nodes.find((n) => {
      const t = n && n["@type"];
      const types = Array.isArray(t) ? t : [t];
      return types.some((x) => typeof x === "string" && /Event$/i.test(x));
    });
    if (ev) return ev;
  }
  return null;
}

function metaContent(html, patterns) {
  for (const p of patterns) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i");
    const m = html.match(re) || html.match(re2);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return "";
}

/* ---------- 種別 ----------
   保存できるのは 大会/演奏会/イベント の3つ。講習会・体験会・フェス等は
   「イベント」に寄せる(分類は増やさない: タブ・地図・色分けが3種前提) */
function guessKind(text) {
  const t = String(text || "");
  if (/大会|コンテスト|コンクール|選手権|チャンピオンシップ|グランプリ|予選|カップ/.test(t)) return "大会";
  if (/演奏会|コンサート|定期演奏|リサイタル|発表会|ジョイント/.test(t)) return "演奏会";
  return "イベント";
}

/* ================= 解析本体(純関数) =================
   fetch と切り離してある。Node の無い開発機では、ブラウザで
   このファイルを読み込んでフィクスチャHTMLを食わせて検証する */
function parseEventHtml(html) {
  const via = [];
  let title = "";
  let date = "";
  let endDate = "";
  let pref = "";
  let venueName = "";
  let time = "";
  let dates = [];

  // 1) JSON-LD(schema.org/Event) — 最も信頼できる
  const ld = findJsonLdEvent(html);
  if (ld) {
    via.push("jsonld");
    if (typeof ld.name === "string") title = ld.name.trim();
    const pick = (v) => {
      const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[0] : "";
    };
    date = pick(ld.startDate);
    endDate = pick(ld.endDate);
    if (endDate && endDate <= date) endDate = "";
    const loc0 = Array.isArray(ld.location) ? ld.location[0] : ld.location;
    if (loc0 && typeof loc0 === "object") {
      if (typeof loc0.name === "string") venueName = cleanVenueName(loc0.name);
      const addr = loc0.address || {};
      const region = typeof addr === "object" ? String(addr.addressRegion || "") : String(addr);
      pref = PREFS.find((p) => region.includes(p) || region === p.replace(/[都府県]$/, "")) || "";
    }
    if (!pref) {
      const locStr = JSON.stringify(ld.location || "");
      pref = PREFS.find((p) => locStr.includes(p)) || "";
    }
    const tm = String(ld.startDate || "").match(/T(\d{2}):(\d{2})/);
    if (tm) time = `${tm[1]}:${tm[2]}`;
  }

  // 2) OGP / <title>
  const ogTitle = metaContent(html, ["og:title", "twitter:title"]);
  const ogDesc = metaContent(html, ["og:description", "description"]);
  if (!title && ogTitle) { title = ogTitle; via.push("og"); }
  if (!title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) { title = stripTags(t[1]).trim(); via.push("title"); }
  }

  // 3) 本文テキストから補完
  const text = stripTags(html).slice(0, 30000);
  const headText = `${title} ${ogDesc}`;

  dates = collectDates(`${headText} ${text}`);
  if (!date && dates.length) { date = dates[0]; via.push("text"); }
  if (date && !dates.includes(date)) dates.unshift(date);

  if (!endDate) {
    const year = Number((date || "").slice(0, 4)) || new Date().getFullYear();
    const range = findRange(`${headText} ${text}`, year);
    if (range && (!date || range.start === date)) {
      date = date || range.start;
      endDate = range.end;
    }
  }

  if (!time) time = findTime(`${headText} ${text}`);
  if (!venueName) venueName = findVenueName(`${headText} ${text}`);
  if (!pref) pref = PREFS.find((p) => headText.includes(p)) || PREFS.find((p) => text.includes(p)) || "";
  // 会場名から引く(「広島グリーンアリーナ」→広島県)。最後の手段
  if (!pref && venueName) {
    pref = PREFS.find((p) => venueName.includes(p.replace(/[都府県]$/, ""))) || "";
  }

  /* 種別は「何も当たらなければイベント」に落ちる。当たったのか
     落ちたのかを区別できないと、推測が断定の顔をしてしまうため
     ここで分けて持つ(2026-07-22 レビュー) */
  const kindText = headText + " " + text.slice(0, 2000);
  const kindHit = /大会|コンテスト|コンクール|選手権|チャンピオンシップ|グランプリ|予選|カップ|演奏会|コンサート|定期演奏|リサイタル|発表会|ジョイント/.test(kindText);
  const kind = guessKind(kindText);

  /* 項目ごとの確信度。high=構造化データ(JSON-LD)や明示ラベルから確実に
     取れたもの / low=本文からの推測。UIはこれを見て見せ方を変える */
  const fromLd = via.includes("jsonld");
  const confidence = {
    title: title ? (fromLd || via.includes("og") ? "high" : "low") : "",
    date: date ? (fromLd ? "high" : "low") : "",
    end_date: endDate ? (fromLd ? "high" : "low") : "",
    pref: pref ? (fromLd ? "high" : "low") : "",
    venue_name: venueName ? (fromLd ? "high" : "low") : "",
    time: time ? (fromLd ? "high" : "low") : "",
    kind: kindHit ? "low" : "guess",   // 種別は常に埋まるので別格を用意する
  };

  return {
    title: String(title || "").slice(0, 200),
    date,
    end_date: endDate,
    dates,
    time,
    venue_name: venueName,
    pref,
    kind,
    confidence,
    via,
  };
}

exports.handler = async (event) => {
  const raw = (event.queryStringParameters || {}).url || "";
  let target;
  try { target = new URL(raw); } catch { return json(400, { ok: false, error: "URLが正しくありません" }); }
  if (!/^https?:$/.test(target.protocol)) return json(400, { ok: false, error: "http/https のURLだけ対応しています" });
  if (isPrivateHost(target.hostname)) return json(400, { ok: false, error: "このURLは取得できません" });

  /* リダイレクトは自前で追う。redirect:"follow" だと入口だけ検査して
     飛び先が無検査になり、内部アドレス(クラウドのメタデータ等)へ
     到達しうる。1ホップごとに isPrivateHost を通す(2026-07-22 レビュー) */
  let html = "";
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 8000);
    let cur = target;
    let res = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(cur.href, {
        signal: ctl.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MarchinZEventBot/1.0; +https://marchinz.netlify.app)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "ja,en;q=0.8",
        },
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      if (!loc) break;
      let next;
      try { next = new URL(loc, cur.href); } catch { clearTimeout(tm); return json(200, { ok: false, error: "転送先のURLが正しくありません" }); }
      if (!/^https?:$/.test(next.protocol) || isPrivateHost(next.hostname)) {
        clearTimeout(tm);
        return json(400, { ok: false, error: "このURLは取得できません" });
      }
      cur = next;
      res = null;
    }
    clearTimeout(tm);
    if (!res) return json(200, { ok: false, error: "転送が多すぎます" });
    if (!res.ok) return json(200, { ok: false, error: `ページを取得できませんでした(HTTP ${res.status})` });
    const buf = await res.arrayBuffer();
    html = decodeBody(buf, res.headers.get("content-type"));
  } catch {
    return json(200, { ok: false, error: "ページを取得できませんでした(時間切れ/接続失敗)" });
  }

  const out = parseEventHtml(html);

  if (!out.title && !out.date && !out.pref) {
    const sns = /(?:^|\.)(twitter\.com|x\.com|instagram\.com|facebook\.com|threads\.net)$/i.test(target.hostname);
    return json(200, {
      ok: false,
      error: sns
        ? "SNSの投稿ページは中身を読み取れないことが多いです。公式サイトや告知ページのURLでお試しください"
        : "このページからはイベント情報を読み取れませんでした",
    });
  }
  return json(200, { ok: true, ...out });
};

// ブラウザでの検証用(Netlify実行時は handler だけが使われる)
if (typeof module !== "undefined") {
  module.exports.parseEventHtml = parseEventHtml;
  module.exports.collectDates = collectDates;
  module.exports.findTime = findTime;
  module.exports.findVenueName = findVenueName;
  module.exports.detectCharset = detectCharset;
  module.exports.decodeBody = decodeBody;
  module.exports.guessKind = guessKind;
}
