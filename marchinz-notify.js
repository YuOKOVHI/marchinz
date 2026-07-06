(() => {
  const KINDS = new Set([
    "like_mll_log",
    "like_community_post",
    "like_calendar_event",
    "like_video_bookmark",
    "like_video_list",
    "like_channel_bookmark",
    "like_channel_list",
    "like_log_diary",
  ]);

  const KIND_TO_PREF_FIELD = {
    like_mll_log: "like_show_mll",
    like_community_post: "like_show_community",
    like_calendar_event: "like_show_calendar",
    like_video_bookmark: "like_show_video_bookmark",
    like_video_list: "like_show_video_bookmark",
    like_channel_bookmark: "like_show_channel_bookmark",
    like_channel_list: "like_show_channel_bookmark",
    like_log_diary: "like_show_log_diary",
  };

  /**
   * いいね時に相手の受信箱へ通知ドキュメントを追加する（actor が recipient の subcollection に create）。
   * @param {import("firebase").firestore.Firestore | null | undefined} db
   * @param {string} recipientUid
   * @param {Record<string, unknown>} partial
   */
  const LIKE_NOTIF_DEDUP_MS = 72 * 60 * 60 * 1000;
  const LIKE_NOTIF_LOCAL_PREFIX = "mz_like_notif:";
  /** @type {Set<string>} */
  const likeNotifInflight = new Set();

  /** @param {string} rcpt @param {string} actor @param {string} kind @param {string} targetId */
  function likeNotifDedupeKey(rcpt, actor, kind, targetId) {
    return `${rcpt}|${actor}|${kind}|${targetId}`;
  }

  /** @param {string} key */
  function readLocalLikeNotifDedup(key) {
    try {
      const raw = sessionStorage.getItem(LIKE_NOTIF_LOCAL_PREFIX + key);
      if (!raw) return false;
      const t = Number(raw);
      return Number.isFinite(t) && Date.now() - t < LIKE_NOTIF_DEDUP_MS;
    } catch {
      return false;
    }
  }

  /** @param {string} key */
  function writeLocalLikeNotifDedup(key) {
    try {
      sessionStorage.setItem(LIKE_NOTIF_LOCAL_PREFIX + key, String(Date.now()));
    } catch {
      //
    }
  }

  /**
   * 同一 actor × kind × target_id のいいね通知が 72 時間以内にあれば重複作成しない。
   * @param {import("firebase").firestore.Firestore} db
   * @param {string} rcpt
   * @param {string} actor
   * @param {string} kind
   * @param {string} targetId
   */
  async function hasRecentLikeNotification(db, rcpt, actor, kind, targetId) {
    const dedupeKey = likeNotifDedupeKey(rcpt, actor, kind, targetId);
    if (readLocalLikeNotifDedup(dedupeKey)) return true;

    const cutoff = Date.now() - LIKE_NOTIF_DEDUP_MS;
    try {
      let snap;
      try {
        snap = await db
          .collection("mll_profiles")
          .doc(rcpt)
          .collection("notifications")
          .where("actor_uid", "==", actor)
          .where("target_id", "==", targetId)
          .where("kind", "==", kind)
          .limit(8)
          .get();
      } catch {
        snap = await db
          .collection("mll_profiles")
          .doc(rcpt)
          .collection("notifications")
          .where("actor_uid", "==", actor)
          .where("target_id", "==", targetId)
          .limit(16)
          .get();
      }
      for (const doc of snap.docs) {
        const d = doc.data() || {};
        if (String(d.kind || "") !== kind) continue;
        if (String(d.actor_uid || "") !== actor) continue;
        if (String(d.target_id || "") !== targetId) continue;
        const t = Date.parse(String(d.created_at || ""));
        if (Number.isFinite(t) && t >= cutoff) {
          writeLocalLikeNotifDedup(dedupeKey);
          return true;
        }
      }
    } catch {
      // Firestore 読み取り不可時は sessionStorage のみ（下で add 成功時に記録）
    }
    return false;
  }

  async function pushLikeNotification(db, recipientUid, partial) {
    const rcpt = String(recipientUid || "").trim();
    const actor = String(partial?.actor_uid || "").trim();
    if (!db || typeof db.collection !== "function" || !rcpt || !actor || actor === rcpt) return;
    const kind = String(partial?.kind || "");
    if (!KINDS.has(kind)) return;
    const targetId = String(partial?.target_id || "").trim().slice(0, 128);
    if (!targetId) return;

    const dedupeKey = likeNotifDedupeKey(rcpt, actor, kind, targetId);
    if (likeNotifInflight.has(dedupeKey)) return;

    const prefField = KIND_TO_PREF_FIELD[kind] || "";
    if (prefField) {
      try {
        const prof = await db.collection("mll_profiles").doc(rcpt).get();
        if ((prof.data() || {})[prefField] === false) return;
      } catch {
        // On read failure, fall through and still try notification write.
      }
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) {
      console.warn("[MarchinZ] Like rate limit exceeded");
      return;
    }
    if (await hasRecentLikeNotification(db, rcpt, actor, kind, targetId)) return;

    likeNotifInflight.add(dedupeKey);
    const actorName = String(partial?.actor_name || "ユーザー").trim().slice(0, 120) || "ユーザー";
    const doc = {
      kind,
      actor_uid: actor,
      actor_name: actorName,
      target_type: String(partial?.target_type || "post").trim().slice(0, 32),
      target_id: targetId,
      target_title: String(partial?.target_title || "").trim().slice(0, 300),
      target_href: String(partial?.target_href || "#").trim().slice(0, 512),
      thread_root_id: String(partial?.thread_root_id || "").trim().slice(0, 128),
      read: false,
      created_at: new Date().toISOString(),
    };
    try {
      await db.collection("mll_profiles").doc(rcpt).collection("notifications").add(doc);
      writeLocalLikeNotifDedup(dedupeKey);
    } catch (e) {
      console.warn("MarchinZPushLikeNotification", e);
    } finally {
      likeNotifInflight.delete(dedupeKey);
    }
  }

  window.MarchinZPushLikeNotification = pushLikeNotification;
})();
