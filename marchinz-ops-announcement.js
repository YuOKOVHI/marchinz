/**
 * 管理者ページ（#admin）: サイト全体お知らせの配信フォーム（Firestore / privileged UID）
 */
(function () {
  "use strict";

  const DOC_ID = "current";

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
    const m = el("ops-announcement-msg");
    if (!m) return;
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("ops-announcement-msg--err", Boolean(isErr));
  }

  function fillPreview(data) {
    const box = el("ops-announcement-preview");
    if (!box) return;
    if (!data || data.active !== true) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.hidden = false;
    box.replaceChildren();
    const t = document.createElement("p");
    t.className = "ops-announcement-preview-title";
    t.textContent = String(data.title || "").trim() || "（タイトルなし）";
    const b = document.createElement("p");
    b.className = "ops-announcement-preview-body";
    b.textContent = String(data.body || "").trim();
    box.appendChild(t);
    if (b.textContent) box.appendChild(b);
    const href = String(data.link_href || "").trim();
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = String(data.link_label || "").trim() || href;
      box.appendChild(a);
    }
  }

  function readForm() {
    const titleEl = el("ops-announcement-title");
    const bodyEl = el("ops-announcement-body");
    const hrefEl = el("ops-announcement-link-href");
    const labelEl = el("ops-announcement-link-label");
    return {
      title: titleEl instanceof HTMLInputElement ? String(titleEl.value || "").trim() : "",
      body: bodyEl instanceof HTMLTextAreaElement ? String(bodyEl.value || "").trim() : "",
      link_href: hrefEl instanceof HTMLInputElement ? String(hrefEl.value || "").trim() : "",
      link_label: labelEl instanceof HTMLInputElement ? String(labelEl.value || "").trim() : "",
    };
  }

  function fillForm(data) {
    const titleEl = el("ops-announcement-title");
    const bodyEl = el("ops-announcement-body");
    const hrefEl = el("ops-announcement-link-href");
    const labelEl = el("ops-announcement-link-label");
    if (titleEl instanceof HTMLInputElement) titleEl.value = String(data?.title || "");
    if (bodyEl instanceof HTMLTextAreaElement) bodyEl.value = String(data?.body || "");
    if (hrefEl instanceof HTMLInputElement) hrefEl.value = String(data?.link_href || "");
    if (labelEl instanceof HTMLInputElement) labelEl.value = String(data?.link_label || "");
    fillPreview(data);
  }

  async function loadCurrent() {
    const d = getDb();
    if (!d) return;
    try {
      const snap = await d.collection("mll_site_announcements").doc(DOC_ID).get();
      const data = snap.exists ? snap.data() || {} : null;
      fillForm(data);
      const status = el("ops-announcement-status");
      if (status) {
        if (data?.active === true) {
          status.textContent = `配信中（更新: ${String(data.updated_at || data.published_at || "—")}）`;
          status.hidden = false;
        } else {
          status.textContent = "現在、配信されているお知らせはありません。";
          status.hidden = false;
        }
      }
    } catch (e) {
      setMsg(String(e?.message || e || "読み込みに失敗しました。"), true);
    }
  }

  function syncPanelVisibility() {
    const panel = el("ops-announcement-admin");
    if (!panel) return;
    const show = isAdminUi();
    panel.hidden = false;
    panel.style.display = show ? "" : "none";
    if (show) void loadCurrent();
  }

  async function publish() {
    const d = getDb();
    const user = window.MLL_AUTH?.getUser?.();
    if (!d || !user?.id) {
      setMsg("ログインしてください。", true);
      return;
    }
    const { title, body, link_href, link_label } = readForm();
    if (!title) {
      setMsg("タイトルを入力してください。", true);
      return;
    }
    if (!body) {
      setMsg("本文を入力してください。", true);
      return;
    }
    const now = new Date().toISOString();
    let prevUid = String(user.id);
    try {
      const prevSnap = await d.collection("mll_site_announcements").doc(DOC_ID).get();
      if (prevSnap.exists) {
        const p = prevSnap.data() || {};
        if (String(p.created_by_uid || "").trim()) prevUid = String(p.created_by_uid).trim();
      }
    } catch {
      //
    }
    const payload = {
      title: title.slice(0, 120),
      body: body.slice(0, 8000),
      active: true,
      published_at: now,
      updated_at: now,
      created_by_uid: prevUid,
    };
    if (link_href) {
      payload.link_href = link_href.slice(0, 2048);
      payload.link_label = link_label.slice(0, 80);
    }
    setMsg("配信中…", false);
    try {
      await d.collection("mll_site_announcements").doc(DOC_ID).set(payload, { merge: false });
      setMsg("お知らせを配信しました。ログイン済みユーザーにバナーと通知が表示されます。", false);
      fillPreview(payload);
      const status = el("ops-announcement-status");
      if (status) {
        status.textContent = `配信中（更新: ${now}）`;
        status.hidden = false;
      }
    } catch (e) {
      const msg = String(e?.message || e || "配信に失敗しました。");
      setMsg(
        msg.includes("permission") || msg.includes("Permission")
          ? `${msg}（Firestore ルールのデプロイと mll_privileged_uids への UID 登録を確認してください）`
          : msg,
        true,
      );
    }
  }

  async function stopCurrent() {
    const d = getDb();
    if (!d) return;
    if (!window.confirm("いま配信中のお知らせを停止しますか？バナーは非表示になります。")) return;
    const now = new Date().toISOString();
    setMsg("停止中…", false);
    try {
      const snap = await d.collection("mll_site_announcements").doc(DOC_ID).get();
      if (!snap.exists) {
        setMsg("停止するお知らせがありません。", true);
        return;
      }
      const prev = snap.data() || {};
      await d
        .collection("mll_site_announcements")
        .doc(DOC_ID)
        .set(
          {
            title: String(prev.title || "").slice(0, 120),
            body: String(prev.body || "").slice(0, 8000),
            link_href: String(prev.link_href || "").slice(0, 2048),
            link_label: String(prev.link_label || "").slice(0, 80),
            active: false,
            published_at: String(prev.published_at || now),
            updated_at: now,
            created_by_uid: String(prev.created_by_uid || ""),
          },
          { merge: false },
        );
      setMsg("お知らせを停止しました。", false);
      fillPreview(null);
      const status = el("ops-announcement-status");
      if (status) {
        status.textContent = "現在、配信されているお知らせはありません。";
        status.hidden = false;
      }
    } catch (e) {
      setMsg(String(e?.message || e || "停止に失敗しました。"), true);
    }
  }

  function wire() {
    const panel = el("ops-announcement-admin");
    if (!panel || panel.dataset.mzOpsAnnWire === "1") return;
    panel.dataset.mzOpsAnnWire = "1";
    el("ops-announcement-publish")?.addEventListener("click", () => void publish());
    el("ops-announcement-stop")?.addEventListener("click", () => void stopCurrent());
    const titleEl = el("ops-announcement-title");
    const bodyEl = el("ops-announcement-body");
    const onInput = () => fillPreview({ ...readForm(), active: true });
    titleEl?.addEventListener("input", onInput);
    bodyEl?.addEventListener("input", onInput);
  }

  window.addEventListener("mll-auth-changed", syncPanelVisibility);
  document.addEventListener("DOMContentLoaded", () => {
    wire();
    syncPanelVisibility();
  });

  window.MarchinZOpsAnnouncementAdmin = {
    refresh() {
      wire();
      syncPanelVisibility();
      return loadCurrent();
    },
  };
})();
