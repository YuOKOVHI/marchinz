/**
 * プロフィール「MarchinZ Note」タブ（#prof-log-diary-root）— 参加形式登録済みイベントのみ任意作成。
 * 写真最大4枚・本文2000文字・公開/非公開。深いリンク: #profile?tab=logdiary&event=…（MarchinZProfileHashParams）
 */
(() => {
  let profileEldMountSeq = 0;

  const MAX_BODY = 2000;
  const MAX_PHOTOS = 4;
  const MAX_NOTE_TITLE = 30;
  const EVENTS_LIMIT = 100;
  const PROFILE_AVATAR_FALLBACK = "logo/marchinz-logo.png";

  /** @param {unknown} raw @returns {string[]} */
  function userNotePhotoUrls(raw) {
    return window.MarchinZDefaultAssets?.normalizeNotePhotoUrls?.(raw, MAX_PHOTOS) || [];
  }

  /**
   * @param {Record<string, unknown>|null|undefined} diary
   * @param {number} urlCount
   */
  function noteCoverIndex(diary, urlCount) {
    return (
      window.MarchinZDefaultAssets?.normalizeCoverPhotoIndex?.(diary?.cover_photo_index, urlCount) ?? 0
    );
  }

  /**
   * 本文下ギャラリー用（表紙は別表示のため、複数枚時は表紙インデックスを除く）
   * @param {Record<string, unknown>|string[]} diaryOrUrls
   */
  function diaryGalleryPhotoUrls(diaryOrUrls) {
    const all = Array.isArray(diaryOrUrls)
      ? diaryOrUrls
      : userNotePhotoUrls(/** @type {Record<string, unknown>} */ (diaryOrUrls)?.photo_urls);
    if (all.length <= 1) return [];
    const cov = Array.isArray(diaryOrUrls)
      ? 0
      : noteCoverIndex(/** @type {Record<string, unknown>} */ (diaryOrUrls), all.length);
    return all.filter((_, i) => i !== cov);
  }

  /**
   * 同一イベントの二重行を防ぐ（日付＋タイトル。doc id が変わっても 1 行）
   * @param {{ eventId?: string; id?: string; date?: string; event_date?: string; title?: string; event_title?: string; eventName?: string }} row
   */
  function noteEventDedupeKey(row) {
    const eid = String(row?.eventId || row?.id || "").trim();
    const date = String(row?.date || row?.event_date || "").trim();
    const title = String(row?.title || row?.event_title || row?.eventName || "").trim();
    const nk = window.MarchinZMllRole?.normTitleKey;
    const titleKey =
      typeof nk === "function" ? nk(title) : title.replace(/\s+/g, " ").trim().toLowerCase();
    if (date && titleKey) return `${date}|${titleKey}`;
    return eid || `${date}|${titleKey}`;
  }

  function showNoteSaveToast(text = "保存しました") {
    window.MarchinZEphemeralMessage?.(text);
  }

  /**
   * 深いリンク用: attendance 行が無くても diary から編集行を組み立てる
   * @param {string} eventId
   * @param {any[]} attendance
   * @param {Map<string, any>} diaries
   */
  function resolveNoteHashOpenTarget(eventId, attendance, diaries) {
    const openEv = String(eventId || "").trim();
    if (!openEv) return null;
    const attMap = new Map(attendance.map((r) => [r.eventId, r]));
    let row = attMap.get(openEv) || attendance.find((r) => r.eventId === openEv) || null;
    let diary = diaries.get(openEv) || null;
    if (!diary) {
      for (const [eid, dd] of diaries) {
        if (eid === openEv) {
          diary = dd;
          break;
        }
        const k = noteEventDedupeKey({
          eventId: eid,
          date: dd.event_date,
          title: dd.event_title,
        });
        const rowKey = row
          ? noteEventDedupeKey(row)
          : noteEventDedupeKey({ eventId: openEv, date: "", title: "" });
        if (k && rowKey && k === rowKey) {
          diary = dd;
          if (!row) row = { eventId: eid, date: dd.event_date, title: dd.event_title };
          break;
        }
      }
    }
    if (!diary && !row) return null;
    if (!row && diary) {
      const live = attMap.get(openEv);
      row = {
        eventId: openEv,
        date: String(live?.date || diary.event_date || "").trim(),
        title: String(live?.title || diary.event_title || "").trim(),
        eventName: String(live?.title || diary.event_title || "").trim(),
        noteTitle: diaryDisplayNoteTitle(diary),
        participation_style: String(live?.participation_style || diary.participation_style || "").trim(),
      };
    } else if (row && diary) {
      row = {
        ...row,
        eventId: openEv,
        eventName: String(row.title || row.eventName || diary.event_title || "").trim(),
        noteTitle: diaryDisplayNoteTitle(diary),
      };
    }
    return row && diary ? { row, diary } : row && !diary ? { row, diary: null } : null;
  }

  /** @param {string} uid @param {string} eventId @param {{ edit?: boolean }} [opts] */
  function replaceProfileNoteHash(uid, eventId, opts = {}) {
    const u = String(uid || "").trim();
    const ev = String(eventId || "").trim();
    if (!u || !ev) return;
    try {
      const base = `${location.pathname}${location.search}`;
      let nh = `#profile?uid=${encodeURIComponent(u)}&tab=logdiary&event=${encodeURIComponent(ev)}`;
      if (opts.edit) nh += "&edit=1";
      history.replaceState(null, "", `${base}${nh}`);
      window.MarchinZRefreshSeoFromLocation?.();
    } catch {
      //
    }
  }

  /**
   * @param {HTMLElement} grid
   * @param {number} count
   */
  function applyPhotoGridCountClass(grid, count) {
    grid.className = "eld-photo-grid";
    const n = Math.max(0, Math.min(MAX_PHOTOS, count));
    if (n > 0) grid.classList.add(`eld-photo-grid--count-${n}`);
  }

  /**
   * @param {string[]} urls
   * @returns {HTMLDivElement}
   */
  function buildPhotoGridWrap(urls) {
    const gridWrap = document.createElement("div");
    gridWrap.className = "eld-grid-wrap";
    const grid = document.createElement("div");
    applyPhotoGridCountClass(grid, urls.length);
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
    gridWrap.appendChild(grid);
    return gridWrap;
  }

  /**
   * @param {HTMLElement} coverWrap
   * @param {Record<string, unknown>} diary
   */
  function appendVisibilityBadgeOnCover(coverWrap, diary) {
    const vis = document.createElement("span");
    vis.className =
      String(diary.visibility || "") === "private"
        ? "eld-vis-badge eld-vis-badge--private mln-feed-cover-vis"
        : "eld-vis-badge eld-vis-badge--public mln-feed-cover-vis";
    vis.textContent = diaryVisibilityLabel(diary.visibility);
    coverWrap.classList.add("mln-feed-card-cover--has-vis");
    coverWrap.appendChild(vis);
  }

  function rawInputMaxBytes() {
    return window.MarchinZImage?.RAW_INPUT_MAX_BYTES || 20 * 1024 * 1024;
  }

  /**
   * @param {File} file
   * @returns {Promise<Blob>}
   */
  /** Safari 等で Web Worker 圧縮が落ちることがあるため Note 用はメインスレッド優先 */
  async function compressDiaryImage(file) {
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
    const R = window.MarchinZMllRole;
    const labelFor = (st) => (R?.participationFormatLabel ? R.participationFormatLabel(st) : st);
    /** @type {Map<string, { eventId: string; date: string; title: string; participation_style: string }>} */
    const byEvent = new Map();
    if (R?.queryMllLogsForUser) {
      try {
        const logSnap = await R.queryMllLogsForUser(db, targetUid);
        logSnap.forEach((doc) => {
          const x = doc.data() || {};
          const eventId = String(x.calendar_event_id || "").trim();
          if (!eventId) return;
          const partStyle = R.participationStyleLabelFromLogData
            ? R.participationStyleLabelFromLogData(x)
            : labelFor(
                R.inferRoleFromLogOrNull?.(x)
                  ? R.roleToParticipationJa(R.inferRoleFromLogOrNull(x))
                  : "",
              );
          byEvent.set(eventId, {
            eventId,
            date: String(x.event_date || "").trim(),
            title: String(x.event_name || "").trim(),
            participation_style: partStyle,
          });
        });
      } catch (e) {
        console.warn("[event-log-diary] mll_logs", e);
      }
    }
    const evSnap = await db.collection("mll_calendar_events").orderBy("date", "desc").limit(EVENTS_LIMIT).get();
    const attendeeSnaps = await Promise.all(
      evSnap.docs.map((d) => d.ref.collection("attendees").doc(targetUid).get()),
    );
    evSnap.docs.forEach((doc, i) => {
      if (byEvent.has(doc.id)) return;
      const as = attendeeSnaps[i];
      if (!as.exists) return;
      const st = String(as.data()?.style || "").trim();
      if (!st) return;
      const d = doc.data() || {};
      byEvent.set(doc.id, {
        eventId: doc.id,
        date: String(d.date || "").trim(),
        title: String(d.title || "").trim(),
        participation_style: labelFor(st),
      });
    });
    return [...byEvent.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   */
  async function loadDiaries(db, targetUid) {
    const viewerId = String(window.MLL_AUTH?.getUser?.()?.id || "").trim();
    const isOwner = viewerId === targetUid;
    const col = db.collection("mll_profiles").doc(targetUid).collection("event_log_diaries");
    const snap = isOwner ? await col.get() : await col.where("visibility", "==", "public").get();
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

  /** @param {Record<string, unknown>|null|undefined} diary */
  function noteDiaryIsPublic(diary) {
    return String(diary?.visibility || "public") !== "private";
  }

  /** MarchinZ Note / Moment の「シェアする」— 本人のみ（公開設定に関わらず） */
  function canShareProfileMarchinZNote(targetUid) {
    const me = window.MLL_AUTH?.getUser?.()?.id;
    const owner = String(targetUid || "").trim();
    return Boolean(me && owner && me === owner);
  }

  /**
   * @param {HTMLElement} actionsRow
   * @param {string} targetUid
   * @param {string} eventId
   * @param {Record<string, unknown>|null|undefined} diary
   * @param {{ eventName?: string; title?: string }} [row]
   */
  function appendNoteShareButton(actionsRow, targetUid, eventId, diary, row) {
    if (!noteDiaryIsPublic(diary) || !canShareProfileMarchinZNote(targetUid)) return;
    const sm = window.MarchinZShareMenu;
    if (!sm?.buildAbsoluteUrlForHash || !sm.setupSearchLikeShareMenuForButton) return;
    const hash = `#profile?uid=${encodeURIComponent(targetUid)}&tab=logdiary&event=${encodeURIComponent(eventId)}`;
    const url = sm.buildAbsoluteUrlForHash(hash);
    const title =
      diaryDisplayNoteTitle(diary) || diaryDisplayEventName(diary, row) || "MarchinZ Note";
    const shareText = sm.noteShareText ? sm.noteShareText(title, url) : `${title}\n${url}`;
    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "btn-share-search btn-marchinz-spotlight";
    shareBtn.textContent = "シェアする";
    shareBtn.setAttribute("aria-label", "MarchinZ Note をシェア");
    actionsRow.appendChild(shareBtn);
    sm.setupSearchLikeShareMenuForButton(shareBtn, shareText, url, "search");
  }

  /** @param {{ participation_style?: string }} row */
  function rowParticipationToFirestoreStyle(row) {
    const R = window.MarchinZMllRole;
    const ps = String(row?.participation_style || "").trim();
    if (!R || !ps) return "";
    const item = R.MLL_PARTICIPATION_4?.find((x) => x.label === ps || x.value === ps);
    if (item) return R.participationValueToFirestoreStyle(item.value);
    return R.attendanceLabelToFirestoreStyle(ps) || "";
  }

  /**
   * Firestore ルール: event_log_diaries の create/update は attendees 必須。
   * 一覧は mll_logs 由来の行も出すため、保存前に attendees を補完する。
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} userId
   * @param {{ eventId: string; date?: string; title?: string; participation_style?: string }} row
   */
  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {{ id: string }} user
   * @param {{ eventId: string; date?: string; title?: string; participation_style?: string }} row
   */
  async function ensureAttendeeForDiarySave(db, user, row) {
    const userId = String(user?.id || "").trim();
    const eventId = String(row.eventId || "").trim();
    if (!eventId || !db || !userId) return;
    const attRef = db.collection("mll_calendar_events").doc(eventId).collection("attendees").doc(userId);
    const snap = await attRef.get();
    if (snap.exists && String(snap.data()?.style || "").trim()) return;
    const R = window.MarchinZMllRole;
    const ps = String(row.participation_style || "").trim();
    const pv = R?.MLL_PARTICIPATION_4?.find((x) => x.label === ps || x.value === ps)?.value || "";
    if (!pv) return;
    if (R?.syncUserInvolvementForCalendar) {
      try {
        const evSnap = await db.collection("mll_calendar_events").doc(eventId).get();
        if (evSnap.exists) {
          const d = evSnap.data() || {};
          await R.syncUserInvolvementForCalendar(
            db,
            user,
            eventId,
            {
              id: eventId,
              date: String(d.date || row.date || "").trim(),
              title: String(d.title || row.title || "").trim(),
              venue_pref: String(d.venue_pref || "").trim(),
              event_url: String(d.event_url || "").trim(),
            },
            pv,
          );
          return;
        }
      } catch (e) {
        console.warn("[event-log-diary] syncUserInvolvementForCalendar", e);
      }
    }
    const fsStyle = rowParticipationToFirestoreStyle(row);
    if (!fsStyle) return;
    await attRef.set({ style: fsStyle }, { merge: true });
  }

  /** Firestore ルール diaryFieldsOk() と一致（余計なキーがあると保存拒否） */
  const DIARY_SAVE_KEYS = [
    "body",
    "visibility",
    "photo_urls",
    "note_title",
    "event_title",
    "event_date",
    "participation_style",
    "cover_photo_index",
    "created_at",
    "updated_at",
    "liked_by",
  ];

  /**
   * 既存ドキュメントのレガシーフィールドを除き、ルール許可キーのみで上書き用オブジェクトを組み立てる。
   * @param {Record<string, unknown>|null|undefined} existing
   * @param {Record<string, unknown>} patch
   */
  function buildDiaryDocumentForWrite(existing, patch) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of DIARY_SAVE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = patch[k];
      else if (existing && Object.prototype.hasOwnProperty.call(existing, k)) out[k] = existing[k];
    }
    return out;
  }

  /** @param {unknown} e */
  function diarySaveErrorMessage(e) {
    const code = String(e?.code || "");
    const m = String(e?.message || e || "保存に失敗しました。");
    if (code === "permission-denied") {
      if (/cover_photo_index|diaryFieldsOk|hasOnly/i.test(m)) {
        return "表紙の保存がサーバー側で拒否されました。Firestore ルール（cover_photo_index）のデプロイが未反映の可能性があります。運営に連絡するか、しばらくしてから再試行してください。";
      }
      return "保存できませんでした。参加スタイル（MarchinZ Log）を選んでから、もう一度お試しください。";
    }
    if (code === "storage/unauthorized" || m.includes("storage/unauthorized")) {
      return "写真のアップロードが拒否されました。しばらくしてから再度お試しください。";
    }
    if (m === window.MarchinZImage?.ERR_TOO_LARGE) {
      return "大きすぎる画像は保存できません。";
    }
    return m;
  }

  /** @param {unknown} vis */
  function diaryVisibilityLabel(vis) {
    return String(vis || "").trim() === "private" ? "非公開中" : "公開中";
  }

  /** @param {Record<string, unknown>|null|undefined} d */
  function diaryDisplayNoteTitle(d) {
    return String(d?.note_title || "").trim();
  }

  /**
   * @param {Record<string, unknown>|null|undefined} d
   * @param {{ eventName?: string; title?: string }} [row]
   */
  function diaryDisplayEventName(d, row) {
    return String(d?.event_title || row?.eventName || row?.title || "").trim() || "イベント";
  }

  /**
   * @param {HTMLElement} host
   * @param {string[]} urls
   */
  /**
   * @param {HTMLElement} host
   * @param {Record<string, unknown>|string[]} diaryOrUrls
   */
  function appendDiaryCardMedia(host, diaryOrUrls) {
    const isDiary =
      diaryOrUrls && typeof diaryOrUrls === "object" && !Array.isArray(diaryOrUrls);
    const urls = isDiary ? userNotePhotoUrls(diaryOrUrls.photo_urls) : userNotePhotoUrls(diaryOrUrls);
    const cover = isDiary
      ? window.MarchinZDefaultAssets?.noteCoverUrl?.(
          diaryOrUrls.photo_urls,
          diaryOrUrls.cover_photo_index,
        ) || urls[0]
      : urls[0];
    const media = document.createElement("div");
    media.className = "eld-card-media mln-feed-card-cover";
    const show = cover || window.MarchinZDefaultAssets?.noteThumbnailDefault?.();
    const cell = document.createElement("div");
    cell.className = "eld-card-photo-cell eld-card-photo-cell--cover";
    const mi = window.MarchinZImage;
    if (mi?.appendProtectedPhoto) {
      mi.appendProtectedPhoto(cell, {
        src: show,
        alt: "",
        classNameImg: "eld-card-photo-img mln-feed-card-cover-img",
        loading: "lazy",
      });
    } else {
      const im = document.createElement("img");
      im.className = "eld-card-photo-img mln-feed-card-cover-img";
      im.src = show || "";
      im.alt = "";
      im.loading = "lazy";
      im.decoding = "async";
      cell.appendChild(im);
    }
    media.appendChild(cell);
    host.insertBefore(media, host.firstChild);
  }

  /** コミュニティ「ノート」一覧と同じ表紙（#mln-feed-cards 準拠） */
  /**
   * @param {HTMLElement} host
   * @param {Record<string, unknown>} diary
   * @param {{ showVisibilityBadge?: boolean }} [opts]
   */
  function appendNoteFeedCover(host, diary, opts = {}) {
    const DA = window.MarchinZDefaultAssets;
    const cover =
      DA?.noteCoverUrl?.(diary.photo_urls, diary.cover_photo_index) ||
      userNotePhotoUrls(diary.photo_urls)[0] ||
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
      const im = document.createElement("img");
      im.className = "mln-feed-card-cover-img";
      im.src = cover;
      im.alt = "";
      im.loading = "lazy";
      im.decoding = "async";
      wrap.appendChild(im);
    }
    if (opts.showVisibilityBadge) appendVisibilityBadgeOnCover(wrap, diary);
    host.appendChild(wrap);
  }

  function participationChipClassName(styleText) {
    const R = window.MarchinZMllRole;
    const unknown = R?.PARTICIPATION_UNKNOWN_LABEL || "（参加スタイル不明）";
    const sty = participationStyleLabel(styleText);
    if (!sty) return "";
    const base = "mln-feed-part-chip";
    if (sty === unknown) return `${base} mln-feed-part-chip--unknown`;
    if (R?.resolveParticipationStyle) {
      const res = R.resolveParticipationStyle(styleText);
      if (!res.known) return `${base} mln-feed-part-chip--unknown`;
    }
    return base;
  }

  /** @param {HTMLElement} parent @param {string} styleText */
  function appendNoteParticipationChip(parent, styleText) {
    const sty = participationStyleLabel(styleText);
    const cls = participationChipClassName(styleText);
    if (!sty || !cls) return;
    const chip = document.createElement("span");
    chip.className = cls;
    chip.textContent = sty;
    parent.appendChild(chip);
  }

  /**
   * @param {HTMLElement} parent
   * @param {Record<string, unknown>} d
   * @param {string} noteTitle
   * @param {string} eventName
   * @param {{ date?: string; participation_style?: string }} [row]
   */
  function appendNoteFeedSubline(parent, d, noteTitle, eventName, row) {
    const evName = String(eventName || "").trim();
    const evd = String(d.event_date ?? row?.date ?? "")
      .trim()
      .replace(/-/g, "/");
    const sty = participationStyleLabel(row?.participation_style ?? d.participation_style);
    const showEvent = evName && (!noteTitle || noteTitle !== evName);
    if (!showEvent && !evd && !sty) return;

    const sub = document.createElement("p");
    sub.className = "mln-feed-card-subline";
    if (showEvent) {
      const evSpan = document.createElement("span");
      evSpan.className = "mln-feed-card-subline-event";
      evSpan.textContent = evName;
      sub.appendChild(evSpan);
    }
    if (evd) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "mln-feed-card-subline-date";
      dateSpan.textContent = evd;
      sub.appendChild(dateSpan);
    }
    if (sty) {
      appendNoteParticipationChip(sub, sty);
    }
    parent.appendChild(sub);
  }

  /**
   * Note 編集：参加スタイル（MarchinZ Log と同期）
   * @param {HTMLElement} shell
   * @param {string} initialLabel
   * @returns {() => string}
   */
  function wireEldParticipationPicker(shell, initialLabel) {
    const R = window.MarchinZMllRole;
    const badge = R?.MLL_LOG_ROW_BADGE_LABEL || "MarchinZ Log";
    const unknown = R?.PARTICIPATION_UNKNOWN_LABEL || "（参加スタイル不明）";
    const options = R?.ATTENDANCE_STYLE_OPTIONS_JA || [
      "観戦",
      "出演",
      "チームスタッフ",
      "スタッフ・運営",
    ];
    const rawInit = String(initialLabel || "").trim();
    let selected = "";
    if (rawInit && options.includes(rawInit)) {
      selected = rawInit;
    } else if (rawInit && R?.resolveParticipationStyle) {
      const res = R.resolveParticipationStyle(rawInit);
      if (res.known && res.uiLabel && options.includes(res.uiLabel)) selected = res.uiLabel;
    }
    const block = document.createElement("div");
    block.className = "eld-participation-block";
    const title = document.createElement("p");
    title.className = "eld-hint eld-participation-label";
    title.textContent = `${badge}（参加スタイル）`;
    /** @type {HTMLElement|null} */
    let curUnknown = null;
    if (!selected) {
      curUnknown = document.createElement("p");
      curUnknown.className = "eld-participation-current-unknown";
      curUnknown.textContent = rawInit
        ? `現在: ${rawInit}（4区分のいずれかを選んで保存してください）`
        : `現在: ${unknown}（4区分のいずれかを選んで保存してください）`;
    }
    const note = document.createElement("p");
    note.className = "eld-participation-sync-note";
    note.textContent =
      "保存すると、このイベントの MarchinZ Log・Note・参加登録の参加スタイルだけを更新します。";
    const opts = document.createElement("div");
    opts.className = "calendar-att-options eld-participation-options";
    /** @type {HTMLButtonElement[]} */
    const buttons = [];
    for (const label of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "calendar-att-opt-btn";
      if (label === selected) b.classList.add("calendar-att-opt-btn--current");
      b.textContent = label;
      b.addEventListener("click", () => {
        selected = label;
        buttons.forEach((btn) => {
          btn.classList.toggle("calendar-att-opt-btn--current", btn === b);
        });
      });
      buttons.push(b);
      opts.appendChild(b);
    }
    if (curUnknown) block.append(title, curUnknown, note, opts);
    else block.append(title, note, opts);
    shell.appendChild(block);
    return () => selected;
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   * @param {string} eventId
   */
  async function runDiaryLikeToggle(db, targetUid, eventId) {
    const user = window.MLL_AUTH?.getUser?.();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return null;
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("like")) return null;
    /** @type {{ title: string }|null} */
    let notifyMeta = null;
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
        const t = diaryDisplayNoteTitle(data) || diaryDisplayEventName(data, null);
        notifyMeta = { title: t.slice(0, 200) || "MarchinZ Note" };
      }
    });
    if (notifyMeta) {
      const nm = window.MarchinZActorDisplayName?.(user) || "ユーザー";
      const evId = encodeURIComponent(String(eventId));
      const uEnc = encodeURIComponent(String(targetUid));
      window.MarchinZPushLikeNotification?.(db, targetUid, {
        kind: "like_log_diary",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "log_diary",
        target_id: String(eventId),
        target_title: notifyMeta.title,
        target_href: `#profile?uid=${uEnc}&tab=logdiary&event=${evId}`,
        thread_root_id: "",
      });
    }
    const snap2 = await ref.get();
    return snap2.exists ? { id: eventId, ...snap2.data() } : null;
  }

  /**
   * @param {FirebaseFirestore.Firestore} db
   * @param {string} targetUid
   * @param {string} eventId
   * @param {string} noteTitle
   */
  async function reportDiaryNote(db, targetUid, eventId, noteTitle) {
    const me = window.MLL_AUTH?.getUser?.();
    if (!me?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return { ok: false, message: "" };
    }
    if (me.id === targetUid) {
      return { ok: false, message: "自分の Note は通報できません。" };
    }
    if (window.MarchinZRateLimit && !window.MarchinZRateLimit.check("report")) {
      return { ok: false, message: "通報の頻度が高すぎます。しばらく待ってから再度お試しください。" };
    }
    const reason = window.prompt("通報理由を入力してください（任意）。", "");
    if (reason === null) return { ok: false, message: "" };
    const report = {
      reporter_id: me.id,
      target_uid: targetUid,
      event_id: eventId,
      note_title: String(noteTitle || "").trim().slice(0, MAX_NOTE_TITLE),
      reason: String(reason).trim().slice(0, 500),
      created_at: isoNow(),
    };
    try {
      const id = `nr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await db.collection("mll_note_reports").doc(id).set(report);
      window.MarchinZTrackEvent?.("report_submit", { target_type: "note" });
      return { ok: true, message: "通報を受け付けました。運営側で確認します。" };
    } catch (e) {
      console.warn(e);
      return { ok: false, message: "通報の送信に失敗しました。" };
    }
  }

  function buildNoteReportMenu(targetUid, eventId, noteTitle) {
    const onReport = async () => {
      const db = window.MLL_AUTH?.getDb?.();
      if (!db) return;
      const r = await reportDiaryNote(db, targetUid, eventId, noteTitle);
      if (r.message) window.alert(r.message);
    };
    const Eu = window.MarchinZEngageUi;
    if (Eu?.buildReportOverflow) return Eu.buildReportOverflow(onReport);
    const det = document.createElement("details");
    det.className = "community-post-overflow";
    const sum = document.createElement("summary");
    sum.className = "community-post-overflow-trigger";
    sum.setAttribute("aria-label", "その他の操作");
    sum.textContent = "⋯";
    const panel = document.createElement("div");
    panel.className = "community-post-overflow-panel";
    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.className = "community-post-overflow-item";
    reportBtn.textContent = "通報する";
    reportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      det.open = false;
      void onReport();
    });
    panel.appendChild(reportBtn);
    det.appendChild(sum);
    det.appendChild(panel);
    return det;
  }

  function normDiaryLikedBy(raw) {
    const o = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) o[k] = true;
    }
    return o;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ targetUid: string; viewerId: string|null; db: FirebaseFirestore.Firestore; likeShowLog?: boolean; previewAsOtherMember?: boolean }} ctx
   */
  async function render(root, ctx, mountGen) {
    const { targetUid, viewerId, db } = ctx;
    const likeShowLog = ctx.likeShowLog !== false;
    /** 本人プロフィールの「他ユーザー視点」プレビュー時はオーナー UI を出さない */
    const previewAsOtherMember = Boolean(ctx.previewAsOtherMember);
    const isOwner = Boolean(viewerId && viewerId === targetUid && !previewAsOtherMember);
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
      if (mountGen !== profileEldMountSeq) return { diaryCount: 0 };
      if (window.MarchinZMllRole?.reconcileDiariesParticipationFromLogs && diaries.size) {
        const rows = [...diaries.entries()].map(([eventId, data]) => ({
          uid: targetUid,
          eventId,
          data: data && typeof data === "object" ? { ...data } : {},
        }));
        try {
          await window.MarchinZMllRole.reconcileDiariesParticipationFromLogs(db, rows);
          for (const r of rows) {
            if (r.eventId && r.data) diaries.set(r.eventId, r.data);
          }
        } catch (e) {
          console.warn("[event-log-diary] reconcile participation_style from Log", e);
        }
      }
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
      try {
        const saved = await runDiaryLikeToggle(db, targetUid, eventId);
        if (!saved) return false;
        diaries.set(eventId, saved);
      } catch (e) {
        console.warn(e);
        return false;
      }
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
      window.MarchinZEngageUi?.buildLikeRow(hostEl, {
        liked,
        count: cnt,
        onClick: () => toggleLogDiaryLike(eventId),
        showLoginHint: !me?.id,
      });
    }

    const authorDisplay = ctx.authorDisplay || null;
    const searchIn = q(root, "[data-eld-search]");
    const filterNav = q(root, "[data-eld-filter-nav]");
    let searchQuery = "";
    /** @type {"all"|"written"|"unwritten"} */
    let listFilter = "written";
    searchIn?.addEventListener("input", () => {
      searchQuery = String(searchIn.value || "");
      renderList();
    });
    if (filterNav instanceof HTMLElement) {
      filterNav.hidden = !isOwner;
      if (isOwner) window.MarchinZIcons?.decorateEldNoteFilterTabs?.();
      if (isOwner && !filterNav.dataset.eldFilterWired) {
        filterNav.dataset.eldFilterWired = "1";
        filterNav.addEventListener("click", (ev) => {
          const btn = ev.target instanceof Element ? ev.target.closest("[data-eld-filter]") : null;
          if (!(btn instanceof HTMLButtonElement)) return;
          const mode = String(btn.getAttribute("data-eld-filter") || "").trim();
          if (mode !== "all" && mode !== "written" && mode !== "unwritten") return;
          if (mode === listFilter) return;
          listFilter = mode;
          filterNav.querySelectorAll("[data-eld-filter]").forEach((b) => {
            if (!(b instanceof HTMLButtonElement)) return;
            b.setAttribute("aria-selected", b === btn ? "true" : "false");
          });
          renderList();
        });
      }
    }

    function attendanceMap() {
      return new Map(attendance.map((r) => [r.eventId, r]));
    }

    function visibleRows() {
      const attMap = attendanceMap();
      if (isOwner) {
        /** @type {Map<string, typeof attendance[0]>} */
        const merged = new Map();
        for (const r of attendance) {
          const k = noteEventDedupeKey(r);
          const prev = merged.get(k);
          if (!prev) {
            merged.set(k, r);
            continue;
          }
          const prefer =
            (diaries.has(r.eventId) && !diaries.has(prev.eventId) ? r : null) ||
            (diaries.has(prev.eventId) && !diaries.has(r.eventId) ? prev : null) ||
            (String(r.date || "").localeCompare(String(prev.date || "")) >= 0 ? r : prev);
          merged.set(k, prefer);
        }
        for (const [eid, d] of diaries) {
          const k = noteEventDedupeKey({
            eventId: eid,
            date: d.event_date,
            title: d.event_title,
          });
          if (merged.has(k)) continue;
          const live = attMap.get(eid);
          merged.set(k, {
            eventId: eid,
            date: String(live?.date || d.event_date || "").trim(),
            title: String(live?.title || d.event_title || "").trim(),
            participation_style: String(live?.participation_style || d.participation_style || "").trim(),
          });
        }
        return [...merged.values()].map((r) => {
          const k = noteEventDedupeKey(r);
          let eventId = r.eventId;
          let d = diaries.get(eventId);
          if (!d) {
            for (const [eid, dd] of diaries) {
              if (
                noteEventDedupeKey({
                  eventId: eid,
                  date: dd.event_date,
                  title: dd.event_title,
                }) === k
              ) {
                d = dd;
                eventId = eid;
                break;
              }
            }
          }
          const live = attMap.get(eventId) || attMap.get(r.eventId);
          const mergedRow = {
            ...r,
            eventId,
            eventName: String(r.title || live?.title || d?.event_title || "").trim(),
            noteTitle: d ? diaryDisplayNoteTitle(d) : "",
          };
          mergedRow.participation_style = rowParticipationDisplay(mergedRow, attMap);
          return mergedRow;
        });
      }
      return Array.from(diaries.values())
        .filter((d) => String(d.visibility || "public") !== "private")
        .map((d) => {
          const live = attMap.get(d.id);
          const mergedRow = {
            eventId: d.id,
            date: String(live?.date || d.event_date || "").trim(),
            title: String(live?.title || d.event_title || "").trim(),
            eventName: String(live?.title || d.event_title || "").trim(),
            noteTitle: diaryDisplayNoteTitle(d),
          };
          mergedRow.participation_style = rowParticipationDisplay(mergedRow, attMap);
          return mergedRow;
        })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }

    /** @param {any} row @param {any} [d] */
    function rowMatchesSearch(row, d) {
      const needle = searchQuery.trim().toLowerCase();
      if (!needle) return true;
      const hay = [
        row.noteTitle,
        row.eventName,
        row.title,
        row.participation_style,
        row.date,
        d?.body,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(needle);
    }

    /** @param {any} row */
    function rowHasDiary(row) {
      return Boolean(diaries.get(row.eventId));
    }

    /** @param {any} row */
    function rowPassesListFilter(row) {
      if (!isOwner || listFilter === "all") return true;
      const has = rowHasDiary(row);
      if (listFilter === "written") return has;
      if (listFilter === "unwritten") return !has;
      return true;
    }

    function emptyMessageForFilter() {
      if (searchQuery.trim()) return "検索に一致する MarchinZ Note はありません。";
      if (listFilter === "written") return "作成済の MarchinZ Note はありません。";
      if (listFilter === "unwritten") return "未記入のイベントはありません。";
      return "まだMarchinZ Noteはありません";
    }

    function renderList() {
      listHost.innerHTML = "";
      const rows = visibleRows()
        .filter((row) => rowPassesListFilter(row))
        .filter((row) => rowMatchesSearch(row, diaries.get(row.eventId)));
      if (!rows.length) {
        const box = document.createElement("div");
        box.className = "empty-state user-profile-empty";
        box.textContent = emptyMessageForFilter();
        listHost.appendChild(box);
        return;
      }
      const grid = document.createElement("div");
      grid.className = "mln-feed-grid prof-log-diary-note-grid";
      for (const row of rows) {
        const d = diaries.get(row.eventId);
        const noteTitle = String(row.noteTitle || (d ? diaryDisplayNoteTitle(d) : "")).trim();
        const eventName = d ? diaryDisplayEventName(d, row) : String(row.eventName || row.title || "").trim();
        const openNoteDialog = () => {
          if (!d && !isOwner) return;
          if (!d && isOwner) state = { mode: "edit", row, diary: null, composeStep: 1 };
          else if (d && isOwner) state = { mode: "view", row, diary: d };
          else state = { mode: "view", row, diary: d };
          openDialog();
        };

        if (!d) {
          const li = document.createElement("article");
          li.className = "eld-event-card";
          const head = document.createElement("div");
          head.className = "eld-event-card-head";
          const t = document.createElement("p");
          t.className = "eld-event-card-title";
          t.textContent = noteTitle || eventName || "（無題）";
          head.appendChild(t);
          const meta = document.createElement("p");
          meta.className = "eld-event-card-meta";
          meta.textContent = formatEldEventCardMeta(row);
          head.appendChild(meta);
          li.appendChild(head);
          const actions = document.createElement("div");
          actions.className = "eld-event-card-actions";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn-share-search eld-open-btn eld-open-btn--write";
          btn.textContent = isOwner ? "MarchinZ Note を書く" : "（非公開）";
          btn.disabled = !isOwner;
          window.MarchinZIcons?.prependIcon?.(btn, ["fa-solid", "fa-book-open"]);
          btn.addEventListener("click", openNoteDialog);
          actions.appendChild(btn);
          li.appendChild(actions);
          grid.appendChild(li);
          continue;
        }

        const art = document.createElement("article");
        art.className = "mln-feed-card mln-feed-card--media mln-feed-card--openable";
        art.tabIndex = 0;
        art.setAttribute("role", "button");
        art.setAttribute(
          "aria-label",
          `${noteTitle || eventName || "MarchinZ Note"} の詳細を開く`,
        );

        const body = document.createElement("div");
        body.className = "mln-feed-card-body";
        appendNoteFeedCover(body, d, { showVisibilityBadge: isOwner });

        const head = document.createElement("div");
        head.className = "mln-feed-card-head";

        if (authorDisplay?.name) {
          const headAside = document.createElement("div");
          headAside.className = "mln-feed-card-head-aside";
          const av = document.createElement("img");
          av.className = "mln-feed-card-head-avatar";
          av.alt = "";
          av.width = 40;
          av.height = 40;
          av.decoding = "async";
          av.src =
            authorDisplay.avatar && /^https?:\/\//i.test(authorDisplay.avatar)
              ? authorDisplay.avatar
              : PROFILE_AVATAR_FALLBACK;
          headAside.appendChild(av);
          const nm = document.createElement("a");
          nm.className = "mln-feed-author-name mln-feed-author-name-link";
          nm.href = `#profile?uid=${encodeURIComponent(targetUid)}`;
          nm.textContent = authorDisplay.name;
          headAside.appendChild(nm);
          head.appendChild(headAside);
        }

        const headMain = document.createElement("div");
        headMain.className = "mln-feed-card-head-main";
        const titleRow = document.createElement("div");
        titleRow.className = "mln-feed-card-title-row mz-title-like-row";
        const h3 = document.createElement("h3");
        h3.className = "mln-feed-card-title";
        const titleText = document.createElement("span");
        titleText.className = "mln-feed-card-title-text";
        titleText.textContent = noteTitle || eventName || "（無題）";
        h3.appendChild(titleText);
        titleRow.appendChild(h3);
        if (likeShowLog) {
          const lr = document.createElement("div");
          lr.className = "eld-card-like-host mz-inline-like-host";
          appendDiaryLikeRow(lr, d, row.eventId);
          window.MarchinZEngageUi?.appendInlineLike(titleRow, lr);
        }
        headMain.appendChild(titleRow);
        appendNoteFeedSubline(headMain, d, noteTitle, eventName, row);
        head.appendChild(headMain);
        body.appendChild(head);

        const openUnlessInteractive = (ev) => {
          if (ev.target.closest("a, button, .community-like-btn, summary")) return;
          ev.preventDefault();
          openNoteDialog();
        };
        art.addEventListener("click", openUnlessInteractive);
        art.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openNoteDialog();
          }
        });

        art.appendChild(body);

        if (!isOwner && viewerId) {
          const engage = document.createElement("div");
          engage.className = "mln-feed-card-engage";
          engage.appendChild(
            buildNoteReportMenu(targetUid, row.eventId, noteTitle || eventName || "MarchinZ Note"),
          );
          body.appendChild(engage);
        }

        grid.appendChild(art);
      }
      listHost.appendChild(grid);
    }

    /** @type {string[]} */
    let editUrls = [];
    /** @type {File[]} */
    let pendingFiles = [];
    /** @type {number} */
    let coverPhotoIndex = 0;

    function syncEditUrlsFromDiary() {
      const d = state?.diary;
      editUrls = userNotePhotoUrls(d?.photo_urls);
      pendingFiles = [];
      coverPhotoIndex = window.MarchinZDefaultAssets?.normalizeCoverPhotoIndex?.(
        d?.cover_photo_index,
        editUrls.length,
      ) ?? 0;
    }

    function totalEditPhotoCount() {
      return editUrls.length + pendingFiles.length;
    }

    function clampCoverPhotoIndex() {
      const n = totalEditPhotoCount();
      if (!n) {
        coverPhotoIndex = 0;
        return;
      }
      coverPhotoIndex = Math.max(0, Math.min(n - 1, coverPhotoIndex));
    }

    /**
     * @param {{
     *   err: HTMLElement;
     *   saveBtn: HTMLButtonElement;
     *   readParticipationLabel: () => string;
     *   nextTitle: string;
     *   nextBody: string;
     *   nextVis: string;
     *   diaryDoc: Record<string, unknown>|null|undefined;
     * }} opts
     */
    async function runDiarySave(opts) {
      const { err, saveBtn, readParticipationLabel, nextTitle, nextBody, nextVis, diaryDoc } = opts;
      const d = diaryDoc;
      const row = state?.row;
      if (!row) return;
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
      if (!nextTitle) {
        err.textContent = "タイトルを入力してください（30文字以内）。";
        err.hidden = false;
        return;
      }
      saveBtn.disabled = true;
      try {
        const R = window.MarchinZMllRole;
        const partUiLabel = readParticipationLabel();
        if (!partUiLabel) {
          err.textContent = "参加スタイル（観戦・出演・チームスタッフ・スタッフ・運営）を選んでください。";
          err.hidden = false;
          return;
        }
        const pv = R?.participationUiLabelToValue?.(partUiLabel) || partUiLabel;
        const partStyle = R?.participationFormatLabel?.(pv) || partUiLabel;
        row.participation_style = partStyle;
        for (const att of attendance) {
          if (att.eventId === row.eventId) att.participation_style = partStyle;
        }
        if (R?.syncParticipationForProfileEvent) {
          await R.syncParticipationForProfileEvent(db, user, {
            eventId: row.eventId,
            eventDate: String(row.date || "").trim(),
            eventTitle: String(row.title || row.eventName || "").trim(),
            participationUiLabel: partUiLabel,
          });
        }
        await ensureAttendeeForDiarySave(db, user, row);
        let nextUrls = editUrls.slice();
        if (pendingFiles.length) {
          const blobs = [];
          for (const f of pendingFiles) {
            if (f instanceof Blob && !(f instanceof File)) {
              blobs.push(f);
            } else if (f.size <= 400 * 1024 && f.type === "image/jpeg") {
              blobs.push(f);
            } else {
              blobs.push(await compressDiaryImage(f));
            }
          }
          const uploaded = await uploadDiaryJpegs(storage, user.id, row.eventId, blobs);
          nextUrls = userNotePhotoUrls(nextUrls.concat(uploaded));
        }
        nextUrls = userNotePhotoUrls(nextUrls);
        clampCoverPhotoIndex();
        const payload = {
          body: nextBody,
          visibility: nextVis,
          photo_urls: nextUrls,
          note_title: nextTitle,
          event_title: String(row.title || row.eventName || "").trim() || "イベント",
          event_date: String(row.date || "").trim() || "—",
          participation_style: partStyle,
          updated_at: isoNow(),
        };
        if (nextUrls.length) {
          payload.cover_photo_index = Math.floor(
            Math.max(0, Math.min(nextUrls.length - 1, coverPhotoIndex)),
          );
        }
        if (!d) payload.created_at = isoNow();
        if (d?.liked_by && typeof d.liked_by === "object" && !Array.isArray(d.liked_by)) {
          payload.liked_by = d.liked_by;
        }
        const toWrite = buildDiaryDocumentForWrite(d, payload);
        await db
          .collection("mll_profiles")
          .doc(user.id)
          .collection("event_log_diaries")
          .doc(row.eventId)
          .set(toWrite);
        if (!d) {
          window.MarchinZAdminUgcLog?.recordNote?.({
            eventId: row.eventId,
            noteTitle: nextTitle || diaryDisplayNoteTitle(toWrite),
            actorUid: user.id,
            actorName: window.MarchinZActorDisplayName?.(user) || "ユーザー",
          });
        }
        const saved = { id: row.eventId, ...toWrite, created_at: d?.created_at || toWrite.created_at };
        diaries.set(row.eventId, saved);
        pendingFiles = [];
        editUrls = nextUrls.slice();
        delete state.composeStep;
        delete state.composeDraft;
        state = { mode: "view", row, diary: saved };
        replaceProfileNoteHash(user.id, row.eventId);
        window.MarchinZTrackEvent?.("note_save_success", {
          visibility: nextVis,
          has_cover: nextUrls.length > 0 ? 1 : 0,
          is_new: d ? 0 : 1,
        });
        paintDialog();
        renderList();
        showNoteSaveToast(nextVis === "private" ? "保存しました（非公開）" : "保存しました");
        window.dispatchEvent(new CustomEvent("marchinz-profile-saved"));
        window.dispatchEvent(
          new CustomEvent("marchinz-mll-updated", { detail: { userId: user.id } }),
        );
      } catch (e) {
        console.warn(e);
        err.textContent = diarySaveErrorMessage(e);
        err.hidden = false;
      } finally {
        saveBtn.disabled = false;
      }
    }

    function openDialog() {
      if (!state) return;
      if (state.mode === "edit") {
        if (state.diary) {
          delete state.composeStep;
          delete state.composeDraft;
        } else if (!state.composeStep) {
          state.composeStep = 1;
        }
        syncEditUrlsFromDiary();
      } else {
        pendingFiles = [];
        coverPhotoIndex = 0;
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
      const hp =
        typeof window.MarchinZProfileHashParams === "function"
          ? window.MarchinZProfileHashParams()
          : null;
      if (hp?.get("tab") === "logdiary" && hp.get("event")) {
        const uid =
          hp.get("uid") || window.MLL_AUTH?.getUser?.()?.id || "";
        location.hash = uid
          ? `#profile?uid=${encodeURIComponent(uid)}&tab=logdiary`
          : "#profile?tab=logdiary";
      }
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
      const urls = mode === "edit" ? editUrls.slice() : userNotePhotoUrls(d?.photo_urls);

      host.innerHTML = "";

      const shell = document.createElement("div");
      shell.className = "eld-shell";

      if (mode === "view" || !isOwner) {
        const noteTitleView = diaryDisplayNoteTitle(d) || diaryDisplayEventName(d, row);
        const allViewUrls = userNotePhotoUrls(d?.photo_urls);
        const showFourGrid = allViewUrls.length === 4;
        if (!showFourGrid) {
          const coverUrl =
            window.MarchinZDefaultAssets?.noteCoverUrl?.(d?.photo_urls, d?.cover_photo_index) ||
            urls[0] ||
            window.MarchinZDefaultAssets?.noteThumbnailDefault?.();
          if (coverUrl) {
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
        } else {
          shell.appendChild(buildPhotoGridWrap(allViewUrls));
        }
        const viewHead = document.createElement("div");
        viewHead.className = "eld-view-head";
        const titleRow = document.createElement("div");
        titleRow.className = "mln-feed-card-title-row mz-title-like-row";
        const vTitle = document.createElement("p");
        vTitle.className = "eld-view-title mln-feed-card-title";
        vTitle.textContent = noteTitleView || "（無題）";
        titleRow.appendChild(vTitle);
        if (d) {
          const lr = document.createElement("div");
          lr.className = "eld-dialog-like-host mz-inline-like-host";
          appendDiaryLikeRow(lr, d, row.eventId);
          window.MarchinZEngageUi?.appendInlineLike?.(titleRow, lr) || titleRow.appendChild(lr);
        }
        viewHead.appendChild(titleRow);
        if (d) appendViewerSubline(viewHead, row, d);
        shell.appendChild(viewHead);
        const text = document.createElement("div");
        text.className = "eld-body-text";
        text.textContent = bodyText || "（本文はまだありません）";
        shell.appendChild(text);
        if (!showFourGrid) {
          const galleryUrls = d ? diaryGalleryPhotoUrls(d) : [];
          if (galleryUrls.length) shell.appendChild(buildPhotoGridWrap(galleryUrls));
        }
        if (d && isOwner) {
          const er = document.createElement("div");
          er.className = "eld-view-actions";
          if (noteDiaryIsPublic(d)) {
            appendNoteShareButton(er, targetUid, row.eventId, d, row);
          }
          if (isOwner) {
            const eb = document.createElement("button");
            eb.type = "button";
            eb.className = "btn-share-search btn-marchinz-spotlight";
            eb.textContent = "編集する";
            eb.addEventListener("click", () => {
              state = { mode: "edit", row, diary: d };
              delete state.composeStep;
              delete state.composeDraft;
              syncEditUrlsFromDiary();
              paintDialog();
            });
            er.appendChild(eb);
          }
          shell.appendChild(er);
        }
      } else {
        const isNewNote = !d;
        const composeStep = isNewNote ? Number(state.composeStep) || 1 : 0;
        const composeDraft = state.composeDraft;
        const err = document.createElement("p");
        err.className = "eld-error";
        err.hidden = true;
        /** @type {() => string} */
        let readParticipationLabel = () => "";

        if (isNewNote && composeStep === 2) {
          const badge = window.MarchinZMllRole?.MLL_LOG_ROW_BADGE_LABEL || "MarchinZ Log";
          const steps = document.createElement("div");
          steps.className = "eld-compose-steps";
          const s1 = document.createElement("span");
          s1.className = "eld-compose-step is-done";
          s1.textContent = "1. MarchinZ Note";
          const s2 = document.createElement("span");
          s2.className = "eld-compose-step is-active";
          s2.textContent = `2. ${badge}`;
          steps.append(s1, s2);
          shell.appendChild(steps);
          const summary = document.createElement("p");
          summary.className = "eld-compose-step-summary";
          summary.textContent = `タイトル: ${String(composeDraft?.title || "").trim() || "（無題）"}`;
          shell.appendChild(summary);
          const liveRowForPart = attendanceMap().get(row.eventId);
          const initPartRaw = String(
            liveRowForPart?.participation_style ||
              row.participation_style ||
              "",
          ).trim();
          const initPartLabel = window.MarchinZMllRole?.participationFormatLabel
            ? window.MarchinZMllRole.participationFormatLabel(initPartRaw)
            : initPartRaw ||
              window.MarchinZMllRole?.PARTICIPATION_UNKNOWN_LABEL ||
              "（参加スタイル不明）";
          readParticipationLabel = wireEldParticipationPicker(shell, initPartLabel);
          const saveRow = document.createElement("div");
          saveRow.className = "eld-save-row";
          const backBtn = document.createElement("button");
          backBtn.type = "button";
          backBtn.className = "btn-reset-search";
          backBtn.textContent = "戻る";
          const saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.className = "btn-share-search btn-marchinz-spotlight";
          saveBtn.textContent = "保存する";
          saveRow.append(backBtn, saveBtn);
          shell.appendChild(err);
          shell.appendChild(saveRow);
          backBtn.addEventListener("click", () => {
            state.composeStep = 1;
            paintDialog();
          });
          saveBtn.addEventListener("click", () => {
            void runDiarySave({
              err,
              saveBtn,
              readParticipationLabel,
              nextTitle: String(composeDraft?.title || "").trim().slice(0, MAX_NOTE_TITLE),
              nextBody: String(composeDraft?.body || "").slice(0, MAX_BODY),
              nextVis: composeDraft?.vis === "private" ? "private" : "public",
              diaryDoc: d,
            });
          });
        } else {
          const editVis =
            composeDraft?.vis ??
            (d == null
              ? window.MLL_AUTH?.getDefaultLogDiaryVisibility?.() === "private"
                ? "private"
                : "public"
              : d.visibility === "private"
                ? "private"
                : "public");
          if (isNewNote && composeStep === 1) {
            const steps = document.createElement("div");
            steps.className = "eld-compose-steps";
            const s1 = document.createElement("span");
            s1.className = "eld-compose-step is-active";
            s1.textContent = "1. MarchinZ Note";
            const s2 = document.createElement("span");
            s2.className = "eld-compose-step";
            s2.textContent = `2. ${window.MarchinZMllRole?.MLL_LOG_ROW_BADGE_LABEL || "MarchinZ Log"}`;
            steps.append(s1, s2);
            shell.appendChild(steps);
          }
          const visRadioName = `eld-vis-${row.eventId}`;
          const visPrompt = document.createElement("div");
          visPrompt.className = "eld-vis-prompt";
          const visTitle = document.createElement("p");
          visTitle.className = "eld-vis-prompt-title";
          visTitle.textContent = "公開設定";
          visPrompt.appendChild(visTitle);
          const visOpts = document.createElement("div");
          visOpts.className = "eld-vis-options";
          const labPub = document.createElement("label");
          labPub.className = "eld-vis-option";
          const rPub = document.createElement("input");
          rPub.type = "radio";
          rPub.name = visRadioName;
          rPub.value = "public";
          rPub.checked = editVis === "public";
          labPub.appendChild(rPub);
          const spPub = document.createElement("span");
          spPub.textContent = "公開（リンクを知っている人は、ログインなしでも閲覧できます）";
          labPub.appendChild(spPub);
          const labPrv = document.createElement("label");
          labPrv.className = "eld-vis-option";
          const rPrv = document.createElement("input");
          rPrv.type = "radio";
          rPrv.name = visRadioName;
          rPrv.value = "private";
          rPrv.checked = editVis === "private";
          labPrv.appendChild(rPrv);
          const spPrv = document.createElement("span");
          spPrv.textContent = "非公開（自分のみ。リンクからも見えません）";
          labPrv.appendChild(spPrv);
          visOpts.appendChild(labPub);
          visOpts.appendChild(labPrv);
          visPrompt.appendChild(visOpts);
          shell.appendChild(visPrompt);

          if (!isNewNote) {
            const liveRowForPart = attendanceMap().get(row.eventId);
            const initPartRaw = String(
              liveRowForPart?.participation_style ||
                row.participation_style ||
                d?.participation_style ||
                "",
            ).trim();
            const initPartLabel = window.MarchinZMllRole?.participationFormatLabel
              ? window.MarchinZMllRole.participationFormatLabel(initPartRaw)
              : initPartRaw ||
                window.MarchinZMllRole?.PARTICIPATION_UNKNOWN_LABEL ||
                "（参加スタイル不明）";
            readParticipationLabel = wireEldParticipationPicker(shell, initPartLabel);
          }

        const titleIn = document.createElement("input");
        titleIn.type = "text";
        titleIn.className = "eld-title-input mz-search-input";
        titleIn.maxLength = MAX_NOTE_TITLE;
        titleIn.required = true;
        titleIn.value = String(composeDraft?.title ?? diaryDisplayNoteTitle(d));
        titleIn.placeholder = "タイトル（必須・30文字まで）";
        titleIn.setAttribute("aria-label", "タイトル");
        const titleHint = document.createElement("p");
        titleHint.className = "eld-hint";
        titleHint.textContent = "タイトル";
        shell.appendChild(titleIn);
        shell.appendChild(titleHint);

        const ta = document.createElement("textarea");
        ta.className = "eld-body-input";
        ta.maxLength = MAX_BODY;
        ta.rows = 6;
        ta.value = String(composeDraft?.body ?? bodyText);
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
        const coverPick = document.createElement("div");
        coverPick.className = "eld-cover-pick";
        coverPick.hidden = true;
        /** @type {string[]} */
        const coverPickBlobUrls = [];

        function revokeCoverPickBlobUrls() {
          coverPickBlobUrls.forEach((u) => {
            try {
              URL.revokeObjectURL(u);
            } catch {
              //
            }
          });
          coverPickBlobUrls.length = 0;
        }

        function paintCoverPick() {
          clampCoverPhotoIndex();
          const n = totalEditPhotoCount();
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
            "サムネイルをタップして表紙を選びます。Note 一覧・詳細では、選んだ写真の中央を基準に枠へ合わせて表示します（はみ出す部分は表示されません）。";
          coverPick.appendChild(coverNote);
          const grid = document.createElement("div");
          grid.className = "eld-cover-pick-grid";
          editUrls.forEach((url, idx) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "eld-cover-pick-btn" + (idx === coverPhotoIndex ? " is-active" : "");
            const img = document.createElement("img");
            img.src = url;
            img.alt = "";
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
          });
          pendingFiles.forEach((file, pi) => {
            const idx = editUrls.length + pi;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "eld-cover-pick-btn" + (idx === coverPhotoIndex ? " is-active" : "");
            const img = document.createElement("img");
            const blobUrl = URL.createObjectURL(file);
            coverPickBlobUrls.push(blobUrl);
            img.src = blobUrl;
            img.alt = file.name;
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
          });
          coverPick.appendChild(grid);
        }

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
              if (coverPhotoIndex > idx) coverPhotoIndex -= 1;
              else if (coverPhotoIndex === idx) coverPhotoIndex = 0;
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
              const globalIdx = editUrls.length + idx;
              pendingFiles.splice(idx, 1);
              URL.revokeObjectURL(u);
              if (coverPhotoIndex > globalIdx) coverPhotoIndex -= 1;
              else if (coverPhotoIndex === globalIdx) coverPhotoIndex = 0;
              paintThumbs();
            });
            wrap.appendChild(img);
            wrap.appendChild(rm);
            prev.appendChild(wrap);
          });
          paintCoverPick();
        }

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
                  const blob = await compressDiaryImage(f);
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
        phoRow.appendChild(phoLabel);
        phoRow.appendChild(prev);
        phoRow.appendChild(coverPick);
        shell.appendChild(phoRow);

        const saveRow = document.createElement("div");
        saveRow.className = "eld-save-row";
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn-share-search btn-marchinz-spotlight";
        saveBtn.textContent = isNewNote && composeStep === 1 ? "次へ" : "保存する";
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-reset-search";
        delBtn.textContent = "日記を削除";
        delBtn.hidden = !d;
        saveRow.appendChild(saveBtn);
        saveRow.appendChild(delBtn);
        shell.appendChild(err);
        shell.appendChild(saveRow);

        saveBtn.addEventListener("click", () => {
          err.hidden = true;
          const nextTitle = String(titleIn.value || "").trim().slice(0, MAX_NOTE_TITLE);
          const nextBody = String(ta.value || "").slice(0, MAX_BODY);
          const nextVis = rPrv.checked ? "private" : "public";
          if (!nextTitle) {
            err.textContent = "タイトルを入力してください（30文字以内）。";
            err.hidden = false;
            return;
          }
          if (isNewNote && composeStep === 1) {
            state.composeDraft = { title: nextTitle, body: nextBody, vis: nextVis };
            state.composeStep = 2;
            paintDialog();
            return;
          }
          void runDiarySave({
            err,
            saveBtn,
            readParticipationLabel,
            nextTitle,
            nextBody,
            nextVis,
            diaryDoc: d,
          });
        });

        delBtn.addEventListener("click", async () => {
          if (!d || !window.confirm("この MarchinZ Note を削除しますか？")) return;
          delBtn.disabled = true;
          try {
            const R = window.MarchinZMllRole;
            if (R?.removeUserInvolvementForCalendarEvent) {
              await R.removeUserInvolvementForCalendarEvent(
                db,
                targetUid,
                {
                  eventId: row.eventId,
                  eventDate: String(row.date || "").trim(),
                  eventName: String(row.title || row.eventName || "").trim(),
                },
                { deleteLogs: true, deleteAttendance: true, deleteDiary: true },
              );
            } else {
              await db
                .collection("mll_profiles")
                .doc(targetUid)
                .collection("event_log_diaries")
                .doc(row.eventId)
                .delete();
            }
            diaries.delete(row.eventId);
            closeDialog();
            renderList();
            window.dispatchEvent(new CustomEvent("marchinz-profile-saved"));
            window.dispatchEvent(
              new CustomEvent("marchinz-mll-updated", { detail: { userId: targetUid } }),
            );
          } catch (e) {
            console.warn(e);
            err.textContent = String(e?.message || "削除に失敗しました。");
            err.hidden = false;
          } finally {
            delBtn.disabled = false;
          }
        });
        }
      }

      host.appendChild(shell);

      const close = document.createElement("button");
      close.type = "button";
      close.className = "eld-dialog-close";
      close.textContent = "閉じる";
      close.addEventListener("click", () => closeDialog());
      host.appendChild(close);
    }

    if (mountGen !== profileEldMountSeq) return { diaryCount: 0 };
    renderList();

    const hp =
      typeof window.MarchinZProfileHashParams === "function"
        ? window.MarchinZProfileHashParams()
        : new URLSearchParams("");
    const openEv = hp.get("event");
    const wantEdit = hp.get("edit") === "1";
    if (openEv && hp.get("tab") === "logdiary") {
      const openTarget = resolveNoteHashOpenTarget(openEv, attendance, diaries);
      if (openTarget) {
        const { row: openRow, diary: openDiary } = openTarget;
        if (isOwner) {
          if (openDiary) {
            state = { mode: wantEdit ? "edit" : "view", row: openRow, diary: openDiary };
            if (wantEdit) syncEditUrlsFromDiary();
          } else {
            state = { mode: "edit", row: openRow, diary: null, composeStep: 1 };
          }
          const loadMountGen = mountGen;
          const loadUid = targetUid;
          const loadEv = openEv;
          window.requestAnimationFrame(() => {
            if (loadMountGen !== profileEldMountSeq) return;
            openDialog();
          });
        } else {
          const loadMountGen = mountGen;
          const loadUid = targetUid;
          const loadEv = openEv;
          window.requestAnimationFrame(() => {
            if (loadMountGen !== profileEldMountSeq) return;
            void openNoteViewer({
              uid: loadUid,
              eventId: loadEv,
              returnHash: location.hash,
            });
          });
        }
      } else if (!isOwner) {
        const loadMountGen = mountGen;
        const loadUid = targetUid;
        const loadEv = openEv;
        window.requestAnimationFrame(() => {
          if (loadMountGen !== profileEldMountSeq) return;
          void openNoteViewer({
            uid: loadUid,
            eventId: loadEv,
            returnHash: location.hash,
          });
        });
      }
    }

    root._eldReloadFromMllUpdated = async (changedUid) => {
      if (changedUid && changedUid !== targetUid) return;
      try {
        [attendance, diaries] = await Promise.all([
          loadAttendanceRows(db, targetUid),
          loadDiaries(db, targetUid),
        ]);
        if (window.MarchinZMllRole?.reconcileDiariesParticipationFromLogs && diaries.size) {
          const rows = [...diaries.entries()].map(([eventId, data]) => ({
            uid: targetUid,
            eventId,
            data: data && typeof data === "object" ? { ...data } : {},
          }));
          try {
            await window.MarchinZMllRole.reconcileDiariesParticipationFromLogs(db, rows);
            for (const r of rows) {
              if (r.eventId && r.data) diaries.set(r.eventId, r.data);
            }
          } catch (e) {
            console.warn("[event-log-diary] reconcile participation_style from Log", e);
          }
        }
        renderList();
        if (state?.row) {
          const attMap = attendanceMap();
          state.row.participation_style = rowParticipationDisplay(state.row, attMap);
          if (state.diary && diaries.has(state.row.eventId)) {
            state.diary = diaries.get(state.row.eventId);
          }
          paintDialog();
        }
      } catch (e) {
        console.warn("[event-log-diary] reload on marchinz-mll-updated", e);
      }
    };

    const diaryCount = isOwner
      ? diaries.size
      : [...diaries.values()].filter((d) => String(d.visibility || "public") !== "private").length;
    return { diaryCount };
  }


  /** @type {string|null} */
  let viewerReturnHash = null;

  function mountMlnNoteViewerDialog() {
    const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById("mln-note-viewer"));
    if (!dlg) return null;
    if (dlg.parentElement !== document.body) {
      document.body.appendChild(dlg);
    }
    return dlg;
  }

  function wireMlnViewerDialog() {
    const dlg = mountMlnNoteViewerDialog();
    if (!dlg || dlg.dataset.mlnViewerWired) return dlg;
    dlg.dataset.mlnViewerWired = "1";
    dlg.querySelector("[data-mln-viewer-close]")?.addEventListener("click", () => closeNoteViewer());
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) closeNoteViewer();
    });
    dlg.addEventListener("close", () => {
      dlg.setAttribute("hidden", "");
      if (viewerReturnHash != null && location.hash !== viewerReturnHash) {
        const target = viewerReturnHash.startsWith("#") ? viewerReturnHash : `#${viewerReturnHash}`;
        history.replaceState(null, "", `${location.pathname}${location.search}${target}`);
      }
      viewerReturnHash = null;
    });
    return dlg;
  }

  function showMlnNoteViewerDialog(dlg) {
    dlg.removeAttribute("hidden");
    try {
      if (!dlg.open) dlg.showModal();
    } catch (e) {
      console.warn("[MarchinZ] mln-note-viewer showModal", e);
      dlg.setAttribute("open", "");
    }
  }

  function closeNoteViewer() {
    const dlg = document.getElementById("mln-note-viewer");
    if (!dlg) return;
    try {
      if (dlg.open) dlg.close();
    } catch {
      //
    }
    dlg.setAttribute("hidden", "");
    dlg.removeAttribute("open");
  }

  function participationStyleLabel(raw) {
    const R = window.MarchinZMllRole;
    if (R?.participationFormatLabel) return R.participationFormatLabel(raw);
    return String(raw || "").trim();
  }

  /** @param {{ date?: string; participation_style?: string }} row */
  function formatEldEventCardMeta(row) {
    const date = String(row?.date || "").trim().replace(/-/g, "/");
    const sty = participationStyleLabel(row?.participation_style);
    if (date && sty) return `${date}  ${sty}`;
    return date || sty || "—";
  }

  /**
   * Log / attendees が無いときは古い Note フィールドを出さず「—」
   * @param {{ eventId?: string; participation_style?: string }} row
   * @param {Map<string, { participation_style?: string }>} attMap
   */
  function rowParticipationDisplay(row, attMap) {
    const eid = String(row?.eventId || "").trim();
    if (eid && attMap.has(eid)) {
      const live = String(attMap.get(eid)?.participation_style || "").trim();
      if (live) return live;
    }
    return "—";
  }

  if (!globalThis.__marchinzEldMllUpdatedWired) {
    globalThis.__marchinzEldMllUpdatedWired = true;
    window.addEventListener("marchinz-mll-updated", (ev) => {
      const changedUid = String(ev.detail?.userId || "").trim();
      const root = document.getElementById("prof-log-diary-root");
      const reload = root && /** @type {{ _eldReloadFromMllUpdated?: (uid: string) => Promise<void> }} */ (root)
        ._eldReloadFromMllUpdated;
      if (typeof reload === "function") void reload(changedUid);
    });
  }

  function appendMllLogRowBadge(parent) {
    const label = window.MarchinZMllRole?.MLL_LOG_ROW_BADGE_LABEL || "MarchinZ Log";
    const lab = document.createElement("span");
    lab.className = "calendar-ev-mll-log-label mln-feed-mll-log-label";
    lab.textContent = label;
    parent.appendChild(lab);
  }

  function appendNotePartChip(parent, styleText) {
    const sty = participationStyleLabel(styleText);
    const cls = participationChipClassName(styleText);
    if (!sty || !cls) return;
    const chip = document.createElement("span");
    chip.className = cls;
    chip.textContent = sty;
    parent.appendChild(chip);
  }

  function appendViewerSubline(parent, row, diary) {
    const noteTitle = diaryDisplayNoteTitle(diary);
    const eventName = diaryDisplayEventName(diary, row);
    const evName = String(eventName || "").trim();
    const evd = String(row.date || diary.event_date || "")
      .trim()
      .replace(/-/g, "/");
    const sty = participationStyleLabel(row.participation_style || diary.participation_style);
    const showEvent = evName && (!noteTitle || noteTitle !== evName);
    const sub = document.createElement("p");
    sub.className = "mln-feed-card-subline eld-view-subline";
    appendMllLogRowBadge(sub);
    if (showEvent) {
      const evSpan = document.createElement("span");
      evSpan.className = "mln-feed-card-subline-event";
      evSpan.textContent = evName;
      sub.appendChild(evSpan);
    }
    if (evd) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "mln-feed-card-subline-date";
      dateSpan.textContent = evd;
      sub.appendChild(dateSpan);
    }
    if (sty) {
      appendNotePartChip(sub, sty);
    }
    parent.appendChild(sub);
  }

  function appendViewerLikeRow(titleRow, db, uid, diary, eventId, onToggled) {
    const me = window.MLL_AUTH?.getUser?.();
    const lb = normDiaryLikedBy(diary.liked_by);
    const cnt = Object.keys(lb).filter((k) => lb[k]).length;
    const liked = Boolean(me?.id && lb[me.id]);
    const host = document.createElement("div");
    const row = window.MarchinZEngageUi?.buildLikeRow(host, {
      liked,
      count: cnt,
      onClick: async () => {
        const saved = await runDiaryLikeToggle(db, uid, eventId);
        if (!saved) return false;
        onToggled(saved);
      },
      stopPropagation: true,
    });
    if (row) {
      row.classList.add("mz-inline-like-host");
      window.MarchinZEngageUi?.appendInlineLike?.(titleRow, row) || titleRow.appendChild(row);
    }
  }

  /**
   * @param {HTMLElement} host
   * @param {{ uid: string; row: any; diary: Record<string, unknown>; author: { name: string; avatar: string } }} ctx
   */
  function paintNoteViewerBody(host, ctx) {
    const { uid, row, diary, author } = ctx;
    const db = window.MLL_AUTH?.getDb?.();
    host.replaceChildren();
    const shell = document.createElement("div");
    shell.className = "eld-shell mln-note-viewer-shell";

    const allViewUrls = userNotePhotoUrls(diary.photo_urls);
    const showFourGrid = allViewUrls.length === 4;
    if (showFourGrid) {
      shell.appendChild(buildPhotoGridWrap(allViewUrls));
    } else {
      const coverUrl =
        window.MarchinZDefaultAssets?.noteCoverUrl?.(diary.photo_urls, diary.cover_photo_index) ||
        allViewUrls[0] ||
        window.MarchinZDefaultAssets?.noteThumbnailDefault?.();
      if (coverUrl) {
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
          im.loading = "eager";
          coverWrap.appendChild(im);
        }
        shell.appendChild(coverWrap);
      }
    }

    const head = document.createElement("div");
    head.className = "mln-feed-card-head";
    const headAside = document.createElement("div");
    headAside.className = "mln-feed-card-head-aside";
    const av = document.createElement("img");
    av.className = "mln-feed-card-head-avatar";
    av.alt = "";
    av.width = 40;
    av.height = 40;
    av.decoding = "async";
    av.src =
      author.avatar && /^https?:\/\//i.test(author.avatar)
        ? author.avatar
        : PROFILE_AVATAR_FALLBACK;
    headAside.appendChild(av);
    const base = `${location.pathname}${location.search}`;
    const nm = document.createElement("a");
    nm.className = "mln-feed-author-name mln-feed-author-name-link";
    nm.href = `${base}#profile?uid=${encodeURIComponent(uid)}`;
    nm.textContent = author.name;
    headAside.appendChild(nm);
    head.appendChild(headAside);
    const headMain = document.createElement("div");
    headMain.className = "mln-feed-card-head-main";
    const titleRow = document.createElement("div");
    titleRow.className = "mln-feed-card-title-row mz-title-like-row";
    const noteTitle = diaryDisplayNoteTitle(diary) || diaryDisplayEventName(diary, row);
    const h2 = document.createElement("h2");
    h2.className = "eld-view-title mln-feed-card-title";
    h2.textContent = noteTitle || "（無題）";
    titleRow.appendChild(h2);
    if (db) {
      appendViewerLikeRow(titleRow, db, uid, diary, row.eventId, (saved) => {
        paintNoteViewerBody(host, { ...ctx, diary: saved });
      });
    }
    headMain.appendChild(titleRow);
    appendViewerSubline(headMain, row, diary);
    head.appendChild(headMain);
    shell.appendChild(head);

    const text = document.createElement("div");
    text.className = "eld-body-text";
    text.textContent = String(diary.body || "").trim() || "（本文はまだありません）";
    shell.appendChild(text);

    if (!showFourGrid) {
      const galleryUrls = diaryGalleryPhotoUrls(diary);
      if (galleryUrls.length) shell.appendChild(buildPhotoGridWrap(galleryUrls));
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "eld-dialog-close";
    close.textContent = "閉じる";
    close.addEventListener("click", () => closeNoteViewer());

    const me = window.MLL_AUTH?.getUser?.();
    const showOwnerActions = me?.id === uid;
    if (showOwnerActions) {
      const er = document.createElement("div");
      er.className = "eld-view-actions mln-note-viewer-actions";
      if (noteDiaryIsPublic(diary)) {
        appendNoteShareButton(er, uid, row.eventId, diary, row);
      }
      const eb = document.createElement("button");
      eb.type = "button";
      eb.className = "btn-share-search btn-marchinz-spotlight";
      eb.textContent = "編集する";
      eb.addEventListener("click", () => {
        const targetHash = `#profile?uid=${encodeURIComponent(uid)}&tab=logdiary&event=${encodeURIComponent(row.eventId)}&edit=1`;
        closeNoteViewer();
        window.requestAnimationFrame(() => {
          if (location.hash !== targetHash) location.hash = targetHash;
        });
      });
      er.appendChild(eb);
      if (er.childElementCount) shell.appendChild(er);
    }

    host.appendChild(shell);
    host.appendChild(close);

    if (me?.id && me.id !== uid && db) {
      const engage = document.createElement("div");
      engage.className = "mln-feed-card-engage";
      engage.appendChild(
        buildNoteReportMenu(uid, row.eventId, noteTitle || diaryDisplayEventName(diary, row)),
      );
      shell.appendChild(engage);
    }
  }

  async function openNoteViewer({ uid, eventId, returnHash }) {
    const dlg = wireMlnViewerDialog();
    if (!dlg) return;
    const body = dlg.querySelector("[data-mln-viewer-body]");
    if (!body) return;
    viewerReturnHash = returnHash ?? location.hash;
    body.textContent = "読み込み中…";
    showMlnNoteViewerDialog(dlg);
    const db = window.MLL_AUTH?.getDb?.();
    if (!db) {
      body.textContent = "データに接続できません。ページを再読み込みしてください。";
      return;
    }
    try {
      const [dSnap, pSnap] = await Promise.all([
        db.collection("mll_profiles").doc(uid).collection("event_log_diaries").doc(eventId).get(),
        db.collection("mll_profiles").doc(uid).get(),
      ]);
      if (!dSnap.exists) {
        body.textContent = "見つかりませんでした。";
        return;
      }
      const diary = { id: eventId, ...(dSnap.data() || {}) };
      const pd = pSnap.exists ? pSnap.data() || {} : {};
      const me = window.MLL_AUTH?.getUser?.();
      if (Boolean(pd.banned) && (!me || me.id !== uid)) {
        body.textContent = "このアカウントは凍結されているため、Note を表示できません。";
        return;
      }
      if (String(diary.visibility || "public") === "private" && (!me || me.id !== uid)) {
        body.textContent = "非公開の Note です。";
        return;
      }
      const author = {
        name: Boolean(pd.withdrawn)
          ? "退会ユーザー"
          : String(pd.display_name || "").trim() || "ユーザー",
        avatar: String(pd.avatar_url || "").trim(),
      };
      const row = {
        eventId,
        date: String(diary.event_date || "").trim(),
        title: String(diary.event_title || "").trim(),
        eventName: String(diary.event_title || "").trim(),
        participation_style: String(diary.participation_style || "").trim(),
      };
      paintNoteViewerBody(body, { uid, row, diary, author });
    } catch (e) {
      console.warn(e);
      if (String(e?.code || "") === "permission-denied") {
        body.textContent = "非公開の Note です。";
        return;
      }
      body.textContent = "読み込みに失敗しました。";
    }
  }

  window.MarchinZNoteActions = {
    openViewer: openNoteViewer,
    toggleDiaryLike: runDiaryLikeToggle,
    reportDiary: reportDiaryNote,
    diaryDisplayNoteTitle,
    diaryDisplayEventName,
    buildNoteReportMenu,
    buildProfileUrlWithDiary,
    noteDiaryIsPublic,
    canShareProfileMarchinZNote,
    get placeholderImage() {
      return window.MarchinZDefaultAssets?.noteThumbnailDefault?.() || "img/defaults/marchinznote_d.jpg";
    },
  };

  window.MarchinZEventLogDiary = {
    /**
     * @param {HTMLElement|null} root
     * @param {{ targetUid: string; viewerId: string|null; db: FirebaseFirestore.Firestore; likeShowLog?: boolean; previewAsOtherMember?: boolean; authorDisplay?: { name: string; avatar?: string } }} ctx
     */
    async mount(root, ctx) {
      if (!root) return { diaryCount: 0 };
      const mountGen = ++profileEldMountSeq;
      if (!root.dataset.eldDlgWired) {
        root.dataset.eldDlgWired = "1";
        const dlg = /** @type {HTMLDialogElement|null} */ (root.querySelector("[data-eld-dialog]"));
        dlg?.addEventListener("click", (ev) => {
          if (ev.target === dlg) root._eldCloseDialog?.();
        });
      }
      const result = await render(root, ctx, mountGen);
      if (mountGen !== profileEldMountSeq) return { diaryCount: 0 };
      return result || { diaryCount: 0 };
    },
  };
})();
