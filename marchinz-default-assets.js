/**
 * プロフィールカバー・MarchinZ Note サムネのデフォルト画像（表示専用・Firestore には保存しない）。
 */
(() => {
  const PROFILE_COVER_PATH = "img/defaults/cover_d.png";
  const NOTE_THUMB_PATH = "img/defaults/marchinznote_d.jpg";

  function assetVersion() {
    return String(document.documentElement.getAttribute("data-mz-version") || "1").trim() || "1";
  }

  /** @param {string} path */
  function withCacheBust(path) {
    return `${path}?v=${encodeURIComponent(assetVersion())}`;
  }

  /** @param {string} raw */
  function isHttpImageUrl(raw) {
    return /^https?:\/\//i.test(String(raw || "").trim());
  }

  /** システム既定サムネ（誤って photo_urls に入っていた場合はユーザー添付とみなさない） */
  function isNoteDefaultThumbnailUrl(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return false;
    return (
      s.includes("marchinznote_d") ||
      s.includes("marchinz-note-placeholder") ||
      s.endsWith("/img/defaults/marchinznote_d.jpg")
    );
  }

  /**
   * Note のユーザー添付写真 URL のみ（https）。空・null・既定画像パスは除外。
   * @param {unknown} raw photo_urls または URL 配列
   * @param {number} [max]
   * @returns {string[]}
   */
  function normalizeNotePhotoUrls(raw, max = 4) {
    const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const out = [];
    const seen = new Set();
    for (const x of arr) {
      const s = String(x ?? "").trim();
      if (!s || isNoteDefaultThumbnailUrl(s) || !isHttpImageUrl(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }

  /** @param {unknown} raw */
  function hasUserNotePhotos(raw) {
    return normalizeNotePhotoUrls(raw).length > 0;
  }

  /**
   * プロフィールカバー表示用 URL（未設定時は cover_d.png）。
   * @param {string} [raw]
   */
  function resolveProfileCoverDisplayUrl(raw) {
    const s = String(raw || "").trim();
    if (isHttpImageUrl(s)) return s;
    return withCacheBust(PROFILE_COVER_PATH);
  }

  /** MarchinZ Note：写真未添付時のみ表示する固定フォールバック */
  function noteThumbnailDefault() {
    return withCacheBust(NOTE_THUMB_PATH);
  }

  /** @param {unknown} raw @param {number} count */
  function normalizeCoverPhotoIndex(raw, count) {
    if (!count) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(count - 1, Math.floor(n)));
  }

  /**
   * Note 表紙 URL（photo_urls の cover_photo_index 番目。未設定は先頭）。
   * @param {unknown} photoUrlsRaw
   * @param {unknown} [coverIndexRaw]
   * @returns {string|null}
   */
  function noteCoverUrl(photoUrlsRaw, coverIndexRaw) {
    const urls = normalizeNotePhotoUrls(photoUrlsRaw);
    if (!urls.length) return null;
    const idx = normalizeCoverPhotoIndex(coverIndexRaw, urls.length);
    return urls[idx] || urls[0];
  }

  window.MarchinZDefaultAssets = {
    profileCoverDefault: () => withCacheBust(PROFILE_COVER_PATH),
    noteThumbnailDefault,
    resolveProfileCoverDisplayUrl,
    isHttpImageUrl,
    isNoteDefaultThumbnailUrl,
    normalizeNotePhotoUrls,
    hasUserNotePhotos,
    normalizeCoverPhotoIndex,
    noteCoverUrl,
  };
})();
