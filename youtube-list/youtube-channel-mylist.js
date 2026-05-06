/**
 * YouTube チャンネルマイリスト — 複数リスト・並べ替え・追加時にリスト選択
 */
(() => {
  const DEFAULT_LIST_ID = "default";
  const LS_LAST_LIST = "mz_yt_mylist_last_list_id";

  const hostEl = () => document.getElementById("mll-yt-channel-mylist-host");
  const msgEl = () => document.getElementById("mll-yt-mylist-msg");
  const pickerDlg = () => document.getElementById("mz-yt-mylist-picker");

  /** @type {Map<string, Set<string>>} */
  const listUrlKeys = new Map();

  /** @type {{ id: string; name: string; visibility: string; list_order: number }[]} */
  let cachedLists = [];

  function getUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function normLbBookmarks(raw) {
    const o = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) o[k] = true;
    }
    return o;
  }

  async function toggleMyChannelBookmarkLike(docId) {
    const db = getDb();
    const user = getUser();
    if (!user?.id || !db) return;
    try {
      const ref = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(docId);
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = normLbBookmarks(data.liked_by);
        const next = { ...prev };
        if (next[user.id]) delete next[user.id];
        else next[user.id] = true;
        txn.update(ref, { liked_by: next });
      });
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "いいねの更新に失敗しました。"), true);
      return;
    }
    renderMylist();
  }

  function appendMyChannelBmLike(hostEl, it, showLike) {
    if (!hostEl || !showLike || !it?.docId) return;
    const me = getUser();
    const lb = normLbBookmarks(it.liked_by);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    const row = document.createElement("div");
    row.className = "community-like-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "community-like-btn" + (liked ? " community-like-btn--on" : "");
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.setAttribute("aria-label", liked ? "いいねを解除" : "いいねする");
    btn.addEventListener("click", () => void toggleMyChannelBookmarkLike(it.docId));
    const heart = document.createElement("span");
    heart.className = "community-like-heart";
    heart.setAttribute("aria-hidden", "true");
    heart.textContent = "\u2665";
    const num = document.createElement("span");
    num.className = "community-like-count";
    num.textContent = String(cnt);
    btn.appendChild(heart);
    btn.appendChild(num);
    row.appendChild(btn);
    if (!me?.id) {
      const hint = document.createElement("span");
      hint.className = "community-like-hint mll-log-meta";
      hint.textContent = "ログインでいいねできます";
      row.appendChild(hint);
    }
    hostEl.appendChild(row);
  }

  function normalizeChannelUrl(u) {
    const s = String(u ?? "").trim();
    if (!s) return "";
    try {
      const x = new URL(s);
      x.hash = "";
      const keys = [...x.searchParams.keys()].sort();
      const next = new URL(x.origin + x.pathname);
      for (const k of keys) {
        for (const v of x.searchParams.getAll(k)) {
          next.searchParams.append(k, v);
        }
      }
      return next.toString();
    } catch {
      return s;
    }
  }

  function urlKey(u) {
    return normalizeChannelUrl(u);
  }

  function bookmarkDocId(normUrl) {
    let h = 2166136261;
    const str = normUrl;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `c${(h >>> 0).toString(36)}`;
  }

  function sanitizeListId(id) {
    return String(id || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 64) || "list";
  }

  /**
   * @param {string} listId
   * @param {string} normUrl
   */
  function channelBookmarkDocumentId(listId, normUrl) {
    const base = bookmarkDocId(normUrl);
    if (listId === DEFAULT_LIST_ID) return base;
    return `${sanitizeListId(listId)}_${base}`;
  }

  /** @param {string} docId @param {Record<string, unknown>} data */
  function inferChannelListIdFromDoc(docId, data) {
    const fromData = String(data?.list_id || "").trim();
    if (fromData) return fromData;
    const id = String(docId);
    const idx = id.lastIndexOf("_c");
    if (idx > 0) {
      const rest = id.slice(idx + 1);
      if (/^c[a-z0-9]+$/.test(rest)) return id.slice(0, idx);
    }
    return DEFAULT_LIST_ID;
  }

  function setMsg(text, isErr) {
    const m = msgEl();
    if (!m) return;
    if (!text) {
      m.hidden = true;
      m.textContent = "";
      return;
    }
    m.hidden = false;
    m.textContent = text;
    m.style.color = isErr ? "#b71c1c" : "";
  }

  function lastUsedListId() {
    try {
      return String(localStorage.getItem(LS_LAST_LIST) || "").trim() || DEFAULT_LIST_ID;
    } catch {
      return DEFAULT_LIST_ID;
    }
  }

  function setLastUsedListId(id) {
    try {
      localStorage.setItem(LS_LAST_LIST, String(id || DEFAULT_LIST_ID));
    } catch {
      //
    }
  }

  async function ensureDefaultChannelList(user, db) {
    const ref = db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(DEFAULT_LIST_ID);
    const snap = await ref.get();
    const now = new Date().toISOString();
    const prev = snap.exists ? snap.data() || {} : {};
    await ref.set(
      {
        name: String(prev.name || "マイリスト").trim() || "マイリスト",
        visibility: prev.visibility === "private" ? "private" : "public",
        list_order: Number.isFinite(Number(prev.list_order)) ? Number(prev.list_order) : 0,
        created_at: String(prev.created_at || now).slice(0, 40) || now,
        updated_at: now,
      },
      { merge: true },
    );
  }

  async function getMaxChannelListOrder(user, db) {
    const snap = await db.collection("mll_profiles").doc(user.id).collection("channel_lists").limit(200).get();
    let m = 0;
    snap.forEach((doc) => {
      const v = Number(doc.data()?.list_order);
      if (Number.isFinite(v)) m = Math.max(m, v);
    });
    return m;
  }

  /** @returns {Promise<{ id: string; name: string; visibility: string; list_order: number }[]>} */
  async function loadChannelListMetas(user, db) {
    await ensureDefaultChannelList(user, db);
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("channel_lists")
      .orderBy("created_at", "asc")
      .limit(80)
      .get();
    const out = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const lo = Number(d.list_order);
      out.push({
        id: doc.id,
        name: String(d.name || doc.id).trim() || doc.id,
        visibility: String(d.visibility || "public").trim() === "private" ? "private" : "public",
        list_order: Number.isFinite(lo) ? lo : doc.id === DEFAULT_LIST_ID ? 0 : 500000,
      });
    });
    if (!out.some((x) => x.id === DEFAULT_LIST_ID)) {
      out.unshift({ id: DEFAULT_LIST_ID, name: "マイリスト", visibility: "public", list_order: 0 });
    }
    out.sort((a, b) => {
      if (a.list_order !== b.list_order) return a.list_order - b.list_order;
      return String(a.name).localeCompare(String(b.name), "ja");
    });
    return out;
  }

  async function refreshCache() {
    listUrlKeys.clear();
    cachedLists = [];
    const db = getDb();
    const user = getUser();
    if (!db || !user?.id) {
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
      renderMylist();
      return;
    }
    try {
      await ensureDefaultChannelList(user, db);
      cachedLists = await loadChannelListMetas(user, db);
      const snap = await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("channel_bookmarks")
        .orderBy("added_at", "desc")
        .limit(400)
        .get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const u = String(d.channel_url || "").trim();
        const k = urlKey(u);
        const lid = inferChannelListIdFromDoc(doc.id, d);
        if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
        if (k) listUrlKeys.get(lid).add(k);
      });
    } catch (e) {
      console.warn("[youtube-channel-mylist]", e);
    }
    window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
    renderMylist();
  }

  function hasChannelInList(rawUrl, listId) {
    const k = urlKey(rawUrl);
    const lid = String(listId || DEFAULT_LIST_ID);
    return Boolean(k && listUrlKeys.get(lid)?.has(k));
  }

  function hasChannelAnywhere(rawUrl) {
    const k = urlKey(rawUrl);
    if (!k) return false;
    for (const s of listUrlKeys.values()) {
      if (s.has(k)) return true;
    }
    return false;
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @param {string} listId
   */
  async function addChannelToList(item, listId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      setMsg("マイリストに追加するにはログインしてください。", true);
      return false;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setMsg("退会済みのアカウントでは保存できません。", true);
      return false;
    }
    const channel_url = normalizeChannelUrl(item?.url);
    if (!channel_url || !/^https?:\/\//i.test(channel_url)) {
      setMsg("チャンネル URL が無効です。", true);
      return false;
    }
    const lid = String(listId || DEFAULT_LIST_ID).trim() || DEFAULT_LIST_ID;
    await ensureDefaultChannelList(user, db);
    if (hasChannelInList(channel_url, lid)) {
      setMsg("このリストにはすでに追加済みです。");
      window.setTimeout(() => setMsg(""), 2400);
      return true;
    }
    const channel_name = String(item?.name ?? "").trim().slice(0, 280) || "チャンネル";
    const channel_logo = String(item?.logo ?? "").trim().slice(0, 2048);
    const category = String(item?.category ?? "").trim().slice(0, 80) || "一般";
    const docId = channelBookmarkDocumentId(lid, channel_url);
    const payload = {
      list_id: lid,
      channel_url,
      channel_name,
      channel_logo,
      category,
      added_at: new Date().toISOString().slice(0, 40),
      sort_index: Math.min(2147483647, Math.floor(Date.now() / 1000)),
    };
    try {
      await db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(docId).set(payload);
      if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
      listUrlKeys.get(lid).add(urlKey(channel_url));
      setLastUsedListId(lid);
      setMsg("マイリストに追加しました。");
      window.setTimeout(() => setMsg(""), 2400);
      renderMylist();
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
      return true;
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "保存に失敗しました。"), true);
      return false;
    }
  }

  async function createChannelList(name, visibility) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return null;
    const id = `L_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const sid = sanitizeListId(id);
    const now = new Date().toISOString();
    const maxO = await getMaxChannelListOrder(user, db);
    await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("channel_lists")
      .doc(sid)
      .set({
        name: String(name || "マイリスト").trim().slice(0, 120) || "マイリスト",
        visibility: visibility === "private" ? "private" : "public",
        list_order: maxO + 100,
        created_at: now,
        updated_at: now,
      });
    return sid;
  }

  async function renameChannelList(listId, rawName) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return;
    const nm = String(rawName || "").trim().slice(0, 120);
    if (!nm) {
      setMsg("リスト名を入力してください。", true);
      return;
    }
    const now = new Date().toISOString();
    await db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(listId).set(
      {
        name: nm,
        updated_at: now,
      },
      { merge: true },
    );
    await refreshCache();
  }

  async function updateChannelListVisibility(listId, visibility) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return;
    const now = new Date().toISOString();
    await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("channel_lists")
      .doc(listId)
      .set({ visibility: visibility === "private" ? "private" : "public", updated_at: now }, { merge: true });
    await refreshCache();
  }

  /**
   * @param {string} listId
   * @param {number} dir
   */
  async function moveChannelListOrder(listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !listId) return;
    const lists = await loadChannelListMetas(user, db);
    const idx = lists.findIndex((x) => x.id === listId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= lists.length) return;
    const a = lists[idx];
    const b = lists[j];
    const now = new Date().toISOString();
    const refA = db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(a.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("channel_lists").doc(b.id);
    const batch = db.batch();
    batch.set(refA, { list_order: b.list_order, updated_at: now }, { merge: true });
    batch.set(refB, { list_order: a.list_order, updated_at: now }, { merge: true });
    await batch.commit();
    await refreshCache();
  }

  /**
   * @param {string} docId
   * @param {string} listId
   * @param {number} dir
   */
  async function moveChannelBookmarkOrder(docId, listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("channel_bookmarks")
      .orderBy("added_at", "desc")
      .limit(400)
      .get();
    /** @type {{ id: string; sort: number; added: string }[]} */
    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const lid = inferChannelListIdFromDoc(doc.id, d);
      if (lid !== listId) return;
      const si = Number(d.sort_index);
      rows.push({
        id: doc.id,
        sort: Number.isFinite(si) ? si : 0,
        added: String(d.added_at || ""),
      });
    });
    rows.sort((x, y) => (x.sort !== y.sort ? x.sort - y.sort : String(x.added).localeCompare(String(y.added))));
    const idx = rows.findIndex((r) => r.id === docId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const A = rows[idx];
    const B = rows[j];
    const refA = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(A.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(B.id);
    const tmp = Math.floor(Date.now() / 1000) % 2000000000;
    await refA.update({ sort_index: tmp });
    await refB.update({ sort_index: A.sort });
    await refA.update({ sort_index: B.sort });
    await refreshCache();
  }

  async function removeByDocId(docId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    try {
      const ref = db.collection("mll_profiles").doc(user.id).collection("channel_bookmarks").doc(docId);
      const snap = await ref.get();
      const d = snap.data() || {};
      const u = String(d.channel_url || "").trim();
      const lid = inferChannelListIdFromDoc(docId, d);
      await ref.delete();
      const k = urlKey(u);
      if (k && listUrlKeys.has(lid)) listUrlKeys.get(lid).delete(k);
      renderMylist();
      window.dispatchEvent(new CustomEvent("marchinz-channel-mylist-updated"));
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "削除に失敗しました。"), true);
    }
  }

  /** @type {{ resolve: (v: string|null) => void } | null} */
  let pickerResolver = null;

  function wirePickerOnce() {
    const dlg = pickerDlg();
    if (!dlg || dlg.dataset.mzYtPickerWired === "1") return;
    dlg.dataset.mzYtPickerWired = "1";
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) closePicker(null);
    });
    dlg.querySelector("[data-mz-yt-picker-cancel]")?.addEventListener("click", () => closePicker(null));
    dlg.querySelector("[data-mz-yt-picker-confirm]")?.addEventListener("click", () => void confirmPicker());
  }

  function closePicker(resultListId) {
    const dlg = pickerDlg();
    if (dlg instanceof HTMLDialogElement) {
      try {
        dlg.close();
      } catch {
        //
      }
    }
    if (pickerResolver) {
      pickerResolver(resultListId);
      pickerResolver = null;
    }
  }

  async function confirmPicker() {
    const dlg = pickerDlg();
    if (!dlg) return;
    const chosen = dlg.querySelector('input[name="mz-yt-picker-list"]:checked');
    const rid = chosen instanceof HTMLInputElement ? String(chosen.value || "").trim() : "";
    const newName = /** @type {HTMLInputElement|null} */ (dlg.querySelector("[data-mz-yt-new-list-name]"));
    const newVis = /** @type {HTMLInputElement|null} */ (dlg.querySelector("[data-mz-yt-new-list-vis]:checked"));
    if (rid === "__new__") {
      const nm = (newName?.value || "").trim();
      if (!nm) {
        setMsg("新しいリストの名前を入力してください。", true);
        return;
      }
      const vis = newVis?.value === "private" ? "private" : "public";
      const nid = await createChannelList(nm, vis);
      if (!nid) {
        setMsg("リストの作成に失敗しました。", true);
        return;
      }
      closePicker(nid);
      return;
    }
    if (!rid) return;
    closePicker(rid);
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @returns {Promise<string|null>}
   */
  function openPicker(item) {
    wirePickerOnce();
    const dlg = pickerDlg();
    if (!(dlg instanceof HTMLDialogElement)) return Promise.resolve(lastUsedListId());

    const body = dlg.querySelector("[data-mz-yt-picker-lists]");
    const newBlock = dlg.querySelector("[data-mz-yt-picker-new]");
    if (body) {
      body.innerHTML = "";
      const lists = cachedLists.length
        ? cachedLists
        : [{ id: DEFAULT_LIST_ID, name: "マイリスト", visibility: "public", list_order: 0 }];
      const last = lastUsedListId();
      const hasLast = lists.some((x) => x.id === last);
      for (const L of lists) {
        const lab = document.createElement("label");
        lab.className = "mz-picker-list-option";
        const inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "mz-yt-picker-list";
        inp.value = L.id;
        if (hasLast ? L.id === last : L.id === DEFAULT_LIST_ID) {
          inp.checked = true;
        }
        const span = document.createElement("span");
        span.textContent = `${L.name}（${L.visibility === "private" ? "リスト非公開" : "リスト公開"}）`;
        lab.appendChild(inp);
        lab.appendChild(span);
        body.appendChild(lab);
      }
      const newLab = document.createElement("label");
      newLab.className = "mz-picker-list-option";
      const newInp = document.createElement("input");
      newInp.type = "radio";
      newInp.name = "mz-yt-picker-list";
      newInp.value = "__new__";
      newLab.appendChild(newInp);
      newLab.appendChild(document.createTextNode("新しいリストを作成…"));
      body.appendChild(newLab);
      newInp.addEventListener("change", () => {
        if (newBlock) newBlock.hidden = !newInp.checked;
      });
      body.querySelectorAll('input[name="mz-yt-picker-list"]').forEach((r) => {
        r.addEventListener("change", () => {
          if (r instanceof HTMLInputElement && r.value !== "__new__" && newBlock) newBlock.hidden = true;
        });
      });
    }
    if (newBlock) {
      newBlock.hidden = true;
      const ni = dlg.querySelector("[data-mz-yt-new-list-name]");
      if (ni instanceof HTMLInputElement) ni.value = "";
    }

    return new Promise((resolve) => {
      pickerResolver = resolve;
      try {
        dlg.showModal();
      } catch {
        resolve(lastUsedListId());
      }
    });
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @returns {Promise<{ ok: boolean; message?: string }>}
   */
  async function addWithPicker(item) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      window.MarchinZNavigateAuthEntry?.("signup", "youtube_channel_mylist");
      return { ok: false, message: "ログインが必要です。" };
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      return { ok: false, message: "退会済みのアカウントでは保存できません。" };
    }
    await ensureDefaultChannelList(user, db);
    cachedLists = await loadChannelListMetas(user, db);
    const listId = await openPicker(item);
    if (!listId) return { ok: false, message: "" };
    const ok = await addChannelToList(item, listId);
    if (!ok) return { ok: false, message: "保存に失敗しました。" };
    return { ok: true, message: "マイリストに追加しました。" };
  }

  /**
   * @param {{ url?: string; name?: string; logo?: string; category?: string }} item
   * @returns {Promise<{ ok: boolean; message?: string }>}
   */
  async function add(item) {
    return addWithPicker(item);
  }

  function renderMylist() {
    const host = hostEl();
    if (!host) return;
    const db = getDb();
    const user = getUser();
    host.innerHTML = "";
    if (!user?.id || !db) {
      const p = document.createElement("p");
      p.className = "mll-mylist-empty";
      p.textContent = "ログイン後、保存したチャンネルがここに表示されます。";
      host.appendChild(p);
      return;
    }

    loadChannelListMetas(user, db)
      .then((lists) => {
        cachedLists = lists;
        return db
          .collection("mll_profiles")
          .doc(user.id)
          .collection("channel_bookmarks")
          .orderBy("added_at", "desc")
          .limit(400)
          .get();
      })
      .then(async (snap) => {
        if (!hostEl()) return;
        let showChLike = true;
        if (user?.id && db) {
          try {
            const ps = await db.collection("mll_profiles").doc(user.id).get();
            showChLike = (ps.data() || {}).like_show_channel_bookmark !== false;
          } catch {
            showChLike = true;
          }
        }
        /** @type {Map<string, { meta: { id: string; name: string; visibility: string; list_order: number }; items: { docId: string; title: string; url: string; sort: number; added: string; liked_by?: Record<string, boolean> }[] }>} */
        const grouped = new Map();
        for (const L of cachedLists) {
          grouped.set(L.id, { meta: { ...L, list_order: Number(L.list_order) || 0 }, items: [] });
        }
        snap.forEach((doc) => {
          const d = doc.data() || {};
          const lid = inferChannelListIdFromDoc(doc.id, d);
          if (!grouped.has(lid)) {
            grouped.set(lid, {
              meta: {
                id: lid,
                name: lid === DEFAULT_LIST_ID ? "マイリスト" : lid,
                visibility: "public",
                list_order: lid === DEFAULT_LIST_ID ? 0 : 500000,
              },
              items: [],
            });
          }
          const url = String(d.channel_url || "").trim();
          const title = String(d.channel_name || "").trim() || url || "チャンネル";
          const si = Number(d.sort_index);
          grouped.get(lid).items.push({
            docId: doc.id,
            title,
            url,
            sort: Number.isFinite(si) ? si : 0,
            added: String(d.added_at || ""),
            liked_by: normLbBookmarks(d.liked_by),
          });
        });

        for (const g of grouped.values()) {
          g.items.sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : String(a.added).localeCompare(String(b.added))));
        }

        const frag = document.createDocumentFragment();
        const sortedLists = [...grouped.values()].sort((a, b) => {
          const ao = Number(a.meta.list_order);
          const bo = Number(b.meta.list_order);
          const ad = Number.isFinite(ao) ? ao : a.meta.id === DEFAULT_LIST_ID ? 0 : 999999;
          const bd = Number.isFinite(bo) ? bo : b.meta.id === DEFAULT_LIST_ID ? 0 : 999999;
          if (ad !== bd) return ad - bd;
          return String(a.meta.name).localeCompare(String(b.meta.name), "ja");
        });

        if (!snap.size) {
          const p = document.createElement("p");
          p.className = "mll-mylist-empty";
          p.textContent = "まだありません。上の一覧から「マイリストに追加」で追加できます。";
          host.appendChild(p);
          return;
        }

        for (const block of sortedLists) {
          if (!block.items.length) continue;
          const sec = document.createElement("section");
          sec.className = "mll-mylist-list-block";
          sec.dataset.listId = block.meta.id;

          const head = document.createElement("header");
          head.className = "mll-mylist-list-head";
          const h4 = document.createElement("h4");
          h4.className = "mll-mylist-list-name";
          h4.textContent = block.meta.name;
          const right = document.createElement("div");
          right.className = "mll-mylist-list-head-right";
          const listTools = document.createElement("div");
          listTools.className = "mll-mylist-list-tools";
          const renameBtn = document.createElement("button");
          renameBtn.type = "button";
          renameBtn.className = "btn-reset-search mll-mylist-list-tool-btn";
          renameBtn.textContent = "名前変更";
          renameBtn.addEventListener("click", () => {
            const nv = window.prompt("リスト名", block.meta.name);
            if (nv == null) return;
            void renameChannelList(block.meta.id, nv);
          });
          const upList = document.createElement("button");
          upList.type = "button";
          upList.className = "btn-reset-search mll-mylist-list-tool-btn";
          upList.textContent = "↑";
          upList.title = "リストの表示順を上へ";
          upList.addEventListener("click", () => void moveChannelListOrder(block.meta.id, -1));
          const downList = document.createElement("button");
          downList.type = "button";
          downList.className = "btn-reset-search mll-mylist-list-tool-btn";
          downList.textContent = "↓";
          downList.title = "リストの表示順を下へ";
          downList.addEventListener("click", () => void moveChannelListOrder(block.meta.id, 1));
          listTools.appendChild(renameBtn);
          listTools.appendChild(upList);
          listTools.appendChild(downList);
          const tag = document.createElement("span");
          const pub = block.meta.visibility !== "private";
          tag.className = `mll-mylist-vis-tag ${pub ? "mll-mylist-vis-tag--public" : "mll-mylist-vis-tag--private"}`;
          tag.textContent = pub ? "公開" : "非公開";
          tag.title = pub ? "プロフィールのマイリストに表示されます" : "プロフィールでは非表示です";
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "btn-reset-search mll-mylist-vis-toggle";
          toggle.textContent = pub ? "非公開にする" : "公開にする";
          toggle.addEventListener("click", () => {
            void (async () => {
              const next = pub ? "private" : "public";
              try {
                await updateChannelListVisibility(block.meta.id, next);
                if (next === "public") {
                  setMsg(
                    "リストを公開にしました。シェアしたリンクを他の方が見られるようにするには、プロフィールの公開範囲で「YouTube マイリスト」も公開にしてください。",
                    false,
                  );
                  window.setTimeout(() => setMsg(""), 10000);
                }
              } catch (e) {
                setMsg(String(e?.message || "公開設定の更新に失敗しました。"), true);
              }
            })();
          });
          right.appendChild(listTools);
          right.appendChild(tag);
          right.appendChild(toggle);
          const shareBtn = document.createElement("button");
          shareBtn.type = "button";
          shareBtn.className = "btn-share-search btn-marchinz-spotlight";
          shareBtn.textContent = "このリストをシェアする";
          shareBtn.setAttribute("aria-label", `リスト「${block.meta.name}」をシェア`);
          right.appendChild(shareBtn);
          const uid = String(user.id || "").trim();
          const sm = window.MarchinZShareMenu;
          if (uid && sm?.buildAbsoluteUrlForHash && sm.mylistShareText && sm.setupSearchLikeShareMenuForButton) {
            const profHash = `#profile?uid=${encodeURIComponent(uid)}&tab=yt&mylist=${encodeURIComponent(block.meta.id)}`;
            const shareUrl = sm.buildAbsoluteUrlForHash(profHash);
            const shareText = sm.mylistShareText(block.meta.name, shareUrl);
            sm.setupSearchLikeShareMenuForButton(shareBtn, shareText, shareUrl);
          }
          head.appendChild(h4);
          head.appendChild(right);

          const ul = document.createElement("ul");
          ul.className = "mll-mylist-video-list";
          for (const it of block.items) {
            const li = document.createElement("li");
            li.className = "mll-mylist-item";
            const main = document.createElement("div");
            main.className = "mll-mylist-item-main";
            const a = document.createElement("a");
            a.href = it.url || "#";
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.className = "mll-mylist-item-title";
            a.textContent = it.title;
            main.appendChild(a);
            appendMyChannelBmLike(main, it, showChLike);
            const ord = document.createElement("div");
            ord.className = "mll-mylist-item-order";
            const upIt = document.createElement("button");
            upIt.type = "button";
            upIt.className = "btn-reset-search mll-mylist-order-btn";
            upIt.textContent = "↑";
            upIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveChannelBookmarkOrder(it.docId, block.meta.id, -1);
            });
            const downIt = document.createElement("button");
            downIt.type = "button";
            downIt.className = "btn-reset-search mll-mylist-order-btn";
            downIt.textContent = "↓";
            downIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveChannelBookmarkOrder(it.docId, block.meta.id, 1);
            });
            ord.appendChild(upIt);
            ord.appendChild(downIt);
            const del = document.createElement("button");
            del.type = "button";
            del.className = "btn-reset-search mll-mylist-remove";
            del.textContent = "削除";
            del.addEventListener("click", () => void removeByDocId(it.docId));
            li.appendChild(main);
            li.appendChild(ord);
            li.appendChild(del);
            ul.appendChild(li);
          }
          sec.appendChild(head);
          sec.appendChild(ul);
          frag.appendChild(sec);
        }
        host.appendChild(frag);
      })
      .catch((e) => {
        console.warn(e);
        const p = document.createElement("p");
        p.className = "mll-mylist-empty";
        p.textContent = "一覧を読み込めませんでした。";
        host.appendChild(p);
      });
  }

  window.addEventListener("mll-auth-changed", () => void refreshCache());

  window.addEventListener("marchinz-like-show-changed", () => {
    window.MarchinZYoutubeChannelMylist?.renderMylist?.();
  });

  void refreshCache();

  window.MarchinZYoutubeChannelMylist = {
    add,
    addWithPicker,
    addChannelToList,
    renderMylist,
    refreshCache,
    normalizeChannelUrl,
    bookmarkDocId,
    hasChannel: hasChannelAnywhere,
    hasChannelInList,
    DEFAULT_LIST_ID,
  };
})();
