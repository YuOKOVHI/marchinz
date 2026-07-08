/**
 * MarchinZ Log — 参加スタイル（role）の唯一の変換・表示ロジック。
 * mll.js / user-profile-page.js / calendar-events.js から参照する。
 */
(() => {
  /** @typedef {"watch"|"perform"|"team_staff"|"ops"} MllRoleKey */

  /** @type {readonly MllRoleKey[]} */
  const PROFILE_ROLE_ORDER = ["watch", "perform", "team_staff", "ops"];

  /** @type {Record<MllRoleKey, { present: string; past: string }>} */
  const ROLE_PHRASE = {
    watch: { present: "観戦する", past: "観戦した" },
    perform: { present: "出演する", past: "出演した" },
    team_staff: { present: "チームスタッフで参加する", past: "チームスタッフで参加した" },
    ops: { present: "運営側で参加する", past: "運営側で参加した" },
  };

  /** @type {Record<MllRoleKey, string>} */
  const ROLE_LABEL_JA = {
    watch: "観戦",
    perform: "出演",
    team_staff: "チームスタッフ",
    ops: "運営",
  };

  /**
   * MarchinZ Log の4区分（サイト全体で共通。value は Firestore 保存値）
   * @type {readonly { value: string; label: string }[]}
   */
  const MLL_PARTICIPATION_4 = [
    { value: "観戦", label: "観戦" },
    { value: "出演", label: "出演" },
    { value: "チームスタッフ", label: "チームスタッフ" },
    { value: "運営", label: "スタッフ・運営" },
  ];

  /** カレンダー attendees 用（ルール allowlist と一致） */
  const ATTENDANCE_STYLE_OPTIONS_JA = ["観戦", "出演", "チームスタッフ", "スタッフ・運営"];

  /** イベントカード・Note カード左端の小さなバッジ */
  const MLL_LOG_ROW_BADGE_LABEL = "MarchinZ Log";

  /** @deprecated 旧イベント登録。新規は MLL_PARTICIPATION_4 の value のみ */
  const EVENT_RECRUITMENT_OPTIONS_JA = ["観戦", "出演", "運営", "チームスタッフ", "未定"];

  /** 4区分に解釈できないときの表示（観戦へは落とさない） */
  const PARTICIPATION_UNKNOWN_LABEL = "（参加スタイル不明）";

  /**
   * @param {string} raw
   * @returns {MllRoleKey|null}
   */
  function tryCanonicalRole(raw) {
    const r = String(raw || "").trim();
    if (!r) return null;
    if (r === "staff" || r === "team_staff" || r === "チームスタッフ") return "team_staff";
    if (r === "ops" || r === "manage" || r === "運営" || r === "スタッフ/運営" || r === "スタッフ・運営")
      return "ops";
    if (r === "perform" || r === "出演") return "perform";
    if (r === "watch" || r === "観戦") return "watch";
    if (/** @type {MllRoleKey[]} */ (PROFILE_ROLE_ORDER).includes(/** @type {MllRoleKey} */ (r))) {
      return /** @type {MllRoleKey} */ (r);
    }
    return null;
  }

  /**
   * フォーム送信など「未選択時は watch」とする経路用。表示・集計では tryCanonicalRole / resolveParticipationStyle を使う。
   * @param {string} role
   * @returns {MllRoleKey}
   */
  function canonicalRole(role) {
    return tryCanonicalRole(role) ?? "watch";
  }

  /**
   * @param {string} stored
   * @returns {{ known: boolean; role: MllRoleKey|null; uiLabel: string; value: string }}
   */
  function resolveParticipationStyle(stored) {
    const v = String(stored ?? "").trim();
    if (!v) {
      return { known: false, role: null, uiLabel: PARTICIPATION_UNKNOWN_LABEL, value: "" };
    }
    const hit = MLL_PARTICIPATION_4.find((x) => x.value === v || x.label === v);
    if (hit) {
      return {
        known: true,
        role: attendanceJaToRoleOrNull(hit.label),
        uiLabel: hit.label,
        value: hit.value,
      };
    }
    if (v === "未定") {
      return { known: true, role: null, uiLabel: "未定", value: "未定" };
    }
    if (v === "スタッフ/運営") {
      return { known: true, role: "ops", uiLabel: "スタッフ・運営", value: "運営" };
    }
    const role = tryCanonicalRole(v);
    if (role) {
      const value = roleToParticipationJa(role);
      const row = MLL_PARTICIPATION_4.find((x) => x.value === value);
      return {
        known: true,
        role,
        uiLabel: row?.label || profileRoleKeyToUiLabel(role),
        value,
      };
    }
    console.warn("[MarchinZMllRole] unknown participation style:", v);
    return { known: false, role: null, uiLabel: PARTICIPATION_UNKNOWN_LABEL, value: "" };
  }

  /**
   * @param {string} dateStr YYYY-MM-DD または YYYY/MM/DD
   */
  function isPastDate(dateStr) {
    const raw = String(dateStr || "").trim().replace(/\//g, "-");
    if (!raw) return false;
    const d = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d < today;
  }

  /**
   * @param {MllRoleKey} role
   * @param {string} dateStr
   */
  function buildRoleLabel(role, dateStr) {
    const key = canonicalRole(role);
    const r = ROLE_PHRASE[key] || ROLE_PHRASE.watch;
    return isPastDate(dateStr) ? r.past : r.present;
  }

  /**
   * @param {{ role?: string; role_label?: string }} doc
   * @returns {MllRoleKey|null}
   */
  function inferRoleFromLogOrNull(doc) {
    const fromRole = tryCanonicalRole(doc?.role);
    if (fromRole) return fromRole;
    const rl = String(doc?.role_label || "").trim();
    if (/出演/.test(rl)) return "perform";
    if (/チームスタッフ/.test(rl)) return "team_staff";
    if (/運営|スタッフ/.test(rl)) return "ops";
    if (/観戦/.test(rl)) return "watch";
    return null;
  }

  /**
   * @param {{ role?: string; role_label?: string }} doc
   * @returns {MllRoleKey}
   */
  function inferRoleFromLog(doc) {
    const r = inferRoleFromLogOrNull(doc);
    if (r) return r;
    console.warn(
      "[MarchinZMllRole] inferRoleFromLog: unmapped log; legacy merge path defaults to watch",
      doc?.role,
      doc?.role_label,
    );
    return "watch";
  }

  /**
   * @param {MllRoleKey|string} role
   * @returns {string}
   */
  function roleToParticipationJa(role) {
    const k = tryCanonicalRole(role);
    if (!k) return "";
    if (k === "perform") return "出演";
    if (k === "team_staff") return "チームスタッフ";
    if (k === "ops") return "運営";
    return "観戦";
  }

  /**
   * @param {string} style UI ラベル（4区分）
   * @returns {MllRoleKey|null}
   */
  function attendanceJaToRoleOrNull(style) {
    const s = String(style || "").trim();
    if (!s) return null;
    if (s === "出演") return "perform";
    if (s === "チームスタッフ") return "team_staff";
    if (s === "運営" || s === "スタッフ/運営" || s === "スタッフ・運営") return "ops";
    if (s === "観戦") return "watch";
    return null;
  }

  /**
   * @param {string} style カレンダー attendees / ダイアログの日本語ラベル
   * @returns {MllRoleKey}
   */
  function attendanceJaToRole(style) {
    return attendanceJaToRoleOrNull(style) ?? "watch";
  }

  /** @param {string} label UI ラベル（MarchinZ Log 4区分） */
  function attendanceLabelToFirestoreStyle(label) {
    const res = resolveParticipationStyle(label);
    if (res.known && res.uiLabel === "スタッフ・運営") return "スタッフ/運営";
    if (res.known && res.value === "運営") return "スタッフ/運営";
    if (res.known && res.value) return res.value;
    if (res.known && res.uiLabel && res.uiLabel !== "未定") return res.uiLabel;
    console.warn("[MarchinZMllRole] attendanceLabelToFirestoreStyle: unknown label", label);
    return "";
  }

  /** @param {string} stored participation_format または attendees.style */
  function participationFormatLabel(stored) {
    return resolveParticipationStyle(stored).uiLabel;
  }

  /** @param {string} v */
  function isParticipationFormat(v) {
    const s = String(v || "").trim();
    return MLL_PARTICIPATION_4.some((x) => x.value === s) || s === "未定";
  }

  /** attendees.style（Firestore）→ 関わり方 select の value */
  function firestoreStyleToParticipationValue(style) {
    const s = String(style || "").trim();
    if (s === "スタッフ/運営" || s === "スタッフ・運営") return "運営";
    if (s === "出演" || s === "チームスタッフ" || s === "観戦") return s;
    if (s === "運営") return "運営";
    return "";
  }

  /** participation_format / select value → attendees.style */
  function participationValueToFirestoreStyle(value) {
    const v = String(value || "").trim();
    if (!v || v === "未定") return "";
    if (v === "運営") return "スタッフ/運営";
    return attendanceLabelToFirestoreStyle(
      MLL_PARTICIPATION_4.find((x) => x.value === v)?.label || v,
    );
  }

  /**
   * ユーザー×イベントの MarchinZ Log 1件（role は問わない）
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {{ calendarEventId?: string; eventDate?: string; eventName?: string; venue?: string }} opts
   */
  async function findUserLogForCalendarEvent(db, userId, opts = {}) {
    const uid = String(userId || "").trim();
    if (!uid || !db) return null;
    const calId = String(opts.calendarEventId || "").trim();
    if (calId) {
      try {
        const snap = await db
          .collection("mll_logs")
          .where("user_id", "==", uid)
          .where("calendar_event_id", "==", calId)
          .limit(30)
          .get();
        /** @type {{ id: string; ref: import('firebase').firestore.DocumentReference; data: Record<string, unknown> }[]} */
        const docs = [];
        snap.forEach((doc) => {
          docs.push({ id: doc.id, ref: doc.ref, data: doc.data() || {} });
        });
        const winner = pickWinnerDoc(docs);
        if (winner) return winner;
      } catch (e) {
        console.warn("[mll-role] findUserLogForCalendarEvent by id", e);
      }
    }
    const eventDate = String(opts.eventDate || "").trim();
    if (!eventDate) return null;
    const mk = eventMatchKey(eventDate, opts.eventName, opts.venue);
    try {
      const snap = await db
        .collection("mll_logs")
        .where("user_id", "==", uid)
        .where("event_date", "==", eventDate)
        .limit(50)
        .get();
      /** @type {{ id: string; ref: import('firebase').firestore.DocumentReference; data: Record<string, unknown> }[]} */
      const docs = [];
      snap.forEach((doc) => {
        const x = doc.data() || {};
        if (logMatchKey(x) !== mk) return;
        docs.push({ id: doc.id, ref: doc.ref, data: x });
      });
      return pickWinnerDoc(docs);
    } catch (e) {
      console.warn("[mll-role] findUserLogForCalendarEvent by matchKey", e);
      return null;
    }
  }

  /**
   * 関わり方の正（優先: mll_logs → attendees → 作成者の participation_format）
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {{ id?: string; created_by?: string; date?: string; title?: string; venue_pref?: string; participation_format?: string }} ev
   * @param {string} [attendeeStyleFirestore]
   */
  async function resolveUserInvolvementForEvent(db, userId, ev, attendeeStyleFirestore) {
    const uid = String(userId || "").trim();
    if (!uid || !ev) return { participationValue: "", role: null };
    const log = db
      ? await findUserLogForCalendarEvent(db, uid, {
          calendarEventId: String(ev.id || "").trim(),
          eventDate: ev.date,
          eventName: ev.title,
          venue: ev.venue_pref,
        })
      : null;
    if (log?.data) {
      const role = inferRoleFromLog(log.data);
      return { participationValue: roleToParticipationJa(role), role };
    }
    const st = String(attendeeStyleFirestore || "").trim();
    if (st) {
      const role = attendanceJaToRole(firestoreStyleToParticipationValue(st) || st);
      return { participationValue: roleToParticipationJa(role), role };
    }
    if (String(ev.created_by || "").trim() === uid) {
      const pf = String(ev.participation_format || "").trim();
      if (pf && pf !== "未定") {
        const role = attendanceJaToRole(pf);
        return { participationValue: roleToParticipationJa(role), role };
      }
    }
    return { participationValue: "", role: null };
  }

  /**
   * MarchinZ Log（mll_logs）・attendees・イベント participation_format を同期
   * @param {import('firebase').firestore.Firestore} db
   * @param {{ id: string; user_metadata?: { avatar_url?: string } }} user
   * @param {string} eventId
   * @param {{ date?: string; title?: string; venue_pref?: string; event_url?: string }} ev
   * @param {string} participationValue 観戦|出演|チームスタッフ|運営（空・未定はスキップ）
   */
  /** @param {MllRoleKey|string} roleKey */
  function profileRoleKeyToUiLabel(roleKey) {
    const k = tryCanonicalRole(roleKey);
    if (!k) return "";
    if (k === "ops") return "スタッフ・運営";
    return ROLE_LABEL_JA[k] || "";
  }

  /** UI ラベル（観戦 / スタッフ・運営 等）→ participation value（観戦|出演|チームスタッフ|運営） */
  function participationUiLabelToValue(label) {
    const s = String(label || "").trim();
    const hit = MLL_PARTICIPATION_4.find((x) => x.label === s || x.value === s);
    if (hit) return hit.value;
    const fs = attendanceLabelToFirestoreStyle(s);
    return firestoreStyleToParticipationValue(fs) || s;
  }

  /**
   * プロフィール MarchinZ Log：参加スタイルのみ更新（イベント掲示の編集は別画面）
   * @param {import('firebase').firestore.Firestore} db
   * @param {{ id: string; user_metadata?: { avatar_url?: string } }} user
   * @param {Record<string, unknown>} log mll_logs ドキュメント + id
   * @param {string} participationUiLabel
   * @param {{ matchMap?: Map<string, string>; byId?: Map<string, { created_by?: string }> }} [calLookup]
   */
  async function updateProfileLogParticipation(db, user, log, participationUiLabel, calLookup) {
    const uid = String(user?.id || "").trim();
    const logId = String(log?.id || "").trim();
    const pv = participationUiLabelToValue(participationUiLabel);
    if (!uid || !logId || !db || !pv) {
      throw new Error("参加スタイルを更新できません。");
    }
    if (String(log.user_id || "").trim() !== uid) {
      throw new Error("この Log を編集する権限がありません。");
    }
    let eid = String(log.calendar_event_id || "").trim();
    if (!eid && calLookup?.matchMap instanceof Map) {
      const date = String(log.event_date || "").trim();
      const title = String(log.event_name || "").trim();
      if (date && title) {
        eid = calLookup.matchMap.get(`${date}__${normTitleKey(title)}`) || "";
      }
    }
    if (eid) {
      const ev = {
        date: String(log.event_date || "").trim(),
        title: String(log.event_name || "").trim(),
        venue_pref: String(log.venue || "").trim(),
        event_url: String(log.official_url || log.ticket_url || "").trim(),
        created_by: String(calLookup?.byId?.get(eid)?.created_by || "").trim(),
      };
      await syncUserInvolvementForCalendar(db, user, eid, ev, pv);
      return;
    }
    const role = attendanceJaToRole(pv);
    const roleLabel = buildRoleLabel(role, String(log.event_date || ""));
    const nowIso = new Date().toISOString();
    await db.collection("mll_logs").doc(logId).update({
      role,
      role_label: roleLabel,
      updated_at: nowIso,
    });
    const styleLabel = participationFormatLabel(pv) || pv;
    await syncDiariesParticipationStyleForUserEvent(db, uid, {
      eventId: "",
      eventDate: String(log.event_date || "").trim(),
      eventTitle: String(log.event_name || "").trim(),
      participationStyleLabel: styleLabel,
      updatedAt: nowIso,
    });
  }

  /** @param {Record<string, unknown>} logData */
  function participationStyleLabelFromLogData(logData) {
    const role = inferRoleFromLogOrNull(logData);
    if (role) {
      return participationFormatLabel(roleToParticipationJa(role));
    }
    const rl = String(logData?.role_label || "").trim();
    if (rl) return rl;
    return PARTICIPATION_UNKNOWN_LABEL;
  }

  /**
   * 同一イベントの MarchinZ Note（event_log_diaries）の participation_style を Log に合わせる。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} uid
   * @param {{ eventId?: string; eventDate?: string; eventTitle?: string; participationStyleLabel: string; updatedAt?: string }} opts
   */
  async function syncDiariesParticipationStyleForUserEvent(db, uid, opts) {
    const owner = String(uid || "").trim();
    const styleLabel = String(opts.participationStyleLabel || "").trim();
    const eid = String(opts.eventId || "").trim();
    const evDate = String(opts.eventDate || "").trim();
    const evTitleKey = normTitleKey(String(opts.eventTitle || ""));
    if (!owner || !db || !styleLabel) return;
    const nowIso = String(opts.updatedAt || "").trim() || new Date().toISOString();
    const diaryCol = db.collection("mll_profiles").doc(owner).collection("event_log_diaries");
    const diarySnap = await diaryCol.get();
    const diaryUpdates = [];
    diarySnap.forEach((doc) => {
      const d = doc.data() || {};
      const matchId = eid && doc.id === eid;
      const matchMeta =
        !eid &&
        evDate &&
        evTitleKey &&
        String(d.event_date || "").trim() === evDate &&
        normTitleKey(String(d.event_title || "")) === evTitleKey;
      if (!matchId && !matchMeta) return;
      if (String(d.participation_style || "").trim() === styleLabel) return;
      diaryUpdates.push(
        doc.ref.update({
          participation_style: styleLabel,
          updated_at: nowIso,
        }),
      );
    });
    if (diaryUpdates.length) await Promise.all(diaryUpdates);
  }

  /**
   * コミュニティ Note 一覧など：表示前に Log と Note の participation_style を突き合わせる。
   * 表示用メモリは常に上書き。Firestore 更新は Note 所有者のみ（他人の Note はルールで拒否される）。
   * @param {import('firebase').firestore.Firestore} db
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }[]} rows
   */
  async function reconcileDiariesParticipationFromLogs(db, rows) {
    if (!db || !Array.isArray(rows) || !rows.length) return;
    const viewerUid = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
    /** @type {Map<string, { uid: string; eventId: string; data: Record<string, unknown> }[]>} */
    const byUid = new Map();
    for (const row of rows) {
      const uid = String(row?.uid || "").trim();
      const eventId = String(row?.eventId || "").trim();
      if (!uid || !eventId) continue;
      if (!byUid.has(uid)) byUid.set(uid, []);
      byUid.get(uid).push(row);
    }
    for (const [uid, userRows] of byUid) {
      /** @type {{ id: string; data: Record<string, unknown> }[]} */
      let logs = [];
      try {
        const snap = await db.collection("mll_logs").where("user_id", "==", uid).limit(MLL_QUERY_LIMIT).get();
        snap.forEach((doc) => {
          logs.push({ id: doc.id, data: doc.data() || {} });
        });
      } catch (e) {
        console.warn("[mll-role] reconcileDiariesParticipationFromLogs logs", uid, e);
        continue;
      }
      const nowIso = new Date().toISOString();
      for (const row of userRows) {
        const eid = String(row.eventId || "").trim();
        const d = row.data || {};
        const logHit =
          (eid ? logs.find((x) => String(x.data.calendar_event_id || "").trim() === eid) : null) ||
          logs.find((x) => logMatchesDiaryNoteRow(x.data, eid, d)) ||
          null;
        if (!logHit) continue;
        const styleLabel = participationStyleLabelFromLogData(logHit.data);
        if (!styleLabel || String(d.participation_style || "").trim() === styleLabel) continue;
        row.data.participation_style = styleLabel;
        row.data.updated_at = nowIso;
        if (viewerUid !== uid) continue;
        try {
          await db
            .collection("mll_profiles")
            .doc(uid)
            .collection("event_log_diaries")
            .doc(eid)
            .update({ participation_style: styleLabel, updated_at: nowIso });
        } catch (e) {
          console.warn("[mll-role] reconcile diary participation_style", uid, eid, e);
        }
      }
    }
  }

  async function syncUserInvolvementForCalendar(db, user, eventId, ev, participationValue) {
    const uid = String(user?.id || "").trim();
    const eid = String(eventId || "").trim();
    const pv = String(participationValue || "").trim();
    if (!uid || !eid || !db || !pv || pv === "未定") return;
    const role = attendanceJaToRole(pv);
    const fsStyle = participationValueToFirestoreStyle(pv);
    if (!fsStyle) return;
    const roleLabel = buildRoleLabel(role, String(ev?.date || ""));
    const nowIso = new Date().toISOString();
    await db
      .collection("mll_calendar_events")
      .doc(eid)
      .collection("attendees")
      .doc(uid)
      .set({ style: fsStyle }, { merge: true });
    const existing = await findUserLogForCalendarEvent(db, uid, {
      calendarEventId: eid,
      eventDate: ev?.date,
      eventName: ev?.title,
      venue: ev?.venue_pref,
    });
    const logPayload = {
      user_id: uid,
      event_name: String(ev?.title || "").trim(),
      event_date: String(ev?.date || "").trim(),
      venue: String(ev?.venue_pref || "").trim(),
      role,
      role_label: roleLabel,
      official_url: String(ev?.event_url || "").trim(),
      note: "",
      ticket_url: "",
      visibility: "public",
      created_at: existing?.data?.created_at || nowIso,
      updated_at: nowIso,
      liked_by:
        existing?.data?.liked_by && typeof existing.data.liked_by === "object"
          ? existing.data.liked_by
          : {},
      calendar_event_id: eid,
      source: "calendar_sync",
    };
    const logId = existing?.id || `${uid}_${Date.now()}`;
    const isNewLog = !existing;
    await db.collection("mll_logs").doc(logId).set(logPayload, { merge: true });
    if (isNewLog) window.MarchinZConfetti?.burst();
    if (isNewLog && window.MarchinZAdminUgcLog?.recordMllLog) {
      const actorName = String(window.MLL_AUTH?.getDisplayName?.() || "").trim();
      void window.MarchinZAdminUgcLog.recordMllLog({
        logId,
        eventId: eid,
        eventName: String(ev?.title || "").trim(),
        eventDate: String(ev?.date || "").trim(),
        actorUid: uid,
        actorName: actorName || undefined,
      });
    }
    if (String(ev?.created_by || "").trim() === uid) {
      await db.collection("mll_calendar_events").doc(eid).update({ participation_format: pv });
    }
    const styleLabel = participationFormatLabel(pv) || pv;
    await syncDiariesParticipationStyleForUserEvent(db, uid, {
      eventId: eid,
      eventDate: String(ev?.date || "").trim(),
      eventTitle: String(ev?.title || "").trim(),
      participationStyleLabel: styleLabel,
      updatedAt: nowIso,
    });
  }

  /**
   * MarchinZ Note 編集など：同一イベントの参加スタイルを Log・Note・カレンダー参加登録に一括反映。
   * @param {import('firebase').firestore.Firestore} db
   * @param {{ id: string }} user
   * @param {{ eventId?: string; eventDate?: string; eventTitle?: string; venue?: string; participationUiLabel: string }} opts
   */
  async function syncParticipationForProfileEvent(db, user, opts) {
    const uid = String(user?.id || "").trim();
    const pv = participationUiLabelToValue(String(opts.participationUiLabel || ""));
    const eid = String(opts.eventId || "").trim();
    const evDate = String(opts.eventDate || "").trim();
    const evTitle = String(opts.eventTitle || "").trim();
    if (!uid || !db || !pv) return;
    const role = attendanceJaToRole(pv);
    const roleLabel = buildRoleLabel(role, evDate);
    const styleLabel = participationFormatLabel(pv) || pv;
    const nowIso = new Date().toISOString();
    const fsStyle = participationValueToFirestoreStyle(pv);
    const diaryMeta = { event_date: evDate, event_title: evTitle };

    if (eid) {
      try {
        const evSnap = await db.collection("mll_calendar_events").doc(eid).get();
        if (evSnap.exists) {
          const d = evSnap.data() || {};
          await syncUserInvolvementForCalendar(db, user, eid, {
            date: evDate || String(d.date || "").trim(),
            title: evTitle || String(d.title || "").trim(),
            venue_pref: String(opts.venue || d.venue_pref || "").trim(),
            event_url: String(d.event_url || "").trim(),
            created_by: d.created_by,
          }, pv);
        } else {
          await db
            .collection("mll_calendar_events")
            .doc(eid)
            .collection("attendees")
            .doc(uid)
            .set({ style: fsStyle }, { merge: true });
        }
      } catch (e) {
        console.warn("[mll-role] syncParticipationForProfileEvent calendar", e);
      }
    }

    /** @type {Promise<unknown>[]} */
    const logUpdates = [];
    try {
      const snap = await db.collection("mll_logs").where("user_id", "==", uid).limit(MLL_QUERY_LIMIT).get();
      snap.forEach((doc) => {
        const data = doc.data() || {};
        const matches = eid
          ? String(data.calendar_event_id || "").trim() === eid
          : logMatchesDiaryNoteRow(data, "", diaryMeta);
        if (!matches) return;
        logUpdates.push(
          doc.ref.update({
            role,
            role_label: roleLabel,
            updated_at: nowIso,
          }),
        );
      });
    } catch (e) {
      console.warn("[mll-role] syncParticipationForProfileEvent logs", e);
    }
    if (logUpdates.length) await Promise.all(logUpdates);

    await syncDiariesParticipationStyleForUserEvent(db, uid, {
      eventId: eid,
      eventDate: evDate,
      eventTitle: evTitle,
      participationStyleLabel: styleLabel,
      updatedAt: nowIso,
    });
  }

  /**
   * @param {MllRoleKey} k
   * @param {number} c
   */
  function formatYearRoleCountJa(k, c) {
    if (!c) return "";
    if (k === "watch") return `${c}回観戦`;
    if (k === "perform") return `${c}回出演`;
    if (k === "team_staff") return `${c}回チームスタッフ`;
    if (k === "ops") return `${c}回運営`;
    return "";
  }

  /**
   * KPI・年別見出し用（0回は含めない）。例: 3回観戦、2回出演、1回運営
   * @param {Partial<Record<MllRoleKey, number>>} totals
   */
  function formatRoleTotalsSummaryJa(totals) {
    const parts = [];
    for (const k of PROFILE_ROLE_ORDER) {
      const piece = formatYearRoleCountJa(k, Number(totals?.[k]) || 0);
      if (piece) parts.push(piece);
    }
    return parts.join("、");
  }

  const MLL_QUERY_LIMIT = 800;

  /** @type {Record<MllRoleKey, number>} */
  const ROLE_RANK = { watch: 1, perform: 2, team_staff: 3, ops: 4 };

  /** @param {string} s */
  function normTitleKey(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  /** @param {string} date @param {string} title @param {string} venue */
  function eventMatchKey(date, title, venue) {
    return `${String(date || "").trim()}|${normTitleKey(title)}|${String(venue || "").trim()}`;
  }

  /** Note 突合用（日付+タイトルのみ。Note に venue が無いため Log の venue は無視） */
  function eventMetaMatchKey(date, title) {
    return `${String(date || "").trim()}|${normTitleKey(title)}`;
  }

  /**
   * @param {Record<string, unknown>} logData
   * @param {string} eventId
   * @param {Record<string, unknown>} diaryData
   */
  function logMatchesDiaryNoteRow(logData, eventId, diaryData) {
    if (String(logData.calendar_event_id || "").trim() === eventId) return true;
    const d = diaryData || {};
    return (
      eventMetaMatchKey(logData.event_date, logData.event_name) ===
      eventMetaMatchKey(d.event_date, d.event_title)
    );
  }

  /** @param {{ event_date?: string; event_name?: string; venue?: string }} log */
  function logMatchKey(log) {
    return eventMatchKey(log?.event_date, log?.event_name, log?.venue);
  }

  /** @param {{ date?: string; title?: string; venue_pref?: string }} ev */
  function calendarMatchKey(ev) {
    return eventMatchKey(ev?.date, ev?.title, ev?.venue_pref);
  }

  /** @param {{ role?: string; role_label?: string }} doc */
  function roleRankOf(doc) {
    const r = inferRoleFromLogOrNull(doc);
    return r ? ROLE_RANK[r] : 0;
  }

  /** @param {{ updated_at?: string; created_at?: string }} doc */
  function docTimestamp(doc) {
    const u = String(doc?.updated_at || "").trim();
    if (u) return u;
    return String(doc?.created_at || "").trim();
  }

  /** @param {Record<string, unknown>|null|undefined} raw */
  function normalizeLikedBy(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) out[k] = true;
    }
    return out;
  }

  /** @param {string} a @param {string} b */
  function preferNonEmpty(a, b) {
    const x = String(a || "").trim();
    if (x) return x;
    return String(b || "").trim();
  }

  /**
   * @param {{ id: string; data: Record<string, unknown> }[]} docs
   * @returns {{ id: string; data: Record<string, unknown> }|null}
   */
  function pickWinnerDoc(docs) {
    if (!docs.length) return null;
    if (docs.length === 1) return docs[0];
    return [...docs].sort((a, b) => {
      const dr = roleRankOf(b.data) - roleRankOf(a.data);
      if (dr !== 0) return dr;
      return docTimestamp(b.data).localeCompare(docTimestamp(a.data));
    })[0];
  }

  /**
   * @param {{ id: string; ref?: unknown; data: Record<string, unknown> }[]} docs
   */
  function planGroupMerge(docs) {
    if (!docs || docs.length < 2) return null;
    const winner = pickWinnerDoc(docs);
    if (!winner) return null;
    const losers = docs.filter((d) => d.id !== winner.id);
    /** @type {Record<string, unknown>} */
    const data = { ...(winner.data || {}) };
    let liked = normalizeLikedBy(data.liked_by);
    for (const L of losers) {
      liked = { ...liked, ...normalizeLikedBy(L.data?.liked_by) };
      data.note = preferNonEmpty(String(data.note || ""), String(L.data?.note || ""));
      data.ticket_url = preferNonEmpty(String(data.ticket_url || ""), String(L.data?.ticket_url || ""));
      data.official_url = preferNonEmpty(String(data.official_url || ""), String(L.data?.official_url || ""));
    }
    data.liked_by = liked;
    const role = inferRoleFromLog(data);
    data.role = role;
    data.role_label = buildRoleLabel(role, String(data.event_date || ""));
    return { winner, losers, payload: data };
  }

  /** @param {{ status?: string }} ev */
  function isCalendarEventActive(ev) {
    return String(ev?.status || "").trim() !== "trashed";
  }

  /**
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} date
   * @param {string} title
   * @param {string} venue
   */
  async function findCalendarEventByMatchKey(db, date, title, venue) {
    const d = String(date || "").trim();
    if (!d || !db) return null;
    const mk = eventMatchKey(d, title, venue);
    let snap;
    try {
      snap = await db.collection("mll_calendar_events").where("date", "==", d).limit(100).get();
    } catch (e) {
      console.warn("[mll-role] calendar matchKey query", e);
      return null;
    }
    /** @type {{ id: string; data: Record<string, unknown>; created_at: string }[]} */
    const matches = [];
    snap.forEach((doc) => {
      const x = doc.data() || {};
      if (!isCalendarEventActive(x)) return;
      if (calendarMatchKey(x) !== mk) return;
      matches.push({ id: doc.id, data: x, created_at: String(x.created_at || "") });
    });
    if (!matches.length) return null;
    matches.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return matches[0];
  }

  /**
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {{ calendarEventId?: string; eventDate?: string; eventName?: string; venue?: string; role?: string }} opts
   */
  async function findUserLogDoc(db, userId, opts = {}) {
    const uid = String(userId || "").trim();
    if (!uid || !db) return null;
    const roleCanon = canonicalRole(opts.role);
    const calId = String(opts.calendarEventId || "").trim();
    if (calId) {
      try {
        const snap = await db
          .collection("mll_logs")
          .where("user_id", "==", uid)
          .where("calendar_event_id", "==", calId)
          .limit(30)
          .get();
        let found = null;
        snap.forEach((doc) => {
          const x = doc.data() || {};
          if (canonicalRole(x.role) === roleCanon) {
            found = { id: doc.id, ref: doc.ref, data: x };
          }
        });
        if (found) return found;
      } catch (e) {
        console.warn("[mll-role] findUserLogDoc by calendar_event_id", e);
      }
    }
    const eventDate = String(opts.eventDate || "").trim();
    if (!eventDate) return null;
    const mk = eventMatchKey(eventDate, opts.eventName, opts.venue);
    try {
      const snap = await db
        .collection("mll_logs")
        .where("user_id", "==", uid)
        .where("event_date", "==", eventDate)
        .limit(50)
        .get();
      let found = null;
      snap.forEach((doc) => {
        const x = doc.data() || {};
        if (logMatchKey(x) !== mk) return;
        if (canonicalRole(x.role) !== roleCanon) return;
        found = { id: doc.id, ref: doc.ref, data: x };
      });
      return found;
    } catch (e) {
      console.warn("[mll-role] findUserLogDoc by matchKey", e);
      return null;
    }
  }

  /** カレンダー統合時に Log update で送れるフィールド（firestore.rules isMllLogCalendarMergePatch と整合） */
  const MERGE_LOG_UPDATE_KEYS = [
    "event_date",
    "event_name",
    "venue",
    "role",
    "role_label",
    "calendar_event_id",
    "liked_by",
    "note",
    "ticket_url",
    "official_url",
    "updated_at",
  ];

  /** @param {Record<string, unknown>} src @param {string[]} keys */
  function pickMergeLogPayload(src, keys) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    return out;
  }

  /**
   * 統合元カレンダーに紐づく Log（calendar_event_id 優先、なければ matchKey）
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} sourceEventId
   * @param {{ date?: string; title?: string; venue_pref?: string }} sourceFields
   */
  async function collectLogsForCalendarSource(db, sourceEventId, sourceFields) {
    /** @type {Map<string, { id: string; ref: import('firebase').firestore.DocumentReference; data: Record<string, unknown> }>} */
    const byId = new Map();
    const addSnap = (snap) => {
      snap?.forEach?.((doc) => {
        if (byId.has(doc.id)) return;
        byId.set(doc.id, { id: doc.id, ref: doc.ref, data: doc.data() || {} });
      });
    };
    const sid = String(sourceEventId || "").trim();
    if (sid) {
      try {
        addSnap(await db.collection("mll_logs").where("calendar_event_id", "==", sid).limit(500).get());
      } catch (e) {
        console.warn("[mll-role] collectLogs calendar_event_id", e);
      }
    }
    const srcDate = String(sourceFields?.date || "").trim();
    const srcMk = calendarMatchKey(sourceFields || {});
    if (srcDate) {
      try {
        const snap = await db.collection("mll_logs").where("event_date", "==", srcDate).limit(500).get();
        snap.forEach((doc) => {
          const x = doc.data() || {};
          if (String(x.calendar_event_id || "").trim() === sid && sid) {
            if (!byId.has(doc.id)) byId.set(doc.id, { id: doc.id, ref: doc.ref, data: x });
            return;
          }
          if (logMatchKey(x) === srcMk) {
            if (!byId.has(doc.id)) byId.set(doc.id, { id: doc.id, ref: doc.ref, data: x });
          }
        });
      } catch (e) {
        console.warn("[mll-role] collectLogs event_date", e);
      }
    }
    return [...byId.values()];
  }

  /**
   * 統合先で同一ユーザーの重複 Log を 1 行に（§12: ops > perform > team_staff > watch）
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} targetEventId
   * @param {{ date?: string; title?: string; venue_pref?: string }} targetFields
   */
  async function mergeDuplicateUserLogsOnCalendar(db, targetEventId, targetFields) {
    const tid = String(targetEventId || "").trim();
    if (!tid || !db) return { deleted: 0, merged: 0 };
    const docs = await collectLogsForCalendarSource(db, tid, targetFields);
    /** @type {Map<string, { id: string; ref: import('firebase').firestore.DocumentReference; data: Record<string, unknown> }[]>} */
    const byUser = new Map();
    for (const d of docs) {
      const uid = String(d.data.user_id || "").trim();
      if (!uid) continue;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(d);
    }
    let deleted = 0;
    let merged = 0;
    for (const group of byUser.values()) {
      if (group.length < 2) continue;
      const plan = planGroupMerge(group);
      if (!plan) continue;
      const payload = {
        ...pickMergeLogPayload(plan.payload, MERGE_LOG_UPDATE_KEYS),
        calendar_event_id: tid,
        updated_at: new Date().toISOString(),
      };
      await plan.winner.ref.update(payload);
      for (const L of plan.losers) {
        await L.ref.delete();
        deleted += 1;
      }
      merged += 1;
    }
    return { deleted, merged };
  }

  /**
   * 統合プレビュー用件数
   * @param {import('firebase').firestore.Firestore} db
   */
  async function countCalendarMergeLogOps(db, sourceEventId, sourceFields, targetEventId, targetFields) {
    const sourceDocs = await collectLogsForCalendarSource(db, sourceEventId, sourceFields);
    const targetDocs = await collectLogsForCalendarSource(db, targetEventId, targetFields);
    /** @type {Map<string, number>} */
    const byUser = new Map();
    for (const d of targetDocs) {
      const uid = String(d.data.user_id || "").trim();
      if (!uid) continue;
      byUser.set(uid, (byUser.get(uid) || 0) + 1);
    }
    let dupDeletes = 0;
    let dupUsers = 0;
    for (const n of byUser.values()) {
      if (n >= 2) {
        dupUsers += 1;
        dupDeletes += n - 1;
      }
    }
    return {
      rewriteCount: sourceDocs.length,
      dupUsers,
      dupDeletes,
    };
  }

  /**
   * カレンダー eventId に紐づく MarchinZ Note（collection group）
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} eventId
   */
  async function collectDiariesForCalendarEventId(db, eventId) {
    const eid = String(eventId || "").trim();
    if (!eid || !db) return [];
    const FieldPath = window.firebase?.firestore?.FieldPath;
    if (!FieldPath) return [];
    try {
      const snap = await db.collectionGroup("event_log_diaries").where(FieldPath.documentId(), "==", eid).get();
      return snap.docs
        .map((doc) => ({
          id: doc.id,
          ref: doc.ref,
          ownerUid: String(doc.ref.parent?.parent?.id || "").trim(),
          data: doc.data() || {},
        }))
        .filter((x) => x.ownerUid);
    } catch (e) {
      console.warn("[mll-role] collectDiariesForCalendarEventId", e);
      return [];
    }
  }

  /**
   * 統合元→統合先へ Note を移動（同一ユーザーで両方ある場合は新しい方を残す）
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} sourceEventId
   * @param {string} targetEventId
   * @param {{ date?: string; title?: string; venue_pref?: string }} targetFields
   */
  async function mergeEventLogDiariesForCalendarMerge(db, sourceEventId, targetEventId, targetFields) {
    const sid = String(sourceEventId || "").trim();
    const tid = String(targetEventId || "").trim();
    if (!sid || !tid || sid === tid || !db) return { moved: 0, deleted: 0, keptTarget: 0 };

    const tgtDate = String(targetFields?.date || "").trim();
    const tgtTitle = String(targetFields?.title || "").trim().slice(0, 200);
    const nowIso = new Date().toISOString();
    const sourceNotes = await collectDiariesForCalendarEventId(db, sid);
    let moved = 0;
    let deleted = 0;
    let keptTarget = 0;

    for (const src of sourceNotes) {
      const ownerUid = src.ownerUid;
      const targetRef = db.collection("mll_profiles").doc(ownerUid).collection("event_log_diaries").doc(tid);
      const targetSnap = await targetRef.get();

      /** @param {Record<string, unknown>} data */
      const patchEventMeta = (data) => ({
        ...data,
        event_date: tgtDate || String(data.event_date || "").trim(),
        event_title: tgtTitle || String(data.event_title || "").trim(),
        updated_at: nowIso,
      });

      if (!targetSnap.exists) {
        const payload = patchEventMeta({ ...src.data });
        if (!payload.created_at) payload.created_at = nowIso;
        await targetRef.set(payload);
        await src.ref.delete();
        moved += 1;
      } else {
        const tgtData = targetSnap.data() || {};
        const srcTs = docTimestamp(src.data);
        const tgtTs = docTimestamp(tgtData);
        if (srcTs.localeCompare(tgtTs) >= 0) {
          const payload = patchEventMeta({
            ...src.data,
            created_at: String(tgtData.created_at || src.data.created_at || nowIso),
            liked_by: { ...normalizeLikedBy(tgtData.liked_by), ...normalizeLikedBy(src.data.liked_by) },
          });
          await targetRef.set(payload);
          await src.ref.delete();
          moved += 1;
        } else {
          await src.ref.delete();
          deleted += 1;
          keptTarget += 1;
        }
      }
    }
    return { moved, deleted, keptTarget };
  }

  /**
   * 統合元 attendees のうち統合先に無い件数
   * @param {import('firebase').firestore.Firestore} db
   */
  async function countAttendeesToCopyForCalendarMerge(db, sourceEventId, targetEventId) {
    const sid = String(sourceEventId || "").trim();
    const tid = String(targetEventId || "").trim();
    if (!db || !sid) return 0;
    try {
      const [srcSnap, tgtSnap] = await Promise.all([
        db.collection("mll_calendar_events").doc(sid).collection("attendees").get(),
        tid ? db.collection("mll_calendar_events").doc(tid).collection("attendees").get() : { docs: [] },
      ]);
      const tgtIds = new Set(tgtSnap.docs.map((d) => d.id));
      return srcSnap.docs.filter((d) => !tgtIds.has(d.id)).length;
    } catch (e) {
      console.warn("[mll-role] countAttendeesToCopyForCalendarMerge", e);
      return 0;
    }
  }

  /**
   * 統合プレビュー（Log・Note・attendees）
   * @param {import('firebase').firestore.Firestore} db
   */
  async function countCalendarMergePreviewOps(db, sourceEventId, sourceFields, targetEventId, targetFields) {
    const logOps = await countCalendarMergeLogOps(db, sourceEventId, sourceFields, targetEventId, targetFields);
    const [sourceNotes, targetNotes, attendeeMove] = await Promise.all([
      collectDiariesForCalendarEventId(db, sourceEventId),
      collectDiariesForCalendarEventId(db, targetEventId),
      countAttendeesToCopyForCalendarMerge(db, sourceEventId, targetEventId),
    ]);
    /** @type {Map<string, { data: Record<string, unknown> }>} */
    const targetByOwner = new Map(targetNotes.map((n) => [n.ownerUid, n]));
    let noteMove = 0;
    let noteDiscardSource = 0;
    for (const src of sourceNotes) {
      const tgt = targetByOwner.get(src.ownerUid);
      if (!tgt) {
        noteMove += 1;
      } else if (docTimestamp(src.data).localeCompare(docTimestamp(tgt.data)) >= 0) {
        noteMove += 1;
      } else {
        noteDiscardSource += 1;
      }
    }
    return {
      ...logOps,
      attendeeMove,
      noteMove,
      noteDiscardSource,
      noteCount: sourceNotes.length,
    };
  }

  /**
   * イベント削除時: 作成者の Log を漏れなく集める（calendar_event_id / matchKey / タイトル+会場）。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {string} eventId
   * @param {{ date?: string; title?: string; venue_pref?: string }} eventFields
   */
  async function collectUserLogsForCalendarDelete(db, userId, eventId, eventFields) {
    const uid = String(userId || "").trim();
    const sid = String(eventId || "").trim();
    if (!uid || !db) return [];
    /** @type {Map<string, { id: string; ref: import('firebase').firestore.DocumentReference; data: Record<string, unknown> }>} */
    const byId = new Map();
    const addDoc = (doc) => {
      if (!doc?.id || byId.has(doc.id)) return;
      byId.set(doc.id, { id: doc.id, ref: doc.ref, data: doc.data() || {} });
    };

    const fromSource = await collectLogsForCalendarSource(db, sid, eventFields);
    for (const d of fromSource) {
      if (String(d.data.user_id || "").trim() === uid) addDoc({ id: d.id, ref: d.ref, data: d.data });
    }

    if (sid) {
      try {
        const snap = await db
          .collection("mll_logs")
          .where("user_id", "==", uid)
          .where("calendar_event_id", "==", sid)
          .limit(50)
          .get();
        snap.forEach(addDoc);
      } catch (e) {
        console.warn("[mll-role] collectUserLogsForCalendarDelete calendar_event_id", e);
      }
    }

    const srcDate = String(eventFields?.date || "").trim();
    const srcMk = calendarMatchKey(eventFields || {});
    const srcTitle = normTitleKey(eventFields?.title);
    const srcVenue = String(eventFields?.venue_pref || "").trim();

    if (srcDate) {
      try {
        const snap = await db
          .collection("mll_logs")
          .where("user_id", "==", uid)
          .where("event_date", "==", srcDate)
          .limit(50)
          .get();
        snap.forEach((doc) => {
          const x = doc.data() || {};
          if (logMatchKey(x) === srcMk) addDoc(doc);
          else if (srcTitle && normTitleKey(x.event_name) === srcTitle && String(x.venue || "").trim() === srcVenue) {
            addDoc(doc);
          }
        });
      } catch (e) {
        console.warn("[mll-role] collectUserLogsForCalendarDelete event_date", e);
      }
    }

    if (srcTitle && srcVenue) {
      try {
        const snap = await queryMllLogsForUser(db, uid);
        snap.forEach((doc) => {
          const x = doc.data() || {};
          const calId = String(x.calendar_event_id || "").trim();
          if (calId && calId !== sid) return;
          if (normTitleKey(x.event_name) !== srcTitle) return;
          if (String(x.venue || "").trim() !== srcVenue) return;
          addDoc(doc);
        });
      } catch (e) {
        console.warn("[mll-role] collectUserLogsForCalendarDelete title+venue", e);
      }
    }

    return [...byId.values()];
  }

  /**
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {string} eventId
   * @param {{ date?: string; title?: string; venue_pref?: string }} eventFields
   */
  async function deleteUserLogsForCalendar(db, userId, eventId, eventFields) {
    const uid = String(userId || "").trim();
    if (!uid || !db) return 0;
    const mine = await collectUserLogsForCalendarDelete(db, uid, eventId, eventFields);
    const chunk = 400;
    for (let i = 0; i < mine.length; i += chunk) {
      const batch = db.batch();
      mine.slice(i, i + chunk).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    return mine.length;
  }

  /**
   * ユーザーのイベント参加登録を解除（Log / attendees / 任意で Note）。
   * 登録時の `syncUserInvolvementForCalendar` と対になる削除経路。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {{ eventId?: string; eventDate?: string; eventName?: string; title?: string; venue?: string; venue_pref?: string }} opts
   * @param {{ deleteLogs?: boolean; deleteAttendance?: boolean; deleteDiary?: boolean }} [actions]
   * @returns {Promise<{ logsDeleted: number; attendanceRemoved: boolean; diaryRemoved: boolean }>}
   */
  async function removeUserInvolvementForCalendarEvent(db, userId, opts = {}, actions = {}) {
    const uid = String(userId || "").trim();
    const result = { logsDeleted: 0, attendanceRemoved: false, diaryRemoved: false };
    if (!uid || !db) return result;

    const deleteLogs = actions.deleteLogs === true;
    const deleteAttendance = actions.deleteAttendance !== false;
    const deleteDiary = actions.deleteDiary === true;

    const eventDate = String(opts.eventDate || "").trim();
    const eventName = String(opts.eventName || opts.title || "").trim();
    const venue = String(opts.venue_pref || opts.venue || "").trim();
    let eid = String(opts.eventId || "").trim();

    if (!eid && eventDate) {
      const ev = await findCalendarEventByMatchKey(db, eventDate, eventName, venue);
      eid = ev?.id ? String(ev.id).trim() : "";
    }

    const eventFields = { date: eventDate, title: eventName, venue_pref: venue };

    if (deleteLogs) {
      result.logsDeleted = await deleteUserLogsForCalendar(db, uid, eid, eventFields);
      pruneLocalMllLogsCacheForEvent(uid, {
        eventId: eid,
        eventDate,
        eventName,
        venue_pref: venue,
      });
    } else if (deleteAttendance) {
      const still = await findUserLogForCalendarEvent(db, uid, {
        calendarEventId: eid,
        eventDate,
        eventName,
        venue,
      });
      if (still) return result;
    }

    if (deleteAttendance && eid) {
      try {
        await db.collection("mll_calendar_events").doc(eid).collection("attendees").doc(uid).delete();
        result.attendanceRemoved = true;
      } catch (e) {
        console.warn("[mll-role] removeUserInvolvement attendance", e);
      }
    }

    if (deleteDiary && eid) {
      try {
        const ref = db.collection("mll_profiles").doc(uid).collection("event_log_diaries").doc(eid);
        const snap = await ref.get();
        if (snap.exists) {
          await ref.delete();
          result.diaryRemoved = true;
        }
      } catch (e) {
        console.warn("[mll-role] removeUserInvolvement diary", e);
      }
    }

    if (!deleteDiary && eid && (deleteLogs || result.attendanceRemoved)) {
      try {
        const ref = db.collection("mll_profiles").doc(uid).collection("event_log_diaries").doc(eid);
        const snap = await ref.get();
        if (snap.exists) {
          await ref.set(
            { participation_style: "", updated_at: new Date().toISOString() },
            { merge: true },
          );
        }
      } catch (e) {
        console.warn("[mll-role] clear diary participation_style after log unregister", e);
      }
    }

    return result;
  }

  function pruneLocalMllLogsCacheForEvent(userId, opts = {}) {
    const uid = String(userId || "").trim();
    if (!uid) return;
    try {
      const raw = localStorage.getItem("marchinz_mll_logs_v1");
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const eid = String(opts.eventId || "").trim();
      const eventFields = {
        date: String(opts.eventDate || "").trim(),
        title: String(opts.eventName || opts.title || "").trim(),
        venue_pref: String(opts.venue_pref || opts.venue || "").trim(),
      };
      const calMk = calendarMatchKey(eventFields);
      const titleKey = normTitleKey(eventFields.title);
      const venue = eventFields.venue_pref;
      const next = arr.filter((L) => {
        if (String(L?.user_id || "").trim() !== uid) return true;
        if (eid && String(L?.calendar_event_id || "").trim() === eid) return false;
        if (eventFields.date && logMatchKey(L) === calMk) return false;
        if (titleKey && normTitleKey(L?.event_name) === titleKey && String(L?.venue || "").trim() === venue) {
          return false;
        }
        return true;
      });
      if (next.length !== arr.length) {
        localStorage.setItem("marchinz_mll_logs_v1", JSON.stringify(next));
      }
    } catch {
      //
    }
  }

  /**
   * コミュニティ「未記入に戻す」: Log + attendees を外す（Note は残す）。登録の逆操作。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {{ eventId?: string; eventDate?: string; eventName?: string; title?: string; venue?: string; venue_pref?: string }} opts
   */
  async function clearCommunityAttendanceForEvent(db, userId, opts = {}) {
    return removeUserInvolvementForCalendarEvent(db, userId, opts, {
      deleteLogs: true,
      deleteAttendance: true,
      deleteDiary: false,
    });
  }

  /**
   * MarchinZ Log 単体削除後: 同一イベントに Log が残っていなければ attendees のみ外す。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {{ eventId?: string; eventDate?: string; eventName?: string; venue?: string; venue_pref?: string }} opts
   */
  async function cleanupCalendarAttendanceAfterLogDelete(db, userId, opts = {}) {
    await removeUserInvolvementForCalendarEvent(db, userId, opts, {
      deleteLogs: false,
      deleteAttendance: true,
      deleteDiary: false,
    });
  }

  /** @param {string} userId */
  function purgeAllLocalMllLogsForUser(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return;
    try {
      const raw = localStorage.getItem("marchinz_mll_logs_v1");
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const next = arr.filter((L) => String(L?.user_id || "").trim() !== uid);
      if (next.length === 0) localStorage.removeItem("marchinz_mll_logs_v1");
      else if (next.length !== arr.length) {
        localStorage.setItem("marchinz_mll_logs_v1", JSON.stringify(next));
      }
    } catch {
      //
    }
  }

  /**
   * 指定ユーザーの MarchinZ Log をすべて削除（attendees / Note 参加スタイルも整合）。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @returns {Promise<{ logsDeleted: number; attendanceRemoved: number; diariesCleared: number }>}
   */
  async function deleteAllMllLogsForUser(db, userId) {
    const uid = String(userId || "").trim();
    const result = { logsDeleted: 0, attendanceRemoved: 0, diariesCleared: 0 };
    if (!uid || !db) return result;

    const eventIds = new Set();

    for (;;) {
      const snap = await db.collection("mll_logs").where("user_id", "==", uid).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((doc) => {
        const x = doc.data() || {};
        const eid = String(x.calendar_event_id || "").trim();
        if (eid) eventIds.add(eid);
        batch.delete(doc.ref);
      });
      await batch.commit();
      result.logsDeleted += snap.size;
      if (snap.size < 400) break;
    }

    for (const eid of eventIds) {
      try {
        const ref = db.collection("mll_profiles").doc(uid).collection("event_log_diaries").doc(eid);
        const dSnap = await ref.get();
        if (dSnap.exists) {
          await ref.set(
            { participation_style: "", updated_at: new Date().toISOString() },
            { merge: true },
          );
          result.diariesCleared += 1;
        }
      } catch (e) {
        console.warn("[mll-role] deleteAllMllLogsForUser diary participation", eid, e);
      }
    }

    result.attendanceRemoved = await removeAllCalendarAttendanceForUser(db, uid);

    purgeAllLocalMllLogsForUser(uid);
    return result;
  }

  /**
   * 全イベントの attendees/{uid} を走査して削除（Log 無しで参加者だけ残る不整合用）。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   */
  async function removeAllCalendarAttendanceForUser(db, userId) {
    const uid = String(userId || "").trim();
    let removed = 0;
    if (!uid || !db) return removed;
    try {
      const snap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(800).get();
      for (const doc of snap.docs) {
        try {
          const attRef = doc.ref.collection("attendees").doc(uid);
          const attSnap = await attRef.get();
          if (!attSnap.exists) continue;
          await attRef.delete();
          removed += 1;
        } catch (e) {
          console.warn("[mll-role] removeAllCalendarAttendanceForUser", doc.id, e);
        }
      }
    } catch (e) {
      console.warn("[mll-role] removeAllCalendarAttendanceForUser", e);
    }
    return removed;
  }

  /**
   * ゴミ箱のイベント掲示を物理削除し、紐づく Log・Note・参加者・いいねをまとめて削除。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} eventId
   * @param {{ date?: string; title?: string; venue_pref?: string; status?: string }} [eventFields]
   */
  async function purgeTrashedCalendarEventPermanently(db, eventId, eventFields = {}) {
    const eid = String(eventId || "").trim();
    const result = { logsDeleted: 0, notesDeleted: 0, attendeesDeleted: 0, eventDeleted: false };
    if (!eid || !db) return result;

    const ref = db.collection("mll_calendar_events").doc(eid);
    const evSnap = await ref.get();
    if (!evSnap.exists) return result;
    const evData = evSnap.data() || {};
    if (String(evData.status || "").trim() !== "trashed") {
      throw new Error("ゴミ箱に入っているイベントのみ完全削除できます。");
    }

    const fields = {
      date: String(eventFields.date || evData.date || "").trim(),
      title: String(eventFields.title || evData.title || "").trim(),
      venue_pref: String(eventFields.venue_pref || evData.venue_pref || "").trim(),
    };

    const logDocs = await collectLogsForCalendarSource(db, eid, fields);
    const chunk = 400;
    for (let i = 0; i < logDocs.length; i += chunk) {
      const slice = logDocs.slice(i, i + chunk);
      const batch = db.batch();
      slice.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      result.logsDeleted += slice.length;
    }

    const FieldPath = window.firebase?.firestore?.FieldPath;
    if (FieldPath) {
      try {
        const noteSnap = await db.collectionGroup("event_log_diaries").where(FieldPath.documentId(), "==", eid).get();
        for (let i = 0; i < noteSnap.docs.length; i += chunk) {
          const slice = noteSnap.docs.slice(i, i + chunk);
          const batch = db.batch();
          slice.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          result.notesDeleted += slice.length;
        }
      } catch (e) {
        console.warn("[mll-role] purgeTrashedCalendarEventPermanently notes collectionGroup", e);
      }
    }

    try {
      const attSnap = await ref.collection("attendees").get();
      if (!attSnap.empty) {
        for (let i = 0; i < attSnap.docs.length; i += chunk) {
          const batch = db.batch();
          attSnap.docs.slice(i, i + chunk).forEach((d) => batch.delete(d.ref));
          await batch.commit();
          result.attendeesDeleted += Math.min(chunk, attSnap.docs.length - i);
        }
      }
    } catch (e) {
      console.warn("[mll-role] purgeTrashedCalendarEventPermanently attendees", e);
    }

    await ref.delete();
    result.eventDeleted = true;
    return result;
  }

  /**
   * プロフィール用: user_id で絞る（コレクション全体 orderBy は他者非公開ログでクエリ失敗する）。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string} userId
   * @param {{ visitorPublicOnly?: boolean }} [opts]
   */
  async function queryMllLogsForUser(db, userId, opts = {}) {
    const uid = String(userId || "").trim();
    if (!uid || !db) {
      return { empty: true, size: 0, forEach() {} };
    }
    const col = db.collection("mll_logs");
    const visitorPublicOnly = Boolean(opts.visitorPublicOnly);
    /** @type {import('firebase').firestore.Query} */
    let q = col.where("user_id", "==", uid);
    if (visitorPublicOnly) {
      q = q.where("visibility", "==", "public");
    }
    try {
      return await q.orderBy("created_at", "desc").limit(MLL_QUERY_LIMIT).get();
    } catch {
      try {
        return await col.where("user_id", "==", uid).limit(MLL_QUERY_LIMIT).get();
      } catch {
        return { empty: true, size: 0, forEach() {} };
      }
    }
  }

  /**
   * イベント一覧・カレンダー用: 公開ログ + 自分の非公開ログ。
   * @param {import('firebase').firestore.Firestore} db
   * @param {string|null} viewerUserId
   */
  async function queryMllLogsForFeed(db, viewerUserId) {
    if (!db) return [];
    const col = db.collection("mll_logs");
    const byId = new Map();
    const merge = (snap) => {
      snap?.forEach?.((doc) => {
        const x = doc.data() || {};
        byId.set(doc.id, { id: doc.id, ...x });
      });
    };
    try {
      merge(await col.where("visibility", "==", "public").orderBy("created_at", "desc").limit(MLL_QUERY_LIMIT).get());
    } catch (e) {
      console.warn("[mll-role] public mll_logs feed", e);
    }
    const me = String(viewerUserId || "").trim();
    if (me) {
      try {
        merge(await queryMllLogsForUser(db, me));
      } catch (e) {
        console.warn("[mll-role] own mll_logs feed", e);
      }
    }
    return [...byId.values()];
  }

  window.MarchinZMllRole = {
    PROFILE_ROLE_ORDER,
    ROLE_LABEL_JA,
    ROLE_PHRASE,
    ROLE_RANK,
    PARTICIPATION_UNKNOWN_LABEL,
    resolveParticipationStyle,
    tryCanonicalRole,
    inferRoleFromLogOrNull,
    attendanceJaToRoleOrNull,
    MLL_PARTICIPATION_4,
    MLL_LOG_ROW_BADGE_LABEL,
    ATTENDANCE_STYLE_OPTIONS_JA,
    attendanceLabelToFirestoreStyle,
    participationFormatLabel,
    isParticipationFormat,
    firestoreStyleToParticipationValue,
    participationValueToFirestoreStyle,
    findUserLogForCalendarEvent,
    resolveUserInvolvementForEvent,
    profileRoleKeyToUiLabel,
    participationUiLabelToValue,
    updateProfileLogParticipation,
    syncUserInvolvementForCalendar,
    syncParticipationForProfileEvent,
    syncDiariesParticipationStyleForUserEvent,
    participationStyleLabelFromLogData,
    reconcileDiariesParticipationFromLogs,
    EVENT_RECRUITMENT_OPTIONS_JA,
    canonicalRole,
    inferRoleFromLog,
    buildRoleLabel,
    roleToParticipationJa,
    attendanceJaToRole,
    isPastDate,
    formatYearRoleCountJa,
    formatRoleTotalsSummaryJa,
    normTitleKey,
    eventMatchKey,
    isCalendarEventActive,
    logMatchKey,
    calendarMatchKey,
    planGroupMerge,
    findCalendarEventByMatchKey,
    findUserLogDoc,
    collectLogsForCalendarSource,
    collectUserLogsForCalendarDelete,
    mergeDuplicateUserLogsOnCalendar,
    countCalendarMergeLogOps,
    countCalendarMergePreviewOps,
    collectDiariesForCalendarEventId,
    mergeEventLogDiariesForCalendarMerge,
    deleteUserLogsForCalendar,
    removeUserInvolvementForCalendarEvent,
    clearCommunityAttendanceForEvent,
    pruneLocalMllLogsCacheForEvent,
    purgeAllLocalMllLogsForUser,
    deleteAllMllLogsForUser,
    purgeTrashedCalendarEventPermanently,
    removeAllCalendarAttendanceForUser,
    cleanupCalendarAttendanceAfterLogDelete,
    queryMllLogsForUser,
    queryMllLogsForFeed,
  };

  window.MarchinZMllBuildRoleLabel = buildRoleLabel;
})();
