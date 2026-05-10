/**
 * プロフィール「MarchinZ Note」タブ（#prof-log-diary-root）— 参加形式登録済みイベントのみ任意作成。
 * 写真最大4枚・本文2000文字・公開/非公開。深いリンク: #profile?tab=logdiary&event=…（MarchinZProfileHashParams）
 */
(() => {
  const MAX_BODY = 2000;
  const MAX_PHOTOS = 4;
  const EVENTS_LIMIT = 100;

  function rawInputMaxBytes() {
    return window.MarchinZImage?.RAW_INPUT_MAX_BYTES || 20 * 1024 * 1024;
  }

  /**
   * @param {File} file
   * @returns {Promise<Blob>}
   */
  async function compressDiaryImage(file) {
    const mi = window.MarchinZImage;
    if (!mi?.compressForUpload) {
      throw new Error("画像圧縮モジュールが読み込まれていません。ページを再読み込みしてください。");
    }
    return mi.compressForUpload(file);
  }

  /** @returns {HTMLElement|null} */
  function q(root, sel) {
    return root ? root.querySelector(sel) : null;
  }

  function rnd() {
    return Math.random().toString(36).slice(2, 10);
  }

  async function uploadDiaryJpegs(storage, uid, eventId, blobs) {
    const out = [];
    for (let i = 0; i < blobs.length; i += 1) {
      const blob = blobs[i];
      const path = `mll_event_diary_media/${uid}/${eventId}_${Date.now()}_${i}_${rnd()}.jpg`;
      const ref = storage.ref(path);
      await ref.put(blob, { contentType: "image/jpeg", cacheControl: "public,max-age=31536000" });
      out.push(await ref.getDownloadURL());
    }
    return out;
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   */
  async function loadAttendanceRows(db, targetUid) {
    const evSnap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(EVENTS_LIMIT).get();
    const rows = [];
    const attendeeSnaps = await Promise.all(
      evSnap.docs.map((d) => d.ref.collection("attendees").doc(targetUid).get()),
    );
    evSnap.docs.forEach((doc, i) => {
      const as = attendeeSnaps[i];
      if (!as.exists) return;
      const st = String(as.data()?.style || "").trim();
      if (!st) return;
      const d = doc.data() || {};
      rows.push({
        eventId: doc.id,
        date: String(d.date || "").trim(),
        title: String(d.title || "").trim(),
        participation_style: st,
      });
    });
    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   */
  async function loadDiaries(db, targetUid) {
    const snap = await db.collection("mll_profiles").doc(targetUid).collection("event_log_diaries").get();
    /** @type {Map<string, any>} */
    const map = new Map();
    snap.forEach((doc) => {
      map.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
    });
    return map;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function buildProfileUrlWithDiary(targetUid, eventId) {
    const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    return `${base}#profile?uid=${encodeURIComponent(targetUid)}&tab=logdiary&event=${encodeURIComponent(eventId)}`;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ targetUid: string; viewerId: string|null; db: FirebaseFirestore.Firestore }} ctx
   */
  function normDiaryLikedBy(raw) {
    const o = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) o[k] = true;
    }
    return o;
  }

  async function render(root, ctx) {
    const { targetUid, viewerId, db } = ctx;
    const likeShowLog = ctx.likeShowLog !== false;
    const isOwner = Boolean(viewerId && viewerId === targetUid);
    const msg = q(root, "[data-eld-msg]");
    if (msg) {
      msg.textContent = "";
      msg.hidden = false;
    }

    let attendance = [];
    /** @type {Map<string, any>} */
    let diaries = new Map();
    try {
      [attendance, diaries] = await Promise.all([loadAttendanceRows(db, targetUid), loadDiaries(db, targetUid)]);
    } catch (e) {
      console.warn(e);
      if (msg) {
        msg.textContent = "MarchinZ Note の読み込みに失敗しました。";
        msg.hidden = false;
      }
      return { diaryCount: 0 };
    }

    if (msg) msg.hidden = true;

    const listHost = q(root, "[data-eld-list]");
    const dialog = /** @type {HTMLDialogElement|null} */ (q(root, "[data-eld-dialog]"));
    if (!listHost || !dialog) return { diaryCount: 0 };

    /** @type {null | { mode: "view"|"edit"; row: any; diary: any|null }} */
    let state = null;

    async function toggleLogDiaryLike(eventId) {
      const user = window.MLL_AUTH?.getUser?.();
      if (!user?.id) {
        window.MarchinZNavigateAuthEntry?.("login");
        return;
      }
      let meta = null;
      try {
        const ref = db.collection("mll_profiles").doc(targetUid).collection("event_log_diaries").doc(eventId);
        await db.runTransaction(async (txn) => {
          const snap = await txn.get(ref);
          if (!snap.exists) return;
          const data = snap.data() || {};
          const prev = normDiaryLikedBy(data.liked_by);
          const next = { ...prev };
          const wasOn = Boolean(next[user.id]);
          if (wasOn) delete next[user.id];
          else next[user.id] = true;
          txn.update(ref, { liked_by: next });
          if (!wasOn && targetUid !== user.id) {
            meta = { title: String(data.event_title || "").trim().slice(0, 200) || "MarchinZ Note" };
          }
        });
      } catch (e) {
        console.warn(e);
        return;
      }
      if (meta) {
        const nm = window.MarchinZActorDisplayName?.(user) || "ユーザー";
        const evId = encodeURIComponent(String(eventId));
        const uEnc = encodeURIComponent(String(targetUid));
        window.MarchinZPushLikeNotification?.(db, targetUid, {
          kind: "like_log_diary",
          actor_uid: user.id,
          actor_name: nm,
          target_type: "log_diary",
          target_id: String(eventId),
          target_title: meta.title,
          target_href: `#profile?uid=${uEnc}&tab=logdiary&event=${evId}`,
          thread_root_id: "",
        });
      }
      try {
        const ref2 = db.collection("mll_profiles").doc(targetUid).collection("event_log_diaries").doc(eventId);
        const snap2 = await ref2.get();
        if (snap2.exists) diaries.set(eventId, { id: eventId, ...snap2.data() });
      } catch {
        //
      }
      renderList();
      if (state?.row?.eventId === eventId && state?.diary) {
        state = { ...state, diary: diaries.get(eventId) || state.diary };
        paintDialog();
      }
    }

    function appendDiaryLikeRow(hostEl, diary, eventId) {
      if (!hostEl || !likeShowLog || !diary) return;
      const me = window.MLL_AUTH?.getUser?.();
      const lb = normDiaryLikedBy(diary.liked_by);
      const cnt = Object.keys(lb).filter((k) => lb[k]).length;
      const liked = Boolean(me?.id && lb[me.id]);
      const row = document.createElement("div");
      row.className = "community-like-row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "community-like-btn" + (liked ? " community-like-btn--on" : "");
      btn.setAttribute("aria-pressed", liked ? "true" : "false");
      btn.setAttribute("aria-label", liked ? "いいねを解除" : "いいねする");
      btn.addEventListener("click", () => void toggleLogDiaryLike(eventId));
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

    function visibleRows() {
      if (isOwner) return attendance;
      return Array.from(diaries.values())
        .filter((d) => String(d.visibility || "public") !== "private")
        .map((d) => ({
          eventId: d.id,
          date: String(d.event_date || "").trim(),
          title: String(d.event_title || "").trim(),
          participation_style: String(d.participation_style || "").trim(),
        }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }

    function renderList() {
      listHost.innerHTML = "";
      const rows = visibleRows();
      if (!rows.length) {
        const p = document.createElement("p");
        p.className = "user-profile-empty";
        p.textContent = isOwner
          ? "イベントで参加形式を登録すると、ここから MarchinZ Note を書けます。"
          : "公開されている MarchinZ Note はまだありません。";
        listHost.appendChild(p);
        return;
      }
      const ul = document.createElement("ul");
      ul.className = "eld-event-list";
      for (const row of rows) {
        const d = diaries.get(row.eventId);
        const li = document.createElement("li");
        li.className = "eld-event-card";
        const head = document.createElement("div");
        head.className = "eld-event-card-head";
        const t = document.createElement("p");
        t.className = "eld-event-card-title";
        t.textContent = row.title || "（無題）";
        const meta = document.createElement("p");
        meta.className = "eld-event-card-meta";
        meta.textContent = `${row.date} · 参加登録: ${row.participation_style}`;
        head.appendChild(t);
        head.appendChild(meta);
        const actions = document.createElement("div");
        actions.className = "eld-event-card-actions";
        if (d) {
          const prev = String(d.body || "").trim().slice(0, 72);
          const pv = document.createElement("p");
          pv.className = "eld-event-card-preview";
          pv.textContent = prev ? `${prev}${String(d.body || "").length > 72 ? "…" : ""}` : "（本文なし）";
          actions.appendChild(pv);
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-share-search btn-marchinz-spotlight eld-open-btn";
        if (!d) {
          btn.textContent = isOwner ? "MarchinZ Note を書く" : "（非公開）";
          btn.disabled = !isOwner;
        } else {
          btn.textContent = isOwner ? "閲覧・編集" : "すべて見る";
        }
        btn.addEventListener("click", () => {
          if (!d && !isOwner) return;
          if (!d && isOwner) state = { mode: "edit", row, diary: null };
          else if (d && isOwner) state = { mode: "view", row, diary: d };
          else state = { mode: "view", row, diary: d };
          openDialog();
        });
        actions.appendChild(btn);
        li.appendChild(head);
        li.appendChild(actions);
        if (d && likeShowLog) {
          const lr = document.createElement("div");
          lr.className = "eld-card-like-host";
          appendDiaryLikeRow(lr, d, row.eventId);
          li.appendChild(lr);
        }
        ul.appendChild(li);
      }
      listHost.appendChild(ul);
    }

    /** @type {string[]} */
    let editUrls = [];
    /** @type {File[]} */
    let pendingFiles = [];

    function syncEditUrlsFromDiary() {
      const d = state?.diary;
      const arr = Array.isArray(d?.photo_urls) ? d.photo_urls.map((x) => String(x || "").trim()).filter(Boolean) : [];
      editUrls = arr.slice(0, MAX_PHOTOS);
      pendingFiles = [];
    }

    function openDialog() {
      if (!state) return;
      if (state.mode === "edit") {
        syncEditUrlsFromDiary();
      } else {
        pendingFiles = [];
      }
      paintDialog();
      try {
        dialog.showModal();
      } catch {
        //
      }
    }

    function closeDialog() {
      try {
        dialog.close();
      } catch {
        //
      }
      state = null;
      pendingFiles = [];
    }

    root._eldCloseDialog = closeDialog;

    function paintDialog() {
      if (!state) return;
      const host = q(dialog, "[data-eld-dialog-body]");
      if (!host) return;
      const xTop = q(dialog, "[data-eld-dialog-close]");
      if (xTop) xTop.onclick = () => closeDialog();
      const { row, diary, mode } = state;
      const d = diary;
      const bodyText = String(d?.body || "");
      const vis =
        d == null
          ? window.MLL_AUTH?.getDefaultLogDiaryVisibility?.() === "private"
            ? "private"
            : "public"
          : d.visibility === "private"
            ? "private"
            : "public";
      const urls = (() => {
        if (mode === "edit") {
          return editUrls.slice();
        }
        const arr = Array.isArray(d?.photo_urls) ? d.photo_urls.map((x) => String(x || "").trim()).filter(Boolean) : [];
        return arr.slice(0, MAX_PHOTOS);
      })();

      host.innerHTML = "";

      const shell = document.createElement("div");
      shell.className = "eld-shell";

      const top = document.createElement("div");
      top.className = "eld-shell-top";
      const h2 = document.createElement("h2");
      h2.className = "eld-shell-heading";
      h2.textContent = "MarchinZ Note";
      const seeAll = document.createElement("button");
      seeAll.type = "button";
      seeAll.className = "eld-shell-seeall";
      seeAll.textContent = "すべて見る";
      seeAll.hidden = urls.length === 0 || urls.length <= 4;
      const gridWrap = document.createElement("div");
      gridWrap.className = "eld-grid-wrap";
      const grid = document.createElement("div");
      grid.className = "eld-photo-grid";
      urls.forEach((u) => {
        const cell = document.createElement("div");
        cell.className = "eld-photo-cell";
        const mi = window.MarchinZImage;
        if (mi?.appendProtectedPhoto) {
          mi.appendProtectedPhoto(cell, { src: u, alt: "", loading: "lazy" });
        } else {
          const im = document.createElement("img");
          im.src = u;
          im.alt = "";
          im.loading = "lazy";
          im.draggable = false;
          cell.appendChild(im);
        }
        grid.appendChild(cell);
      });
      seeAll.addEventListener("click", () => {
        grid.classList.toggle("eld-photo-grid--expanded");
        seeAll.textContent = grid.classList.contains("eld-photo-grid--expanded") ? "折りたたむ" : "すべて見る";
      });
      gridWrap.appendChild(grid);
      top.appendChild(h2);
      top.appendChild(seeAll);
      shell.appendChild(top);

      if (mode === "view" || !isOwner) {
        const text = document.createElement("div");
        text.className = "eld-body-text";
        text.textContent = bodyText || "（本文はまだありません）";
        shell.appendChild(text);
        if (d && likeShowLog) {
          const lr = document.createElement("div");
          lr.className = "eld-dialog-like-host";
          appendDiaryLikeRow(lr, d, row.eventId);
          shell.appendChild(lr);
        }
        if (urls.length) shell.appendChild(gridWrap);
        if (isOwner && d) {
          const er = document.createElement("div");
          er.className = "eld-view-actions";
          const eb = document.createElement("button");
          eb.type = "button";
          eb.className = "btn-share-search btn-marchinz-spotlight";
          eb.textContent = "編集する";
          eb.addEventListener("click", () => {
            state = { mode: "edit", row, diary: d };
            syncEditUrlsFromDiary();
            paintDialog();
          });
          er.appendChild(eb);
          shell.appendChild(er);
        }
      } else {
        const visRadioName = `eld-vis-${row.eventId}`;
        const visPrompt = document.createElement("div");
        visPrompt.className = "eld-vis-prompt";
        if (!d) {
          const lead = document.createElement("p");
          lead.className = "eld-vis-lead";
          lead.textContent =
            "新しい MarchinZ Note です。まず公開範囲を選んでから、本文・写真を入力してください（あとから変更できます）。";
          visPrompt.appendChild(lead);
        }
        const visTitle = document.createElement("p");
        visTitle.className = "eld-vis-prompt-title";
        visTitle.textContent = d ? "この日記の公開範囲" : "この日記を誰に見せますか？";
        visPrompt.appendChild(visTitle);
        const visOpts = document.createElement("div");
        visOpts.className = "eld-vis-options";
        const labPub = document.createElement("label");
        labPub.className = "eld-vis-option";
        const rPub = document.createElement("input");
        rPub.type = "radio";
        rPub.name = visRadioName;
        rPub.value = "public";
        rPub.checked = vis === "public";
        labPub.appendChild(rPub);
        const spPub = document.createElement("span");
        spPub.textContent = "公開（プロフィールから閲覧可）";
        labPub.appendChild(spPub);
        const labPrv = document.createElement("label");
        labPrv.className = "eld-vis-option";
        const rPrv = document.createElement("input");
        rPrv.type = "radio";
        rPrv.name = visRadioName;
        rPrv.value = "private";
        rPrv.checked = vis === "private";
        labPrv.appendChild(rPrv);
        const spPrv = document.createElement("span");
        spPrv.textContent = "非公開（自分のみ）";
        labPrv.appendChild(spPrv);
        visOpts.appendChild(labPub);
        visOpts.appendChild(labPrv);
        visPrompt.appendChild(visOpts);
        shell.appendChild(visPrompt);

        const err = document.createElement("p");
        err.className = "eld-error";
        err.hidden = true;

        const ta = document.createElement("textarea");
        ta.className = "eld-body-input";
        ta.maxLength = MAX_BODY;
        ta.rows = 6;
        ta.value = bodyText;
        ta.setAttribute("aria-label", "本文");
        const hint = document.createElement("p");
        hint.className = "eld-hint";
        hint.textContent = `最大 ${MAX_BODY} 文字 · 写真は合計 ${MAX_PHOTOS} 枚まで。アップロード前に長辺最大 1024px・目安 300KB 以下の JPEG に自動圧縮します（元ファイルが ${Math.floor(rawInputMaxBytes() / 1048576)}MB を超える場合は追加できません）。`;
        shell.appendChild(ta);
        shell.appendChild(hint);

        const uploadNotice = document.createElement("p");
        uploadNotice.className = "eld-upload-notice";
        const uploadLead = document.createElement("strong");
        uploadLead.textContent = "オリジナル写真の保管は、必ずご自身の端末やバックアップで行ってください。";
        uploadNotice.append(
          uploadLead,
          document.createTextNode(
            "システム障害・データ消失・復旧不能、第三者の行為等に起因する損害について、運営は一切の責任を負いません。",
          ),
        );
        shell.appendChild(uploadNotice);

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

        function paintThumbs() {
          prev.querySelectorAll("img[src^='blob:']").forEach((img) => {
            try {
              URL.revokeObjectURL(img.src);
            } catch {
              //
            }
          });
          prev.innerHTML = "";
          const all = [...editUrls];
          all.forEach((url, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "eld-thumb";
            const img = document.createElement("img");
            img.src = url;
            img.alt = "";
            img.draggable = false;
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "eld-thumb-rm";
            rm.textContent = "×";
            rm.addEventListener("click", () => {
              editUrls.splice(idx, 1);
              paintThumbs();
            });
            wrap.appendChild(img);
            wrap.appendChild(rm);
            prev.appendChild(wrap);
          });
          pendingFiles.forEach((file, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "eld-thumb eld-thumb--pending";
            const u = URL.createObjectURL(file);
            const img = document.createElement("img");
            img.src = u;
            img.alt = file.name;
            img.draggable = false;
            const rm = document.createElement("button");
            rm.type = "button";
            rm.className = "eld-thumb-rm";
            rm.textContent = "×";
            rm.addEventListener("click", () => {
              pendingFiles.splice(idx, 1);
              URL.revokeObjectURL(u);
              paintThumbs();
            });
            wrap.appendChild(img);
            wrap.appendChild(rm);
            prev.appendChild(wrap);
          });
        }

        fileIn.addEventListener("change", () => {
          const incoming = Array.from(fileIn.files || []);
          fileIn.value = "";
          let skippedBig = 0;
          const rawMax = rawInputMaxBytes();
          for (const f of incoming) {
            if (pendingFiles.length + editUrls.length >= MAX_PHOTOS) break;
            if (!/^image\//i.test(f.type || "")) continue;
            if (f.size > rawMax) {
              skippedBig += 1;
              continue;
            }
            pendingFiles.push(f);
          }
          if (skippedBig > 0) {
            window.alert("ファイルサイズが大きすぎます。20MB以下の画像を選択してください");
            err.textContent = `画像のうち ${skippedBig} 枚は 1 枚あたり ${Math.floor(rawMax / 1048576)}MB を超えたため追加されませんでした。`;
            err.hidden = false;
          }
          paintThumbs();
        });

        paintThumbs();
        phoRow.appendChild(phoLabel);
        phoRow.appendChild(prev);
        shell.appendChild(phoRow);

        const saveRow = document.createElement("div");
        saveRow.className = "eld-save-row";
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn-share-search btn-marchinz-spotlight";
        saveBtn.textContent = "保存する";
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-reset-search";
        delBtn.textContent = "日記を削除";
        delBtn.hidden = !d;
        saveRow.appendChild(saveBtn);
        saveRow.appendChild(delBtn);
        shell.appendChild(err);
        shell.appendChild(saveRow);

        saveBtn.addEventListener("click", async () => {
          err.hidden = true;
          const user = window.MLL_AUTH?.getUser?.();
          const storage = window.MLL_AUTH?.getStorage?.();
          if (!user?.id || user.id !== targetUid) {
            err.textContent = "ログインが必要です。";
            err.hidden = false;
            return;
          }
          if (!storage) {
            err.textContent = "Firebase Storage が利用できません。";
            err.hidden = false;
            return;
          }
          const nextBody = String(ta.value || "").slice(0, MAX_BODY);
          const nextVis = rPrv.checked ? "private" : "public";
          saveBtn.disabled = true;
          try {
            let nextUrls = editUrls.slice();
            if (pendingFiles.length) {
              const blobs = [];
              for (const f of pendingFiles) {
                blobs.push(await compressDiaryImage(f));
              }
              const uploaded = await uploadDiaryJpegs(storage, user.id, row.eventId, blobs);
              nextUrls = nextUrls.concat(uploaded).slice(0, MAX_PHOTOS);
            }
            const payload = {
              body: nextBody,
              visibility: nextVis,
              photo_urls: nextUrls,
              event_title: row.title,
              event_date: row.date,
              participation_style: row.participation_style,
              updated_at: isoNow(),
            };
            if (!d) payload.created_at = isoNow();
            await db.collection("mll_profiles").doc(user.id).collection("event_log_diaries").doc(row.eventId).set(payload, { merge: true });
            diaries.set(row.eventId, { id: row.eventId, ...payload });
            pendingFiles = [];
            editUrls = nextUrls.slice();
            closeDialog();
            renderList();
            window.dispatchEvent(new CustomEvent("marchinz-profile-saved"));
          } catch (e) {
            console.warn(e);
            const m = String(e?.message || e || "保存に失敗しました。");
            if (m === window.MarchinZImage?.ERR_TOO_LARGE) {
              err.textContent = "大きすぎる画像は保存できません。";
            } else {
              err.textContent = m;
            }
            err.hidden = false;
          } finally {
            saveBtn.disabled = false;
          }
        });

        delBtn.addEventListener("click", async () => {
          if (!d || !window.confirm("この MarchinZ Note を削除しますか？")) return;
          delBtn.disabled = true;
          try {
            await db.collection("mll_profiles").doc(targetUid).collection("event_log_diaries").doc(row.eventId).delete();
            diaries.delete(row.eventId);
            closeDialog();
            renderList();
            window.dispatchEvent(new CustomEvent("marchinz-profile-saved"));
          } catch (e) {
            console.warn(e);
            err.textContent = String(e?.message || "削除に失敗しました。");
            err.hidden = false;
          } finally {
            delBtn.disabled = false;
          }
        });
      }

      const pill = document.createElement("div");
      pill.className = "eld-pill";
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "eld-pill-item eld-pill-iconbtn";
      copyBtn.setAttribute("data-eld-copy", "");
      copyBtn.title = "リンクをコピー";
      copyBtn.textContent = "🔗";
      pill.appendChild(copyBtn);
      copyBtn?.addEventListener("click", async () => {
        const url = buildProfileUrlWithDiary(targetUid, row.eventId);
        try {
          await navigator.clipboard.writeText(url);
          copyBtn.textContent = "✓";
          setTimeout(() => {
            copyBtn.textContent = "🔗";
          }, 1400);
        } catch {
          window.prompt("リンクをコピー", url);
        }
      });
      shell.appendChild(pill);

      host.appendChild(shell);

      const close = document.createElement("button");
      close.type = "button";
      close.className = "eld-dialog-close";
      close.textContent = "閉じる";
      close.addEventListener("click", () => closeDialog());
      host.appendChild(close);
    }

    renderList();

    const hp =
      typeof window.MarchinZProfileHashParams === "function"
        ? window.MarchinZProfileHashParams()
        : new URLSearchParams("");
    const openEv = hp.get("event");
    if (openEv && hp.get("tab") === "logdiary") {
      const row = attendance.find((r) => r.eventId === openEv);
      const dd = diaries.get(openEv);
      if (row) {
        if (isOwner) {
          if (dd) state = { mode: "view", row, diary: dd };
          else state = { mode: "edit", row, diary: null };
          openDialog();
        } else if (dd && String(dd.visibility || "public") !== "private") {
          state = { mode: "view", row, diary: dd };
          openDialog();
        }
      } else if (!isOwner && openEv) {
        const ddOnly = diaries.get(openEv);
        if (ddOnly && String(ddOnly.visibility || "public") !== "private") {
          state = {
            mode: "view",
            row: {
              eventId: openEv,
              date: String(ddOnly.event_date || "").trim(),
              title: String(ddOnly.event_title || "").trim(),
              participation_style: String(ddOnly.participation_style || "").trim(),
            },
            diary: ddOnly,
          };
          openDialog();
        }
      }
    }

    const diaryCount = isOwner
      ? diaries.size
      : [...diaries.values()].filter((d) => String(d.visibility || "public") !== "private").length;
    return { diaryCount };
  }

  window.MarchinZEventLogDiary = {
    /**
     * @param {HTMLElement|null} root
     * @param {{ targetUid: string; viewerId: string|null; db: FirebaseFirestore.Firestore; likeShowLog?: boolean }} ctx
     */
    async mount(root, ctx) {
      if (!root) return { diaryCount: 0 };
      if (!root.dataset.eldDlgWired) {
        root.dataset.eldDlgWired = "1";
        const dlg = /** @type {HTMLDialogElement|null} */ (root.querySelector("[data-eld-dialog]"));
        dlg?.addEventListener("click", (ev) => {
          if (ev.target === dlg) root._eldCloseDialog?.();
        });
      }
      return (await render(root, ctx)) || { diaryCount: 0 };
    },
  };
})();
