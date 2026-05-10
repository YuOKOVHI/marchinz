(() => {
  const LS_KEY_MLL_LOGS = "marchinz_mll_logs_v1";

  const form = document.getElementById("mll-log-form");
  const inputName = document.getElementById("mll-event-name");
  const inputDate = document.getElementById("mll-event-date");
  const inputVenue = document.getElementById("mll-venue");
  const selectRole = document.getElementById("mll-role");
  const inputOfficialUrl = document.getElementById("mll-official-url");
  const selectEventKind = document.getElementById("mll-event-kind");
  const roleButtons = document.getElementById("mll-role-buttons");
  const btnSave = document.getElementById("btn-mll-save");
  const errorEventName = document.getElementById("mll-error-event-name");
  const errorEventDate = document.getElementById("mll-error-event-date");
  const errorVenue = document.getElementById("mll-error-venue");
  const errorRole = document.getElementById("mll-error-role");
  const errorEventKind = document.getElementById("mll-error-event-kind");
  const msg = document.getElementById("mll-create-msg");
  const list = document.getElementById("mll-log-list");
  const eventList = document.getElementById("mll-event-list");
  const profileViewer = document.getElementById("mll-profile-viewer");
  const profileCard = document.getElementById("mll-profile-card");
  const rolePreview = document.getElementById("mll-role-preview");

  const CALENDAR_KIND_OPTIONS = ["演奏会", "大会", "イベント"];
  if (!form || !list || !inputName || !inputDate || !selectRole || !selectEventKind) return;

  /** Firestore 保存値は watch / perform / team_staff / ops（旧 staff は team_staff に読み替え） */
  const ROLE_LABEL = {
    watch: { present: "観戦する", past: "観戦した" },
    perform: { present: "出演する", past: "出演した" },
    team_staff: { present: "チームスタッフで参加する", past: "チームスタッフで参加した" },
    ops: { present: "運営側で参加する", past: "運営側で参加した" },
  };

  function canonicalRole(role) {
    const r = String(role || "").trim();
    if (r === "staff" || r === "team_staff" || r === "チームスタッフ") return "team_staff";
    if (r === "ops" || r === "manage" || r === "運営") return "ops";
    if (r === "perform" || r === "出演") return "perform";
    if (r === "watch" || r === "観戦") return "watch";
    return "watch";
  }
  const UNKNOWN_USER = "ユーザー";
  const MLL_MESSAGE = {
    deleteFailed: "削除に失敗しました。時間をおいて再度お試しください。",
    visibilityUpdateFailed: "公開設定の更新に失敗しました。時間をおいて再度お試しください。",
    likeUpdateFailed: "いいねの更新に失敗しました。時間をおいて再度お試しください。",
  };

  function mllFriendlyErrorMessage(err, fallback) {
    const code = String(err?.code || "").trim();
    if (code === "auth/network-request-failed") return "通信エラーが発生しました。通信環境をご確認ください。";
    if (code === "permission-denied") return "この操作を行う権限がありません。";
    if (code === "unavailable") return "ただいま混み合っています。少し時間をおいて再度お試しください。";
    return fallback;
  }
  let allLogsCache = [];
  const profileCache = new Map();

  function normalizeLikedBy(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-zA-Z0-9_-]{8,128}$/.test(k) && v === true) out[k] = true;
    }
    return out;
  }

  function logVisibility(log) {
    return log && log.visibility === "private" ? "private" : "public";
  }

  /** 閲覧者 viewerUserId（未ログインは null）が当該ログを見られてよいか */
  function canViewerSeeLog(log, viewerUserId) {
    if (logVisibility(log) === "public") return true;
    return Boolean(viewerUserId && String(log.user_id) === String(viewerUserId));
  }

  function normalizeLogEntry(x) {
    if (!x || typeof x !== "object") return x;
    const visibility = logVisibility(x);
    return { ...x, visibility, liked_by: normalizeLikedBy(x.liked_by) };
  }

  function loadLogs() {
    try {
      const raw = localStorage.getItem(LS_KEY_MLL_LOGS);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map((row) => normalizeLogEntry(row)) : [];
    } catch {
      return [];
    }
  }

  function saveLogs(logs) {
    try {
      localStorage.setItem(LS_KEY_MLL_LOGS, JSON.stringify(logs));
    } catch {
      // ignore
    }
  }

  function getAuthUser() {
    return window.MLL_AUTH?.getUser?.() || null;
  }

  function getFirestoreDb() {
    return window.MLL_AUTH?.getDb?.() || null;
  }

  function cleanUrl(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    return `https://${s}`;
  }

  function displayNameFromUser(user) {
    return user?.user_metadata?.full_name || user?.user_metadata?.name || UNKNOWN_USER;
  }

  function isPastDate(dateStr) {
    if (!dateStr) return false;
    const d = new Date(`${dateStr}T00:00:00`);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d < today;
  }

  function buildRoleLabel(role, dateStr) {
    const key = canonicalRole(role);
    const r = ROLE_LABEL[key] || ROLE_LABEL.watch;
    return isPastDate(dateStr) ? r.past : r.present;
  }

  function updateRolePreview() {
    if (!rolePreview) return;
    if (!String(selectRole.value || "").trim()) {
      rolePreview.textContent = "表示: 参加スタイルを選択してください";
      return;
    }
    const label = buildRoleLabel(selectRole.value, inputDate.value);
    rolePreview.textContent = `表示: ${label}`;
  }

  function setMessage(text, isError = false) {
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = isError ? "#b71c1c" : "";
  }

  function setFieldError(node, text) {
    if (!node) return;
    node.textContent = String(text || "");
  }

  function clearFieldErrors() {
    setFieldError(errorEventName, "");
    setFieldError(errorEventDate, "");
    setFieldError(errorVenue, "");
    setFieldError(errorRole, "");
    setFieldError(errorEventKind, "");
  }

  function profileForUserId(userId, fallbackName = UNKNOWN_USER, fallbackAvatar = "") {
    const p = profileCache.get(userId) || {};
    return {
      id: userId,
      display_name: p.display_name || fallbackName || UNKNOWN_USER,
      avatar_url: p.avatar_url || fallbackAvatar || "",
    };
  }

  async function deleteMllLog(log) {
    const user = getAuthUser();
    if (!user?.id || String(log.user_id) !== String(user.id)) return;
    const name = String(log.event_name || "").slice(0, 120);
    const ok = window.confirm(
      `「${name || "この大会"}」の参加記録を削除しますか？\n削除すると一覧から消え、取り消せません。`
    );
    if (!ok) return;
    const logId = String(log.id);
    const db = getFirestoreDb();
    if (db) {
      try {
        await db.collection("mll_logs").doc(logId).delete();
      } catch (e) {
        setMessage(mllFriendlyErrorMessage(e, MLL_MESSAGE.deleteFailed), true);
        return;
      }
    }
    saveLogs(loadLogs().filter((L) => String(L.id) !== logId));
    setMessage("参加記録を削除しました。");
    await refreshMLLView();
  }

  async function setLogVisibility(log, nextVisibility, opts) {
    const user = getAuthUser();
    if (!user?.id || String(log.user_id) !== String(user.id)) return;
    const vis = nextVisibility === "private" ? "private" : "public";
    const id = String(log.id);
    const db = getFirestoreDb();
    if (db) {
      try {
        await db.collection("mll_logs").doc(id).set({ visibility: vis }, { merge: true });
      } catch (e) {
        setMessage(mllFriendlyErrorMessage(e, MLL_MESSAGE.visibilityUpdateFailed), true);
        return;
      }
    }
    saveLogs(
      loadLogs().map((L) =>
        String(L.id) === id ? normalizeLogEntry({ ...L, visibility: vis }) : L
      )
    );
    if (vis === "private") {
      setMessage("この記録を非公開にしました。");
    } else if (opts?.wasPrivate) {
      setMessage(
        "この記録を公開にしました。プロフィールで他の方にも見てもらうには、公開範囲で「MarchinZ Log」も公開にしてください。",
        false,
      );
      window.setTimeout(() => setMessage(""), 10000);
    } else {
      setMessage("この記録を公開しました。");
    }
    await refreshMLLView();
  }

  function renderMyLogs() {
    const userId = getAuthUser()?.id || null;
    const logs = allLogsCache
      .filter((x) => (userId ? x.user_id === userId : false))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    list.innerHTML = "";
    if (!logs.length) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent = "まだログはありません。";
      list.appendChild(li);
      return;
    }

    for (const log of logs) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      const title = document.createElement("p");
      title.className = "mll-log-title";
      title.textContent = `${log.event_name}`;
      const meta = document.createElement("p");
      meta.className = "mll-log-meta";
      meta.textContent = `${log.event_date} / ${buildRoleLabel(log.role, log.event_date)}${log.venue ? ` / ${log.venue}` : ""}`;
      li.appendChild(title);
      li.appendChild(meta);
      const visNote = document.createElement("p");
      visNote.className = "mll-log-meta mll-log-visibility-note";
      visNote.textContent =
        logVisibility(log) === "private"
          ? "非公開（他のユーザーにはこの記録は表示されません）"
          : "公開（イベント一覧・プロフィールから他のユーザーにも見えます）";
      li.appendChild(visNote);
      if (log.ticket_url || log.official_url) {
        const links = document.createElement("p");
        links.className = "mll-log-note";
        appendLinkRow(links, [
          { href: log.ticket_url, label: "チケット" },
          { href: log.official_url, label: "公式" },
        ]);
        li.appendChild(links);
      }
      if (log.note) {
        const note = document.createElement("p");
        note.className = "mll-log-note";
        note.textContent = log.note;
        li.appendChild(note);
      }
      const likeHost = document.createElement("div");
      likeHost.className = "mll-log-like-host";
      appendMllLikeRow(likeHost, log);
      li.appendChild(likeHost);
      const actions = document.createElement("div");
      actions.className = "mll-log-self-actions";
      const visBtn = document.createElement("button");
      visBtn.type = "button";
      visBtn.className = "btn-reset-search mll-log-visibility-btn";
      visBtn.textContent = logVisibility(log) === "private" ? "公開にする" : "非公開にする";
      visBtn.setAttribute(
        "aria-label",
        logVisibility(log) === "private" ? "この参加記録を公開にする" : "この参加記録を非公開にする"
      );
      visBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const next = logVisibility(log) === "private" ? "public" : "private";
        void setLogVisibility(log, next, { wasPrivate: logVisibility(log) === "private" });
      });
      actions.appendChild(visBtn);
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-reset-search mll-log-delete-btn";
      delBtn.textContent = "この記録を削除";
      delBtn.setAttribute("aria-label", `${log.event_name || "参加記録"}を削除`);
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void deleteMllLog(log);
      });
      actions.appendChild(delBtn);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  function openUserProfile(userId, fallbackName = UNKNOWN_USER, fallbackAvatar = "") {
    if (!profileViewer || !profileCard || !userId) return;
    const p = profileForUserId(userId, fallbackName, fallbackAvatar);
    const viewerId = getAuthUser()?.id || null;
    const userLogs = allLogsCache.filter(
      (x) => String(x.user_id) === String(userId) && canViewerSeeLog(x, viewerId)
    );
    profileCard.innerHTML = "";
    const avatar = document.createElement("img");
    avatar.className = "profile-avatar";
    avatar.src = p.avatar_url || "logo/marchinz-logo.png";
    avatar.alt = `${p.display_name} のプロフィール画像`;
    const body = document.createElement("div");
    body.className = "profile-main";
    const name = document.createElement("p");
    name.className = "profile-name";
    name.textContent = p.display_name || UNKNOWN_USER;
    const stats = document.createElement("p");
    stats.className = "mll-log-meta";
    stats.textContent = `投稿ログ: ${userLogs.length}件`;
    body.appendChild(name);
    body.appendChild(stats);
    const profPage = document.createElement("p");
    profPage.className = "mll-log-meta";
    const pa = document.createElement("a");
    pa.href = `#profile?uid=${encodeURIComponent(String(userId))}`;
    pa.className = "mll-profile-page-link";
    pa.textContent = "プロフィールページを開く";
    profPage.appendChild(pa);
    body.appendChild(profPage);
    profileCard.appendChild(avatar);
    profileCard.appendChild(body);
    profileViewer.hidden = false;
  }

  function renderEventList() {
    if (!eventList) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const viewerId = getAuthUser()?.id || null;
    const grouped = new Map();
    for (const log of allLogsCache) {
      if (!canViewerSeeLog(log, viewerId)) continue;
      if (!log.event_date || log.event_date < todayStr) continue;
      const key = `${log.event_name}__${log.event_date}__${log.venue || ""}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          event_name: log.event_name,
          event_date: log.event_date,
          venue: log.venue || "",
          ticket_url: log.ticket_url || "",
          official_url: log.official_url || "",
          creator_id: log.user_id || "",
          creator_name: log.creator_name || UNKNOWN_USER,
          creator_avatar: log.creator_avatar || "",
          participants: new Map(),
        });
      }
      const item = grouped.get(key);
      if (!item.ticket_url && log.ticket_url) item.ticket_url = log.ticket_url;
      if (!item.official_url && log.official_url) item.official_url = log.official_url;
      if (log.created_at && (!item.created_at || String(log.created_at) < String(item.created_at))) {
        item.created_at = log.created_at;
        item.creator_id = log.user_id || item.creator_id;
        item.creator_name = log.creator_name || item.creator_name;
        item.creator_avatar = log.creator_avatar || item.creator_avatar;
      }
      if (log.user_id) {
        const p = profileForUserId(log.user_id, log.creator_name || UNKNOWN_USER, log.creator_avatar || "");
        item.participants.set(log.user_id, {
          id: log.user_id,
          logId: String(log.id),
          name: p.display_name,
          avatar: p.avatar_url,
          role: canonicalRole(log.role),
          role_label: log.role_label || buildRoleLabel(log.role, log.event_date),
        });
      }
    }

    const events = [...grouped.values()].sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
    const logById = new Map(allLogsCache.map((row) => [String(row.id), row]));
    eventList.innerHTML = "";
    if (!events.length) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      li.textContent = "今後の大会・演奏会情報はまだありません。";
      eventList.appendChild(li);
      return;
    }

    for (const ev of events) {
      const li = document.createElement("li");
      li.className = "mll-log-item";
      const title = document.createElement("p");
      title.className = "mll-log-title";
      title.textContent = ev.event_name;
      const meta = document.createElement("p");
      meta.className = "mll-log-meta";
      meta.textContent = `${ev.event_date}${ev.venue ? ` / ${ev.venue}` : ""}`;

      const creatorRow = document.createElement("p");
      creatorRow.className = "mll-log-meta";
      creatorRow.textContent = "情報作成者: ";
      const creatorBtn = document.createElement("button");
      creatorBtn.type = "button";
      creatorBtn.className = "visible-orgs-tag mll-user-chip";
      creatorBtn.textContent = ev.creator_name || UNKNOWN_USER;
      creatorBtn.addEventListener("click", () =>
        openUserProfile(ev.creator_id, ev.creator_name || UNKNOWN_USER, ev.creator_avatar || "")
      );
      creatorRow.appendChild(creatorBtn);

      const participantWrap = document.createElement("div");
      participantWrap.className = "visible-orgs";
      const participantLabel = document.createElement("span");
      participantLabel.className = "visible-orgs-label";
      participantLabel.textContent = "参戦予定";
      const participantTags = document.createElement("div");
      participantTags.className = "visible-orgs-tags mll-participant-rows";
      const participants = [...ev.participants.values()];
      if (!participants.length) {
        const emptyTag = document.createElement("span");
        emptyTag.className = "visible-orgs-tag";
        emptyTag.textContent = "未登録";
        participantTags.appendChild(emptyTag);
      } else {
        for (const p of participants) {
          const row = document.createElement("div");
          row.className = "mll-participant-like-row";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "visible-orgs-tag mll-user-chip";
          btn.textContent = `${p.name}（${buildRoleLabel(p.role, ev.event_date)}）`;
          btn.addEventListener("click", () => openUserProfile(p.id, p.name, p.avatar || ""));
          row.appendChild(btn);
          const lg = p.logId ? logById.get(String(p.logId)) : null;
          if (lg) {
            const likeHost = document.createElement("div");
            likeHost.className = "mll-log-like-host";
            appendMllLikeRow(likeHost, lg);
            row.appendChild(likeHost);
          }
          participantTags.appendChild(row);
        }
      }
      participantWrap.appendChild(participantLabel);
      participantWrap.appendChild(participantTags);

      li.appendChild(title);
      li.appendChild(meta);
      li.appendChild(creatorRow);
      if (ev.ticket_url || ev.official_url) {
        const links = document.createElement("p");
        links.className = "mll-log-note";
        appendLinkRow(links, [
          { href: ev.ticket_url, label: "チケットページ" },
          { href: ev.official_url, label: "公式ページ" },
        ]);
        li.appendChild(links);
      }
      li.appendChild(participantWrap);
      eventList.appendChild(li);
    }
  }

  async function loadRemoteProfiles() {
    const db = getFirestoreDb();
    if (!db) return;
    try {
      const snap = await db.collection("mll_profiles").limit(500).get();
      snap.forEach((doc) => {
        const p = doc.data() || {};
        if (!doc.id) return;
        profileCache.set(doc.id, {
          display_name: p.display_name || UNKNOWN_USER,
          avatar_url: p.avatar_url || "",
          like_show_mll: p.like_show_mll !== false,
        });
      });
    } catch {
      // Firestore未設定時などはローカル情報を利用
    }
  }

  async function loadAllLogs() {
    const localLogs = loadLogs();
    const byId = new Map();
    for (const x of localLogs) {
      const cr = canonicalRole(x.role);
      byId.set(
        String(x.id),
        normalizeLogEntry({
          ...x,
          role: cr,
          role_label: buildRoleLabel(cr, x.event_date),
        }),
      );
    }
    const db = getFirestoreDb();
    if (db) {
      try {
        const snap = await db.collection("mll_logs").orderBy("created_at", "desc").limit(800).get();
        snap.forEach((doc) => {
          const x = doc.data() || {};
          const id = doc.id;
          const cr = canonicalRole(x.role);
          const merged = normalizeLogEntry({
            ...x,
            id,
            role: cr,
            role_label: buildRoleLabel(cr, x.event_date),
            creator_name: x.creator_name || UNKNOWN_USER,
            creator_avatar: x.creator_avatar || "",
            ticket_url: cleanUrl(x.ticket_url || ""),
            official_url: cleanUrl(x.official_url || ""),
          });
          byId.set(id, merged);
        });
      } catch {
        // リモート読み込み失敗時はローカルのみ
      }
    }
    allLogsCache = [...byId.values()];
  }

  async function refreshMLLView() {
    await loadRemoteProfiles();
    const u = getAuthUser();
    const db = getFirestoreDb();
    if (u?.id && db) {
      try {
        const s = await db.collection("mll_profiles").doc(u.id).get();
        const p = s.data() || {};
        const ex = profileCache.get(u.id) || {};
        profileCache.set(u.id, {
          ...ex,
          display_name: p.display_name || ex.display_name || UNKNOWN_USER,
          avatar_url: p.avatar_url || ex.avatar_url || "",
          like_show_mll: p.like_show_mll !== false,
        });
      } catch {
        //
      }
    }
    await loadAllLogs();
    renderMyLogs();
    renderEventList();
  }

  function appendLinkRow(container, items) {
    const validItems = items.filter((x) => x?.href);
    validItems.forEach((item, idx) => {
      const a = document.createElement("a");
      a.href = item.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = item.label;
      container.appendChild(a);
      if (idx !== validItems.length - 1) {
        container.appendChild(document.createTextNode(" / "));
      }
    });
  }

  function toggleMllLikeLocal(logId, uid) {
    const logs = loadLogs();
    let hit = false;
    const next = logs.map((L) => {
      if (String(L.id) !== String(logId)) return L;
      hit = true;
      const lb = { ...(L.liked_by && typeof L.liked_by === "object" ? L.liked_by : {}) };
      if (lb[uid]) delete lb[uid];
      else lb[uid] = true;
      return { ...L, liked_by: lb };
    });
    if (hit) saveLogs(next);
  }

  async function toggleMllLogLike(logId) {
    const user = getAuthUser();
    if (!user?.id) {
      window.MarchinZNavigateAuthEntry?.("login");
      return;
    }
    const db = getFirestoreDb();
    if (!db) {
      toggleMllLikeLocal(logId, user.id);
      await refreshMLLView();
      return;
    }
    /** @type {{ owner: string; eventName: string } | null} */
    let likeNotify = null;
    try {
      const ref = db.collection("mll_logs").doc(String(logId));
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
          const owner = String(data.user_id || "").trim();
          const eventName = String(data.event_name || "").trim().slice(0, 200);
          if (owner && owner !== user.id) likeNotify = { owner, eventName };
        }
      });
    } catch (e) {
      setMessage(mllFriendlyErrorMessage(e, MLL_MESSAGE.likeUpdateFailed), true);
      return;
    }
    if (likeNotify) {
      const nm = String(displayNameFromUser(user) || UNKNOWN_USER).trim().slice(0, 120) || UNKNOWN_USER;
      window.MarchinZPushLikeNotification?.(db, likeNotify.owner, {
        kind: "like_mll_log",
        actor_uid: user.id,
        actor_name: nm,
        target_type: "mll_log",
        target_id: String(logId),
        target_title: likeNotify.eventName || "MarchinZ Log",
        target_href: `#profile?uid=${encodeURIComponent(likeNotify.owner)}&tab=mll`,
        thread_root_id: "",
      });
    }
    await refreshMLLView();
  }

  function appendMllLikeRow(hostEl, log) {
    if (!hostEl || !log?.id) return;
    const me = getAuthUser();
    const lb = log.liked_by && typeof log.liked_by === "object" ? log.liked_by : {};
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
    btn.addEventListener("click", () => void toggleMllLogLike(log.id));
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

  function eventsRegisterPanelOpen() {
    return window.MarchinZEventsRegisterExpanded === true;
  }

  function syncAuthStateUI() {
    const user = getAuthUser();
    const loggedIn = Boolean(user);
    const withdrawn = Boolean(window.MLL_AUTH?.isWithdrawn?.());
    const panelOpen = eventsRegisterPanelOpen();
    const disableMll = !loggedIn || withdrawn || !panelOpen;

    form.querySelectorAll("input,select,textarea,button").forEach((el) => {
      const tag = String(el.tagName || "").toLowerCase();
      if (tag === "button") {
        const isSubmit = el.type === "submit" || el.id === "btn-mll-save";
        if (isSubmit) el.disabled = withdrawn || !panelOpen;
        else el.disabled = disableMll;
      } else {
        el.disabled = disableMll;
      }
    });

    if (!panelOpen) {
      setMessage("", false);
    } else if (!loggedIn) {
      setMessage("", false);
    } else if (withdrawn) {
      setMessage("退会済みのアカウントではログを保存できません。", true);
    } else {
      setMessage("", false);
    }
    void refreshMLLView();
  }

  function mapRoleToParticipation(role) {
    if (role === "perform") return "出演";
    if (role === "team_staff") return "チームスタッフ";
    if (role === "ops") return "運営";
    return "観戦";
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const user = getAuthUser();
    if (!user) {
      window.MarchinZNavigateAuthEntry?.("signup", "mll_save");
      return;
    }
    if (window.MLL_AUTH?.isWithdrawn?.()) {
      setMessage("退会済みのアカウントではログを保存できません。", true);
      return;
    }

    clearFieldErrors();
    const eventName = inputName.value.trim();
    const eventDate = inputDate.value;
    const venue = (inputVenue?.value || "").trim();
    const roleRaw = String(selectRole.value || "").trim();
    const role = roleRaw ? canonicalRole(roleRaw) : "";
    const calendarKind = String(selectEventKind.value || "").trim();
    const note = "";
    const ticketUrl = "";
    const officialUrl = String(inputOfficialUrl?.value || "").trim();

    let hasError = false;
    if (!eventName) {
      setFieldError(errorEventName, "入力してください");
      hasError = true;
    }
    if (!eventDate) {
      setFieldError(errorEventDate, "入力してください");
      hasError = true;
    }
    if (!venue) {
      setFieldError(errorVenue, "選択してください");
      hasError = true;
    }
    if (!roleRaw) {
      setFieldError(errorRole, "選択してください");
      hasError = true;
    }
    if (!CALENDAR_KIND_OPTIONS.includes(calendarKind)) {
      setFieldError(errorEventKind, "選択してください");
      hasError = true;
    }
    if (hasError) {
      setMessage("必須項目を入力してください。", true);
      return;
    }

    if (officialUrl && !/^https:\/\//i.test(officialUrl)) {
      setMessage("URLの形式が正しくありません。https:// から始まるURLを入力してください。", true);
      return;
    }

    const creatorName = displayNameFromUser(user);
    const creatorAvatar = user.user_metadata?.avatar_url || "";
    const visibility = "public";
    const log = normalizeLogEntry({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      user_id: user.id,
      event_name: eventName,
      event_date: eventDate,
      venue,
      role,
      role_label: buildRoleLabel(role, eventDate),
      note,
      ticket_url: ticketUrl,
      official_url: officialUrl,
      creator_name: creatorName,
      creator_avatar: creatorAvatar,
      created_at: new Date().toISOString(),
      liked_by: {},
      visibility,
    });

    const participation_format = mapRoleToParticipation(String(log.role || ""));
    const date = String(log.event_date || "").trim();
    const title = String(log.event_name || "").trim().slice(0, 200);
    const venue_pref = String(log.venue || "").trim().slice(0, 48);
    const event_url = String(log.official_url || "").trim().slice(0, 2000);
    const created_by = String(log.user_id);
    const creator_display_name = String(log.creator_name || UNKNOWN_USER).trim().slice(0, 200);
    const creator_avatar_url = String(log.creator_avatar || "").trim();
    const created_at = new Date().toISOString();
    const payload = {
      kind: calendarKind,
      date,
      title,
      venue_pref,
      event_url,
      participation_format,
      created_by,
      liked_by: {},
      creator_display_name,
      creator_avatar_url,
      created_at,
    };

    const db = getFirestoreDb();
    if (!db) {
      window.alert("Firestore が利用できません。ページを再読み込みしてからお試しください。");
      return;
    }

    const logPayload = {
      id: log.id,
      user_id: log.user_id,
      event_name: log.event_name,
      event_date: log.event_date,
      venue: log.venue,
      role: log.role,
      role_label: log.role_label,
      note: log.note,
      ticket_url: log.ticket_url,
      official_url: log.official_url,
      creator_name: log.creator_name,
      creator_avatar: log.creator_avatar,
      created_at: log.created_at,
      liked_by: {},
      visibility: logVisibility(log),
    };

    // Firestore Web では enableIndexedDbPersistence を呼んでいないため、IndexedDB オフライン永続化は無効（公式どおりメモリ中心）。
    // Auth の setPersistence(LOCAL) は認証ストレージであり、Firestore のオフラインキャッシュとは別レイヤ。

    if (btnSave) btnSave.disabled = true;
    const saveDeadlineMs = 8000;
    let timeoutId = 0;
    const saveStartedAt = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error("TIMEOUT_BLOCKED"));
        }, saveDeadlineMs);
      });

      const savePromise = Promise.all([
        db.collection("mll_logs").doc(String(log.id)).set(logPayload, { merge: true }),
        db.collection("mll_calendar_events").add(payload),
      ]);

      await Promise.race([savePromise, timeoutPromise]);

      window.alert("イベントを登録しました。");
      window.MarchinZSetEventsRegisterExpanded?.(false);

      const logs = loadLogs();
      logs.push(log);
      saveLogs(logs);
      form.reset();
      if (inputVenue) inputVenue.value = "";
      roleButtons?.querySelectorAll(".mll-role-btn").forEach((node) => node.classList.remove("is-active"));
      updateRolePreview();
      clearFieldErrors();
      setMessage("");
      await refreshMLLView();
    } catch (error) {
      const elapsedMs =
        typeof performance !== "undefined" && performance.now
          ? Math.round(performance.now() - saveStartedAt)
          : null;
      const msg = String(error?.message || "");
      const isTimeout = msg === "TIMEOUT_BLOCKED";
      const firebaseCode = error?.code != null ? String(error.code) : "";
      const firebaseMessage = error?.message != null ? String(error.message) : "";
      const errorName = error?.name != null ? String(error.name) : "";

      console.error("[mll] 保存エラー（分類）:", {
        kind: isTimeout ? "promise_race_timeout" : "native_or_other",
        isTimeout,
        deadlineMs: saveDeadlineMs,
        elapsedMs,
        errorName,
        firebaseCode,
        firebaseMessage,
        stack: error?.stack || "(no stack)",
        raw: error,
      });
      console.error("[mll] 保存エラー（Firebase 互換フィールドのそのまま）:", {
        code: error?.code,
        message: error?.message,
        name: error?.name,
        customData: error?.customData,
      });

      if (isTimeout || error?.code === "unavailable") {
        window.alert(
          "通信がブロックされました。お使いのブラウザの「広告ブロック」や「トラッキング防止機能（Brave Shields等）」をオフにしてから再試行してください。"
        );
      } else {
        window.alert("保存に失敗しました。時間をおいて再度お試しください。");
      }
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (btnSave) btnSave.disabled = false;
    }
  });

  if (roleButtons) {
    roleButtons.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const btn = t.closest(".mll-role-btn");
      if (!btn) return;
      const nextValue = String(btn.dataset.roleValue || "").trim();
      if (!nextValue) return;
      selectRole.value = nextValue;
      updateRolePreview();
      roleButtons.querySelectorAll(".mll-role-btn").forEach((node) => {
        node.classList.toggle("is-active", node === btn);
      });
    });
  }
  selectRole.addEventListener("change", () => {
    updateRolePreview();
    if (!roleButtons) return;
    const selected = canonicalRole(selectRole.value);
    roleButtons.querySelectorAll(".mll-role-btn").forEach((node) => {
      node.classList.toggle("is-active", String(node.dataset.roleValue || "") === selected);
    });
  });
  inputDate.addEventListener("change", updateRolePreview);
  window.addEventListener("mll-auth-changed", syncAuthStateUI);
  window.addEventListener("marchinz-events-register-changed", syncAuthStateUI);
  window.addEventListener("marchinz-like-show-changed", () => {
    void refreshMLLView();
  });
  if (eventList) {
    eventList.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const userId = t.dataset.userId || "";
      if (!userId) return;
      openUserProfile(userId, t.dataset.userName || UNKNOWN_USER, t.dataset.userAvatar || "");
    });
  }

  document.getElementById("mll-profile-close")?.addEventListener("click", () => {
    if (profileViewer) profileViewer.hidden = true;
  });

  updateRolePreview();
  syncAuthStateUI();

  window.MarchinZToggleMllLogLike = toggleMllLogLike;
  window.MarchinZResyncMllEventFormUi = syncAuthStateUI;
  /** カレンダー統合時に role_label を再計算するほかで利用 */
  window.MarchinZMllBuildRoleLabel = buildRoleLabel;
})();
