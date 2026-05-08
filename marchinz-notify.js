(() => {
  const KINDS = new Set([
    "like_mll_log",
    "like_community_post",
    "like_calendar_event",
    "like_video_bookmark",
    "like_channel_bookmark",
    "like_log_diary",
  ]);

  const KIND_TO_PREF_FIELD = {
    like_mll_log: "like_show_mll",
    like_community_post: "like_show_community",
    like_calendar_event: "like_show_calendar",
    like_video_bookmark: "like_show_video_bookmark",
    like_channel_bookmark: "like_show_channel_bookmark",
    like_log_diary: "like_show_log_diary",
  };

  /**
   * いいね時に相手の受信箱へ通知ドキュメントを追加する（actor が recipient の subcollection に create）。
   * @param {import("firebase").firestore.Firestore | null | undefined} db
   * @param {string} recipientUid
   * @param {Record<string, unknown>} partial
   */
  async function pushLikeNotification(db, recipientUid, partial) {
    const rcpt = String(recipientUid || "").trim();
    const actor = String(partial?.actor_uid || "").trim();
    if (!db || typeof db.collection !== "function" || !rcpt || !actor || actor === rcpt) return;
    const kind = String(partial?.kind || "");
    if (!KINDS.has(kind)) return;
    const prefField = KIND_TO_PREF_FIELD[kind] || "";
    if (prefField) {
      try {
        const prof = await db.collection("mll_profiles").doc(rcpt).get();
        if ((prof.data() || {})[prefField] === false) return;
      } catch {
        // On read failure, fall through and still try notification write.
      }
    }
    const actorName = String(partial?.actor_name || "ユーザー").trim().slice(0, 120) || "ユーザー";
    const doc = {
      kind,
      actor_uid: actor,
      actor_name: actorName,
      target_type: String(partial?.target_type || "post").trim().slice(0, 32),
      target_id: String(partial?.target_id || "").trim().slice(0, 128),
      target_title: String(partial?.target_title || "").trim().slice(0, 300),
      target_href: String(partial?.target_href || "#").trim().slice(0, 512),
      thread_root_id: String(partial?.thread_root_id || "").trim().slice(0, 128),
      read: false,
      created_at: new Date().toISOString(),
    };
    try {
      await db.collection("mll_profiles").doc(rcpt).collection("notifications").add(doc);
    } catch (e) {
      console.warn("MarchinZPushLikeNotification", e);
    }
  }

  window.MarchinZPushLikeNotification = pushLikeNotification;
})();
