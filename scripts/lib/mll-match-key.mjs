/**
 * MarchinZ — mll_logs と mll_calendar_events の matchKey（calendar-events.js と同一正規化）
 */

/** @param {string} s */
export function normTitleKey(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} date
 * @param {string} title
 * @param {string} venue
 */
export function eventMatchKey(date, title, venue) {
  return `${String(date || "").trim()}|${normTitleKey(title)}|${String(venue || "").trim()}`;
}

/** @param {{ event_date?: string; event_name?: string; venue?: string }} log */
export function logMatchKey(log) {
  return eventMatchKey(log?.event_date, log?.event_name, log?.venue);
}

/** @param {{ date?: string; title?: string; venue_pref?: string }} ev */
export function calendarMatchKey(ev) {
  return eventMatchKey(ev?.date, ev?.title, ev?.venue_pref);
}

/**
 * @param {string} matchKey
 * @param {{ id: string; created_at?: string }[]} candidates
 * @param {string} [preferEventId]
 */
export function pickCalendarEventId(matchKey, candidates, preferEventId = "") {
  if (!candidates?.length) return { eventId: "", ambiguous: false, candidates: [] };
  const pref = String(preferEventId || "").trim();
  if (pref && candidates.some((c) => c.id === pref)) {
    return { eventId: pref, ambiguous: candidates.length > 1, candidates };
  }
  if (candidates.length === 1) {
    return { eventId: candidates[0].id, ambiguous: false, candidates };
  }
  const sorted = [...candidates].sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || "")),
  );
  return { eventId: sorted[0].id, ambiguous: true, candidates };
}
