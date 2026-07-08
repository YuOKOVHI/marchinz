/**
 * MarchinZ 共通: browser-image-compression によるアップロード前圧縮と、
 * 表示用の軽い「保存しづらくする」ラッパ（フロントのみ・完全防除ではない）。
 */
(() => {
  const RAW_INPUT_MAX_BYTES = 20 * 1024 * 1024;
  const ERR_TOO_LARGE = "FILE_TOO_LARGE";

  /** @returns {null | ((file: File, opts: object) => Promise<File|Blob>)} */
  function getImageCompression() {
    const g = typeof globalThis !== "undefined" ? globalThis : window;
    const fn = g.imageCompression;
    return typeof fn === "function" ? fn : null;
  }

  /**
   * @param {File} file
   * @param {{ maxSizeMB?: number; maxWidthOrHeight?: number; useWebWorker?: boolean; initialQuality?: number }=} overrides
   * @returns {Promise<Blob>}
   */
  async function compressForUpload(file, overrides) {
    if (!file?.size) throw new Error("画像が空です");
    if (file.size > RAW_INPUT_MAX_BYTES) {
      window.alert("ファイルサイズが大きすぎます。20MB以下の画像を選択してください");
      throw new Error(ERR_TOO_LARGE);
    }
    const ic = getImageCompression();
    if (!ic) {
      throw new Error("画像圧縮ライブラリが読み込まれていません。ページを再読み込みしてください。");
    }
    const maxSizeMB = overrides?.maxSizeMB ?? 0.3;
    const maxWidthOrHeight = overrides?.maxWidthOrHeight ?? 1024;
    const wantWorker = overrides?.useWebWorker !== false;
    const baseOpts = {
      maxSizeMB,
      maxWidthOrHeight,
      useWebWorker: wantWorker,
      fileType: "image/jpeg",
      initialQuality: overrides?.initialQuality ?? 0.82,
    };
    try {
      const out = await ic(file, baseOpts);
      return out instanceof Blob ? out : file;
    } catch (e) {
      if (!wantWorker) throw e;
      console.warn("[MarchinZ] imageCompression (worker) retry without worker", e);
      const out = await ic(file, { ...baseOpts, useWebWorker: false });
      return out instanceof Blob ? out : file;
    }
  }

  /** @param {HTMLImageElement} img */
  function bindImgGuards(img) {
    if (!img || img.dataset.mzProtectBound === "1") return;
    img.draggable = false;
    img.addEventListener(
      "contextmenu",
      (ev) => {
        ev.preventDefault();
      },
      { passive: false },
    );
    img.addEventListener(
      "dragstart",
      (ev) => {
        ev.preventDefault();
      },
      { passive: false },
    );
    img.style.webkitTouchCallout = "none";
    img.style.userSelect = "none";
    img.style.webkitUserSelect = "none";
    img.dataset.mzProtectBound = "1";
  }

  /**
   * 既存の img を内側ラップ＋透明オーバーレイで囲む（同一 img に対して一度だけ）。
   * @param {HTMLImageElement} img
   */
  /**
   * 縦長画像(スマホスクショ等)に mz-img-portrait を付与する。
   * 一覧カードの固定比クロップで意図しない断片が見えるのを防ぐため、
   * CSS 側で縦長のみ object-fit: contain に切り替える判定に使う。
   * @param {HTMLImageElement} img
   */
  function tagPortraitOrientation(img) {
    const apply = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth * 1.15) {
        img.classList.add("mz-img-portrait");
      }
    };
    if (img.complete && img.naturalWidth > 0) {
      apply();
    } else {
      img.addEventListener("load", apply, { once: true });
    }
  }

  function ensureProtectedImgWrap(img) {
    if (!img) return;
    bindImgGuards(img);
    tagPortraitOrientation(img);
    if (img.closest(".marchinz-protected-photo-inner")) return;
    const p = img.parentElement;
    if (!p) return;
    const inner = document.createElement("span");
    inner.className = "marchinz-protected-photo-inner";
    const overlay = document.createElement("span");
    overlay.className = "marchinz-protected-photo-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.addEventListener(
      "contextmenu",
      (ev) => {
        ev.preventDefault();
      },
      { passive: false },
    );
    p.insertBefore(inner, img);
    inner.appendChild(img);
    inner.appendChild(overlay);
  }

  /**
   * @param {HTMLElement} container
   * @param {{ src: string; alt?: string; classNameImg?: string; loading?: "lazy"|"eager" }} o
   */
  function appendProtectedPhoto(container, o) {
    if (!container || !o?.src) return;
    const cell = document.createElement("div");
    cell.className = "marchinz-protected-photo-cell";
    const inner = document.createElement("span");
    inner.className = "marchinz-protected-photo-inner";
    const img = document.createElement("img");
    img.src = o.src;
    img.alt = o.alt || "";
    img.loading = o.loading || "lazy";
    img.decoding = "async";
    if (o.classNameImg) img.className = o.classNameImg;
    bindImgGuards(img);
    tagPortraitOrientation(img);
    const overlay = document.createElement("span");
    overlay.className = "marchinz-protected-photo-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.addEventListener(
      "contextmenu",
      (ev) => {
        ev.preventDefault();
      },
      { passive: false },
    );
    inner.appendChild(img);
    inner.appendChild(overlay);
    cell.appendChild(inner);
    container.appendChild(cell);
  }

  /** @type {{ el: HTMLElement; onKey: (ev: KeyboardEvent) => void } | null} */
  let activePhotoLightbox = null;

  function closePhotoLightbox() {
    if (!activePhotoLightbox) return;
    document.removeEventListener("keydown", activePhotoLightbox.onKey);
    try {
      activePhotoLightbox.el.remove();
    } catch {
      //
    }
    document.documentElement.classList.remove("mz-photo-lightbox-open");
    document.body.classList.remove("mz-photo-lightbox-open");
    activePhotoLightbox = null;
  }

  /**
   * 掲示板など：画像を画面内に収めて表示（拡大しすぎない）
   * @param {string[]} urls
   * @param {number} [startIndex=0]
   */
  function openPhotoLightbox(urls, startIndex = 0) {
    const list = (Array.isArray(urls) ? urls : [])
      .map((u) => String(u || "").trim())
      .filter((u) => /^https?:\/\//i.test(u));
    if (!list.length) return;
    closePhotoLightbox();
    let idx = Math.max(0, Math.min(Number(startIndex) || 0, list.length - 1));

    const root = document.createElement("div");
    root.className = "mz-photo-lightbox";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "画像を表示");

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "mz-photo-lightbox-backdrop";
    backdrop.setAttribute("aria-label", "閉じる");
    backdrop.tabIndex = -1;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mz-photo-lightbox-close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "×";

    const frame = document.createElement("div");
    frame.className = "mz-photo-lightbox-frame";

    const img = document.createElement("img");
    img.className = "mz-photo-lightbox-img";
    img.alt = "";
    img.draggable = false;
    bindImgGuards(img);

    const show = () => {
      img.src = list[idx];
      img.alt = list.length > 1 ? `画像 ${idx + 1} / ${list.length}` : "投稿画像";
    };

    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closePhotoLightbox();
        return;
      }
      if (list.length < 2) return;
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        idx = (idx - 1 + list.length) % list.length;
        show();
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        idx = (idx + 1) % list.length;
        show();
      }
    };

    backdrop.addEventListener("click", () => closePhotoLightbox());
    closeBtn.addEventListener("click", () => closePhotoLightbox());
    root.addEventListener("click", (ev) => {
      if (ev.target === root || ev.target === frame) closePhotoLightbox();
    });
    img.addEventListener("click", (ev) => ev.stopPropagation());

    frame.appendChild(img);
    root.appendChild(backdrop);
    root.appendChild(frame);
    root.appendChild(closeBtn);
    document.body.appendChild(root);
    document.documentElement.classList.add("mz-photo-lightbox-open");
    document.body.classList.add("mz-photo-lightbox-open");
    show();
    document.addEventListener("keydown", onKey);
    activePhotoLightbox = { el: root, onKey };
    closeBtn.focus();
  }

  window.MarchinZImage = {
    RAW_INPUT_MAX_BYTES,
    ERR_TOO_LARGE,
    compressForUpload,
    bindImgGuards,
    ensureProtectedImgWrap,
    appendProtectedPhoto,
    openPhotoLightbox,
    closePhotoLightbox,
  };
})();
