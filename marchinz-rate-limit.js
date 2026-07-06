/**
 * MarchinZ — クライアント側レート制限
 * いいねスパム・連続投稿・連続イベント作成を抑止する簡易ガード。
 * サーバー側（Firestore ルール）と併用を推奨。
 */
(() => {
  const buckets = new Map();

  /**
   * @param {string} action 例: "like", "post", "event_create"
   * @param {{ maxPerWindow?: number, windowMs?: number }} opts
   * @returns {boolean} true = 許可, false = 制限中
   */
  function checkRate(action, opts = {}) {
    const maxPerWindow = opts.maxPerWindow || 10;
    const windowMs = opts.windowMs || 60000;
    const now = Date.now();

    if (!buckets.has(action)) buckets.set(action, []);
    const times = buckets.get(action);

    while (times.length && times[0] <= now - windowMs) times.shift();

    if (times.length >= maxPerWindow) return false;
    times.push(now);
    return true;
  }

  /** @returns {number} 制限解除までの残りms（0 = 制限なし） */
  function cooldownMs(action, opts = {}) {
    const windowMs = opts.windowMs || 60000;
    const maxPerWindow = opts.maxPerWindow || 10;
    const now = Date.now();
    const times = buckets.get(action);
    if (!times || times.length < maxPerWindow) return 0;
    const oldest = times[times.length - maxPerWindow];
    const remain = (oldest + windowMs) - now;
    return remain > 0 ? remain : 0;
  }

  const LIMITS = {
    like:         { maxPerWindow: 20, windowMs: 60000 },
    post:         { maxPerWindow: 5,  windowMs: 60000 },
    event_create: { maxPerWindow: 3,  windowMs: 60000 },
    report:       { maxPerWindow: 3,  windowMs: 120000 },
  };

  window.MarchinZRateLimit = {
    check(action) {
      const cfg = LIMITS[action] || { maxPerWindow: 10, windowMs: 60000 };
      const ok = checkRate(action, cfg);
      if (!ok) {
        window.MarchinZTrackEvent?.("rate_limit_hit", { bucket: String(action || "unknown") });
      }
      return ok;
    },
    cooldown(action) {
      const cfg = LIMITS[action] || { maxPerWindow: 10, windowMs: 60000 };
      return cooldownMs(action, cfg);
    },
    LIMITS,
  };
})();
