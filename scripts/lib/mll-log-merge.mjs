/**
 * MarchinZ Log 行マージ — docs/MLL_CALENDAR_LIFECYCLE_DISCUSSION.md §12
 */

/** @type {Record<string, number>} */
export const ROLE_RANK = {
  watch: 1,
  perform: 2,
  team_staff: 3,
  ops: 4,
};

const PROFILE_ROLE_ORDER = ["watch", "perform", "team_staff", "ops"];

/** @param {string} role */
export function canonicalRole(role) {
  const r = String(role || "").trim();
  if (r === "staff" || r === "team_staff" || r === "チームスタッフ") return "team_staff";
  if (r === "ops" || r === "manage" || r === "運営" || r === "スタッフ/運営") return "ops";
  if (r === "perform" || r === "出演") return "perform";
  if (r === "watch" || r === "観戦") return "watch";
  return "watch";
}

/** @param {{ role?: string; role_label?: string }} doc */
export function inferRoleFromLog(doc) {
  let r = String(doc?.role || "").trim();
  if (r === "staff" || r === "チームスタッフ") r = "team_staff";
  else if (r === "manage" || r === "運営" || r === "スタッフ/運営") r = "ops";
  else if (r === "出演") r = "perform";
  else if (r === "観戦") r = "watch";
  if (PROFILE_ROLE_ORDER.includes(r)) return r;
  const rl = String(doc?.role_label || "").trim();
  if (/出演/.test(rl)) return "perform";
  if (/チームスタッフ/.test(rl)) return "team_staff";
  if (/運営|スタッフ/.test(rl)) return "ops";
  if (/観戦/.test(rl)) return "watch";
  return "watch";
}

/** @param {{ role?: string; role_label?: string }} doc */
export function roleRankOf(doc) {
  return ROLE_RANK[inferRoleFromLog(doc)] || 0;
}

/** @param {{ updated_at?: string; created_at?: string }} doc */
export function docTimestamp(doc) {
  const u = String(doc?.updated_at || "").trim();
  if (u) return u;
  return String(doc?.created_at || "").trim();
}

/** @param {Record<string, unknown>|null|undefined} raw */
export function normalizeLikedBy(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) out[k] = true;
  }
  return out;
}

/** @param {Record<string, boolean>} a @param {Record<string, boolean>} b */
export function unionLikedBy(a, b) {
  return { ...normalizeLikedBy(a), ...normalizeLikedBy(b) };
}

/**
 * @param {string} a
 * @param {string} b
 */
function preferNonEmpty(a, b) {
  const x = String(a || "").trim();
  if (x) return x;
  return String(b || "").trim();
}

/**
 * @param {{ id: string; data: Record<string, unknown> }} winner
 * @param {{ id: string; data: Record<string, unknown> }[]} losers
 */
export function buildMergedPayload(winner, losers) {
  /** @type {Record<string, unknown>} */
  const data = { ...(winner.data || {}) };
  let liked = normalizeLikedBy(/** @type {Record<string, unknown>} */ (data.liked_by));
  for (const L of losers) {
    liked = unionLikedBy(liked, /** @type {Record<string, unknown>} */ (L.data?.liked_by));
    data.note = preferNonEmpty(String(data.note || ""), String(L.data?.note || ""));
    data.ticket_url = preferNonEmpty(String(data.ticket_url || ""), String(L.data?.ticket_url || ""));
    data.official_url = preferNonEmpty(String(data.official_url || ""), String(L.data?.official_url || ""));
  }
  data.liked_by = liked;
  const role = inferRoleFromLog(data);
  data.role = role;
  return data;
}

/**
 * @param {{ id: string; data: Record<string, unknown> }[]} docs
 */
export function pickWinnerDoc(docs) {
  if (!docs.length) return null;
  if (docs.length === 1) return docs[0];
  return [...docs].sort((a, b) => {
    const dr = roleRankOf(b.data) - roleRankOf(a.data);
    if (dr !== 0) return dr;
    return docTimestamp(b.data).localeCompare(docTimestamp(a.data));
  })[0];
}

/**
 * @param {{ id: string; data: Record<string, unknown> }[]} docs
 * @returns {{ winner: { id: string; data: Record<string, unknown> }; losers: { id: string; data: Record<string, unknown> }[]; payload: Record<string, unknown> }|null}
 */
export function planGroupMerge(docs) {
  if (docs.length < 2) return null;
  const winner = pickWinnerDoc(docs);
  if (!winner) return null;
  const losers = docs.filter((d) => d.id !== winner.id);
  const payload = buildMergedPayload(winner, losers);
  return { winner, losers, payload };
}

/**
 * マージグループキー（calendar_event_id 優先、無ければ matchKey）
 * @param {{ id: string; data: Record<string, unknown> }} doc
 * @param {(log: Record<string, unknown>) => string} matchKeyFn
 */
export function mergeGroupKey(doc, matchKeyFn) {
  const uid = String(doc.data?.user_id || "").trim();
  const calId = String(doc.data?.calendar_event_id || "").trim();
  const mk = matchKeyFn(doc.data || {});
  return calId ? `${uid}|cal:${calId}` : `${uid}|mk:${mk}`;
}
