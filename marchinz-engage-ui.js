/**
 * 通報（⋯）・タイトル横いいねの共通 UI（Font Awesome）
 */
(() => {
  /**
   * @typedef {{ label: string; onClick: () => void|Promise<void>; variant?: "default"|"danger" }} OverflowMenuItem
   */

  /**
   * @param {boolean} liked
   * @returns {string}
   */
  function likeHeartClass(liked) {
    return liked ? "fa-solid fa-heart" : "fa-regular fa-heart";
  }

  /**
   * @param {HTMLElement} btn
   * @param {boolean} liked
   * @param {{ animate?: boolean }} [opts]
   */
  function syncLikeButtonUi(btn, liked, opts = {}) {
    btn.classList.toggle("community-like-btn--on", liked);
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.setAttribute("aria-label", liked ? "いいねを解除" : "いいねする");
    const heart = btn.querySelector(".community-like-heart");
    if (heart) {
      heart.className = `community-like-heart ${likeHeartClass(liked)}`;
    }
    if (opts.animate) {
      btn.classList.remove("community-like-btn--pop");
      void btn.offsetWidth;
      btn.classList.add("community-like-btn--pop");
    }
  }

  /**
   * @param {HTMLElement} btn
   * @returns {{ wasLiked: boolean; curCount: number }}
   */
  function applyOptimisticLikeToggle(btn) {
    const num = btn.querySelector(".community-like-count");
    const wasLiked = btn.classList.contains("community-like-btn--on");
    const nextLiked = !wasLiked;
    const curCount = parseInt(String(num?.textContent || "0"), 10) || 0;
    const nextCount = Math.max(0, curCount + (nextLiked ? 1 : -1));
    syncLikeButtonUi(btn, nextLiked, { animate: true });
    if (num) num.textContent = String(nextCount);
    return { wasLiked, curCount };
  }

  /**
   * @param {HTMLElement} btn
   * @param {{ wasLiked: boolean; curCount: number }} snap
   */
  function revertOptimisticLikeToggle(btn, snap) {
    syncLikeButtonUi(btn, snap.wasLiked, { animate: false });
    setLikeButtonCount(btn, snap.curCount);
  }

  /**
   * @param {HTMLElement} btn
   * @param {number} count
   */
  function setLikeButtonCount(btn, count) {
    const num = btn.querySelector(".community-like-count");
    if (num) num.textContent = String(count);
  }

  /**
   * @param {HTMLElement} btn
   * @param {() => void|Promise<void>|false|null|undefined} onClick `false` で楽観更新を取り消す
   * @param {{ stopPropagation?: boolean }} [opts]
   */
  function wireLikeButtonClick(btn, onClick, opts = {}) {
    btn.addEventListener("click", (e) => {
      if (opts.stopPropagation) e.stopPropagation();
      if (btn.disabled) return;
      const snap = applyOptimisticLikeToggle(btn);
      btn.disabled = true;
      Promise.resolve(onClick())
        .then((r) => {
          if (r === false) revertOptimisticLikeToggle(btn, snap);
        })
        .catch(() => revertOptimisticLikeToggle(btn, snap))
        .finally(() => {
          btn.disabled = false;
        });
    });
  }

  /**
   * @param {HTMLElement|null|undefined} hostEl
   * @param {{ liked: boolean; count: number; onClick: () => void|Promise<void>|false; showLoginHint?: boolean; disabled?: boolean; stopPropagation?: boolean }} opts
   * @returns {HTMLElement|null}
   */
  function buildLikeRow(hostEl, opts) {
    if (!hostEl) return null;
    const liked = Boolean(opts.liked);
    const row = document.createElement("div");
    row.className = "community-like-row";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "community-like-btn" + (liked ? " community-like-btn--on" : "");
    btn.disabled = Boolean(opts.disabled);
    syncLikeButtonUi(btn, liked);
    wireLikeButtonClick(btn, () => opts.onClick(), { stopPropagation: Boolean(opts.stopPropagation) });

    const heart = document.createElement("i");
    heart.className = `community-like-heart ${likeHeartClass(liked)}`;
    heart.setAttribute("aria-hidden", "true");

    const num = document.createElement("span");
    num.className = "community-like-count";
    num.textContent = String(opts.count ?? 0);

    btn.appendChild(heart);
    btn.appendChild(num);
    row.appendChild(btn);

    if (opts.showLoginHint) {
      const hint = document.createElement("span");
      hint.className = "community-like-hint mll-log-meta";
      hint.textContent = "ログインでいいねできます";
      row.appendChild(hint);
    }

    hostEl.appendChild(row);
    return row;
  }

  /**
   * ケバブメニュー（⋯）＋ドロップダウン。画面外クリックで閉じる。
   * @param {OverflowMenuItem[]} items
   * @param {{ extraClass?: string; panelBelow?: boolean }} [opts]
   */
  function buildActionOverflow(items, opts = {}) {
    const det = document.createElement("details");
    const cls = ["community-post-overflow"];
    if (opts.extraClass) cls.push(opts.extraClass);
    if (opts.panelBelow) cls.push("community-post-overflow--panel-below");
    det.className = cls.join(" ");

    const sum = document.createElement("summary");
    sum.className = "community-post-overflow-trigger";
    sum.setAttribute("aria-label", "その他の操作");
    const sumIcon = document.createElement("i");
    sumIcon.className = "fa-solid fa-ellipsis community-post-overflow-icon";
    sumIcon.setAttribute("aria-hidden", "true");
    sum.appendChild(sumIcon);
    sum.addEventListener("click", (e) => e.stopPropagation());

    const panel = document.createElement("div");
    panel.className = "community-post-overflow-panel";

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      const danger = item.variant === "danger";
      btn.className =
        "community-post-overflow-item" +
        (danger ? " community-post-overflow-item--danger" : " community-post-overflow-item--neutral");
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        det.open = false;
        void item.onClick();
      });
      panel.appendChild(btn);
    }

    /** @type {((e: MouseEvent) => void) | null} */
    let outsideHandler = null;
    const unbindOutside = () => {
      if (outsideHandler) {
        document.removeEventListener("click", outsideHandler, true);
        outsideHandler = null;
      }
    };
    det.addEventListener("toggle", () => {
      unbindOutside();
      if (!det.open) return;
      outsideHandler = (e) => {
        const t = e.target;
        if (!(t instanceof Node) || !det.contains(t)) {
          det.open = false;
          unbindOutside();
        }
      };
      document.addEventListener("click", outsideHandler, true);
    });

    det.appendChild(sum);
    det.appendChild(panel);
    det.addEventListener("click", (e) => e.stopPropagation());
    return det;
  }

  /**
   * @param {() => void|Promise<void>} onReport
   * @param {{ extraClass?: string; panelBelow?: boolean }} [opts]
   */
  function buildReportOverflow(onReport, opts = {}) {
    return buildActionOverflow([{ label: "通報する", variant: "danger", onClick: onReport }], opts);
  }

  /**
   * @param {HTMLElement} titleRow
   * @param {HTMLElement|null|undefined} likeHost
   */
  function appendInlineLike(titleRow, likeHost) {
    if (titleRow && likeHost?.childElementCount) {
      likeHost.classList.add("mz-inline-like-host");
      titleRow.appendChild(likeHost);
    }
  }

  window.MarchinZEngageUi = {
    buildActionOverflow,
    buildReportOverflow,
    appendInlineLike,
    buildLikeRow,
    wireLikeButtonClick,
    syncLikeButtonUi,
    setLikeButtonCount,
    likeHeartClass,
  };
})();
