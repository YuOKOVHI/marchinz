(() => {
  const LS_KEY = "marchinz_community_posts_v2";
  const LS_KEY_LEGACY = "marchinz_community_posts_v1";
  const LS_KEY_REPORTS = "marchinz_community_reports_v1";
  const SS_INTENT_COMMUNITY_COMPOSE = "mll_intent_community_compose";
  const SS_COMM_THREAD_FOCUS = "mz_comm_thread_focus";

  /** 話題カテゴリ（表示タブ／投稿フォーム共通） */
  const THEMES = [
    "告知（出演・開催等）",
    "メンバー募集",
    "クラウドファンディング",
    "質問",
    "運営より",
    "その他",
  ];
  const OLD_THEME_MAP = {
    クラファン募集: "クラウドファンディング",
    メンバー募集: "メンバー募集",
    演奏会告知: "告知（出演・開催等）",
    演奏会・出演告知: "告知（出演・開催等）",
    大会開催告知: "告知（出演・開催等）",
    見学募集: "その他",
  };
  const FILTER_ALL = "ALL";
  const MAX_COMMUNITY_IMAGES = 4;

  function rawInputMaxBytes() {
    return window.MarchinZImage?.RAW_INPUT_MAX_BYTES || 20 * 1024 * 1024;
  }

  const WITHDRAWN_NAME = "退会ユーザー";
  const authorProfileCache = new Map();

  let activeDisplayTab = FILTER_ALL;

  const form = document.getElementById("community-form");
  const titleEl = document.getElementById("community-title");
  const contentEl = document.getElementById("community-content");
  const msgEl = document.getElementById("community-msg");
  const listEl = document.getElementById("community-list");
  const submitBtn = document.getElementById("community-submit");
  const composeOverlay = document.getElementById("community-compose-overlay");
  const openComposeBtn = document.getElementById("community-open-compose");
  const feedMsgEl = document.getElementById("community-feed-msg");
  const moderationListEl = document.getElementById("moderation-list");
  const moderationNoteEl = document.getElementById("moderation-note");
  const topicImagesInput = document.getElementById("community-images");
  const topicImagesPreview = document.getElementById("community-images-preview");
  const topicImagesNote = document.getElementById("community-images-note");
  let cachedPosts = [];
  let cachedReports = [];
  let composeOverlayActive = false;
  let modalEscapeAttached = false;
  let feedMsgTimer = null;

  if (
    !form ||
    !titleEl ||
    !contentEl ||
    !listEl ||
    !submitBtn ||
    !composeOverlay ||
    !openComposeBtn ||
    !feedMsgEl
  )
    return;

  const filterTabs = [...document.querySelectorAll("[data-community-filter]")];
  const formThemeTabs = [...document.querySelectorAll("[data-community-form-theme]")];

  function currentUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function authorWithdrawn(userId) {
    if (!userId) return false;
    return Boolean(authorProfileCache.get(String(userId))?.withdrawn);
  }

  function resolveAuthor(post) {
    if (!post) return { name: "ユーザー", avatar: "", withdrawn: false };
    if (authorWithdrawn(post.user_id)) {
      return { name: WITHDRAWN_NAME, avatar: "", withdrawn: true };
    }
    return {
      name: post.user_name || "ユーザー",
      avatar: post.user_avatar || "",
      withdrawn: false,
    };
  }

  async function hydrateAuthorProfilesForPosts(posts) {
    authorProfileCache.clear();
    const db = getDb();
    const ids = new Set(posts.map((p) => p.user_id).filter(Boolean));
    const me = currentUser()?.id;
    if (me) ids.add(me);
    if (!db || !ids.size) return;
    await Promise.all(
      [...ids].map(async (uid) => {
        try {
          const snap = await db.collection("mll_profiles").doc(String(uid)).get();
          const d = snap.data() || {};
          authorProfileCache.set(String(uid), {
            withdrawn: Boolean(d.withdrawn),
            like_show_community: d.like_show_community !== false,
          });
        } catch {
          authorProfileCache.set(String(uid), { withdrawn: false, like_show_community: true });
        }
      }),
    );
  }

  function isAdmin() {
    return Boolean(window.MLL_AUTH?.isAdmin?.());
  }

  function profileFallback(user) {
    return {
      display_name:
        user?.user_metadata?.full_name || user?.user_metadata?.name || "ユーザー",
      avatar_url: user?.user_metadata?.avatar_url || "",
      withdrawn: false,
    };
  }

  function setMsg(text, isError = false) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.color = isError ? "#b71c1c" : "";
  }

  function setFeedMsg(text, isError = false) {
    if (!feedMsgEl) return;
    if (feedMsgTimer) {
      clearTimeout(feedMsgTimer);
      feedMsgTimer = null;
    }
    feedMsgEl.textContent = text || "";
    feedMsgEl.style.color = isError ? "#b71c1c" : "";
    if (text && !isError) {
      feedMsgTimer = window.setTimeout(() => {
        feedMsgEl.textContent = "";
        feedMsgEl.style.color = "";
        feedMsgTimer = null;
      }, 9000);
    }
  }

  function escapeCommunityModals(ev) {
    if (ev.key !== "Escape") return;
    if (!composeOverlayActive) return;
    ev.preventDefault();
    closeComposeOverlay();
  }

  function syncBodyModalLock() {
    const on = composeOverlayActive;
    document.documentElement.classList.toggle("community-compose-active", on);
    document.body.classList.toggle("community-compose-active", on);
  }

  function attachModalEscapeIfNeeded() {
    if (composeOverlayActive && !modalEscapeAttached) {
      document.addEventListener("keydown", escapeCommunityModals, true);
      modalEscapeAttached = true;
    } else if (!composeOverlayActive && modalEscapeAttached) {
      document.removeEventListener("keydown", escapeCommunityModals, true);
      modalEscapeAttached = false;
    }
  }

  function closeComposeOverlay() {
    if (!composeOverlayActive) return;
    composeOverlay.hidden = true;
    composeOverlay.setAttribute("aria-hidden", "true");
    composeOverlayActive = false;
    attachModalEscapeIfNeeded();
    syncBodyModalLock();
    try {
      openComposeBtn.focus();
    } catch {
      //
    }
  }

  function openComposeOverlay() {
    setMsg("", false);
    composeOverlay.hidden = false;
    composeOverlay.setAttribute("aria-hidden", "false");
    composeOverlayActive = true;
    attachModalEscapeIfNeeded();
    syncBodyModalLock();
    requestAnimationFrame(() => {
      const closeBtn = composeOverlay.querySelector(".community-compose-close-btn");
      const u = currentUser();
      if (u?.id && titleEl && !titleEl.disabled) {
        titleEl.focus();
      } else if (closeBtn) {
        closeBtn.focus();
      }
    });
  }

  function normalizeTheme(t) {
    const s = String(t || "").trim();
    if (THEMES.includes(s)) return s;
    if (OLD_THEME_MAP[s]) return OLD_THEME_MAP[s];
    return "その他";
  }

  function normalizePostDoc(raw) {
    const copy = { ...raw };
    if (copy.theme) copy.theme = normalizeTheme(copy.theme);
    const id = String(copy.id || "").trim();
    let threadRoot = String(copy.thread_root_id || "").trim();
    if (!threadRoot) threadRoot = id;
    copy.thread_root_id = threadRoot;
    const isRootPost = Boolean(id && id === threadRoot);
    let pp = String(copy.parent_post_id ?? "").trim();
    if (isRootPost) {
      copy.parent_post_id = "";
    } else if (!pp) {
      copy.parent_post_id = threadRoot;
    } else {
      copy.parent_post_id = pp;
    }
    const imgs = Array.isArray(copy.image_urls) ? copy.image_urls : [];
    copy.image_urls = imgs
      .map((x) => String(x || "").trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, MAX_COMMUNITY_IMAGES);
    const lbSrc =
      copy.liked_by != null &&
      typeof copy.liked_by === "object" &&
      !Array.isArray(copy.liked_by)
        ? copy.liked_by
        : {};
    copy.liked_by = {};
    for (const k of Object.keys(lbSrc)) {
      const uid = String(k || "").trim();
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(uid) && lbSrc[k] === true) copy.liked_by[uid] = true;
    }
    return copy;
  }

  function mapPost(raw) {
    const n = normalizePostDoc(raw || {});
    const id = String(n.id || "");
    let thread_root_id = String(n.thread_root_id || "").trim() || id;
    const isRootPost = Boolean(id && id === thread_root_id);
    let parent_post_id = "";
    if (!isRootPost) {
      parent_post_id = String(n.parent_post_id || "").trim() || thread_root_id;
    }
    return {
      id,
      theme: normalizeTheme(n.theme),
      thread_root_id,
      parent_post_id,
      title: String(n.title || "").trim(),
      content: String(n.content || "").trim(),
      created_at: String(n.created_at || ""),
      updated_at: String(n.updated_at || ""),
      user_id: String(n.user_id || ""),
      user_name: String(n.user_name || "ユーザー"),
      user_avatar: String(n.user_avatar || ""),
      hidden: Boolean(n.hidden),
      hidden_at: String(n.hidden_at || ""),
      hidden_by: String(n.hidden_by || ""),
      hidden_reason: String(n.hidden_reason || ""),
      reported_count: Number(n.reported_count || 0),
      image_urls: Array.isArray(n.image_urls)
        ? n.image_urls
            .map((x) => String(x || "").trim())
            .filter((u) => /^https?:\/\//i.test(u))
            .slice(0, MAX_COMMUNITY_IMAGES)
        : [],
      liked_by: n.liked_by && typeof n.liked_by === "object" && !Array.isArray(n.liked_by) ? { ...n.liked_by } : {},
    };
  }

  function isThreadRoot(p) {
    return Boolean(p?.id && p.id === p.thread_root_id);
  }

  function setTabGroupSelected(buttons, selectedValue, attrName) {
    for (const b of buttons) {
      const sel = String(b.getAttribute(attrName) || "") === selectedValue;
      b.setAttribute("aria-selected", sel ? "true" : "false");
    }
  }

  function selectedFormTheme() {
    const hit = formThemeTabs.find((b) => b.getAttribute("aria-selected") === "true");
    const v = String(hit?.getAttribute("data-community-form-theme") || "").trim();
    return THEMES.includes(v) ? v : THEMES[0];
  }

  /** 旧 LS キーからの読み込み（初回のみ） */
  function loadLocalPosts() {
    const readKey = (key) => {
      try {
        const raw = localStorage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.map((x) => mapPost(normalizePostDoc(x))) : [];
      } catch {
        return [];
      }
    };
    let merged = readKey(LS_KEY);
    if (!merged.length) {
      merged = readKey(LS_KEY_LEGACY).map(mapPost);
    }
    try {
      if (merged.length && !localStorage.getItem(LS_KEY) && localStorage.getItem(LS_KEY_LEGACY)) {
        localStorage.setItem(LS_KEY, JSON.stringify(merged.map(normalizePostDoc)));
      }
    } catch {
      // ignore
    }
    return merged;
  }

  function saveLocalPosts(posts) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(posts));
    } catch {
      // ignore
    }
  }

  function loadLocalReports() {
    try {
      const raw = localStorage.getItem(LS_KEY_REPORTS);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(mapReport) : [];
    } catch {
      return [];
    }
  }

  function saveLocalReports(reports) {
    try {
      localStorage.setItem(LS_KEY_REPORTS, JSON.stringify(reports));
    } catch {
      // ignore
    }
  }

  function mapReport(raw) {
    return {
      id: String(raw.id || ""),
      post_id: String(raw.post_id || ""),
      reporter_id: String(raw.reporter_id || ""),
      reporter_name: String(raw.reporter_name || "ユーザー"),
      reason: String(raw.reason || "").trim(),
      created_at: String(raw.created_at || ""),
    };
  }

  function formatDate(isoLike) {
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(
      2,
      "0",
    )} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function formatDateTimeJa(isoLike) {
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return "";
    const wk = ["日", "月", "火", "水", "木", "金", "土"];
    const mo = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${d.getFullYear()}年${mo}月${day}日（${wk[d.getDay()]}）${hh}:${mi}:${ss}`;
  }

  function hasMeaningfulUpdatedAt(p) {
    const c = Date.parse(String(p?.created_at || ""));
    const u = Date.parse(String(p?.updated_at || ""));
    return Boolean(String(p?.updated_at || "").trim()) && Number.isFinite(u) && Number.isFinite(c) && u > c + 2000;
  }

  function appendDatetimeBlock(hostEl, p) {
    if (!hostEl || !p) return;
    const row = document.createElement("div");
    row.className = "community-datetime-row";
    const t1 = document.createElement("time");
    t1.className = "community-post-datetime";
    t1.dateTime = String(p.created_at || "");
    t1.textContent = `投稿：${formatDateTimeJa(p.created_at)}`;
    row.appendChild(t1);
    if (hasMeaningfulUpdatedAt(p)) {
      const t2 = document.createElement("time");
      t2.className = "community-post-datetime community-post-datetime--updated";
      t2.dateTime = String(p.updated_at || "");
      t2.textContent = `更新：${formatDateTimeJa(p.updated_at)}`;
      row.appendChild(t2);
    }
    hostEl.appendChild(row);
  }

  function appendImageGallery(wrapEl, urls, maskWithdrawn = false) {
    const list = (Array.isArray(urls) ? urls : [])
      .map((x) => String(x || "").trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, MAX_COMMUNITY_IMAGES);
    if (!list.length || !wrapEl) return;
    const fig = document.createElement("div");
    fig.className = "community-post-images";
    fig.setAttribute("role", "group");
    fig.setAttribute("aria-label", maskWithdrawn ? "投稿画像（退会ユーザーのため非表示）" : "投稿画像");
    if (maskWithdrawn) {
      for (let i = 0; i < list.length; i++) {
        const box = document.createElement("div");
        box.className = "community-post-image community-post-image--withdrawn";
        box.setAttribute("role", "img");
        box.setAttribute("aria-label", "退会ユーザーの投稿画像");
        fig.appendChild(box);
      }
    } else {
      const mi = window.MarchinZImage;
      for (const u of list) {
        const slot = document.createElement("div");
        slot.className = "community-post-image-slot";
        if (mi?.appendProtectedPhoto) {
          mi.appendProtectedPhoto(slot, {
            src: u,
            alt: "投稿画像",
            loading: "lazy",
            classNameImg: "community-post-image",
          });
        } else {
          const img = document.createElement("img");
          img.className = "community-post-image";
          img.src = u;
          img.alt = "投稿画像";
          img.loading = "lazy";
          img.decoding = "async";
          img.draggable = false;
          slot.appendChild(img);
        }
        fig.appendChild(slot);
      }
    }
    wrapEl.appendChild(fig);
  }

  function toggleLikeLocal(postId, uid) {
    const posts = loadLocalPosts();
    const next = posts.map((post) => {
      if (post.id !== postId) return post;
      const lb = { ...(post.liked_by && typeof post.liked_by === "object" ? post.liked_by : {}) };
      if (lb[uid]) delete lb[uid];
      else lb[uid] = true;
      return mapPost(normalizePostDoc({ ...post, liked_by: lb }));
    });
    saveLocalPosts(next.map(normalizePostDoc));
  }

  async function toggleCommunityLike(postId) {
    const user = currentUser();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const db = getDb();
    if (!db) {
      toggleLikeLocal(postId, user.id);
      await refreshAll();
      return;
    }
    /** @type {{ author: string; title: string; threadRoot: string } | null} */
    let likeNotify = null;
    try {
      const ref = db.collection("mll_community_posts").doc(postId);
      await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        const prev = data.liked_by && typeof data.liked_by === "object" ? data.liked_by : {};
        const nextLb = { ...prev };
        const wasOn = Boolean(nextLb[user.id]);
        if (wasOn) delete nextLb[user.id];
        else nextLb[user.id] = true;
        txn.update(ref, { liked_by: nextLb });
        if (!wasOn) {
          const author = String(data.user_id || "").trim();
          const title = String(data.title || "投稿").trim().slice(0, 200);
          const threadRoot = String(data.thread_root_id || postId || "").trim().slice(0, 128);
          if (author && author !== user.id) likeNotify = { author, title, threadRoot };
        }
      });
    } catch (e) {
      setMsg(String(e?.message || e || "いいねの更新に失敗しました"), true);
      return;
    }
    if (likeNotify) {
      const nm = String(profileFallback(user).display_name || "ユーザー").trim().slice(0, 120) || "ユーザー";
      window.MarchinZPushLikeNotification?.(db, likeNotify.author, {
        kind: "like_community_post",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "community_post",
        target_id: String(postId),
        target_title: likeNotify.title,
          target_href: "#community/board",
        thread_root_id: likeNotify.threadRoot,
      });
    }
    await refreshAll();
  }

  function appendLikeRow(hostEl, p) {
    if (!hostEl || !p) return;
    const authorId = String(p.user_id || "").trim();
    if (authorId && authorProfileCache.get(authorId)?.like_show_community === false) return;
    const me = currentUser();
    const lb =
      p.liked_by && typeof p.liked_by === "object" && !Array.isArray(p.liked_by) ? p.liked_by : {};
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    const row = document.createElement("div");
    row.className = "community-like-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "community-like-btn" + (liked ? " community-like-btn--on" : "");
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.setAttribute("aria-label", liked ? "いいねを解除" : "いいねする");
    btn.disabled = false;
    btn.addEventListener("click", () => void toggleCommunityLike(p.id));
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

  function storageAvailable() {
    return Boolean(window.MLL_AUTH?.getStorage?.());
  }

  async function uploadCommunityJpegs(storage, uid, blobs) {
    const out = [];
    const rnd = () => Math.random().toString(36).slice(2, 10);
    for (let i = 0; i < blobs.length; i += 1) {
      const blob = blobs[i];
      const path = `mll_community/${uid}/${Date.now()}_${i}_${rnd()}.jpg`;
      const ref = storage.ref(path);
      await ref.put(blob, { contentType: "image/jpeg", cacheControl: "public,max-age=31536000" });
      out.push(await ref.getDownloadURL());
    }
    return out;
  }

  async function buildImageUrlsFromFiles(uid, files) {
    const storage = window.MLL_AUTH.getStorage();
    if (!storage) {
      throw new Error("Firebase Storage が利用できません（プロジェクトの Storage を有効化し storageBucket を設定してください）");
    }
    const mi = window.MarchinZImage;
    if (!mi?.compressForUpload) {
      throw new Error("画像圧縮モジュールが読み込まれていません。ページを再読み込みしてください。");
    }
    const blobs = [];
    for (const file of files) {
      blobs.push(await mi.compressForUpload(file));
    }
    return uploadCommunityJpegs(storage, uid, blobs);
  }

  /**
   * Storage セキュリティルールは `firebase/storage.rules` の例を Firebase Console に適用すること。
   * 管理人の書込許可には Firestore の `mll_privileged_uids/{uid}` 登録が必要。
   */
  function attachImageSlots(inputEl, previewEl) {
    const state = { files: [] };

    function render() {
      if (!previewEl) return;
      previewEl.querySelectorAll("img[src^='blob:']").forEach((img) => {
        try {
          URL.revokeObjectURL(img.src);
        } catch {
          //
        }
      });
      previewEl.innerHTML = "";
      state.files.forEach((file, idx) => {
        const thumb = document.createElement("div");
        thumb.className = "community-image-thumb";
        const url = URL.createObjectURL(file);
        const pic = document.createElement("img");
        pic.src = url;
        pic.alt = `${file.name} のプレビュー`;
        pic.draggable = false;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "community-image-thumb-remove";
        rm.textContent = "削除";
        rm.addEventListener("click", () => {
          state.files = state.files.filter((_, j) => j !== idx);
          URL.revokeObjectURL(url);
          render();
        });
        thumb.appendChild(pic);
        thumb.appendChild(rm);
        previewEl.appendChild(thumb);
      });
    }

    function setFromIncomingMore(fileListLike) {
      const arr = Array.from(fileListLike || []).filter(Boolean);
      const next = state.files.slice();
      const rawMax = rawInputMaxBytes();
      let skippedBig = 0;
      for (const f of arr) {
        if (next.length >= MAX_COMMUNITY_IMAGES) break;
        if (!/^image\//i.test(String(f.type || ""))) continue;
        if (f.size > rawMax) {
          skippedBig += 1;
          continue;
        }
        next.push(f);
      }
      if (skippedBig > 0) {
        window.alert("ファイルサイズが大きすぎます。20MB以下の画像を選択してください");
      }
      state.files = next;
      render();
    }

    if (inputEl) {
      inputEl.addEventListener("change", () => {
        setFromIncomingMore(inputEl.files);
        inputEl.value = "";
      });
    }

    return {
      getFiles: () => state.files.slice(),
      reset: () => {
        state.files = [];
        if (previewEl) {
          previewEl.querySelectorAll("img[src^='blob:']").forEach((img) => {
            try {
              URL.revokeObjectURL(img.src);
            } catch {
              //
            }
          });
          previewEl.innerHTML = "";
        }
        if (inputEl) inputEl.value = "";
      },
      setEnabled(v) {
        if (inputEl) inputEl.disabled = !v;
      },
    };
  }

  const topicImageSlots = attachImageSlots(topicImagesInput, topicImagesPreview);

  function postActionsRow(p, opts) {
    const { includeReplyToggle = false, onReplyToggle } = opts || {};
    const me = currentUser();
    const admin = isAdmin();
    const actions = document.createElement("div");
    actions.className = "community-post-actions";
    const posterWithdrawn = authorWithdrawn(p.user_id);
    let canManage = Boolean(me?.id && (me.id === p.user_id || admin));
    if (posterWithdrawn && me?.id === p.user_id && !admin) {
      canManage = false;
    }
    if (canManage) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-reset-search";
      editBtn.textContent = "編集";
      editBtn.addEventListener("click", () => void editPost(p.id));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-reset-search";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", () => void deletePost(p.id));
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      if (admin) {
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "btn-reset-search";
        toggleBtn.textContent = p.hidden ? "復元" : "非表示";
        toggleBtn.addEventListener("click", () => void toggleHidden(p.id, !p.hidden));
        actions.appendChild(toggleBtn);
      }
    } else {
      const reportBtn = document.createElement("button");
      reportBtn.type = "button";
      reportBtn.className = "btn-reset-search";
      reportBtn.textContent = "通報";
      reportBtn.addEventListener("click", () => void reportPost(p.id));
      actions.appendChild(reportBtn);
    }
    if (includeReplyToggle && me?.id && !window.MLL_AUTH?.isWithdrawn?.()) {
      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "btn-reset-search";
      replyBtn.textContent = "返信する";
      replyBtn.addEventListener("click", () => {
        if (typeof onReplyToggle === "function") onReplyToggle(replyBtn);
      });
      actions.appendChild(replyBtn);
    }
    return actions;
  }

  async function submitReply(threadRoot, parentPost, compose) {
    const user = currentUser();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setMsg("退会済みのアカウントでは返信できません。", true);
      return;
    }
    const textarea = compose?.textarea;
    const imageSlots = compose?.imageSlots;
    const content = String(textarea?.value || "").trim();
    const files = (imageSlots?.getFiles?.() || []).slice(0, MAX_COMMUNITY_IMAGES);
    if (!content && !files.length) {
      setMsg("返信本文を入力するか、画像を1枚以上選んでください。", true);
      return;
    }
    if (files.length && !storageAvailable()) {
      setMsg("画像付き返信には Firebase Storage の利用が必要です。", true);
      return;
    }
    let image_urls = [];
    if (files.length) {
      try {
        image_urls = await buildImageUrlsFromFiles(user.id, files);
      } catch (e) {
        if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
          setMsg("大きすぎる画像は投稿できません。", true);
          return;
        }
        setMsg(String(e?.message || e || "画像のアップロードに失敗しました"), true);
        return;
      }
    }
    if (!content.trim() && !image_urls.length) {
      setMsg("返信本文を入力するか、画像を投稿してください。", true);
      return;
    }
    const profile = await fetchProfile(user);
    const now = new Date().toISOString();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const post = {
      id,
      theme: normalizeTheme(threadRoot.theme),
      thread_root_id: threadRoot.thread_root_id,
      parent_post_id: parentPost.id,
      title: "",
      content: content.trim(),
      image_urls,
      liked_by: {},
      created_at: now,
      updated_at: now,
      user_id: user.id,
      user_name: profile.display_name || "ユーザー",
      user_avatar: profile.avatar_url || "",
    };
    await writePost(post);
    textarea.value = "";
    imageSlots?.reset?.();
    setMsg("返信を投稿しました。");
    await refreshAll();
  }

  function appendReplyComposer(wrapRoot, threadRoot, parentPost) {
    if (currentUser()?.id && window.MLL_AUTH?.isWithdrawn?.()) {
      const note = document.createElement("p");
      note.className = "mll-log-meta";
      note.textContent = "退会済みのアカウントでは返信できません。";
      wrapRoot.appendChild(note);
      return {
        box: note,
        ta: null,
        expand() {},
        imageSlots: null,
      };
    }
    const box = document.createElement("div");
    box.className = "community-reply-compose community-reply-compose--collapsed";
    const ta = document.createElement("textarea");
    ta.className = "community-reply-textarea";
    ta.rows = 3;
    ta.maxLength = 1200;
    ta.placeholder =
      parentPost?.id === threadRoot.id
        ? "この話題に返信…（または画像のみ）"
        : `${String(parentPost?.user_name || "投稿").slice(0, 40)} への返信…`;

    const imgRow = document.createElement("div");
    imgRow.className = "community-reply-images-row";
    const input = document.createElement("input");
    input.type = "file";
    input.className = "community-images-input community-images-input--reply";
    input.accept = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";
    input.multiple = true;
    input.disabled = true;
    const preview = document.createElement("div");
    preview.className = "community-images-preview community-images-preview--reply";
    const replyImageSlots = attachImageSlots(input, preview);
    replyImageSlots.setEnabled(storageAvailable() && Boolean(currentUser()?.id));

    const row = document.createElement("div");
    row.className = "community-reply-actions";
    const send = document.createElement("button");
    send.type = "button";
    send.className = "btn-reset-search";
    send.textContent = "返信を送る";
    send.addEventListener("click", () =>
      void submitReply(threadRoot, parentPost, { textarea: ta, imageSlots: replyImageSlots }),
    );
    row.appendChild(send);
    imgRow.appendChild(input);
    imgRow.appendChild(preview);
    box.appendChild(ta);
    box.appendChild(imgRow);
    box.appendChild(row);
    wrapRoot.appendChild(box);

    const expand = () => {
      box.classList.remove("community-reply-compose--collapsed");
      replyImageSlots.setEnabled(storageAvailable() && Boolean(currentUser()?.id));
      ta.focus();
    };
    return { box, ta, expand, imageSlots: replyImageSlots };
  }

  const MAX_REPLY_NEST_DEPTH = 12;

  function sortPostsChronoAsc(a, b) {
    return String(a.created_at).localeCompare(String(b.created_at));
  }

  function buildRepliesByParent(root, repliesInThread, globalById) {
    const map = new Map();
    const rootId = root.id;
    for (const r of repliesInThread) {
      let pid = String(r.parent_post_id || "").trim();
      const parentOk =
        pid &&
        globalById[pid] &&
        globalById[pid].thread_root_id === rootId;
      if (!parentOk) pid = rootId;
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(r);
    }
    for (const [, arr] of map) arr.sort(sortPostsChronoAsc);
    return map;
  }

  function renderPosts(posts) {
    listEl.innerHTML = "";
    const admin = isAdmin();
    const me = currentUser();
    const visible = posts.filter((p) => !p.hidden || admin);
    const byId = {};
    visible.forEach((p) => {
      byId[p.id] = p;
    });

    let roots = visible.filter(isThreadRoot);
    if (activeDisplayTab !== FILTER_ALL) {
      roots = roots.filter((r) => r.theme === activeDisplayTab);
    }
    roots.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    if (!roots.length) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent =
        activeDisplayTab === FILTER_ALL
          ? "まだ投稿はありません。最初の話題を作成してみましょう。"
          : "このカテゴリの話題はまだありません。";
      listEl.appendChild(li);
      return;
    }

    function renderReplyBranch(parentId, depth, threadRoot, repliesByParent) {
      if (depth > MAX_REPLY_NEST_DEPTH) return null;
      const children = repliesByParent.get(parentId) || [];
      if (!children.length) return null;
      const ul = document.createElement("ul");
      ul.className =
        depth <= 1 ? "community-reply-list" : "community-reply-list community-reply-list--nested";
      for (const r of children) {
        const rli = document.createElement("li");
        rli.className = "community-reply-item";
        rli.style.setProperty("--reply-depth", String(Math.min(depth, 8)));

        const inner = document.createElement("div");
        inner.className = "community-reply-item-inner";

        const rh = document.createElement("div");
        rh.className = "community-post-head community-post-head--reply";
        const rauth = resolveAuthor(r);
        const ra = document.createElement("img");
        ra.className = "community-post-avatar" + (rauth.withdrawn ? " community-post-avatar--withdrawn" : "");
        ra.src =
          rauth.withdrawn
            ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#ffffff"/></svg>')}`
            : rauth.avatar || "logo/marchinz-logo.png";
        ra.alt = rauth.withdrawn ? "" : `${rauth.name} のプロフィール画像`;
        const rtext = document.createElement("div");
        const rn = document.createElement("p");
        rn.className = "mll-log-title";
        rn.textContent = rauth.name;
        rtext.appendChild(rn);
        appendDatetimeBlock(rtext, r);
        rh.appendChild(ra);
        rh.appendChild(rtext);

        inner.appendChild(rh);
        if (String(r.content || "").trim()) {
          const rc = document.createElement("p");
          rc.className = "mll-log-note";
          rc.textContent = r.content;
          inner.appendChild(rc);
        }
        appendImageGallery(inner, r.image_urls, rauth.withdrawn);
        appendLikeRow(inner, r);
        if (r.hidden && admin) {
          const hn = document.createElement("p");
          hn.className = "community-hidden-note";
          hn.textContent = `非表示中（理由: ${r.hidden_reason || "管理者対応"}）`;
          inner.appendChild(hn);
        }
        let replyUi = null;
        inner.appendChild(
          postActionsRow(r, {
            includeReplyToggle: Boolean(me?.id),
            onReplyToggle: () => {
              replyUi?.expand();
            },
          }),
        );

        const nestedUl = renderReplyBranch(r.id, depth + 1, threadRoot, repliesByParent);
        if (nestedUl) inner.appendChild(nestedUl);

        replyUi = appendReplyComposer(inner, threadRoot, r);

        rli.appendChild(inner);
        ul.appendChild(rli);
      }
      return ul;
    }

    for (const root of roots) {
      const li = document.createElement("li");
      li.className = "mll-log-item community-thread";
      li.dataset.mzThreadRoot = String(root.id || "");

      const theme = document.createElement("p");
      theme.className = "community-theme-tag";
      theme.textContent = `【${root.theme}】`;

      const head = document.createElement("div");
      head.className = "community-post-head";
      const roAuth = resolveAuthor(root);
      const avatar = document.createElement("img");
      avatar.className = "community-post-avatar" + (roAuth.withdrawn ? " community-post-avatar--withdrawn" : "");
      avatar.src =
        roAuth.withdrawn
          ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#ffffff"/></svg>')}`
          : roAuth.avatar || "logo/marchinz-logo.png";
      avatar.alt = roAuth.withdrawn ? "" : `${roAuth.name} のプロフィール画像`;
      const headText = document.createElement("div");
      const name = document.createElement("p");
      name.className = "mll-log-title";
      name.textContent = roAuth.name;
      headText.appendChild(name);
      appendDatetimeBlock(headText, root);
      head.appendChild(avatar);
      head.appendChild(headText);

      const title = document.createElement("p");
      title.className = "mll-log-title";
      title.textContent = root.title;

      const threadBody = document.createElement("div");
      threadBody.className = "community-thread-body";
      let rootReplyUi = null;
      const actions = postActionsRow(root, {
        includeReplyToggle: Boolean(me?.id),
        onReplyToggle: () => {
          rootReplyUi?.expand();
        },
      });

      threadBody.appendChild(theme);
      threadBody.appendChild(head);
      threadBody.appendChild(title);
      if (String(root.content || "").trim()) {
        const content = document.createElement("p");
        content.className = "mll-log-note";
        content.textContent = root.content;
        threadBody.appendChild(content);
      }
      appendImageGallery(threadBody, root.image_urls, roAuth.withdrawn);
      appendLikeRow(threadBody, root);
      if (root.hidden && admin) {
        const hiddenNote = document.createElement("p");
        hiddenNote.className = "community-hidden-note";
        hiddenNote.textContent = `非表示中（理由: ${root.hidden_reason || "管理者対応"}）`;
        threadBody.appendChild(hiddenNote);
      }
      threadBody.appendChild(actions);

      const repliesAll = visible.filter((p) => !isThreadRoot(p) && p.thread_root_id === root.id);
      const repliesByParent = buildRepliesByParent(root, repliesAll, byId);
      const topRepliesUl = renderReplyBranch(root.id, 1, root, repliesByParent);
      if (topRepliesUl) threadBody.appendChild(topRepliesUl);

      rootReplyUi = appendReplyComposer(threadBody, root, root);

      li.appendChild(threadBody);
      listEl.appendChild(li);
    }
  }

  async function fetchProfile(user) {
    const fallback = { ...profileFallback(user), withdrawn: false };
    const db = getDb();
    if (!db || !user?.id) return fallback;
    try {
      const snap = await db.collection("mll_profiles").doc(user.id).get();
      if (!snap.exists) return fallback;
      const d = snap.data() || {};
      if (d.withdrawn) {
        return { display_name: WITHDRAWN_NAME, avatar_url: "", withdrawn: true };
      }
      return {
        display_name: d.display_name || fallback.display_name,
        avatar_url: d.avatar_url || fallback.avatar_url,
        withdrawn: false,
      };
    } catch {
      return fallback;
    }
  }

  async function readPosts() {
    const db = getDb();
    if (!db) {
      return loadLocalPosts().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    try {
      const snap = await db.collection("mll_community_posts").orderBy("created_at", "desc").limit(250).get();
      return snap.docs.map((d) => mapPost({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return loadLocalPosts().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
  }

  async function readReports() {
    const db = getDb();
    if (!db) {
      return loadLocalReports().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    try {
      const snap = await db.collection("mll_community_reports").orderBy("created_at", "desc").limit(300).get();
      return snap.docs.map((d) => mapReport({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return loadLocalReports().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
  }

  async function writePost(post) {
    const doc = normalizePostDoc(post);
    const db = getDb();
    if (!db) {
      const posts = loadLocalPosts();
      posts.unshift(mapPost(doc));
      saveLocalPosts(posts.slice(0, 200).map(normalizePostDoc));
      return;
    }
    try {
      await db.collection("mll_community_posts").doc(doc.id).set(doc);
    } catch {
      const posts = loadLocalPosts();
      posts.unshift(mapPost(doc));
      saveLocalPosts(posts.slice(0, 200).map(normalizePostDoc));
    }
  }

  async function updatePost(updated) {
    const doc = normalizePostDoc(updated);
    const db = getDb();
    if (!db) {
      const posts = loadLocalPosts();
      const next = posts.map((p) => (p.id === updated.id ? mapPost(doc) : p));
      saveLocalPosts(next.map(normalizePostDoc));
      return;
    }
    try {
      await db.collection("mll_community_posts").doc(updated.id).set(doc, { merge: true });
    } catch {
      const posts = loadLocalPosts();
      const next = posts.map((p) => (p.id === updated.id ? mapPost(doc) : p));
      saveLocalPosts(next.map(normalizePostDoc));
    }
  }

  async function removeThreadAll(threadRootId) {
    const db = getDb();
    if (!db) {
      saveLocalPosts(loadLocalPosts().filter((p) => p.thread_root_id !== threadRootId));
      return;
    }
    try {
      const snap = await db.collection("mll_community_posts").where("thread_root_id", "==", threadRootId).get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } catch {
      saveLocalPosts(loadLocalPosts().filter((p) => p.thread_root_id !== threadRootId));
    }
  }

  function buildChildrenMapThread(threadRootId) {
    const threadPosts = cachedPosts.filter((p) => p.thread_root_id === threadRootId);
    const byT = Object.fromEntries(threadPosts.map((p) => [p.id, p]));
    const map = new Map();
    for (const p of threadPosts) {
      if (p.id === threadRootId) continue;
      let pid = String(p.parent_post_id || "").trim();
      if (!byT[pid] || byT[pid].thread_root_id !== threadRootId) {
        pid = threadRootId;
      }
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(p);
    }
    return map;
  }

  function collectSubtreeIds(startId, childrenMap) {
    const out = [];
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      out.push(id);
      for (const c of childrenMap.get(id) || []) {
        stack.push(c.id);
      }
    }
    return out;
  }

  async function removePostIds(ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return;
    const db = getDb();
    if (!db) {
      const drop = new Set(uniq);
      saveLocalPosts(loadLocalPosts().filter((p) => !drop.has(p.id)));
      return;
    }
    const CHUNK = 400;
    try {
      for (let i = 0; i < uniq.length; i += CHUNK) {
        const slice = uniq.slice(i, i + CHUNK);
        const batch = db.batch();
        for (const id of slice) {
          batch.delete(db.collection("mll_community_posts").doc(id));
        }
        await batch.commit();
      }
    } catch {
      const drop = new Set(uniq);
      saveLocalPosts(loadLocalPosts().filter((p) => !drop.has(p.id)));
    }
  }

  async function toggleHidden(postId, hide) {
    const me = currentUser();
    if (!isAdmin() || !me?.id) {
      setMsg("この操作は管理者のみ実行できます。", true);
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    let reason = post.hidden_reason || "";
    if (hide) {
      const input = window.prompt("非表示理由を入力してください。", reason);
      if (input === null) return;
      reason = String(input).trim();
    }
    const updated = {
      ...post,
      hidden: hide,
      hidden_at: hide ? new Date().toISOString() : "",
      hidden_by: hide ? me.id : "",
      hidden_reason: hide ? reason : "",
      updated_at: new Date().toISOString(),
    };
    await updatePost(updated);
    setMsg(hide ? "投稿を非表示にしました。" : "投稿を復元しました。");
    await refreshAll();
  }

  async function writeReport(report) {
    const db = getDb();
    if (!db) {
      const reports = loadLocalReports();
      reports.unshift(report);
      saveLocalReports(reports.slice(0, 300));
      return;
    }
    try {
      await db.collection("mll_community_reports").doc(report.id).set(report);
      await db.collection("mll_community_posts").doc(report.post_id).set(
        {
          reported_at: report.created_at,
          reported_count: (window.firebase?.firestore?.FieldValue || {}).increment
            ? window.firebase.firestore.FieldValue.increment(1)
            : 1,
        },
        { merge: true },
      );
    } catch {
      const reports = loadLocalReports();
      reports.unshift(report);
      saveLocalReports(reports.slice(0, 300));
    }
  }

  function resolveModerationHeading(post) {
    const root =
      cachedPosts.find((x) => x.id === post.thread_root_id && isThreadRoot(x)) ||
      (isThreadRoot(post) ? post : null);
    if (!root) {
      const fallback = cachedPosts.find((x) => x.id === post.thread_root_id);
      const th = fallback ? fallback.theme : post.theme;
      const ti = fallback ? fallback.title : post.title;
      return { themeLabel: normalizeTheme(th), titleLabel: ti || "（削除済みの話題）" };
    }
    return { themeLabel: normalizeTheme(root.theme), titleLabel: root.title };
  }

  async function editPost(postId) {
    const me = currentUser();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    if (post.user_id !== me.id && !isAdmin()) return;
    if (post.user_id === me.id && authorWithdrawn(me.id) && !isAdmin()) {
      setMsg("退会済みのアカウントでは編集できません。", true);
      return;
    }
    const reply = !isThreadRoot(post);
    let cleanedTitle = post.title;
    if (!reply) {
      const nextTitle = window.prompt("タイトルを編集してください。", post.title);
      if (nextTitle === null) return;
      cleanedTitle = String(nextTitle).trim();
      if (!cleanedTitle) {
        setMsg("タイトルは空にできません。", true);
        return;
      }
    }
    const nextContent = window.prompt("内容を編集してください。", post.content);
    if (nextContent === null) return;
    const cleanedContent = String(nextContent).trim();
    if (!cleanedContent) {
      setMsg("内容は空にできません。", true);
      return;
    }
    const updated = {
      ...post,
      title: reply ? "" : cleanedTitle,
      content: cleanedContent,
      theme: normalizeTheme(post.theme),
      updated_at: new Date().toISOString(),
    };
    await updatePost(updated);
    setMsg(reply ? "返信を更新しました。" : "投稿を更新しました。");
    await refreshAll();
  }

  async function deletePost(postId) {
    const me = currentUser();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    if (post.user_id !== me.id && !isAdmin()) return;
    if (post.user_id === me.id && authorWithdrawn(me.id) && !isAdmin()) {
      setMsg("退会済みのアカウントでは削除できません。", true);
      return;
    }
    const isRootPost = isThreadRoot(post);
    const childMap = buildChildrenMapThread(post.thread_root_id);
    const subtreeIds = isRootPost ? [] : collectSubtreeIds(post.id, childMap);
    const n = subtreeIds.length;
    const msg = isRootPost
      ? "この話題とすべての返信を削除しますか？"
      : n > 1
        ? `この返信と、その下に続く返信を合わせて ${n} 件を削除しますか？`
        : "この返信を削除しますか？";
    const ok = window.confirm(msg);
    if (!ok) return;
    if (isRootPost) {
      await removeThreadAll(post.thread_root_id);
    } else {
      await removePostIds(subtreeIds);
    }
    setMsg(isRootPost ? "話題を削除しました。" : "返信を削除しました。");
    await refreshAll();
  }

  async function reportPost(postId) {
    const me = currentUser();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const post = cachedPosts.find((x) => x.id === postId);
    if (!post) return;
    if (post.user_id === me.id) {
      setMsg("自分の投稿は通報できません。", true);
      return;
    }
    const reason = window.prompt("通報理由を入力してください（任意）。", "");
    if (reason === null) return;
    const report = {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      post_id: post.id,
      reporter_id: me.id,
      reporter_name:
        me.user_metadata?.full_name || me.user_metadata?.name || "ユーザー",
      reason: String(reason).trim().slice(0, 500),
      created_at: new Date().toISOString(),
    };
    await writeReport(report);
    setMsg("通報を受け付けました。運営側で確認します。");
  }

  function renderModeration() {
    if (!moderationListEl || !moderationNoteEl) return;
    moderationListEl.innerHTML = "";
    if (!isAdmin()) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent = "このページは管理者のみ閲覧できます。";
      moderationListEl.appendChild(li);
      moderationNoteEl.textContent = "管理者ログイン時に通報履歴が表示されます。";
      return;
    }
    const reportByPost = new Map();
    for (const r of cachedReports) {
      if (!reportByPost.has(r.post_id)) reportByPost.set(r.post_id, []);
      reportByPost.get(r.post_id).push(r);
    }
    const rows = cachedPosts
      .map((p) => ({ post: p, reports: reportByPost.get(p.id) || [] }))
      .filter((x) => x.reports.length > 0)
      .sort((a, b) => String(b.reports[0]?.created_at || "").localeCompare(String(a.reports[0]?.created_at || "")));
    moderationNoteEl.textContent = `通報対象投稿: ${rows.length}件 / 通報履歴: ${cachedReports.length}件`;
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent = "現在、確認が必要な通報はありません。";
      moderationListEl.appendChild(li);
      return;
    }
    for (const row of rows) {
      const p = row.post;
      const { themeLabel, titleLabel } = resolveModerationHeading(p);
      const li = document.createElement("li");
      li.className = "mll-log-item";
      const title = document.createElement("p");
      title.className = "mll-log-title";
      let suffix = "";
      if (!isThreadRoot(p)) {
        suffix =
          p.parent_post_id && p.parent_post_id !== p.thread_root_id ? "（ネスト返信）" : "（返信）";
      }
      title.textContent = `【${themeLabel}】${titleLabel}${suffix}`;
      const meta = document.createElement("p");
      meta.className = "mll-log-meta";
      const modAuth = resolveAuthor(p);
      meta.textContent = `投稿者: ${modAuth.name} / 投稿: ${formatDateTimeJa(p.created_at)} / 状態: ${
        p.hidden ? "非表示" : "公開"
      }`;
      const body = document.createElement("p");
      body.className = "moderation-report-note";
      body.textContent = String(p.content || "").trim();
      const note = document.createElement("p");
      note.className = "moderation-report-note";
      note.textContent = row.reports
        .map((r) => `${formatDate(r.created_at)} ${r.reporter_name}: ${r.reason || "理由未記入"}`)
        .join("\n");
      const actions = document.createElement("div");
      actions.className = "community-post-actions";
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "btn-reset-search";
      toggleBtn.textContent = p.hidden ? "復元" : "非表示";
      toggleBtn.addEventListener("click", () => void toggleHidden(p.id, !p.hidden));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-reset-search";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", () => void deletePost(p.id));
      actions.appendChild(toggleBtn);
      actions.appendChild(delBtn);
      li.appendChild(title);
      li.appendChild(meta);
      li.appendChild(body);
      appendImageGallery(li, p.image_urls, modAuth.withdrawn);
      li.appendChild(note);
      li.appendChild(actions);
      moderationListEl.appendChild(li);
    }
  }

  function syncLoginUI(user, profile) {
    const loggedIn = Boolean(user?.id);
    const withdrawn = Boolean(window.MLL_AUTH?.isWithdrawn?.() || profile?.withdrawn);
    const canUseImages = loggedIn && storageAvailable() && !withdrawn;
    submitBtn.disabled = !loggedIn || withdrawn;
    titleEl.disabled = !loggedIn || withdrawn;
    contentEl.disabled = !loggedIn || withdrawn;
    if (openComposeBtn) openComposeBtn.disabled = !loggedIn || withdrawn;
    formThemeTabs.forEach((el) => {
      el.disabled = !loggedIn || withdrawn;
    });
    topicImageSlots?.setEnabled(canUseImages);
    if (topicImagesNote) {
      topicImagesNote.textContent = canUseImages
        ? `任意で最大${MAX_COMMUNITY_IMAGES}枚。アップロード前に長辺最大1024px・目安300KB以下のJPEGへ自動圧縮（元が${Math.floor(rawInputMaxBytes() / 1048576)}MB超は不可）。`
        : "画像付き投稿を使う場合は Firebase で Storage を有効化し auth-config の storageBucket を設定してください（未設定時はテキストのみ）。";
    }

    if (!loggedIn) {
      if (openComposeBtn) openComposeBtn.disabled = false;
      topicImageSlots?.reset?.();
      return;
    }
  }

  function tryFocusStoredCommunityThread() {
    let id = "";
    try {
      id = String(sessionStorage.getItem(SS_COMM_THREAD_FOCUS) || "").trim();
    } catch {
      id = "";
    }
    if (!id || !listEl) return;
    try {
      sessionStorage.removeItem(SS_COMM_THREAD_FOCUS);
    } catch {
      //
    }
    const esc =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    window.requestAnimationFrame(() => {
      const row = listEl.querySelector(`li[data-mz-thread-root="${esc}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "start" });
      row.classList.add("community-thread--highlight");
      window.setTimeout(() => row.classList.remove("community-thread--highlight"), 4200);
    });
  }

  async function refreshAll() {
    const [posts, reports] = await Promise.all([readPosts(), readReports()]);
    cachedPosts = posts;
    cachedReports = reports;
    await hydrateAuthorProfilesForPosts(cachedPosts);
    renderPosts(cachedPosts);
    renderModeration();
    tryFocusStoredCommunityThread();
  }

  filterTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = String(btn.getAttribute("data-community-filter") || "").trim();
      activeDisplayTab = (v === FILTER_ALL || THEMES.includes(v)) ? v : FILTER_ALL;
      setTabGroupSelected(filterTabs, activeDisplayTab, "data-community-filter");
      renderPosts(cachedPosts);
    });
  });

  formThemeTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = String(btn.getAttribute("data-community-form-theme") || "").trim();
      if (!THEMES.includes(v)) return;
      setTabGroupSelected(formThemeTabs, v, "data-community-form-theme");
    });
  });

  openComposeBtn.addEventListener("click", () => {
    if (!currentUser()?.id) {
      try {
        sessionStorage.setItem(SS_INTENT_COMMUNITY_COMPOSE, "1");
      } catch {
        //
      }
      window.MarchinZNavigateAuthEntry?.("signup", "community_compose");
      return;
    }
    setFeedMsg("", false);
    openComposeOverlay();
  });

  composeOverlay.addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-community-compose-close]")) return;
    closeComposeOverlay();
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const user = currentUser();
    if (!user?.id) {
      try {
        sessionStorage.setItem(SS_INTENT_COMMUNITY_COMPOSE, "1");
      } catch {
        //
      }
      window.MarchinZNavigateAuthEntry?.("signup", "community_submit");
      return;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setMsg("退会済みのアカウントでは投稿できません。", true);
      return;
    }
    const title = String(titleEl.value || "").trim();
    const content = String(contentEl.value || "").trim();
    const files = topicImageSlots.getFiles().slice(0, MAX_COMMUNITY_IMAGES);
    if (!title) {
      setMsg("タイトルを入力してください。", true);
      return;
    }
    if (!content && !files.length) {
      setMsg("本文を入力するか、画像を1枚以上選んでください。", true);
      return;
    }
    if (files.length && !storageAvailable()) {
      setMsg("画像付き投稿には Firebase Storage が必要です。", true);
      return;
    }
    submitBtn.disabled = true;
    let image_urls = [];
    try {
      if (files.length) image_urls = await buildImageUrlsFromFiles(user.id, files);
      if (!content.trim() && !image_urls.length) {
        setMsg("本文または画像を投稿してください。", true);
        return;
      }
      const p = await fetchProfile(user);
      const now = new Date().toISOString();
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const post = {
        id,
        theme: normalizeTheme(selectedFormTheme()),
        thread_root_id: id,
        title,
        content: content.trim(),
        image_urls,
        liked_by: {},
        created_at: now,
        updated_at: now,
        user_id: user.id,
        user_name: p.display_name || "ユーザー",
        user_avatar: p.avatar_url || "",
      };
      await writePost(post);
      form.reset();
      topicImageSlots.reset();
      const firstFt = THEMES[0];
      setTabGroupSelected(formThemeTabs, firstFt, "data-community-form-theme");
      setMsg("");
      closeComposeOverlay();
      setFeedMsg("話題を投稿しました。");
      await refreshAll();
    } catch (e) {
      if (String(e?.message || "") === window.MarchinZImage?.ERR_TOO_LARGE) {
        setMsg("大きすぎる画像は投稿できません。", true);
      } else {
        setMsg(String(e?.message || e || "投稿に失敗しました"), true);
      }
    } finally {
      const w = Boolean(window.MLL_AUTH?.isWithdrawn?.());
      submitBtn.disabled = !Boolean(currentUser()?.id) || w;
    }
  });

  window.addEventListener("mll-auth-changed", async (ev) => {
    const user = ev.detail?.user || null;
    if (user?.id) {
      let wantCompose = false;
      try {
        wantCompose = sessionStorage.getItem(SS_INTENT_COMMUNITY_COMPOSE) === "1";
      } catch {
        wantCompose = false;
      }
      if (wantCompose) {
        try {
          sessionStorage.removeItem(SS_INTENT_COMMUNITY_COMPOSE);
        } catch {
          //
        }
        const raw = window.location.hash.replace(/^#/, "");
        if (raw === "community") {
          setFeedMsg("", false);
          openComposeOverlay();
        }
      }
    }
    const p = user ? await fetchProfile(user) : profileFallback(null);
    syncLoginUI(user, p);
    await refreshAll();
  });

  window.addEventListener("marchinz-like-show-changed", async () => {
    const user = currentUser();
    const p = user ? await fetchProfile(user) : profileFallback(null);
    syncLoginUI(user, p);
    await refreshAll();
  });

  setTabGroupSelected(filterTabs, FILTER_ALL, "data-community-filter");
  setTabGroupSelected(formThemeTabs, THEMES[0], "data-community-form-theme");

  window.addEventListener("hashchange", () => {
    const raw = window.location.hash.replace(/^#/, "").trim();
    const page = raw.split(/[?&#]/)[0] || "";
    if (page === "community") {
      tryFocusStoredCommunityThread();
      if (currentUser()?.id) {
        try {
          if (sessionStorage.getItem(SS_INTENT_COMMUNITY_COMPOSE) === "1") {
            sessionStorage.removeItem(SS_INTENT_COMMUNITY_COMPOSE);
            setFeedMsg("", false);
            openComposeOverlay();
          }
        } catch {
          //
        }
      }
      return;
    }
    if (composeOverlayActive) closeComposeOverlay();
    if (!currentUser()?.id && page !== "signup" && page !== "login") {
      try {
        sessionStorage.removeItem(SS_INTENT_COMMUNITY_COMPOSE);
      } catch {
        //
      }
    }
  });

  (async () => {
    const user = currentUser();
    const p = user ? await fetchProfile(user) : profileFallback(null);
    syncLoginUI(user, p);
    await refreshAll();
  })();
})();
