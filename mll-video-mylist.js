/**
 * 大会動画マイリスト — 複数リスト・リスト単位の公開／非公開・追加時にリスト選択
 */
(() => {
  const SS_INTENT_MYLIST_ROW = "mll_intent_mylist_row_json";
  const DEFAULT_LIST_ID = "default";
  const LS_LAST_LIST = "mz_video_mylist_last_list_id";

  const hostEl = () => document.getElementById("mll-mylist-video-host");
  const msgEl = () => document.getElementById("mll-mylist-msg");
  const pickerDlg = () => document.getElementById("mz-video-mylist-picker");

  /** @type {Map<string, Set<string>>} listId -> normalized url keys */
  const listUrlKeys = new Map();

  /** @type {{ id: string; name: string; visibility: string; list_order: number }[]} */
  let cachedLists = [];

  let pendingRowPlain = null;

  const ROW_KEYS_FOR_PENDING = [
    "種別",
    "分類",
    "動画での表示名",
    "チーム名",
    "団体/チーム名",
    "団体名",
    "配信日",
    "大会名",
    "URL",
    "動画配信元",
    "動画配信元URL",
  ];

  function cloneRowForPending(row) {
    const o = {};
    for (const k of ROW_KEYS_FOR_PENDING) {
      const v = row[k];
      o[k] = v == null ? "" : String(v).trim();
    }
    return o;
  }

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

  async function toggleMyVideoBookmarkLike(docId) {
    const db = getDb();
    const user = getUser();
    if (!user?.id || !db) return;
    try {
      const ref = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(docId);
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
    renderList();
  }

  function appendMyVideoBmLike(hostEl, it, showLike) {
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
    btn.addEventListener("click", () => void toggleMyVideoBookmarkLike(it.docId));
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

  function normalizeBookmarkUrl(u) {
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
    return normalizeBookmarkUrl(u);
  }

  function youtubeVideoIdFromUrl(urlStr) {
    const s = String(urlStr ?? "").trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      if (host === "youtu.be") {
        const id = u.pathname.split("/").filter(Boolean)[0];
        return id && /^[\w-]{11}$/.test(id) ? id : "";
      }
      if (host.includes("youtube.com")) {
        if (u.pathname.startsWith("/embed/")) {
          const id = u.pathname.split("/")[2];
          return id && /^[\w-]{11}$/.test(id) ? id : "";
        }
        if (u.pathname.startsWith("/shorts/")) {
          const id = u.pathname.split("/")[2];
          return id && /^[\w-]{11}$/.test(id) ? id : "";
        }
        const v = u.searchParams.get("v");
        return v && /^[\w-]{11}$/.test(v) ? v : "";
      }
    } catch {
      return "";
    }
    return "";
  }

  function bookmarkDocId(normUrl) {
    let h = 2166136261;
    const str = normUrl;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `b${(h >>> 0).toString(36)}`;
  }

  function sanitizeListId(id) {
    return String(id || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 64) || "list";
  }

  /**
   * 既定リストは従来どおり URL ハッシュのみの doc ID。それ以外は listId + '_' + hash
   * @param {string} listId
   * @param {string} normUrl
   */
  function bookmarkDocumentId(listId, normUrl) {
    const base = bookmarkDocId(normUrl);
    if (listId === DEFAULT_LIST_ID) return base;
    return `${sanitizeListId(listId)}_${base}`;
  }

  /** @param {string} docId @param {Record<string, unknown>} data */
  function inferListIdFromDoc(docId, data) {
    const fromData = String(data?.list_id || "").trim();
    if (fromData) return fromData;
    const id = String(docId);
    const idx = id.lastIndexOf("_b");
    if (idx > 0) {
      const rest = id.slice(idx + 1);
      if (/^b[a-z0-9]+$/.test(rest)) return id.slice(0, idx);
    }
    return DEFAULT_LIST_ID;
  }

  function rowCategory(row) {
    if (row["分類"]) return String(row["分類"] || "").trim();
    const title = row["大会名"] || "";
    const cf = String(title).toLowerCase();
    if (cf.includes("mix3") || String(title).includes("スリークロス")) {
      return "スリークロスチーム";
    }
    return "マーチング団体等";
  }

  function rowOrgTeam(row) {
    return String(row["団体/チーム名"] ?? row["団体名"] ?? "").trim();
  }

  function rowDisplayName(row) {
    return String(row["動画での表示名"] ?? row["チーム名"] ?? row["団体"] ?? "").trim();
  }

  function rowChannelName(row) {
    const n = String(row["動画配信元"] ?? "").trim();
    return n || "マーチング祭";
  }

  function rowChannelUrl(row) {
    const u = String(row["動画配信元URL"] ?? "").trim();
    return u || "https://www.youtube.com/@marching-matsuri";
  }

  function rowToPayload(row, listId) {
    const url = String(row["URL"] ?? "").trim();
    const key = urlKey(url);
    return {
      list_id: listId,
      url: key || url,
      video_id: youtubeVideoIdFromUrl(url),
      org_team: rowOrgTeam(row),
      display_name: rowDisplayName(row),
      event_title: String(row["大会名"] ?? "").trim(),
      channel_name: rowChannelName(row),
      channel_url: rowChannelUrl(row),
      category: rowCategory(row),
      added_at: new Date().toISOString(),
      sort_index: Math.min(2147483647, Math.floor(Date.now() / 1000)),
    };
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

  async function ensureDefaultList(user, db) {
    const ref = db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(DEFAULT_LIST_ID);
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

  async function getMaxVideoListOrder(user, db) {
    const snap = await db.collection("mll_profiles").doc(user.id).collection("video_lists").limit(200).get();
    let m = 0;
    snap.forEach((doc) => {
      const v = Number(doc.data()?.list_order);
      if (Number.isFinite(v)) m = Math.max(m, v);
    });
    return m;
  }

  /** @returns {Promise<{ id: string; name: string; visibility: string; list_order: number }[]>} */
  async function loadListMetas(user, db) {
    await ensureDefaultList(user, db);
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("video_lists")
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
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
      renderList();
      return;
    }
    try {
      await ensureDefaultList(user, db);
      cachedLists = await loadListMetas(user, db);
      const snap = await db
        .collection("mll_profiles")
        .doc(user.id)
        .collection("video_bookmarks")
        .orderBy("added_at", "desc")
        .limit(400)
        .get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const u = String(d.url || "").trim();
        const k = urlKey(u);
        const lid = inferListIdFromDoc(doc.id, d);
        if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
        if (k) listUrlKeys.get(lid).add(k);
      });
    } catch (e) {
      console.warn("[mll-video-mylist]", e);
    }
    window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
    renderList();
  }

  function hasUrlInList(rawUrl, listId) {
    const k = urlKey(rawUrl);
    const lid = String(listId || DEFAULT_LIST_ID);
    return Boolean(k && listUrlKeys.get(lid)?.has(k));
  }

  function trackMetric(name, payload = {}) {
    if (typeof window.MarchinZTrackEvent === "function") {
      window.MarchinZTrackEvent(name, payload);
    }
  }

  /** いずれかのリストに同一 URL があるか */
  function hasUrlAnywhere(rawUrl) {
    const k = urlKey(rawUrl);
    if (!k) return false;
    for (const s of listUrlKeys.values()) {
      if (s.has(k)) return true;
    }
    return false;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async function addRowToList(row, listId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      setMsg("マイリストに追加するにはログインしてください。", true);
      return false;
    }
    const lid = String(listId || DEFAULT_LIST_ID).trim() || DEFAULT_LIST_ID;
    const payload = rowToPayload(row, lid);
    if (!payload.url) {
      setMsg("動画URLがありません。", true);
      return false;
    }
    if (hasUrlInList(payload.url, lid)) {
      setMsg("このリストにはすでに追加済みです。");
      window.setTimeout(() => setMsg(""), 2400);
      return true;
    }
    const docId = bookmarkDocumentId(lid, payload.url);
    try {
      await db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(docId).set(payload);
      if (!listUrlKeys.has(lid)) listUrlKeys.set(lid, new Set());
      listUrlKeys.get(lid).add(payload.url);
      setLastUsedListId(lid);
      setMsg("マイリストに追加しました。");
      trackMetric("mylist_add", { target: "video", list_id: lid });
      window.setTimeout(() => setMsg(""), 2400);
      renderList();
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
      return true;
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "保存に失敗しました。"), true);
      return false;
    }
  }

  async function createList(name, visibility) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return null;
    const id = `L_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const sid = sanitizeListId(id);
    const now = new Date().toISOString();
    const maxO = await getMaxVideoListOrder(user, db);
    await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("video_lists")
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

  async function renameVideoList(listId, rawName) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return;
    const nm = String(rawName || "").trim().slice(0, 120);
    if (!nm) {
      setMsg("リスト名を入力してください。", true);
      return;
    }
    const now = new Date().toISOString();
    await db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(listId).set(
      {
        name: nm,
        updated_at: now,
      },
      { merge: true },
    );
    await refreshCache();
  }

  /**
   * @param {string} listId
   * @param {number} dir -1 = 上へ, +1 = 下へ
   */
  async function moveVideoListOrder(listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !listId) return;
    const lists = await loadListMetas(user, db);
    const idx = lists.findIndex((x) => x.id === listId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= lists.length) return;
    const a = lists[idx];
    const b = lists[j];
    const now = new Date().toISOString();
    const refA = db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(a.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("video_lists").doc(b.id);
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
  async function moveVideoBookmarkOrder(docId, listId, dir) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    const snap = await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("video_bookmarks")
      .orderBy("added_at", "desc")
      .limit(400)
      .get();
    /** @type {{ id: string; sort: number; added: string }[]} */
    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const lid = inferListIdFromDoc(doc.id, d);
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
    const refA = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(A.id);
    const refB = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(B.id);
    const tmp = Math.floor(Date.now() / 1000) % 2000000000;
    await refA.update({ sort_index: tmp });
    await refB.update({ sort_index: A.sort });
    await refA.update({ sort_index: B.sort });
    await refreshCache();
  }

  async function updateListVisibility(listId, visibility) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) return;
    const now = new Date().toISOString();
    await db
      .collection("mll_profiles")
      .doc(user.id)
      .collection("video_lists")
      .doc(listId)
      .set({ visibility: visibility === "private" ? "private" : "public", updated_at: now }, { merge: true });
    await refreshCache();
  }

  function requestLoginThenAdd(row) {
    pendingRowPlain = cloneRowForPending(row);
    try {
      sessionStorage.setItem(SS_INTENT_MYLIST_ROW, JSON.stringify(pendingRowPlain));
    } catch {
      //
    }
    window.MarchinZNavigateAuthEntry?.("signup", "videos_mylist");
  }

  /** @type {{ resolve: (v: string|null) => void } | null} */
  let pickerResolver = null;

  function wirePickerOnce() {
    const dlg = pickerDlg();
    if (!dlg || dlg.dataset.mzPickerWired === "1") return;
    dlg.dataset.mzPickerWired = "1";
    dlg.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t === dlg) closePicker(null);
    });
    dlg.querySelector("[data-mz-picker-cancel]")?.addEventListener("click", () => closePicker(null));
    dlg.querySelector("[data-mz-picker-confirm]")?.addEventListener("click", () => void confirmPicker());
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
    const chosen = dlg.querySelector('input[name="mz-picker-list"]:checked');
    const rid = chosen instanceof HTMLInputElement ? String(chosen.value || "").trim() : "";
    const newName = /** @type {HTMLInputElement|null} */ (dlg.querySelector("[data-mz-new-list-name]"));
    const newVis = /** @type {HTMLInputElement|null} */ (dlg.querySelector("[data-mz-new-list-vis]:checked"));
    if (rid === "__new__") {
      const nm = (newName?.value || "").trim();
      if (!nm) {
        setMsg("新しいリストの名前を入力してください。", true);
        return;
      }
      const vis = newVis?.value === "private" ? "private" : "public";
      const nid = await createList(nm, vis);
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
   * @param {Record<string, string>} row
   * @returns {Promise<string|null>} list id or null
   */
  function openPicker(row) {
    wirePickerOnce();
    const dlg = pickerDlg();
    if (!(dlg instanceof HTMLDialogElement)) return Promise.resolve(lastUsedListId());

    const body = dlg.querySelector("[data-mz-picker-lists]");
    const newBlock = dlg.querySelector("[data-mz-picker-new]");
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
        inp.name = "mz-picker-list";
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
      newInp.name = "mz-picker-list";
      newInp.value = "__new__";
      newLab.appendChild(newInp);
      newLab.appendChild(document.createTextNode("新しいリストを作成…"));
      body.appendChild(newLab);
      newInp.addEventListener("change", () => {
        if (newBlock) newBlock.hidden = !newInp.checked;
      });
      body.querySelectorAll('input[name="mz-picker-list"]').forEach((r) => {
        r.addEventListener("change", () => {
          if (r instanceof HTMLInputElement && r.value !== "__new__" && newBlock) newBlock.hidden = true;
        });
      });
    }
    if (newBlock) {
      newBlock.hidden = true;
      const ni = dlg.querySelector("[data-mz-new-list-name]");
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
   * @param {Record<string, string>} row
   */
  async function openAddDialog(row) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db) {
      requestLoginThenAdd(row);
      return;
    }
    await ensureDefaultList(user, db);
    cachedLists = await loadListMetas(user, db);
    const listId = await openPicker(row);
    if (!listId) return;
    await addRowToList(row, listId);
  }

  async function removeByDocId(docId) {
    const user = getUser();
    const db = getDb();
    if (!user?.id || !db || !docId) return;
    try {
      const ref = db.collection("mll_profiles").doc(user.id).collection("video_bookmarks").doc(docId);
      const snap = await ref.get();
      const d = snap.data() || {};
      const u = String(d.url || "").trim();
      const lid = inferListIdFromDoc(docId, d);
      await ref.delete();
      const k = urlKey(u);
      if (k && listUrlKeys.has(lid)) listUrlKeys.get(lid).delete(k);
      renderList();
      window.dispatchEvent(new CustomEvent("marchinz-mylist-updated"));
    } catch (e) {
      console.warn(e);
      setMsg(String(e?.message || "削除に失敗しました。"), true);
    }
  }

  function renderList() {
    const host = hostEl();
    if (!host) return;
    const db = getDb();
    const user = getUser();
    host.innerHTML = "";
    if (!user?.id || !db) {
      const p = document.createElement("p");
      p.className = "mll-mylist-empty";
      p.textContent = "ログイン後、保存した動画がここに表示されます。";
      host.appendChild(p);
      return;
    }

    loadListMetas(user, db)
      .then((lists) => {
        cachedLists = lists;
        return db
          .collection("mll_profiles")
          .doc(user.id)
          .collection("video_bookmarks")
          .orderBy("added_at", "desc")
          .limit(400)
          .get();
      })
      .then(async (snap) => {
        if (!hostEl()) return;
        const showVidLike = true;
        /** @type {Map<string, { meta: { id: string; name: string; visibility: string; list_order: number }; items: { docId: string; title: string; url: string; org: string; sort: number; added: string; liked_by?: Record<string, boolean> }[] }>} */
        const grouped = new Map();
        for (const L of cachedLists) {
          grouped.set(L.id, { meta: { ...L, list_order: Number(L.list_order) || 0 }, items: [] });
        }
        snap.forEach((doc) => {
          const d = doc.data() || {};
          const lid = inferListIdFromDoc(doc.id, d);
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
          const url = String(d.url || "").trim();
          const title = String(d.event_title || "").trim() || url || "動画";
          const org = String(d.org_team || "").trim();
          const si = Number(d.sort_index);
          grouped.get(lid).items.push({
            docId: doc.id,
            title,
            url,
            org,
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
          p.textContent = "まだありません。検索結果のカードから「マイリストに追加」で追加できます。";
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
          renameBtn.title = "リストの表示名を変更";
          renameBtn.addEventListener("click", () => {
            const nv = window.prompt("リスト名", block.meta.name);
            if (nv == null) return;
            void renameVideoList(block.meta.id, nv);
          });
          const upList = document.createElement("button");
          upList.type = "button";
          upList.className = "btn-reset-search mll-mylist-list-tool-btn";
          upList.textContent = "↑";
          upList.title = "リストの表示順を上へ";
          upList.addEventListener("click", () => void moveVideoListOrder(block.meta.id, -1));
          const downList = document.createElement("button");
          downList.type = "button";
          downList.className = "btn-reset-search mll-mylist-list-tool-btn";
          downList.textContent = "↓";
          downList.title = "リストの表示順を下へ";
          downList.addEventListener("click", () => void moveVideoListOrder(block.meta.id, 1));
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
                await updateListVisibility(block.meta.id, next);
                if (next === "public") {
                  setMsg(
                    "リストを公開にしました。シェアしたリンクを他の方が見られるようにするには、プロフィールの公開範囲で「大会動画マイリスト」も公開にしてください。",
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
            const profHash = `#profile?uid=${encodeURIComponent(uid)}&tab=videos&mylist=${encodeURIComponent(block.meta.id)}`;
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
            if (it.org) {
              const sub = document.createElement("p");
              sub.className = "mll-mylist-item-meta";
              sub.textContent = it.org;
              main.appendChild(sub);
            }
            appendMyVideoBmLike(main, it, showVidLike);
            const ord = document.createElement("div");
            ord.className = "mll-mylist-item-order";
            const upIt = document.createElement("button");
            upIt.type = "button";
            upIt.className = "btn-reset-search mll-mylist-order-btn";
            upIt.textContent = "↑";
            upIt.title = "このリスト内で上へ";
            upIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveVideoBookmarkOrder(it.docId, block.meta.id, -1);
            });
            const downIt = document.createElement("button");
            downIt.type = "button";
            downIt.className = "btn-reset-search mll-mylist-order-btn";
            downIt.textContent = "↓";
            downIt.title = "このリスト内で下へ";
            downIt.addEventListener("click", (ev) => {
              ev.preventDefault();
              void moveVideoBookmarkOrder(it.docId, block.meta.id, 1);
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

  window.MarchinZVideoMylist = {
    normalizeUrl: normalizeBookmarkUrl,
    urlKey,
    hasUrl: hasUrlAnywhere,
    hasUrlInList,
    refreshCache,
    addRow: openAddDialog,
    addRowToList,
    openAddDialog,
    renderList,
    requestLoginThenAdd,
    createList,
    renameList: renameVideoList,
    moveListOrder: moveVideoListOrder,
    moveBookmarkOrder: moveVideoBookmarkOrder,
    DEFAULT_LIST_ID,
  };

  window.addEventListener("mll-auth-changed", async (ev) => {
    const user = ev.detail?.user || null;
    let row = null;
    if (user?.id) {
      if (pendingRowPlain) {
        row = pendingRowPlain;
        pendingRowPlain = null;
        try {
          sessionStorage.removeItem(SS_INTENT_MYLIST_ROW);
        } catch {
          //
        }
      } else {
        try {
          const raw = sessionStorage.getItem(SS_INTENT_MYLIST_ROW);
          if (raw) {
            sessionStorage.removeItem(SS_INTENT_MYLIST_ROW);
            row = JSON.parse(raw);
          }
        } catch {
          row = null;
        }
      }
    }
    if (user?.id && row) {
      await ensureDefaultList(user, getDb());
      cachedLists = await loadListMetas(user, getDb());
      const listId = await openPicker(row);
      if (listId) {
        const ok = await addRowToList(row, listId);
        if (!ok) {
          setMsg("マイリストへの保存に失敗しました。ネットワークや Firebase の設定を確認し、もう一度お試しください。", true);
        }
      }
    }
    await refreshCache();
  });

  window.addEventListener("hashchange", () => {
    if (getUser()?.id) return;
    const h = location.hash.replace(/^#/, "");
    if (h === "signup" || h === "login") return;
    pendingRowPlain = null;
    try {
      sessionStorage.removeItem(SS_INTENT_MYLIST_ROW);
    } catch {
      //
    }
  });

  window.addEventListener("marchinz-like-show-changed", () => {
    window.MarchinZVideoMylist?.renderList?.();
  });

  void refreshCache();
})();
