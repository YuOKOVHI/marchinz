/**
 * コミュニティ「ノート」タブ ─ 公開 MarchinZ Note を更新日時順でカード一覧
 */
(() => {
  const LIMIT = 48;
  /** @type {boolean} */
  let busy = false;

  function excerptBody(raw, maxLen) {
    const t = String(raw ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
    return t.length >= maxLen ? `${t}…` : t || "（本文なし）";
  }

  /** @returns {HTMLElement|null} */
  function container() {
    return document.getElementById("mln-feed-cards");
  }

  /** @returns {HTMLElement|null} */
  function msgEl() {
    return document.getElementById("mln-feed-msg");
  }

  /** @returns {FirebaseFirestore.Firestore|null} */
  function getDb() {
    try {
      return window.MLL_AUTH?.getDb?.() || null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} uid
   * @param {string} eventId
   */
  function profileDiaryHref(uid, eventId) {
    const base = `${location.pathname}${location.search}`;
    return `${base}#profile?uid=${encodeURIComponent(uid)}&tab=logdiary&event=${encodeURIComponent(eventId)}`;
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
            out.set(uid, {
              name: "ユーザー",
              avatar: "",
              hide: false,
            });
            return;
          }
          const d = snap.data() || {};
          const wd = Boolean(d.withdrawn);
          const bn = Boolean(d.banned);
          const name =
            wd || bn
              ? "退会ユーザー"
              : String(d.display_name ?? "").trim() || "ユーザー";
          out.set(uid, {
            name,
            avatar: String(d.avatar_url ?? "").trim(),
            hide: wd || bn,
          });
        } catch {
          out.set(uid, {
            name: "ユーザー",
            avatar: "",
            hide: false,
          });
        }
      }),
    );
    return out;
  }

  function renderEmpty(root, textNodeText) {
    root.replaceChildren();
    const p = document.createElement("p");
    p.className = "mln-feed-empty";
    p.textContent = textNodeText;
    root.appendChild(p);
  }

  function safeSlug(uid, ev) {
    return `t-${encodeURIComponent(uid).replace(/%/g, "")}-${encodeURIComponent(ev).replace(/%/g, "")}`.slice(0, 120);
  }

  /**
   * @param {{ uid: string; eventId: string; data: Record<string, unknown> }} row
   * @param {{ name: string; avatar: string }} author
   */
  function buildCardEl(row, author) {
    const d = row.data;
    const href = profileDiaryHref(row.uid, row.eventId);

    const art = document.createElement("article");
    art.className = "mln-feed-card";

    const coverWrap = document.createElement("div");
    coverWrap.className = "mln-feed-card-cover-wrap";
    const ca = document.createElement("a");
    ca.className = "mln-feed-card-cover-link";
    ca.href = href;
    /** @type {string[]} */
    const urls =
      Array.isArray(d.photo_urls) && d.photo_urls.length ? d.photo_urls : [];
    const thumb = urls[0] ? String(urls[0]).trim() : "";
    if (thumb) {
      const img = document.createElement("img");
      img.className = "mln-feed-card-thumb";
      img.src = thumb;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      ca.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "mln-feed-card-thumb mln-feed-card-thumb--empty";
      ph.setAttribute("aria-hidden", "true");
      ca.appendChild(ph);
    }
    coverWrap.appendChild(ca);

    const body = document.createElement("div");
    body.className = "mln-feed-card-body";

    const rowAuth = document.createElement("div");
    rowAuth.className = "mln-feed-author";
    const av = document.createElement("img");
    av.className = "mln-feed-author-avatar";
    av.alt = "";
    av.width = 32;
    av.height = 32;
    av.decoding = "async";
    av.src =
      author.avatar && /^https?:\/\//i.test(author.avatar)
        ? author.avatar
        : "logo/marchinz-logo.png";
    const nm = document.createElement("span");
    nm.className = "mln-feed-author-name";
    nm.textContent = author.name;
    rowAuth.appendChild(av);
    rowAuth.appendChild(nm);

    const hid = safeSlug(row.uid, row.eventId);
    const h3 = document.createElement("h3");
    h3.className = "mln-feed-card-title";
    h3.id = `mln-feed-title-${hid}`;
    ca.setAttribute("aria-labelledby", h3.id);
    h3.textContent = String(d.event_title ?? "").trim() || "（無題）";

    const meta = document.createElement("p");
    meta.className = "mln-feed-card-meta";
    const evd = String(d.event_date ?? "").trim();
    const upd = String(d.updated_at ?? d.created_at ?? "").trim();
    const sty = String(d.participation_style ?? "").trim();
    meta.textContent = [
      evd,
      upd ? `更新 ${upd}` : "",
      sty || "",
    ]
      .filter(Boolean)
      .join(" · ");

    const exc = document.createElement("p");
    exc.className = "mln-feed-card-excerpt";
    exc.textContent = excerptBody(d.body, 180);

    const ctaWrap = document.createElement("p");
    ctaWrap.className = "mln-feed-card-cta-wrap";
    const ma = document.createElement("a");
    ma.href = href;
    ma.className = "mln-feed-card-more";
    ma.textContent = "プロフィールで見る";
    ctaWrap.appendChild(ma);

    body.appendChild(rowAuth);
    body.appendChild(h3);
    body.appendChild(meta);
    body.appendChild(exc);
    body.appendChild(ctaWrap);

    art.appendChild(coverWrap);
    art.appendChild(body);
    return art;
  }

  async function refresh() {
    const root = container();
    const msg = msgEl();
    if (!root) return;
    if (busy) return;
    const db = getDb();
    if (!db || !window.firebase?.firestore) {
      if (msg) {
        msg.textContent =
          "データに接続できません。Firebase 設定とネットワークを確認してください。";
        msg.hidden = false;
      }
      renderEmpty(
        root,
        "一覧を読み込めません。auth-config.js と Firebase を確認してください。",
      );
      return;
    }

    busy = true;
    if (msg) {
      msg.textContent = "読み込み中…";
      msg.hidden = false;
    }
    root.replaceChildren();

    try {
      const qs = db
        .collectionGroup("event_log_diaries")
        .where("visibility", "==", "public")
        .orderBy("updated_at", "desc")
        .limit(LIMIT);
      const snap = await qs.get();

      /** @type {{ uid: string; eventId: string; data: Record<string, unknown> }[]} */
      const rowsRaw = [];
      snap.forEach((doc) => {
        const pref = doc.ref.parent && doc.ref.parent.parent;
        const uid =
          pref &&
          pref.id &&
          typeof pref.path === "string" &&
          pref.path.startsWith("mll_profiles/")
            ? pref.id
            : null;
        if (!uid || !doc.id) return;
        rowsRaw.push({
          uid,
          eventId: doc.id,
          data: doc.data() || {},
        });
      });

      const uids = [...new Set(rowsRaw.map((r) => r.uid))];
      const pmap = await loadProfilesMinimal(db, uids);
      const rows = rowsRaw.filter((r) => !pmap.get(r.uid)?.hide);

      if (!rows.length) {
        renderEmpty(root, "まだ公開の MarchinZ Note が登録されていません。");
      } else {
        const frag = document.createDocumentFragment();
        for (const row of rows) {
          const p = pmap.get(row.uid);
          const author = p || { name: "ユーザー", avatar: "" };
          frag.appendChild(buildCardEl(row, author));
        }
        root.appendChild(frag);
      }

      if (msg) msg.textContent = `更新が新しい順 · 最大 ${LIMIT} 件を表示しています`;
    } catch (e) {
      const code = typeof e?.code === "string" ? e.code : "";
      console.warn("[MarchinZ] MLN feed", e);
      if (msg) {
        msg.textContent =
          code === "failed-precondition"
            ? "インデックスが必要です（collection group「event_log_diaries」の複合インデックス）。Firebase Console で作成してください。"
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

  window.MarchinZMlnPublicFeed = { refresh };
})();
