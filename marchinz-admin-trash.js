/**
 * 管理者ページ（#admin/trash）: イベント掲示のゴミ箱一覧と運営による復元
 */
(function () {
  "use strict";

  function el(id) {
    const n = document.getElementById(id);
    return n instanceof HTMLElement ? n : null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function getUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function isAdminUi() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function setMsg(text, isErr) {
    const m = el("admin-trash-msg");
    if (!m) return;
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("ops-announcement-msg--err", Boolean(isErr));
  }

  function formatIsoShort(iso) {
    const s = String(iso || "").trim();
    if (!s) return "—";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 16);
    try {
      return d.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return s.slice(0, 16);
    }
  }

  /**
   * @param {import("firebase").firestore.Firestore} db
   * @returns {Promise<Array<Record<string, unknown> & { id: string }>>}
   */
  async function loadTrashedEvents(db) {
    const snap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(500).get();
    /** @type {Array<Record<string, unknown> & { id: string }>} */
    const rows = [];
    snap.forEach((doc) => {
      const x = doc.data() || {};
      if (String(x.status || "").trim() !== "trashed") return;
      rows.push({
        id: doc.id,
        kind: String(x.kind || ""),
        date: String(x.date || ""),
        title: String(x.title || ""),
        venue_pref: String(x.venue_pref || "").trim(),
        event_url: String(x.event_url || "").trim(),
        created_by: String(x.created_by || ""),
        creator_display_name: String(x.creator_display_name || ""),
        trashed_at: String(x.trashed_at || ""),
        trashed_by: String(x.trashed_by || ""),
        original_created_by: String(x.original_created_by || ""),
      });
    });
    rows.sort((a, b) => String(b.trashed_at || "").localeCompare(String(a.trashed_at || "")));
    return rows;
  }

  /**
   * @param {import("firebase").firestore.Firestore} db
   * @param {string} uid
   */
  async function fetchProfileBrief(db, uid) {
    const id = String(uid || "").trim();
    if (!id) return { display_name: "", avatar_url: "" };
    try {
      const snap = await db.collection("mll_profiles").doc(id).get();
      const p = snap.data() || {};
      return {
        display_name: String(p.display_name || "").trim(),
        avatar_url: String(p.avatar_url || "").trim(),
      };
    } catch {
      return { display_name: "", avatar_url: "" };
    }
  }

  /**
   * @param {HTMLElement} list
   * @param {Array<Record<string, unknown> & { id: string }>} rows
   */
  function renderList(list, rows) {
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "mz-admin-trash-empty";
      empty.textContent = "ゴミ箱に入っているイベントはありません。";
      list.appendChild(empty);
      return;
    }
    for (const ev of rows) {
      const li = document.createElement("li");
      li.className = "mz-admin-trash-item";

      const main = document.createElement("div");
      main.className = "mz-admin-trash-item-main";

      const title = document.createElement("h4");
      title.className = "mz-admin-trash-item-title";
      title.textContent = String(ev.title || "（タイトルなし）").slice(0, 200);

      const meta1 = document.createElement("p");
      meta1.className = "mz-admin-trash-item-meta";
      const parts = [String(ev.date || "").trim(), String(ev.venue_pref || "").trim(), String(ev.kind || "").trim()].filter(
        Boolean,
      );
      meta1.textContent = parts.join(" · ") || "—";

      const meta2 = document.createElement("p");
      meta2.className = "mz-admin-trash-item-meta mz-admin-trash-item-meta--sub";
      const creator = String(ev.creator_display_name || "").trim() || String(ev.created_by || "").slice(0, 12) || "—";
      meta2.textContent = `作成者表示: ${creator} · ゴミ箱へ: ${formatIsoShort(ev.trashed_at)}`;

      main.appendChild(title);
      main.appendChild(meta1);
      main.appendChild(meta2);

      const actions = document.createElement("div");
      actions.className = "mz-admin-trash-item-actions";

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn-share-search";
      restoreBtn.textContent = "復元（運営引き継ぎ）";
      restoreBtn.addEventListener("click", () => {
        void restoreTrashedEvent(ev, restoreBtn);
      });

      const purgeBtn = document.createElement("button");
      purgeBtn.type = "button";
      purgeBtn.className = "calendar-ev-delete-btn";
      purgeBtn.textContent = "完全削除";
      purgeBtn.addEventListener("click", () => {
        void purgeTrashedEvent(ev, purgeBtn);
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(purgeBtn);
      li.appendChild(main);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  /**
   * @param {Record<string, unknown> & { id: string }} ev
   * @param {HTMLButtonElement} btn
   */
  async function restoreTrashedEvent(ev, btn) {
    const db = getDb();
    const user = getUser();
    if (!db || !user?.id || !isAdminUi()) {
      setMsg("ログインと管理者権限を確認してください。", true);
      return;
    }
    const title = String(ev.title || "").slice(0, 80);
    if (
      !window.confirm(
        `「${title}」を復元しますか？\n\n` +
          "掲示はイベント一覧に再表示されます。\n" +
          "作成者は運営アカウント（あなた）に引き継がれます。\n" +
          "削除時に消えた作成者本人の MarchinZ Log は復元されません（本人が再度登録できます）。\n" +
          "他人の Log はそのまま残ります。",
      )
    ) {
      return;
    }
    btn.disabled = true;
    setMsg("復元しています…");
    try {
      const opsProf = await fetchProfileBrief(db, user.id);
      const prevCreatedBy = String(ev.created_by || "").trim();
      const patch = {
        status: "active",
        trashed_at: "",
        trashed_by: "",
        created_by: user.id,
        creator_display_name: String(opsProf.display_name || "運営").slice(0, 120),
        creator_avatar_url: String(opsProf.avatar_url || "").slice(0, 2000),
        restored_at: new Date().toISOString(),
        restored_by: user.id,
        original_created_by: prevCreatedBy.slice(0, 128),
      };
      await db.collection("mll_calendar_events").doc(String(ev.id)).update(patch);
      setMsg(`「${title}」を復元しました。イベント一覧に表示されます。`);
      await refresh();
    } catch (e) {
      console.warn("[admin-trash] restore failed", e);
      const code = String(e?.code || "").trim();
      const hint =
        code === "permission-denied"
          ? "Firestore ルール（イベント復元）が本番に未反映の可能性があります。"
          : "";
      setMsg(String(e?.message || "復元に失敗しました。") + (hint ? ` ${hint}` : ""), true);
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * @param {Record<string, unknown> & { id: string }} ev
   * @param {HTMLButtonElement} btn
   */
  async function purgeTrashedEvent(ev, btn) {
    const db = getDb();
    const user = getUser();
    if (!db || !user?.id || !isAdminUi()) {
      setMsg("ログインと管理者権限を確認してください。", true);
      return;
    }
    const title = String(ev.title || "").slice(0, 80);
    if (
      !window.confirm(
        `「${title}」を完全削除しますか？\n\n` +
          "掲示（イベントカード）と、紐づく MarchinZ Log・MarchinZ Note・参加者・いいねをすべて削除します。\n" +
          "この操作は取り消せません。",
      )
    ) {
      return;
    }
    btn.disabled = true;
    setMsg("完全削除しています…");
    try {
      const R = window.MarchinZMllRole;
      if (!R?.purgeTrashedCalendarEventPermanently) {
        throw new Error("完全削除機能を読み込めませんでした。ページを再読み込みしてください。");
      }
      const result = await R.purgeTrashedCalendarEventPermanently(db, String(ev.id), {
        date: String(ev.date || ""),
        title: String(ev.title || ""),
        venue_pref: String(ev.venue_pref || ""),
      });
      setMsg(
        `「${title}」を完全削除しました（Log ${result.logsDeleted} 件、Note ${result.notesDeleted} 件、参加者 ${result.attendeesDeleted} 件）。`,
      );
      window.dispatchEvent(new CustomEvent("marchinz-mll-updated"));
      await refresh();
    } catch (e) {
      console.warn("[admin-trash] purge failed", e);
      const code = String(e?.code || "").trim();
      const hint =
        code === "permission-denied"
          ? "Firestore ルール（完全削除）が本番に未反映の可能性があります。"
          : "";
      setMsg(String(e?.message || "完全削除に失敗しました。") + (hint ? ` ${hint}` : ""), true);
    } finally {
      btn.disabled = false;
    }
  }

  let refreshGen = 0;

  async function refresh() {
    const list = el("admin-trash-list");
    if (!list) return;
    if (!isAdminUi()) {
      list.replaceChildren();
      setMsg("管理者のみ利用できます。", true);
      return;
    }
    const db = getDb();
    if (!db) {
      list.replaceChildren();
      setMsg("Firestore が利用できません。", true);
      return;
    }
    const gen = ++refreshGen;
    setMsg("読み込み中…");
    try {
      const rows = await loadTrashedEvents(db);
      if (gen !== refreshGen) return;
      renderList(list, rows);
      setMsg(rows.length ? `${rows.length} 件（ゴミ箱）` : "");
    } catch (e) {
      if (gen !== refreshGen) return;
      console.warn("[admin-trash] load failed", e);
      list.replaceChildren();
      setMsg(String(e?.message || "一覧の取得に失敗しました。"), true);
    }
  }

  window.MarchinZAdminTrash = {
    refresh,
  };
})();
