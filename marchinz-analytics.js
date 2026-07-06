/**
 * MarchinZ — 計測の共通入口（Plausible / GA4 gtag / ローカルカウンタ）
 * site-nav より前に読み込むこと。
 */
(() => {
  const CORE_PULSE_MS = 30000;

  function trackEvent(name, payload = {}) {
    const k = `marchinz_metric_${name}`;
    try {
      const c = Number.parseInt(localStorage.getItem(k) || "0", 10) || 0;
      localStorage.setItem(k, String(c + 1));
    } catch {
      //
    }
    if (typeof window.plausible === "function") {
      window.plausible(name, { props: payload });
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", name, payload);
    }
  }

  /**
   * SPA 用: ハッシュ遷移ごとに page_view を送り、GA4 の画面・エンゲージメント集計を補正する。
   * @param {string} pageId
   * @param {{ communityTab?: string|null }} [routeOpts]
   */
  function trackRouteView(pageId, routeOpts = {}) {
    const path = `${location.pathname}${location.hash || "#"}`;
    const tab = routeOpts.communityTab != null ? String(routeOpts.communityTab) : "";
    trackEvent("mz_route_view", {
      page_id: String(pageId || ""),
      community_tab: tab,
      page_path: path,
    });
    if (typeof window.gtag === "function") {
      window.gtag("event", "page_view", {
        page_location: location.href,
        page_path: path,
        page_title: document.title,
        mz_page_id: String(pageId || ""),
        ...(tab ? { mz_community_tab: tab } : {}),
      });
    }
  }

  let engageTimer = null;
  let engageSurface = "";
  let pulseIndex = 0;

  function stopCoreEngagement() {
    if (engageTimer) {
      clearInterval(engageTimer);
      engageTimer = null;
    }
    engageSurface = "";
    pulseIndex = 0;
  }

  function pulseCoreEngagement() {
    if (!engageSurface || document.visibilityState !== "visible") return;
    pulseIndex += 1;
    trackEvent("mz_core_engagement_pulse", {
      surface: engageSurface,
      pulse_index: pulseIndex,
      pulse_sec: CORE_PULSE_MS / 1000,
    });
    if (typeof window.gtag === "function") {
      window.gtag("event", "mz_core_engagement_pulse", {
        engagement_time_msec: CORE_PULSE_MS,
        surface: engageSurface,
        pulse_index: pulseIndex,
      });
    }
  }

  /** @param {string} surface e.g. videos_browse, log_diary */
  function startCoreEngagement(surface) {
    stopCoreEngagement();
    const s = String(surface || "").trim();
    if (!s) return;
    engageSurface = s;
    pulseIndex = 0;
    trackEvent("mz_core_engagement_start", { surface: engageSurface });
    engageTimer = window.setInterval(pulseCoreEngagement, CORE_PULSE_MS);
  }

  /** @param {number} count */
  function searchResultBucket(count) {
    const n = Math.max(0, Number(count) || 0);
    if (n === 0) return "0";
    if (n <= 10) return "1-10";
    if (n <= 50) return "11-50";
    return "51+";
  }

  window.MarchinZTrackEvent = trackEvent;
  window.MarchinZTrackRouteView = trackRouteView;
  window.MarchinZCoreEngagement = { start: startCoreEngagement, stop: stopCoreEngagement };
  window.MarchinZAnalytics = { searchResultBucket };
})();
