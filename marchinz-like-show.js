(() => {
  /**
   * mll_profiles の「いいね通知」各フラグ。未設定・null は ON（通知する）。
   * @param {Record<string, unknown>|null|undefined} pdata
   */
  function parseLikeShowPrefs(pdata) {
    const p = pdata || {};
    return {
      mll: p.like_show_mll !== false,
      community: p.like_show_community !== false,
      calendar: p.like_show_calendar !== false,
      videoBookmark: p.like_show_video_bookmark !== false,
      channelBookmark: p.like_show_channel_bookmark !== false,
      logDiary: p.like_show_log_diary !== false,
    };
  }

  /** @param {import("firebase").auth.User|null|undefined} user */
  function actorDisplayName(user) {
    const nick = String(window.MLL_AUTH?.getDisplayName?.() || "").trim();
    if (nick) return nick.slice(0, 120);
    return (
      String(user?.user_metadata?.full_name || user?.user_metadata?.name || "ユーザー").trim().slice(0, 120) ||
      "ユーザー"
    );
  }

  window.MarchinZParseLikeShowPrefs = parseLikeShowPrefs;
  window.MarchinZActorDisplayName = actorDisplayName;
})();
