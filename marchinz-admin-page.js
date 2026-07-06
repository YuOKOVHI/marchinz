/**
 * 管理者ページ（#admin / #admin/reports / #admin/announce / #admin/trash / #admin/banned）のタブ切替。
 * site-nav.js の showPage から MarchinZAdminShell.setTab が呼ばれる。
 */
(function () {
  "use strict";

  const ADMIN_TABS = /** @type {const} */ (["reports", "announce", "trash", "banned"]);

  function normalizeAdminTab(tab) {
    const v = String(tab || "").trim().toLowerCase();
    return ADMIN_TABS.includes(v) ? v : "reports";
  }

  function setTabInternal(tab) {
    const t = normalizeAdminTab(tab);
    const reports = document.getElementById("admin-pane-reports");
    const announce = document.getElementById("admin-pane-announce");
    const trash = document.getElementById("admin-pane-trash");
    const banned = document.getElementById("admin-pane-banned");
    if (reports instanceof HTMLElement) reports.hidden = t !== "reports";
    if (announce instanceof HTMLElement) announce.hidden = t !== "announce";
    if (trash instanceof HTMLElement) trash.hidden = t !== "trash";
    if (banned instanceof HTMLElement) banned.hidden = t !== "banned";
    document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const on = btn.getAttribute("data-admin-tab") === t;
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (t === "announce") {
      try {
        void window.MarchinZOpsAnnouncementAdmin?.refresh?.();
      } catch {
        //
      }
    }
    if (t === "trash") {
      try {
        void window.MarchinZAdminTrash?.refresh?.();
      } catch {
        //
      }
    }
    if (t === "banned") {
      try {
        void window.MarchinZAdminBanned?.refresh?.();
      } catch {
        //
      }
    }
  }

  window.MarchinZAdminShell = {
    setTab(tab) {
      setTabInternal(tab);
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = String(btn.getAttribute("data-admin-tab") || "");
        if (!ADMIN_TABS.includes(v)) return;
        const next =
          v === "announce"
            ? "#admin/announce"
            : v === "trash"
              ? "#admin/trash"
              : v === "banned"
                ? "#admin/banned"
                : "#admin/reports";
        if (location.hash !== next) location.hash = next;
        else setTabInternal(v);
      });
    });
  });
})();
