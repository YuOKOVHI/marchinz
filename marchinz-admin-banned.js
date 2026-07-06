/**
 * 管理者ページ（#admin/banned）: 凍結アカウント一覧と凍結解除
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

  function isAdminUi() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function setMsg(text, isErr) {
    const m = el("admin-banned-msg");
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
  async function loadBannedProfiles(db) {
    const snap = await db.collection("mll_profiles").where("banned", "==", true).limit(300).get();
    /** @type {Array<Record<string, unknown> & { id: string }>} */
    const rows = [];
    snap.forEach((doc) => {
      const x = doc.data() || {};
      rows.push({
        id: doc.id,
        display_name: String(x.display_name || "").trim(),
        marchinz_public_id: String(x.marchinz_public_id || "").trim(),
        banned_at: String(x.banned_at || "").trim(),
        banned_reason: String(x.banned_reason || "").trim(),
        withdrawn: Boolean(x.withdrawn),
      });
    });
    rows.sort((a, b) => String(b.banned_at || "").localeCompare(String(a.banned_at || "")));
    return rows;
  }

  /** @type {Array<Record<string, unknown> & { id: string }>} */
  let cachedRows = [];

  function getSearchQuery() {
    const inp = el("admin-banned-search");
    return inp instanceof HTMLInputElement ? String(inp.value || "").trim().toLowerCase() : "";
  }

  /**
   * @param {Array<Record<string, unknown> & { id: string }>} rows
   */
  function filterRows(rows) {
    const q = getSearchQuery();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        String(r.display_name || ""),
        String(r.marchinz_public_id || ""),
        String(r.id || ""),
        String(r.banned_reason || ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
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
      empty.textContent = cachedRows.length
        ? "検索条件に一致する凍結アカウントはありません。"
        : "現在、凍結中のアカウントはありません。";
      list.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const li = document.createElement("li");
      li.className = "mz-admin-trash-item";

      const main = document.createElement("div");
      main.className = "mz-admin-trash-item-main";

      const title = document.createElement("h4");
      title.className = "mz-admin-trash-item-title";
      const name = String(row.display_name || "（表示名なし）").slice(0, 120);
      title.textContent = name;

      const meta1 = document.createElement("p");
      meta1.className = "mz-admin-trash-item-meta";
      const pubId = String(row.marchinz_public_id || "").trim();
      const uidShort = String(row.id || "").slice(0, 12);
      meta1.textContent = [
        pubId ? `MarchinZ ID: ${pubId}` : null,
        `UID: ${uidShort}…`,
        Boolean(row.withdrawn) ? "退会済み" : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const meta2 = document.createElement("p");
      meta2.className = "mz-admin-trash-item-meta mz-admin-trash-item-meta--sub";
      meta2.textContent = `凍結日時: ${formatIsoShort(row.banned_at)}`;

      const reason = document.createElement("p");
      reason.className = "mz-admin-trash-item-meta mz-admin-trash-item-meta--sub";
      const rs = String(row.banned_reason || "").trim();
      reason.textContent = rs ? `理由: ${rs.slice(0, 500)}` : "理由: （未記録）";

      main.appendChild(title);
      main.appendChild(meta1);
      main.appendChild(meta2);
      main.appendChild(reason);

      const actions = document.createElement("div");
      actions.className = "mz-admin-trash-item-actions mz-admin-banned-item-actions";

      const profBtn = document.createElement("a");
      profBtn.className = "btn-reset-search";
      profBtn.href = `#profile?uid=${encodeURIComponent(String(row.id || ""))}`;
      profBtn.textContent = "プロフィール";

      const unbanBtn = document.createElement("button");
      unbanBtn.type = "button";
      unbanBtn.className = "btn-share-search";
      unbanBtn.textContent = "凍結を解除";
      unbanBtn.addEventListener("click", () => {
        void unbanProfile(row, unbanBtn);
      });

      actions.appendChild(profBtn);
      actions.appendChild(unbanBtn);
      li.appendChild(main);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  function rerenderFromCache() {
    const list = el("admin-banned-list");
    if (!list) return;
    const filtered = filterRows(cachedRows);
    renderList(list, filtered);
    if (!getSearchQuery()) {
      setMsg(filtered.length ? `${filtered.length} 件（凍結中）` : "");
    } else {
      setMsg(`${filtered.length} 件（全 ${cachedRows.length} 件中）`);
    }
  }

  /**
   * @param {Record<string, unknown> & { id: string }} row
   * @param {HTMLButtonElement} btn
   */
  async function unbanProfile(row, btn) {
    const db = getDb();
    if (!db || !isAdminUi()) {
      setMsg("ログインと管理者権限を確認してください。", true);
      return;
    }
    const uid = String(row.id || "").trim();
    const name = String(row.display_name || uid).slice(0, 80);
    if (!uid) return;
    if (!window.confirm(`「${name}」の凍結を解除しますか？`)) return;
    btn.disabled = true;
    setMsg("凍結を解除しています…");
    const now = new Date().toISOString();
    try {
      await db.collection("mll_profiles").doc(uid).update({
        banned: false,
        banned_at: "",
        banned_reason: "",
        updated_at: now,
      });
      setMsg(`「${name}」の凍結を解除しました。`);
      await refresh();
    } catch (e) {
      console.warn("[admin-banned] unban failed", e);
      const code = String(e?.code || "").trim();
      const hint =
        code === "permission-denied"
          ? "Firestore の mll_privileged_uids に UID が登録されているか、ルールが本番に反映されているか確認してください。"
          : "";
      setMsg(String(e?.message || "凍結解除に失敗しました。") + (hint ? ` ${hint}` : ""), true);
    } finally {
      btn.disabled = false;
    }
  }

  let refreshGen = 0;
  let searchWired = false;

  async function refresh() {
    const list = el("admin-banned-list");
    if (!list) return;
    if (!isAdminUi()) {
      list.replaceChildren();
      cachedRows = [];
      setMsg("管理者のみ利用できます。", true);
      return;
    }
    const db = getDb();
    if (!db) {
      list.replaceChildren();
      cachedRows = [];
      setMsg("Firestore が利用できません。", true);
      return;
    }
    const gen = ++refreshGen;
    setMsg("読み込み中…");
    try {
      cachedRows = await loadBannedProfiles(db);
      if (gen !== refreshGen) return;
      rerenderFromCache();
    } catch (e) {
      if (gen !== refreshGen) return;
      console.warn("[admin-banned] load failed", e);
      cachedRows = [];
      list.replaceChildren();
      const code = String(e?.code || "").trim();
      const hint =
        code === "failed-precondition"
          ? "Firestore のインデックス作成が必要な場合があります（banned == true）。"
          : "";
      setMsg(String(e?.message || "一覧の取得に失敗しました。") + (hint ? ` ${hint}` : ""), true);
    }
  }

  function wireSearch() {
    if (searchWired) return;
    const inp = el("admin-banned-search");
    if (!(inp instanceof HTMLInputElement)) return;
    searchWired = true;
    inp.addEventListener("input", () => {
      rerenderFromCache();
    });
  }

  window.MarchinZAdminBanned = {
    refresh,
  };

  document.addEventListener("DOMContentLoaded", () => {
    wireSearch();
  });
})();
