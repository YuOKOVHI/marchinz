"use strict";
/**
 * イベントページのURLからタイトル/開催日/都道府県/種別を推定して返す。
 * イベント登録フォームの「URLから仮入力」用(ブラウザからは他サイトを直接fetchできないため
 * サーバ側で取得する)。返すのは抽出済みフィールドのみで、HTML本体は返さない。
 *
 * GET /.netlify/functions/event-scrape?url=https://...
 * → { ok, title, date, pref, kind, via: ["jsonld"|"og"|"text", ...] }
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

/** 本文テキストから開催日候補を拾う。年つき(2026年7月20日 / 2026/7/20)優先、無ければ月日のみ(未来解釈) */
function findDates(text) {
  const out = [];
  const re1 = /(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/g;
  let m;
  while ((m = re1.exec(text)) && out.length < 8) {
    const s = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (s) out.push(s);
  }
  if (!out.length) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const y = now.getFullYear();
    const re2 = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
    while ((m = re2.exec(text)) && out.length < 8) {
      let s = isoDate(y, Number(m[1]), Number(m[2]));
      if (s && s < today) s = isoDate(y + 1, Number(m[1]), Number(m[2]));
      if (s) out.push(s);
    }
  }
  return out;
}

/** JSON-LD から schema.org/Event ノードを探す(@graph・配列対応) */
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

function guessKind(text) {
  if (/大会|コンテスト|コンクール|選手権|チャンピオンシップ|グランプリ/.test(text)) return "大会";
  if (/演奏会|コンサート|定期演奏|リサイタル/.test(text)) return "演奏会";
  return "イベント";
}

exports.handler = async (event) => {
  const raw = (event.queryStringParameters || {}).url || "";
  let target;
  try { target = new URL(raw); } catch { return json(400, { ok: false, error: "URLが正しくありません" }); }
  if (!/^https?:$/.test(target.protocol)) return json(400, { ok: false, error: "http/https のURLだけ対応しています" });
  if (isPrivateHost(target.hostname)) return json(400, { ok: false, error: "このURLは取得できません" });

  let html = "";
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(target.href, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarchinZEventBot/1.0; +https://marchinz.netlify.app)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.8",
      },
    });
    clearTimeout(tm);
    if (!res.ok) return json(200, { ok: false, error: `ページを取得できませんでした(HTTP ${res.status})` });
    html = (await res.text()).slice(0, 1500000);
  } catch {
    return json(200, { ok: false, error: "ページを取得できませんでした(時間切れ/接続失敗)" });
  }

  const via = [];
  let title = "";
  let date = "";
  let pref = "";

  // 1) JSON-LD(schema.org/Event) — 最も信頼できる
  const ld = findJsonLdEvent(html);
  if (ld) {
    via.push("jsonld");
    if (typeof ld.name === "string") title = ld.name.trim();
    if (typeof ld.startDate === "string") {
      const m = ld.startDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) date = m[0];
    }
    const loc = ld.location;
    const locStr = JSON.stringify(loc || "");
    pref = PREFS.find((p) => locStr.includes(p)) || "";
  }

  // 2) OGP / <title>
  const ogTitle = metaContent(html, ["og:title", "twitter:title"]);
  const ogDesc = metaContent(html, ["og:description", "description"]);
  if (!title && ogTitle) { title = ogTitle; via.push("og"); }
  if (!title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) { title = stripTags(t[1]).trim(); via.push("title"); }
  }

  // 3) 本文テキストから日付・都道府県を補完
  const text = stripTags(html).slice(0, 20000);
  if (!date) {
    const dates = findDates(`${title} ${ogDesc} ${text}`);
    if (dates.length) { date = dates[0]; via.push("text"); }
  }
  if (!pref) pref = PREFS.find((p) => `${title} ${ogDesc}`.includes(p)) || PREFS.find((p) => text.includes(p)) || "";

  const kind = guessKind(`${title} ${ogDesc}`) || guessKind(text);

  if (!title && !date && !pref) {
    return json(200, { ok: false, error: "このページからはイベント情報を読み取れませんでした" });
  }
  return json(200, {
    ok: true,
    title: title.slice(0, 200),
    date,
    pref,
    kind,
    via,
  });
};
