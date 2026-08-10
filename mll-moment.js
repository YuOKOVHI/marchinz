/**
 * コミュニティ「モーメント」タブ — MarchinZ Moment（常時公開・短投稿・写真最大4枚）
 */
(() => {
  const LIMIT = 48;
  const MAX_BODY = 400;
  const MAX_PHOTOS = 4;
  const FEED_SUMMARY_TEXT = `更新が新しい順 · 最大 ${LIMIT} 件を表示しています`;
  const AVATAR_FALLBACK = "logo/marchinz-logo.png";

  /** @type {boolean} */
  let busy = false;
  /** @type {string} */
  let searchQuery = "";
  /** @type {{ uid: string; momentId: string; data: Record<string, unknown>; _author?: { name: string; avatar: string } }[]} */
  let cachedRows = [];

  /** @param {unknown} raw @returns {string[]} */
  function userPhotoUrls(raw) {
    return window.MarchinZDefaultAssets?.normalizeNotePhotoUrls?.(raw, MAX_PHOTOS) || [];
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function rnd() {
    return Math.random().toString(36).slice(2, 10);
  }

  /** @param {HTMLDialogElement|null|undefined} dialog */
  function showMomentDialog(dialog) {
    if (!dialog) return;
    // TOPから開くと、dialogの元位置はhiddenなMomentタブの内側にある。
    // 非表示祖先の中でshowModalしてもSafariでは見えないため、表示直前にbody直下へ移す。
    if (dialog.closest("[hidden]")) document.body.appendChild(dialog);
    dialog.removeAttribute("hidden");
    try {
      if (!dialog.open) dialog.showModal();
    } catch (e) {
      console.warn("[MarchinZ] moment dialog showModal", e);
      dialog.setAttribute("open", "");
    }
  }

  /* ★ 入力が残ったままの Moment 作成ダイアログを閉じてよいか(2026-08-06)。
     背景タップ・ESC・×・キャンセルのどこから閉じても同じ確認を通す。
     判定関数は openCompose が dialog._mlmComposeDirty に載せる
     (Moment に下書き保存は無いので、閉じる=破棄) */
  function confirmMomentComposeDiscard(dialog) {
    const dirty = typeof dialog?._mlmComposeDirty === "function" && dialog._mlmComposeDirty();
    return !dirty || window.confirm("入力中の内容は保存されません。閉じてよろしいですか？");
  }

  /** @param {HTMLDialogElement|null|undefined} dialog */
  function hideMomentDialog(dialog) {
    if (!dialog) return;
    try {
      if (dialog.open) dialog.close();
    } catch {
      //
    }
    dialog.setAttribute("hidden", "");
    dialog.removeAttribute("open");
  }

  function rawInputMaxBytes() {
    return window.MarchinZImage?.RAW_INPUT_MAX_BYTES || 20 * 1024 * 1024;
  }

  /** @param {File} file @returns {Promise<Blob>} */
  async function compressImage(file) {
    const mi = window.MarchinZImage;
    if (!mi?.compressForUpload) {
      throw new Error("画像圧縮モジュールが読み込まれていません。ページを再読み込みしてください。");
    }
    return mi.compressForUpload(file, {
      maxSizeMB: 0.35,
      maxWidthOrHeight: 1280,
      useWebWorker: false,
      initialQuality: 0.8,
    });
  }

  /** @param {Blob} blob @param {string} name */
  function blobToJpegFile(blob, name) {
    const base = String(name || "photo").replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  }

  /** @param {FirebaseStorage.Storage} storage @param {string} uid @param {string} momentId @param {Blob[]} blobs @param {(n: number, total: number) => void} [onStep] */
  async function uploadMomentJpegs(storage, uid, momentId, blobs, onStep) {
    const out = [];
    const doneRefs = [];
    try {
      for (let i = 0; i < blobs.length; i += 1) {
        onStep?.(i + 1, blobs.length);
        const blob = blobs[i];
        const path = `mll_moment_media/${uid}/${momentId}_${Date.now()}_${i}_${rnd()}.jpg`;
        const ref = storage.ref(path);
        await ref.put(blob, { contentType: "image/jpeg", cacheControl: "public,max-age=31536000" });
        doneRefs.push(ref);
        out.push(await ref.getDownloadURL());
      }
    } catch (e) {
      /* ★ 途中失敗でアップ済み分を残さない(2026-08-06)。3枚目で失敗すると
         1〜2枚目が Storage に孤児として残り、誰からも参照されないまま
         容量を食い続けていた。消してから投げ直す(削除の失敗は握る) */
      await Promise.all(doneRefs.map((r) => r.delete().catch(() => {})));
      throw e;
    }
    return out;
  }

  function excerptBody(raw, maxLen = 120) {
    const t = String(raw ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
    return t.length >= maxLen ? `${t}…` : t || "（本文なし）";
  }

  /** @returns {HTMLElement|null} */
  function container() {
    return document.getElementById("mlm-feed-cards");
  }

  /** @returns {HTMLElement|null} */
  function msgEl() {
    return document.getElementById("mlm-feed-msg");
  }

  /** @returns {HTMLInputElement|null} */
  function searchEl() {
    return /** @type {HTMLInputElement|null} */ (document.getElementById("mlm-feed-search"));
  }

  /** @returns {FirebaseFirestore.Firestore|null} */
  function getDb() {
    try {
      return window.MLL_AUTH?.getDb?.() || null;
    } catch {
      return null;
    }
  }

  function normLikedBy(raw) {
    const o = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) o[k] = true;
    }
    return o;
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string[]} uids
   */
  async function loadProfilesMinimal(db, uids) {
    /** @type {Map<string, { name: string; avatar: string; hide: boolean }>} */
    const out = new Map();
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const snap = await db.collection("mll_profiles").doc(uid).get();
          if (!snap.exists) {
            out.set(uid, { name: "ユーザー", avatar: "", hide: false });
            return;
          }
          const d = snap.data() || {};
          const wd = Boolean(d.withdrawn);
          const bn = Boolean(d.banned);
          const name =
            wd || bn ? "退会ユーザー" : String(d.display_name ?? "").trim() || "ユーザー";
          out.set(uid, {
            name,
            avatar: String(d.avatar_url ?? "").trim(),
            hide: wd || bn,
          });
        } catch {
          out.set(uid, { name: "ユーザー", avatar: "", hide: false });
        }
      }),
    );
    return out;
  }

  function renderEmpty(root, text) {
    root.replaceChildren();
    const p = document.createElement("p");
    p.className = "mln-feed-empty";
    p.textContent = text;
    root.appendChild(p);
  }

  /**
   * @param {{ uid: string; momentId: string; data: Record<string, unknown>; _author?: { name: string; avatar: string } }} row
   */
  function rowMatchesSearch(row) {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return true;
    const author = String(row._author?.name || "").toLowerCase();
    const body = String(row.data.body || "").toLowerCase();
    return author.includes(needle) || body.includes(needle);
  }

  /**
   * @param {HTMLElement} host
   * @param {Record<string, unknown>} data
   */
  function appendFeedCover(host, data) {
    const DA = window.MarchinZDefaultAssets;
    const cover =
      DA?.noteCoverUrl?.(data.photo_urls, data.cover_photo_index) ||
      userPhotoUrls(data.photo_urls)[0] ||
      DA?.noteThumbnailDefault?.() ||
      "img/defaults/marchinznote_d.jpg";
    const wrap = document.createElement("div");
    wrap.className = "mln-feed-card-cover";
    const mi = window.MarchinZImage;
    if (mi?.appendProtectedPhoto) {
      mi.appendProtectedPhoto(wrap, {
        src: cover,
        alt: "",
        classNameImg: "mln-feed-card-cover-img",
        loading: "lazy",
      });
    } else {
      const img = document.createElement("img");
      img.className = "mln-feed-card-cover-img";
      img.src = cover;
      img.alt = "";
      img.loading = "lazy";
      wrap.appendChild(img);
    }
    host.appendChild(wrap);
  }

  /**
   * @param {HTMLElement} titleRow
   * @param {{ uid: string; momentId: string; data: Record<string, unknown> }} row
   */
  function appendFeedLike(titleRow, row) {
    const d = row.data;
    const me = window.MLL_AUTH?.getUser?.();
    const lb = normLikedBy(d.liked_by);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    const likeWrap = document.createElement("div");
    likeWrap.className = "mz-inline-like-host";
    window.MarchinZEngageUi?.buildLikeRow(likeWrap, {
      liked,
      count: cnt,
      onClick: async () => {
        const db = getDb();
        if (!db || !window.MarchinZMomentActions?.toggleLike) return;
        const saved = await window.MarchinZMomentActions.toggleLike(db, row.uid, row.momentId);
        if (saved) {
          row.data = saved;
          paintCards();
        }
      },
      showLoginHint: !me?.id,
    });
    titleRow.appendChild(likeWrap);
  }

  /**
   * @param {HTMLElement} engage
   * @param {{ uid: string; momentId: string; data: Record<string, unknown> }} row
   */
  function appendFeedEngage(engage, row) {
    const me = window.MLL_AUTH?.getUser?.();
    if (me?.id && me.id !== row.uid && window.MarchinZMomentActions?.buildReportMenu) {
      engage.appendChild(
        window.MarchinZMomentActions.buildReportMenu(
          row.uid,
          row.momentId,
          excerptBody(row.data.body, 80),
        ),
      );
    }
  }

  /**
   * @param {{ uid: string; momentId: string; data: Record<string, unknown> }} row
   * @param {{ name: string; avatar: string }} author
   */
  function buildCardEl(row, author) {
    const d = row.data;
    const bodyExcerpt = excerptBody(d.body, 160);
    const photoUrls = userPhotoUrls(d.photo_urls);

    const art = document.createElement("article");
    art.className = "mln-feed-card mln-feed-card--openable mlm-feed-card";
    if (photoUrls.length) art.classList.add("mln-feed-card--media", "mlm-feed-card--with-photo");
    art.tabIndex = 0;
    art.setAttribute("role", "button");
    art.setAttribute("aria-label", `${bodyExcerpt} の詳細を開く`);

    const cardBody = document.createElement("div");
    cardBody.className = "mln-feed-card-body";

    if (photoUrls.length) {
      appendFeedCover(cardBody, d);
    }

    const head = document.createElement("div");
    head.className = "mln-feed-card-head";

    const av = document.createElement("img");
    av.className = "mln-feed-card-head-avatar";
    av.alt = "";
    av.width = 40;
    av.height = 40;
    av.loading = "lazy";
    av.src = author.avatar || AVATAR_FALLBACK;
    head.appendChild(av);

    const meta = document.createElement("div");
    meta.className = "mln-feed-card-head-meta";
    const nameEl = document.createElement("span");
    nameEl.className = "mln-feed-card-author";
    nameEl.textContent = author.name;
    meta.appendChild(nameEl);
    const updated = String(d.updated_at || d.created_at || "").trim();
    if (updated) {
      const dateEl = document.createElement("span");
      dateEl.className = "mln-feed-card-head-date";
      dateEl.textContent = updated.slice(0, 10).replace(/-/g, "/");
      meta.appendChild(dateEl);
    }
    head.appendChild(meta);
    cardBody.appendChild(head);

    const titleRow = document.createElement("div");
    titleRow.className = "mln-feed-card-title-row mz-title-like-row mlm-feed-card-body-row";
    const textEl = document.createElement("p");
    textEl.className = "mlm-feed-card-text mln-feed-card-title";
    textEl.textContent = bodyExcerpt;
    titleRow.appendChild(textEl);
    appendFeedLike(titleRow, row);
    cardBody.appendChild(titleRow);

    const engage = document.createElement("div");
    engage.className = "mln-feed-card-engage";
    appendFeedEngage(engage, row);
    cardBody.appendChild(engage);

    art.appendChild(cardBody);

    const open = () => void openViewer({ uid: row.uid, momentId: row.momentId });
    art.addEventListener("click", (ev) => {
      if (ev.target instanceof Element && ev.target.closest("a, button, .community-like-btn, summary")) return;
      open();
    });
    art.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open();
      }
    });

    return art;
  }

  function paintCards() {
    const root = container();
    if (!root) return;
    const filtered = cachedRows.filter((r) => rowMatchesSearch(r));
    if (!filtered.length) {
      renderEmpty(
        root,
        searchQuery.trim()
          ? "検索に一致する MarchinZ Moment はありません。"
          : "まだ MarchinZ Moment が投稿されていません。",
      );
      return;
    }
    const frag = document.createDocumentFragment();
    for (const row of filtered) {
      const p = row._author || { name: "ユーザー", avatar: "" };
      frag.appendChild(buildCardEl(row, p));
    }
    root.replaceChildren(frag);
  }

  /**
   * TOP と Moment 一覧で同じ公開判定を使う。凍結・退会プロフィールはここで除外する。
   * @param {number} [limit]
   * @returns {Promise<{ uid: string; momentId: string; data: Record<string, unknown>; _author: { name: string; avatar: string } }[]>}
   */
  async function loadLatestPublic(limit = LIMIT) {
    const db = getDb();
    if (!db) return [];
    const n = Math.max(1, Math.min(LIMIT, Number(limit) || LIMIT));
    // Firestore Rules はフィルターではない。公開一覧はクエリ自体を public に限定する。
    // これが無いと、他人の非公開文書を含み得る collectionGroup 問い合わせ全体が拒否される。
    const snap = await db
      .collectionGroup("moments")
      .where("visibility", "==", "public")
      .orderBy("updated_at", "desc")
      .limit(n)
      .get();
    const rowsRaw = [];
    snap.forEach((doc) => {
      const pref = doc.ref.parent && doc.ref.parent.parent;
      const uid =
        pref && pref.id && typeof pref.path === "string" && pref.path.startsWith("mll_profiles/")
          ? pref.id
          : null;
      if (!uid || !doc.id) return;
      const data = doc.data() || {};
      if (String(data.visibility || "") !== "public") return;
      rowsRaw.push({ uid, momentId: doc.id, data });
    });
    const pmap = await loadProfilesMinimal(db, [...new Set(rowsRaw.map((r) => r.uid))]);
    return rowsRaw
      .filter((r) => !pmap.get(r.uid)?.hide)
      .map((r) => ({
        ...r,
        _author: pmap.get(r.uid) || { name: "ユーザー", avatar: "" },
      }));
  }

  async function refresh() {
    const root = container();
    const msg = msgEl();
    if (!root) return;
    if (busy) return;
    const redirectPending = Boolean(window.MLL_AUTH?.isRedirectPending?.());
    const db = getDb();
    if (!db || !window.firebase?.firestore) {
      if (redirectPending) {
        if (msg) {
          msg.textContent = "読み込み中…";
          msg.hidden = false;
        }
        return;
      }
      if (msg) {
        msg.textContent =
          "データに接続できません。Firebase 設定とネットワークを確認してください。";
        msg.hidden = false;
      }
      renderEmpty(root, "一覧を読み込めません。auth-config.js と Firebase を確認してください。");
      return;
    }

    busy = true;
    if (msg) {
      msg.textContent = FEED_SUMMARY_TEXT;
      msg.hidden = false;
    }
    root.replaceChildren();

    try {
      cachedRows = await loadLatestPublic(LIMIT);

      paintCards();
      if (msg) msg.textContent = FEED_SUMMARY_TEXT;
    } catch (e) {
      const code = typeof e?.code === "string" ? e.code : "";
      console.warn("[MarchinZ] Moment feed", e);
      cachedRows = [];
      if (msg) {
        msg.textContent =
          code === "failed-precondition"
            ? "インデックスを作成中です。1〜2分待ってからページを再読み込みしてください。"
            : "一覧を読み込めませんでした。しばらくしてから試してください。";
      }
      const pe = document.createElement("p");
      pe.className = "mln-feed-empty mln-feed-empty--err";
      pe.textContent = code
        ? `エラーコード: ${code}`
        : "Firestore のクエリまたはルールを確認してください。";
      root.replaceChildren(pe);
    } finally {
      busy = false;
    }
  }

  let initialLoadDone = false;

  function communityMomentsHashParams() {
    const raw = location.hash.replace(/^#/, "");
    const qi = raw.indexOf("?");
    if (qi === -1) return null;
    const base = raw.slice(0, qi).trim().toLowerCase();
    if (base !== "community/moments") return null;
    const params = new URLSearchParams(raw.slice(qi + 1));
    const momentId = String(params.get("moment") || "").trim();
    const uid = String(params.get("uid") || "").trim();
    if (!momentId || !uid) return null;
    return { momentId, uid };
  }

  async function ensureInitialLoad() {
    if (initialLoadDone) {
      await refresh();
    } else {
      initialLoadDone = true;
      const se = searchEl();
      if (se && !se.dataset.mlmSearchWired) {
        se.dataset.mlmSearchWired = "1";
        se.addEventListener("input", () => {
          searchQuery = String(se.value || "");
          paintCards();
        });
      }
      wireCreateButton();
      wireDialogs();
      await refresh();
    }
    const hp = communityMomentsHashParams();
    if (hp) {
      void openViewer(hp);
    }
  }

  function wireCreateButton() {
    const btn = document.getElementById("mlm-feed-create-btn");
    if (!btn || btn.dataset.mlmWired) return;
    btn.dataset.mlmWired = "1";
    btn.addEventListener("click", () => {
      const me = window.MLL_AUTH?.getUser?.();
      if (!me?.id) {
        window.MarchinZNavigateAuthEntry?.("login");
        return;
      }
      openCompose(null);
    });
    window.addEventListener("mll-auth-changed", () => {
      const user = window.MLL_AUTH?.getUser?.();
      btn.hidden = !user?.id;
    });
    const user = window.MLL_AUTH?.getUser?.();
    btn.hidden = !user?.id;
  }

  /** @param {HTMLElement} shell @param {{ editUrls: string[]; pendingFiles: File[]; coverPhotoIndex: number; err: HTMLElement }} ctx */
  function wirePhotoEditor(shell, ctx) {
    const { err } = ctx;
    let { editUrls, pendingFiles, coverPhotoIndex } = ctx;

    const clampCover = () => {
      const n = editUrls.length + pendingFiles.length;
      if (!n) {
        coverPhotoIndex = 0;
        return;
      }
      coverPhotoIndex = Math.max(0, Math.min(n - 1, coverPhotoIndex));
    };

    const phoRow = document.createElement("div");
    phoRow.className = "eld-photo-edit";
    const phoLabel = document.createElement("label");
    phoLabel.className = "eld-photo-add";
    const fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.accept = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif";
    fileIn.multiple = true;
    fileIn.hidden = true;
    const phoBtn = document.createElement("span");
    phoBtn.className = "eld-photo-add-btn";
    phoBtn.textContent = "写真を追加";
    phoLabel.appendChild(fileIn);
    phoLabel.appendChild(phoBtn);

    const prev = document.createElement("div");
    prev.className = "eld-photo-previews";
    const coverPick = document.createElement("div");
    coverPick.className = "eld-cover-pick";
    coverPick.hidden = true;
    /** @type {string[]} */
    const coverPickBlobUrls = [];

    const revokeCoverPickBlobUrls = () => {
      coverPickBlobUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {
          //
        }
      });
      coverPickBlobUrls.length = 0;
    };

    const paintCoverPick = () => {
      clampCover();
      const n = editUrls.length + pendingFiles.length;
      coverPick.hidden = n === 0;
      revokeCoverPickBlobUrls();
      coverPick.replaceChildren();
      if (!n) return;
      const lab = document.createElement("p");
      lab.className = "eld-cover-pick-label";
      lab.textContent = "表紙を選択";
      coverPick.appendChild(lab);
      const coverNote = document.createElement("p");
      coverNote.className = "eld-cover-pick-note";
      coverNote.textContent =
        "サムネイルをタップして表紙を選びます。一覧・詳細では、選んだ写真の中央を基準に枠へ合わせて表示します（はみ出す部分は表示されません）。";
      coverPick.appendChild(coverNote);
      const grid = document.createElement("div");
      grid.className = "eld-cover-pick-grid";
      const addCoverBtn = (src, idx, alt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "eld-cover-pick-btn" + (idx === coverPhotoIndex ? " is-active" : "");
        const img = document.createElement("img");
        img.src = src;
        img.alt = alt || "";
        btn.appendChild(img);
        if (idx === coverPhotoIndex) {
          const badge = document.createElement("span");
          badge.className = "eld-cover-pick-badge";
          badge.textContent = "表紙";
          btn.appendChild(badge);
        }
        btn.addEventListener("click", () => {
          coverPhotoIndex = idx;
          paintCoverPick();
        });
        grid.appendChild(btn);
      };
      editUrls.forEach((url, idx) => addCoverBtn(url, idx, ""));
      pendingFiles.forEach((file, pi) => {
        const idx = editUrls.length + pi;
        const blobUrl = URL.createObjectURL(file);
        coverPickBlobUrls.push(blobUrl);
        addCoverBtn(blobUrl, idx, file.name);
      });
      coverPick.appendChild(grid);
    };

    const paintThumbs = () => {
      prev.querySelectorAll("img[src^='blob:']").forEach((img) => {
        try {
          URL.revokeObjectURL(img.src);
        } catch {
          //
        }
      });
      prev.replaceChildren();
      editUrls.forEach((url, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "eld-thumb";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "eld-thumb-rm";
        rm.textContent = "×";
        rm.addEventListener("click", () => {
          editUrls.splice(idx, 1);
          if (coverPhotoIndex > idx) coverPhotoIndex -= 1;
          else if (coverPhotoIndex === idx) coverPhotoIndex = 0;
          paintThumbs();
        });
        wrap.append(img, rm);
        prev.appendChild(wrap);
      });
      pendingFiles.forEach((file, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "eld-thumb eld-thumb--pending";
        const u = URL.createObjectURL(file);
        const img = document.createElement("img");
        img.src = u;
        img.alt = file.name;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "eld-thumb-rm";
        rm.textContent = "×";
        rm.addEventListener("click", () => {
          const globalIdx = editUrls.length + idx;
          pendingFiles.splice(idx, 1);
          URL.revokeObjectURL(u);
          if (coverPhotoIndex > globalIdx) coverPhotoIndex -= 1;
          else if (coverPhotoIndex === globalIdx) coverPhotoIndex = 0;
          paintThumbs();
        });
        wrap.append(img, rm);
        prev.appendChild(wrap);
      });
      paintCoverPick();
    };

    fileIn.addEventListener("change", () => {
      void (async () => {
        const incoming = Array.from(fileIn.files || []);
        fileIn.value = "";
        let skippedBig = 0;
        let compressFail = 0;
        const rawMax = rawInputMaxBytes();
        phoBtn.textContent = "圧縮中…";
        phoLabel.style.pointerEvents = "none";
        try {
          for (const f of incoming) {
            if (pendingFiles.length + editUrls.length >= MAX_PHOTOS) break;
            if (!/^image\//i.test(f.type || "")) continue;
            if (f.size > rawMax) {
              skippedBig += 1;
              continue;
            }
            try {
              const blob = await compressImage(f);
              pendingFiles.push(blobToJpegFile(blob, f.name));
            } catch (ce) {
              console.warn(ce);
              compressFail += 1;
            }
          }
        } finally {
          phoBtn.textContent = "写真を追加";
          phoLabel.style.pointerEvents = "";
        }
        if (skippedBig > 0) {
          window.alert("ファイルサイズが大きすぎます。20MB以下の画像を選択してください");
          err.textContent = `画像のうち ${skippedBig} 枚は 1 枚あたり ${Math.floor(rawMax / 1048576)}MB を超えたため追加されませんでした。`;
          err.hidden = false;
        } else if (compressFail > 0) {
          err.textContent = `画像のうち ${compressFail} 枚は圧縮できませんでした。別の画像をお試しください。`;
          err.hidden = false;
        }
        paintThumbs();
      })();
    });

    paintThumbs();
    phoRow.append(phoLabel, prev, coverPick);
    shell.appendChild(phoRow);

    return {
      get editUrls() {
        return editUrls;
      },
      get pendingFiles() {
        return pendingFiles;
      },
      get coverPhotoIndex() {
        clampCover();
        return coverPhotoIndex;
      },
      clearPending() {
        pendingFiles = [];
      },
      setEditUrls(urls) {
        editUrls = urls.slice();
      },
    };
  }

  /**
   * @param {{ uid: string; momentId: string; data?: Record<string, unknown> }|null} existing
   */
  function openCompose(existing) {
    const dialog = /** @type {HTMLDialogElement|null} */ (
      document.getElementById("mlm-moment-compose")
    );
    if (!dialog) return;
    const bodyHost = dialog.querySelector("[data-mlm-compose-body]");
    if (!bodyHost) return;

    const me = window.MLL_AUTH?.getUser?.();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }

    const isEdit = Boolean(existing?.momentId && existing?.data);
    const d = existing?.data || null;
    /** @type {string[]} */
    let editUrls = userPhotoUrls(d?.photo_urls);
    /** @type {File[]} */
    let pendingFiles = [];
    let coverPhotoIndex =
      window.MarchinZDefaultAssets?.normalizeCoverPhotoIndex?.(d?.cover_photo_index, editUrls.length) ??
      0;

    bodyHost.replaceChildren();
    const shell = document.createElement("div");
    shell.className = "eld-shell";

    const visPrompt = document.createElement("div");
    visPrompt.className = "eld-vis-prompt mlm-vis-static";
    const visTitle = document.createElement("p");
    visTitle.className = "eld-vis-prompt-title";
    visTitle.textContent = "公開設定";
    const visNote = document.createElement("p");
    visNote.className = "eld-hint";
    visNote.textContent = "公開（Moment は常に公開されます）";
    visPrompt.append(visTitle, visNote);
    shell.appendChild(visPrompt);

    const ta = document.createElement("textarea");
    ta.className = "eld-body-input";
    ta.maxLength = MAX_BODY;
    ta.rows = 6;
    ta.value = String(d?.body || "");
    ta.setAttribute("aria-label", "本文");
    ta.placeholder = `本文（最大 ${MAX_BODY} 文字）`;
    const hint = document.createElement("p");
    hint.className = "eld-hint";
    hint.textContent = `最大 ${MAX_BODY} 文字 · 写真は合計 ${MAX_PHOTOS} 枚まで。`;
    shell.append(ta, hint);

    const uploadNotice = document.createElement("p");
    uploadNotice.className = "eld-upload-notice";
    const uploadLead = document.createElement("strong");
    uploadLead.textContent = "オリジナル画像はご自身で保管して下さい";
    uploadNotice.appendChild(uploadLead);
    shell.appendChild(uploadNotice);

    const err = document.createElement("p");
    err.className = "eld-error";
    err.hidden = true;

    const photoEditor = wirePhotoEditor(shell, { editUrls, pendingFiles, coverPhotoIndex, err });

    const saveRow = document.createElement("div");
    saveRow.className = "eld-save-row";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-share-search btn-marchinz-spotlight";
    saveBtn.textContent = isEdit ? "保存する" : "投稿する";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-reset-search";
    cancelBtn.textContent = "キャンセル";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-reset-search";
    delBtn.textContent = "削除する";
    delBtn.hidden = !isEdit;
    saveRow.append(saveBtn, cancelBtn);
    if (isEdit) saveRow.appendChild(delBtn);
    shell.append(err, saveRow);
    bodyHost.appendChild(shell);

    const closeDialog = () => hideMomentDialog(dialog);

    /* 破棄確認の判定材料。保存/削除の成功時は null に戻してから閉じる */
    const initialBody = String(d?.body || "").trim();
    const initialUrlCount = editUrls.length;
    dialog._mlmComposeDirty = () =>
      String(ta.value || "").trim() !== initialBody ||
      photoEditor.pendingFiles.length > 0 ||
      photoEditor.editUrls.length !== initialUrlCount;

    cancelBtn.addEventListener("click", () => {
      if (!confirmMomentComposeDiscard(dialog)) return;
      closeDialog();
    });

    saveBtn.addEventListener("click", () => {
      void (async () => {
        err.hidden = true;
        const nextBody = String(ta.value || "").trim().slice(0, MAX_BODY);
        if (!nextBody) {
          err.textContent = "本文を入力してください。";
          err.hidden = false;
          return;
        }
        const db = getDb();
        const storage = window.MLL_AUTH?.getStorage?.();
        if (!db || !storage) {
          err.textContent = "Firebase に接続できません。";
          err.hidden = false;
          return;
        }
        saveBtn.disabled = true;
        try {
          const col = db.collection("mll_profiles").doc(me.id).collection("moments");
          const momentId = isEdit ? existing.momentId : col.doc().id;
          let nextUrls = photoEditor.editUrls.slice();
          if (photoEditor.pendingFiles.length) {
            const blobs = [];
            for (const f of photoEditor.pendingFiles) {
              if (f instanceof Blob && !(f instanceof File)) blobs.push(f);
              else if (f.size <= 400 * 1024 && f.type === "image/jpeg") blobs.push(f);
              else blobs.push(await compressImage(f));
            }
            const uploaded = await uploadMomentJpegs(storage, me.id, momentId, blobs, (n, total) => {
              saveBtn.textContent = `写真をアップロード中… ${n}/${total}`;
            });
            nextUrls = userPhotoUrls(nextUrls.concat(uploaded));
          }
          nextUrls = userPhotoUrls(nextUrls);
          const covIdx = photoEditor.coverPhotoIndex;
          /** @type {Record<string, unknown>} */
          const payload = {
            body: nextBody,
            visibility: "public",
            photo_urls: nextUrls,
            updated_at: isoNow(),
          };
          if (nextUrls.length) {
            payload.cover_photo_index = Math.floor(
              Math.max(0, Math.min(nextUrls.length - 1, covIdx)),
            );
          }
          if (!isEdit) payload.created_at = isoNow();
          if (d?.liked_by && typeof d.liked_by === "object" && !Array.isArray(d.liked_by)) {
            payload.liked_by = d.liked_by;
          }
          await col.doc(momentId).set(payload, { merge: isEdit });
          if (!isEdit) {
            window.MarchinZAdminUgcLog?.recordMoment?.({
              momentId,
              excerpt: nextBody,
              actorUid: me.id,
              actorName: window.MarchinZActorDisplayName?.(me) || "ユーザー",
            });
          }
          window.MarchinZTrackEvent?.("moment_save_success", {
            has_cover: nextUrls.length > 0 ? 1 : 0,
            is_new: isEdit ? 0 : 1,
          });
          window.MarchinZEphemeralMessage?.(isEdit ? "保存しました" : "投稿しました");
          dialog._mlmComposeDirty = null; // 保存済みなので破棄確認は不要
          closeDialog();
          await refresh();
          window.dispatchEvent(new CustomEvent("marchinz-mll-updated", { detail: { userId: me.id } }));
        } catch (e) {
          console.warn(e);
          err.textContent = "保存に失敗しました。しばらくしてから再度お試しください。";
          err.hidden = false;
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? "保存する" : "投稿する"; // アップロード進捗表示から戻す
        }
      })();
    });

    delBtn.addEventListener("click", () => {
      if (!isEdit || !existing) return;
      if (!window.confirm("この Moment を削除しますか？")) return;
      void (async () => {
        const db = getDb();
        if (!db) return;
        delBtn.disabled = true;
        try {
          await db
            .collection("mll_profiles")
            .doc(me.id)
            .collection("moments")
            .doc(existing.momentId)
            .delete();
          window.MarchinZEphemeralMessage?.("削除しました");
          dialog._mlmComposeDirty = null; // 実体を削除済みなので破棄確認は不要
          closeDialog();
          await refresh();
        } catch (e) {
          console.warn(e);
          err.textContent = "削除に失敗しました。";
          err.hidden = false;
        } finally {
          delBtn.disabled = false;
        }
      })();
    });

    showMomentDialog(dialog);
    requestAnimationFrame(() => ta.focus({ preventScroll: true }));
  }

  /**
   * @param {HTMLElement} body
   * @param {{ uid: string; momentId: string; data: Record<string, unknown>; author: { name: string; avatar: string } }} ctx
   */
  function paintViewerBody(body, ctx) {
    const { uid, momentId, data: d, author } = ctx;
    const me = window.MLL_AUTH?.getUser?.();
    const isOwner = Boolean(me?.id && me.id === uid);
    body.replaceChildren();

    const shell = document.createElement("div");
    shell.className = "eld-shell";

    const urls = userPhotoUrls(d.photo_urls);
    if (urls.length) {
      const coverUrl =
        window.MarchinZDefaultAssets?.noteCoverUrl?.(d.photo_urls, d.cover_photo_index) || urls[0];
      const coverWrap = document.createElement("div");
      coverWrap.className = "mln-feed-card-cover mln-note-viewer-cover";
      const mi = window.MarchinZImage;
      if (mi?.appendProtectedPhoto) {
        mi.appendProtectedPhoto(coverWrap, {
          src: coverUrl,
          alt: "",
          classNameImg: "mln-feed-card-cover-img",
          loading: "eager",
        });
      } else {
        const im = document.createElement("img");
        im.className = "mln-feed-card-cover-img";
        im.src = coverUrl;
        im.alt = "";
        coverWrap.appendChild(im);
      }
      shell.appendChild(coverWrap);
    }

    const viewHead = document.createElement("div");
    viewHead.className = "eld-view-head";
    const headRow = document.createElement("div");
    headRow.className = "mln-feed-card-head";
    const av = document.createElement("img");
    av.className = "mln-feed-card-head-avatar";
    av.src = author.avatar || AVATAR_FALLBACK;
    av.alt = "";
    av.width = 40;
    av.height = 40;
    const meta = document.createElement("div");
    meta.className = "mln-feed-card-head-meta";
    const nameEl = document.createElement("span");
    nameEl.className = "mln-feed-card-author";
    nameEl.textContent = author.name;
    meta.appendChild(nameEl);
    headRow.append(av, meta);
    viewHead.appendChild(headRow);

    const titleRow = document.createElement("div");
    titleRow.className = "mln-feed-card-title-row mz-title-like-row";
    const spacer = document.createElement("span");
    spacer.className = "mlm-viewer-like-spacer";
    titleRow.appendChild(spacer);
    const lr = document.createElement("div");
    lr.className = "eld-dialog-like-host mz-inline-like-host";
    const lb = normLikedBy(d.liked_by);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    window.MarchinZEngageUi?.buildLikeRow(lr, {
      liked,
      count: cnt,
      onClick: async () => {
        const db = getDb();
        if (!db) return;
        const saved = await toggleMomentLike(db, uid, momentId);
        if (saved) {
          d.liked_by = saved.liked_by;
          paintViewerBody(body, ctx);
        }
      },
      showLoginHint: !me?.id,
    });
    window.MarchinZEngageUi?.appendInlineLike?.(titleRow, lr) || titleRow.appendChild(lr);
    viewHead.appendChild(titleRow);
    shell.appendChild(viewHead);

    const text = document.createElement("div");
    text.className = "eld-body-text";
    text.textContent = String(d.body || "").trim() || "（本文なし）";
    shell.appendChild(text);

    if (isOwner) {
      const er = document.createElement("div");
      er.className = "eld-view-actions";
      const eb = document.createElement("button");
      eb.type = "button";
      eb.className = "btn-share-search btn-marchinz-spotlight";
      eb.textContent = "編集する";
      eb.addEventListener("click", () => {
        const viewer = document.getElementById("mlm-moment-viewer");
        try {
          viewer?.close();
        } catch {
          //
        }
        openCompose({ uid, momentId, data: d });
      });
      er.appendChild(eb);
      shell.appendChild(er);
    } else if (me?.id) {
      const engage = document.createElement("div");
      engage.className = "mln-feed-card-engage";
      engage.appendChild(buildMomentReportMenu(uid, momentId, excerptBody(d.body, 80)));
      shell.appendChild(engage);
    }

    body.appendChild(shell);
  }

  /**
   * @param {{ uid: string; momentId: string }} opts
   */
  async function openViewer(opts) {
    const dialog = /** @type {HTMLDialogElement|null} */ (
      document.getElementById("mlm-moment-viewer")
    );
    const body = dialog?.querySelector("[data-mlm-viewer-body]");
    if (!dialog || !body) return;

    const uid = String(opts.uid || "").trim();
    const momentId = String(opts.momentId || "").trim();
    if (!uid || !momentId) return;

    body.textContent = "読み込み中…";
    showMomentDialog(dialog);

    const db = getDb();
    if (!db) {
      body.textContent = "データに接続できません。";
      return;
    }
    try {
      const [dSnap, pSnap] = await Promise.all([
        db.collection("mll_profiles").doc(uid).collection("moments").doc(momentId).get(),
        db.collection("mll_profiles").doc(uid).get(),
      ]);
      if (!dSnap.exists) {
        body.textContent = "見つかりませんでした。";
        return;
      }
      const data = dSnap.data() || {};
      const pd = pSnap.exists ? pSnap.data() || {} : {};
      const me = window.MLL_AUTH?.getUser?.();
      if (Boolean(pd.banned) && (!me || me.id !== uid)) {
        body.textContent = "このアカウントは凍結されているため、Moment を表示できません。";
        return;
      }
      const author = {
        name: Boolean(pd.withdrawn)
          ? "退会ユーザー"
          : String(pd.display_name || "").trim() || "ユーザー",
        avatar: String(pd.avatar_url || "").trim(),
      };
      paintViewerBody(body, { uid, momentId, data, author });
    } catch (e) {
      console.warn(e);
      body.textContent = "読み込みに失敗しました。";
    }
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   * @param {string} momentId
   */
  async function toggleMomentLike(db, targetUid, momentId) {
    const user = window.MLL_AUTH?.getUser?.();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return null;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) return null;
    const ref = db.collection("mll_profiles").doc(targetUid).collection("moments").doc(momentId);
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const prev = normLikedBy(data.liked_by);
      const next = { ...prev };
      const wasOn = Boolean(next[user.id]);
      if (wasOn) delete next[user.id];
      else next[user.id] = true;
      txn.update(ref, { liked_by: next });
      if (!wasOn && targetUid !== user.id) {
        const nm = window.MarchinZActorDisplayName?.(user) || "ユーザー";
        const mEnc = encodeURIComponent(String(momentId));
        const uEnc = encodeURIComponent(String(targetUid));
        window.MarchinZPushLikeNotification?.(db, targetUid, {
          kind: "like_moment",
          actor_uid: user.id,
          actor_name: nm,
          target_type: "moment",
          target_id: String(momentId),
          target_title: String(data.body || "").trim().slice(0, 200) || "MarchinZ Moment",
          target_href: `#community/moments?uid=${uEnc}&moment=${mEnc}`,
          thread_root_id: "",
        });
      }
    });
    const snap2 = await ref.get();
    return snap2.exists ? snap2.data() : null;
  }

  /**
   * @param {string} targetUid
   * @param {string} momentId
   * @param {string} excerpt
   */
  function buildMomentReportMenu(targetUid, momentId, excerpt) {
    const onReport = async () => {
      const db = getDb();
      if (!db) return;
      const res = await reportMoment(db, targetUid, momentId, excerpt);
      if (res.message) window.alert(res.message);
    };
    const Eu = window.MarchinZEngageUi;
    if (Eu?.buildReportMenu) return Eu.buildReportMenu({ onReport, label: "通報する" });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "community-report-btn";
    btn.textContent = "通報する";
    btn.addEventListener("click", onReport);
    return btn;
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   * @param {string} momentId
   * @param {string} excerpt
   */
  async function reportMoment(db, targetUid, momentId, excerpt) {
    const me = window.MLL_AUTH?.getUser?.();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return { ok: false, message: "" };
    }
    if (me.id === targetUid) {
      return { ok: false, message: "自分の Moment は通報できません。" };
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("report")) {
      return { ok: false, message: "通報の頻度が高すぎます。しばらく待ってから再度お試しください。" };
    }
    const reason = window.prompt("通報理由を入力してください（任意）。", "");
    if (reason === null) return { ok: false, message: "" };
    const report = {
      reporter_id: me.id,
      target_uid: targetUid,
      moment_id: momentId,
      body_excerpt: String(excerpt || "").trim().slice(0, 120),
      reason: String(reason).trim().slice(0, 500),
      created_at: isoNow(),
    };
    try {
      const id = `mr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await db.collection("mll_moment_reports").doc(id).set(report);
      window.MarchinZTrackEvent?.("report_submit", { target_type: "moment" });
      return { ok: true, message: "通報を受け付けました。運営側で確認します。" };
    } catch (e) {
      console.warn(e);
      return { ok: false, message: "通報の送信に失敗しました。" };
    }
  }

  function wireDialogs() {
    if (document.documentElement.dataset.mlmDialogsWired) return;
    document.documentElement.dataset.mlmDialogsWired = "1";
    for (const id of ["mlm-moment-compose", "mlm-moment-viewer"]) {
      const d = /** @type {HTMLDialogElement|null} */ (document.getElementById(id));
      if (!d) continue;
      d.addEventListener("close", () => {
        d.setAttribute("hidden", "");
        d.removeAttribute("open");
      });
      d.addEventListener("click", (ev) => {
        if (ev.target === d) {
          if (id === "mlm-moment-compose" && !confirmMomentComposeDiscard(d)) return;
          hideMomentDialog(d);
        }
      });
      if (id === "mlm-moment-compose") {
        /* ESC は <dialog> の cancel 経由で閉じる。破棄確認で止められるように */
        d.addEventListener("cancel", (ev) => {
          if (!confirmMomentComposeDiscard(d)) ev.preventDefault();
        });
      }
    }
    document
      .getElementById("mlm-moment-compose")
      ?.querySelector("[data-mlm-compose-close]")
      ?.addEventListener("click", () => {
        const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById("mlm-moment-compose"));
        if (!confirmMomentComposeDiscard(dlg)) return;
        hideMomentDialog(dlg);
      });
    document.getElementById("mlm-moment-viewer")?.querySelector("[data-mlm-viewer-close]")?.addEventListener("click", () => {
      hideMomentDialog(/** @type {HTMLDialogElement|null} */ (document.getElementById("mlm-moment-viewer")));
    });
  }

  window.addEventListener("mll-auth-changed", () => {
    void refresh();
  });

  window.addEventListener("marchinz-mll-updated", () => {
    void refresh();
  });

  window.MarchinZMomentActions = {
    toggleLike: toggleMomentLike,
    buildReportMenu: buildMomentReportMenu,
    reportMoment,
    openViewer,
    openCompose,
  };

  window.MarchinZMomentFeed = {
    refresh,
    ensureInitialLoad,
    openCompose,
    openViewer,
    loadLatestPublic,
  };
})();
