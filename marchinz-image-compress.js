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
   * @param {{ maxSizeMB?: number; maxWidthOrHeight?: number }=} overrides
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
    const baseOpts = {
      maxSizeMB,
      maxWidthOrHeight,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.82,
    };
    try {
      const out = await ic(file, baseOpts);
      return out instanceof Blob ? out : file;
    } catch (e) {
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
  function ensureProtectedImgWrap(img) {
    if (!img) return;
    bindImgGuards(img);
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

  window.MarchinZImage = {
    RAW_INPUT_MAX_BYTES,
    ERR_TOO_LARGE,
    compressForUpload,
    ensureProtectedImgWrap,
    appendProtectedPhoto,
  };
})();
