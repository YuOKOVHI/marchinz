/**
 * MarchinZ サイト共通：文字列並び「日本語 → 英語 → 数字 → その他」
 * index.html で site-nav.js / app.js より前に読み込む。
 */
(function (global) {
  "use strict";

  const COLLATOR_JA = new Intl.Collator("ja", { sensitivity: "base" });
  const COLLATOR_EN = new Intl.Collator("en", { sensitivity: "base", numeric: true });

  let unicodePropsOk = true;
  try {
    unicodePropsOk = new RegExp("\\p{Script=Hiragana}", "u").test("あ");
  } catch (_e) {
    unicodePropsOk = false;
  }

  function firstGraphemeNormalized(s) {
    const t = String(s == null ? "" : s).trim().normalize("NFKC");
    if (!t) return "";
    return Array.from(t)[0] || "";
  }

  /**
   * 先頭1文字（NFKC 済み）の並びグループ。小さいほど先。
   * 0=日本語（ひら・カタ・漢字）、1=英語（ラテン文字）、2=数字、3=その他、4=空
   */
  function classifyFirst(raw) {
    const ch = firstGraphemeNormalized(raw);
    if (!ch) return 4;
    if (unicodePropsOk) {
      try {
        if (
          /\p{Script=Hiragana}/u.test(ch) ||
          /\p{Script=Katakana}/u.test(ch) ||
          /\p{Script=Han}/u.test(ch)
        ) {
          return 0;
        }
        if (/\p{Nd}/u.test(ch)) return 2;
        if (/\p{Script=Latin}/u.test(ch)) return 1;
        return 3;
      } catch (_err) {
        /* fall through range-based */
      }
    }
    const c = ch.codePointAt(0);
    if (c >= 0x3040 && c <= 0x309f) return 0;
    if (c >= 0x30a0 && c <= 0x30ff) return 0;
    if (c >= 0x4e00 && c <= 0x9fff) return 0;
    if (c >= 0x3400 && c <= 0x4dbf) return 0;
    if (c >= 0xff10 && c <= 0xff19) return 2;
    if (/[0-9]/.test(ch)) return 2;
    if (/[A-Za-z]/.test(ch)) return 1;
    if ((c >= 0xff21 && c <= 0xff3a) || (c >= 0xff41 && c <= 0xff5a)) return 1;
    return 3;
  }

  /**
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  function compare(a, b) {
    const sa = String(a == null ? "" : a);
    const sb = String(b == null ? "" : b);
    const ta = sa.trim().normalize("NFKC");
    const tb = sb.trim().normalize("NFKC");
    const ca = classifyFirst(sa);
    const cb = classifyFirst(sb);
    if (ca !== cb) return ca - cb;

    if (ca === 4) return 0;
    switch (ca) {
      case 0:
        return COLLATOR_JA.compare(ta, tb);
      case 1:
        return COLLATOR_EN.compare(ta, tb);
      case 2:
        return ta.localeCompare(tb, undefined, { numeric: true });
      default:
        return COLLATOR_JA.compare(ta, tb);
    }
  }

  global.MarchinZSort = {
    compare: compare,
    classifyFirst: classifyFirst,
  };
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
