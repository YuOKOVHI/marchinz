"use strict";
/* ============ 素材の OPFS 先行受け取り ============
   iOS の file picker が File を返す境界自体は変えられない。MarchinZ はその
   File を解析へ渡す前に OPFS へ分割書き込みし、サイズ検証後は OPFS 上の
   File だけを clip.file として使う。失敗時は元 File へ戻し、取り込みを止めない。

   書き出し用 exporter の Worker はプロキシ/完成品と共有すると競合するため、
   同じ exportwriter.js を**別Worker**として起動する。ディレクトリも mz-source
   へ分離し、書き出し掃除から作業中の素材を守る。 */

MC.sourceStore = (() => {
  const S = {};
  S.DIR = "mz-source";
  S.PREFIX = "mzsrc_";
  S.LOCK = "mz-source-active";
  S.PENDING_KEY = "mz_switcher_source_pending_v1";
  S.CHUNK = 8 * 1024 * 1024;
  S._session = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  S._seq = 0;
  S._live = new Set();
  S._worker = null;
  S._workerP = null;
  S._activeRelease = null;
  S._activeP = null;
  S._epoch = 1;
  S._removals = new Set();

  S._trackRemoval = promise => {
    let tracked;
    tracked = Promise.resolve(promise).finally(() => S._removals.delete(tracked));
    S._removals.add(tracked);
    return tracked;
  };

  const diag = (phase, data) => {
    try {
      if (MC.storageDiag && MC.storageDiag.sourceHandoff) {
        MC.storageDiag.sourceHandoff(phase, data || {});
      }
    } catch (_) {}
  };
  const errText = e => String((e && (e.message || e.name)) || e || "不明").slice(0, 240);
  const pending = () => {
    try {
      const a = JSON.parse(localStorage.getItem(S.PENDING_KEY) || "[]");
      return Array.isArray(a) ? a.filter(n => typeof n === "string").slice(-20) : [];
    } catch (_) { return []; }
  };
  const savePending = a => {
    try {
      if (a.length) localStorage.setItem(S.PENDING_KEY, JSON.stringify([...new Set(a)].slice(-20)));
      else localStorage.removeItem(S.PENDING_KEY);
    } catch (_) {}
  };
  const notePending = name => savePending(pending().concat(name));
  const clearPending = name => savePending(pending().filter(n => n !== name));
  const patientTimeout = (fn, ms) => window.MZ_SESSION && MZ_SESSION.patientTimeout
    ? MZ_SESSION.patientTimeout(fn, ms)
    : (() => { const id = setTimeout(fn, ms); return () => clearTimeout(id); })();

  S.supported = () => {
    try {
      return !!(navigator.storage && navigator.storage.getDirectory && typeof Worker !== "undefined");
    } catch (_) { return false; }
  };

  S._initWorker = () => {
    if (S._worker) return Promise.resolve(S._worker);
    if (S._workerP) return S._workerP;
    S._workerP = new Promise((resolve, reject) => {
      let worker;
      try {
        const v = document.documentElement.getAttribute("data-mz-app-v") || "1";
        worker = new Worker("js/exportwriter.js?v=" + v);
      } catch (e) { reject(e); return; }
      const cancel = patientTimeout(() => {
        try { worker.terminate(); } catch (_) {}
        reject(new Error("素材保存Workerの起動タイムアウト"));
      }, 8000);
      const onReady = ev => {
        if (!ev.data || ev.data.type !== "ready") return;
        cancel(); worker.removeEventListener("message", onReady); worker.onerror = null;
        S._worker = worker; resolve(worker);
      };
      worker.onerror = ev => {
        cancel(); try { worker.terminate(); } catch (_) {}
        reject(new Error("素材保存Workerを起動できません" + (ev && ev.message ? ": " + ev.message : "")));
      };
      worker.addEventListener("message", onReady);
    }).catch(e => { S._workerP = null; throw e; });
    return S._workerP;
  };

  S._request = (msg, transfer, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const worker = S._worker;
    if (!worker) { reject(new Error("素材保存Workerがありません")); return; }
    const cancel = patientTimeout(() => {
      worker.removeEventListener("message", onMessage);
      reject(new Error((msg && msg.type) + ": 素材保存Workerの応答がありません"));
    }, timeoutMs);
    const onMessage = ev => {
      const m = ev.data || {};
      if (m.type === "ready") return;
      cancel(); worker.removeEventListener("message", onMessage);
      if (m.type === "error") reject(new Error(m.op + ": " + m.message));
      else resolve(m);
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage(msg, transfer || []);
  });

  /* 素材があるタブは shared lock を保持する。起動掃除は exclusive lock が
     取れたときだけ全消しするため、別タブの作業中素材を削除しない。 */
  S._holdActive = () => {
    if (!navigator.locks) return Promise.resolve(true);
    if (S._activeRelease) return Promise.resolve(true);
    if (S._activeP) return S._activeP;
    S._activeP = new Promise(resolve => {
      navigator.locks.request(S.LOCK, { mode: "shared" }, lock => {
        if (!lock) { resolve(false); return; }
        let release;
        const held = new Promise(r => { release = r; });
        S._activeRelease = () => {
          const fn = release; release = null; S._activeRelease = null; S._activeP = null;
          if (fn) fn();
        };
        resolve(true); return held;
      }).catch(() => { S._activeP = null; resolve(false); });
    });
    return S._activeP;
  };

  S._dropActiveIfIdle = () => {
    if (S._live.size || !S._activeRelease) return;
    S._activeRelease();
  };

  S._removeName = async (name, expectedBytes = 0) => {
    if (!name) return false;
    notePending(name);
    let removed = false;
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(S.DIR, { create: false }).catch(() => null);
      if (dir) await dir.removeEntry(name).catch(e => {
        if (!e || e.name !== "NotFoundError") throw e;
      });
      removed = true; clearPending(name);
    } catch (_) {}
    S._live.delete(name); S._dropActiveIfIdle();
    diag("removed", { bytes: Number(expectedBytes) || 0, removed });
    return removed;
  };

  S.stage = async (file, options = {}) => {
    if (!file || !S.supported()) {
      diag("fallback", { bytes: Number(file && file.size) || 0, reason: "opfs_unavailable" });
      return { file, storage: "file", name: "", fallback: true };
    }
    const bytes = Number(file.size) || 0;
    const epoch = S._epoch;
    let name = "";
    try {
      /* 明らかに空きが足りない場合だけ先に戻す。estimateは概算なので、足りる
         と出ても実書き込みとサイズ検証を必ず通す。 */
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const free = Number(est && est.quota) - Number(est && est.usage || 0);
        if (isFinite(free) && free < bytes + 64 * 1024 * 1024) {
          diag("fallback", { bytes, reason: "quota_preflight" });
          return { file, storage: "file", name: "", fallback: true };
        }
      }
      if (epoch !== S._epoch) return { file: null, storage: "none", aborted: true };
      const locked = await S._holdActive();
      if (!locked && navigator.locks) throw new Error("素材領域の利用ロックを取得できません");
      await S._initWorker();
      const ext = (/\.(mp4|mov|m4v)$/i.exec(String(file.name || "")) || ["", "bin"])[1].toLowerCase();
      name = `${S.PREFIX}${S._session}_${++S._seq}.${ext}`;
      notePending(name);
      diag("start", { bytes, source: Number(options.source) || 0 });
      await S._request({ type: "open", dir: S.DIR, name });
      for (let at = 0; at < bytes; at += S.CHUNK) {
        if (epoch !== S._epoch) throw new DOMException("素材保存を中断しました", "AbortError");
        const end = Math.min(bytes, at + S.CHUNK);
        const buf = await file.slice(at, end).arrayBuffer();
        await S._request({ type: "write", data: buf, position: at }, [buf], 120000);
        if (options.onProgress) options.onProgress(bytes ? end / bytes : 1);
      }
      const fin = await S._request({ type: "finalize" }, null, 120000);
      if (epoch !== S._epoch) throw new DOMException("素材保存を中断しました", "AbortError");
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(S.DIR, { create: false });
      const handle = await dir.getFileHandle(name, { create: false });
      const stored = await handle.getFile();
      if (stored.size !== bytes || Number(fin && fin.size) !== bytes) {
        throw new Error(`素材のサイズ検証に失敗しました（${stored.size}/${bytes}）`);
      }
      clearPending(name); S._live.add(name);
      diag("success", { bytes, source: Number(options.source) || 0 });
      return { file: stored, storage: "opfs", name, fallback: false };
    } catch (e) {
      try { if (S._worker) await S._request({ type: "abort" }, null, 5000); } catch (_) {}
      if (name) await S._removeName(name, bytes);
      else S._dropActiveIfIdle();
      if (epoch !== S._epoch || (e && e.name === "AbortError")) {
        diag("aborted", { bytes, source: Number(options.source) || 0 });
        return { file: null, storage: "none", name: "", aborted: true };
      }
      diag("fallback", { bytes, source: Number(options.source) || 0, reason: errText(e) });
      return { file, storage: "file", name: "", fallback: true, error: errText(e) };
    }
  };

  S.releaseClip = clip => {
    const name = clip && clip.sourceOpfsName;
    const bytes = Number(clip && clip.size) || 0;
    if (clip) { clip.sourceOpfsName = ""; clip.sourceStorage = "released"; }
    return name ? S._trackRemoval(S._removeName(name, bytes)) : Promise.resolve(false);
  };

  S.cancelWrites = () => {
    S._epoch++;
    if (S._worker) { try { S._worker.terminate(); } catch (_) {} }
    S._worker = null; S._workerP = null;
  };

  S.releaseAll = clips => {
    const names = (clips || []).map(c => ({ name: c && c.sourceOpfsName, bytes: Number(c && c.size) || 0 }))
      .filter(x => x.name);
    for (const c of clips || []) if (c) { c.sourceOpfsName = ""; c.sourceStorage = "released"; }
    const removals = names.map(x => S._trackRemoval(S._removeName(x.name, x.bytes)));
    S.cancelWrites();
    S._live.clear(); S._dropActiveIfIdle();
    return Promise.allSettled(removals).then(() => names.length);
  };

  /* 診断では「削除を依頼した」ではなく、OPFSから実際に消えた後を測る。 */
  S.waitForIdle = async () => {
    while (S._removals.size) await Promise.allSettled([...S._removals]);
    return true;
  };

  S.audit = async () => {
    try {
      if (!S.supported()) return null;
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(S.DIR, { create: false }).catch(() => null);
      if (!dir) return { items: [], bytes: 0, n: 0 };
      const items = [];
      for await (const [name, handle] of dir.entries()) {
        let size = 0, mtime = 0;
        try { const f = await handle.getFile(); size = f.size || 0; mtime = f.lastModified || 0; } catch (_) {}
        items.push({ name, size, mtime });
      }
      return { items, bytes: items.reduce((n, x) => n + x.size, 0), n: items.length };
    } catch (_) { return null; }
  };

  /* 新しいページの起動時、ほかのタブに作業中素材が無いと確認できた場合だけ
     前ページ/クラッシュの残骸を全消しする。Locks非対応ブラウザでは、明示削除の
     控えと6時間超だけを消し、現在利用中かもしれない素材を守る。 */
  S.sweep = async () => {
    if (!S.supported()) return { supported: false, deleted: 0, freed: 0, skipped: false };
    const clean = async deep => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(S.DIR, { create: false }).catch(() => null);
      if (!dir) return { supported: true, deleted: 0, freed: 0, skipped: false, deep };
      const due = new Set(pending()); const now = Date.now();
      let deleted = 0, freed = 0;
      for await (const [name, handle] of dir.entries()) {
        let f = null; try { f = await handle.getFile(); } catch (_) {}
        const stale = !f || !f.lastModified || now - f.lastModified > 6 * 60 * 60 * 1000;
        if (!deep && !due.has(name) && !stale) continue;
        let ok = true; await dir.removeEntry(name).catch(() => { ok = false; });
        if (ok) { deleted++; freed += Number(f && f.size) || 0; clearPending(name); }
      }
      const report = { supported: true, deleted, freed, skipped: false, deep };
      diag("sweep", report); return report;
    };
    if (!navigator.locks) return clean(false);
    return navigator.locks.request(S.LOCK, { mode: "exclusive", ifAvailable: true }, lock => {
      if (!lock) return { supported: true, deleted: 0, freed: 0, skipped: true, deep: false };
      return clean(true);
    }).catch(() => ({ supported: true, deleted: 0, freed: 0, skipped: true, deep: false }));
  };

  return S;
})();
