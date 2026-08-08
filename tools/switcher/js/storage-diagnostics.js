"use strict";
/* Safari「書類とデータ」の管理者専用診断。
   動画本体・ファイル名は保存/送信しない。選択だけ、通常取り込み、アプリ側の
   参照解除、Safari終了後を同じ試行内で分け、OPFS実測と突き合わせる。 */

MC.storageDiag = (() => {
  const D = {};
  const KEY = "mz_storage_diag_v2";
  const SCHEMA = 3, MAX_EVENTS = 120, MAX_ITEMS = 80, MAX_HISTORY = 3;
  let state = null;
  /* iPhoneでは全画面分析の上にも残すが、常に大きなカードを重ねない。
     数値を記録する瞬間だけ管理者が開き、記録後は作業を邪魔しない帯へ戻す。 */
  D._expanded = false;

  const admin = () => Boolean(window.MZ_LIMITS && MZ_LIMITS.admin);
  const now = () => Date.now();
  const errText = e => String((e && (e.message || e.name)) || e || "不明").slice(0, 240);
  const bytes = n => {
    n = Number(n) || 0; const sign = n < 0 ? "−" : ""; n = Math.abs(n);
    if (n >= 1e9) return sign + (n / 1e9).toFixed(2) + " GB";
    if (n >= 1e6) return sign + Math.round(n / 1e6) + " MB";
    if (n >= 1e3) return sign + Math.round(n / 1e3) + " KB";
    return sign + Math.round(n) + " B";
  };
  const stamp = ms => {
    const d = new Date(ms || now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      + ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };
  const anonId = name => {
    let h = 2166136261;
    for (const ch of String(name || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  const cleanNumber = n => isFinite(Number(n)) ? Number(n) : null;
  const fresh = () => ({
    schema: SCHEMA, active: false, runId: "", startedAt: 0,
    events: [], checkpoints: [], clips: [], lastSnapshot: null,
    selectionOnly: null, imported: null, released: null, returned: null, lastRecord: null,
    history: [], notice: "",
  });
  const runData = () => ({
    runId: state.runId, startedAt: state.startedAt, endedAt: now(),
    events: state.events || [], checkpoints: state.checkpoints || [], clips: state.clips || [],
    lastSnapshot: state.lastSnapshot || null, selectionOnly: state.selectionOnly || null,
    imported: state.imported || null, released: state.released || null, returned: state.returned || null,
    lastRecord: state.lastRecord || null,
  });
  const blankRun = () => {
    Object.assign(state, { active: false, runId: "", startedAt: 0, events: [], checkpoints: [], clips: [],
      lastSnapshot: null, selectionOnly: null, imported: null, released: null, returned: null, lastRecord: null });
  };
  const archive = reason => {
    if (!state || (!state.active && !(state.events || []).length && !(state.checkpoints || []).length)) return;
    const h = runData(); h.reason = reason || "試行を終了";
    state.history = [h].concat(state.history || []).slice(0, MAX_HISTORY);
  };
  const migrate = v => {
    const s = fresh();
    if (v && (v.events || v.checkpoints || v.clips)) {
      s.history = [{ runId: v.runId || "旧診断", startedAt: v.startedAt || 0, endedAt: now(),
        events: v.events || [], checkpoints: v.checkpoints || [], clips: v.clips || [],
        lastSnapshot: v.lastSnapshot || null, reason: "v2.4.0以前の記録" }];
      s.notice = "前回までの記録は別試行として保存しました。今回の数値とは混ぜません。";
    }
    return s;
  };
  const load = () => {
    if (!admin()) return fresh();
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && v.schema === SCHEMA) return Object.assign(fresh(), v, { history: Array.isArray(v.history) ? v.history : [] });
      if (v) return migrate(v);
    } catch (_) {}
    return fresh();
  };
  const save = () => {
    if (!admin() || !state) return;
    state.events = (state.events || []).slice(-MAX_EVENTS);
    state.history = (state.history || []).slice(0, MAX_HISTORY);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {
      state.events = state.events.slice(-50);
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    }
  };
  const push = (type, data) => {
    if (!admin() || !state || !state.active) return;
    state.events.push({ at: now(), type, data: data || {} });
    save(); D.render();
  };
  const category = name => {
    name = String(name || "");
    if (window.MC && MC.proxy && name.startsWith(MC.proxy.PREFIX)) return "proxy";
    if (name.startsWith("mzpart_")) return "part";
    if (name === MC.exporter.JOB_FILE) return "job";
    if (name.startsWith("__probe_")) return "probe";
    if (/\.(mp4|mov)$/i.test(name)) return "result";
    return "other";
  };
  const sumCats = items => {
    const out = {};
    for (const it of items) {
      if (!out[it.category]) out[it.category] = { n: 0, bytes: 0 };
      out[it.category].n++; out[it.category].bytes += it.bytes || 0;
    }
    return out;
  };
  const hasEvent = type => (state.events || []).some(e => e.type === type);
  const hasBaseline = () => (state && state.checkpoints || []).some(c =>
    c && c.phase === "基準値" && Number(c.safariGb) > 0.01 && c.validForDelta !== false);
  const phaseFor = () => {
    if (!(state.checkpoints || []).length) return "基準値";
    if (state.selectionOnly && !state.selectionOnly.measured) return "選択のみ後";
    /* ②だけを測ってSafariを閉じた最小試行では、③/④を経由していなくても
       ⑤をそのまま記録する。従来は !imported が先に勝ち、終了後の数値を
       「通常取り込み・分析後」と誤記録していた。 */
    if (state.returned && !state.returned.measured) return "Safari完全終了後";
    if (state.imported && !state.imported.measured) return "通常取り込み・分析後";
    if (state.released && !state.released.measured) return "素材参照を外した後";
    return "追加測定";
  };
  const phaseShort = phase => ({
    "基準値": "①基準値", "選択のみ後": "②選択のみ後", "通常取り込み・分析後": "③分析後",
    "素材参照を外した後": "④参照解除後", "Safari完全終了後": "⑤Safari終了後",
  }[phase] || phase);
  const recordText = rec => {
    if (!rec) return "";
    const delta = Number(rec.deltaSafariBytes) || 0;
    const diff = rec.hasPrevious ? `（${delta === 0 ? "差分 0B" : `${delta > 0 ? "+" : "−"}${bytes(Math.abs(delta))}`}）` : "";
    return `記録済：${phaseShort(rec.phase)} Safari ${Number(rec.safariGb).toFixed(2)}GB${diff}／OPFS ${bytes(rec.opfsBytes)}`;
  };

  /* 実機では、診断欄を #dropSec の外へ出しただけでは足りなかった。
     おまかせの全画面・工程の切替・Safariの描画順のどれかに #workspace 配下の
     fixed要素が巻き込まれると、診断は記録中なのに入力欄へ戻れない。
     診断中のスマホだけ body直下へ実体を移す。閉じれば元の素材欄上へ必ず戻すため、
     通常の管理画面の配置・一般利用者の画面には影響しない。 */
  D.placeHost = () => {
    const host = document.getElementById("storageDiag");
    const side = document.querySelector("#workspace .side");
    const dock = document.getElementById("storageDiagDock");
    if (!host || !side || !dock) return;
    /* iPhone/iPadは回転するとCSS幅が900pxを超えることがある。幅で退避先を
       決めると、診断中に横向きへした瞬間だけdockに残ったままfixed規則が外れ、
       入力欄が分析画面の下へ潜る。端末判定はstate.jsのMC.isIOSを正本にし、
       診断中のiOSは向きに関係なくbody直下へ置く。 */
    const ios = !!(window.MC && MC.isIOS);
    const target = state && state.active && ios ? dock : side;
    if (host.parentElement === target) return;
    if (target === side) {
      const before = side.querySelector("#setupTabs");
      if (before) side.insertBefore(host, before); else side.prepend(host);
    } else target.appendChild(host);
  };

  D.captureRaw = async reason => {
    const snap = {
      at: now(), reason: String(reason || "手動計測"),
      estimate: { supported: false, usage: null, quota: null, details: null, error: "" },
      locks: { supported: false, held: [], pending: [], error: "" },
      opfs: { supported: false, directory: false, directories: {}, n: 0, bytes: 0, categories: {}, items: [], error: "" },
    };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        snap.estimate.supported = true;
        const e = await navigator.storage.estimate();
        snap.estimate.usage = cleanNumber(e && e.usage); snap.estimate.quota = cleanNumber(e && e.quota);
        snap.estimate.details = (e && e.usageDetails) || null;
      }
    } catch (e) { snap.estimate.error = errText(e); }
    try {
      if (navigator.locks && navigator.locks.query) {
        snap.locks.supported = true;
        const q = await navigator.locks.query();
        const names = a => (a || []).map(v => String(v.name || "(名称なし)")).slice(0, 20);
        snap.locks.held = names(q.held); snap.locks.pending = names(q.pending);
      }
    } catch (e) { snap.locks.error = errText(e); }
    try {
      if (!(navigator.storage && navigator.storage.getDirectory)) return snap;
      snap.opfs.supported = true;
      const root = await navigator.storage.getDirectory();
      const raw = [];
      const dirs = [
        { key: "export", name: MC.exporter.OPFS_DIR, forcedCategory: "" },
        { key: "source", name: MC.sourceStore && MC.sourceStore.DIR, forcedCategory: "source" },
      ].filter(x => x.name);
      for (const spec of dirs) {
        const dir = await root.getDirectoryHandle(spec.name, { create: false }).catch(e => {
          if (e && e.name === "NotFoundError") return null;
          throw e;
        });
        snap.opfs.directories[spec.key] = !!dir;
        if (!dir) continue;
        snap.opfs.directory = true;
        for await (const [name, handle] of dir.entries()) {
          let size = 0, mtime = 0, readError = "";
          try { const f = await handle.getFile(); size = f.size || 0; mtime = f.lastModified || 0; }
          catch (e) { readError = errText(e); }
          raw.push({ id: anonId(spec.key + ":" + name), category: spec.forcedCategory || category(name), bytes: size,
            ageSec: mtime ? Math.max(0, Math.round((now() - mtime) / 1000)) : null, readError });
        }
      }
      raw.sort((a, b) => b.bytes - a.bytes);
      snap.opfs.n = raw.length; snap.opfs.bytes = raw.reduce((s, v) => s + v.bytes, 0);
      snap.opfs.categories = sumCats(raw); snap.opfs.items = raw.slice(0, MAX_ITEMS);
    } catch (e) { snap.opfs.error = errText(e); }
    return snap;
  };
  D.capture = async reason => {
    if (!admin() || !state || !state.active) return null;
    const snap = await D.captureRaw(reason);
    state.lastSnapshot = snap; state.events.push({ at: snap.at, type: "snapshot", data: snap });
    save(); D.render(); return snap;
  };
  D.start = async () => {
    if (!admin()) return;
    if (!state) state = load();
    /* すでに開いていた別タブは、Aタブで診断を始めたことを知らないまま
       「新しい試行」を押せる。そこでAの記録を上書きしないよう、開始直前に
       localStorageの正本を読み直す。同一試行をSafari再起動後に続ける場合は
       init時に同じrunIdを読んでいるので止めない。 */
    const latest = load();
    if (latest.active && latest.runId && latest.runId !== state.runId) {
      state = latest; D.render();
      if (MC.ui) MC.ui.toast("別のタブで容量診断を記録中です。その試行を続けてください");
      return;
    }
    archive("新しい試行を開始"); blankRun(); state.active = true; state.startedAt = now(); state.notice = "";
    D._expanded = true; // ①の基準値だけは、開始直後に続けて入力できるよう開く
    state.runId = `${state.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    save(); D.render(); await D.capture("診断開始");
  };
  D.stop = () => {
    if (!admin()) return;
    try { localStorage.removeItem(KEY); } catch (_) {}
    state = fresh(); D._expanded = false; D.render();
  };
  D.init = () => {
    state = load();
    const host = document.getElementById("storageDiag");
    if (host) host.hidden = !admin();
    D.render();
    /* 他タブで記録が進んだ場合も、古いinactive状態で上書きしない。 */
    if (!D._storageWired) {
      D._storageWired = true;
      window.addEventListener("storage", e => {
        if (e.key !== KEY || !admin()) return;
        state = load(); D.render();
      });
    }
    if (admin() && state.active) push("page_open", {
      version: document.documentElement.getAttribute("data-mz-version") || "", ios: !!MC.isIOS,
    });
  };
  D.beforeImport = files => {
    if (!state || !state.active || !admin()) return;
    const arr = Array.from(files || []), total = arr.reduce((s, f) => s + (Number(f.size) || 0), 0);
    state.imported = { at: now(), n: arr.length, bytes: total, measured: false };
    push("files_selected", { n: arr.length, bytes: total,
      types: arr.map(f => String(f.type || "unknown").slice(0, 40)) });
  };
  /* iOSのpickerは開いた時点で動画容量ぶんの内部コピーを作り得る。
     onchange後に「基準値がありません」と止めても容量は戻らないため、
     診断中だけはOSのpickerを開く共通入口より前で①を必須にする。 */
  D.allowPicker = () => {
    if (!state) state = load();
    if (!admin() || !state.active || hasBaseline()) return true;
    D._expanded = true; D.render();
    if (MC.ui && MC.ui.toast) MC.ui.toast("先に①の基準値を記録してください。動画選択はまだ開きません");
    return false;
  };
  D.selectionOnly = files => {
    if (!state || !state.active || !admin()) return;
    if (!D.allowPicker()) return false;
    const arr = Array.from(files || []), total = arr.reduce((s, f) => s + (Number(f.size) || 0), 0);
    if (!arr.length) return;
    state.selectionOnly = { at: now(), n: arr.length, bytes: total, measured: false };
    push("picker_only_selected", { n: arr.length, bytes: total,
      types: arr.map(f => String(f.type || "unknown").slice(0, 40)),
      note: "FileListを直ちに外し、MarchinZの動画解析・再生・プロキシ化はしていません" });
  };
  D.clipLoaded = clip => {
    if (!state || !state.active || !admin() || !clip) return;
    const no = state.clips.length + 1;
    const c = { source: no, bytes: cleanNumber(clip.size || (clip.file && clip.file.size)),
      width: cleanNumber(clip.width), height: cleanNumber(clip.height), duration: cleanNumber(clip.duration),
      type: String(clip.mimeType || (clip.file && clip.file.type) || "unknown").slice(0, 40) };
    state.clips.push(c); push("clip_loaded", c);
  };
  D.proxyDecision = (clip, spec, extra) => {
    if (!state || !state.active || !admin()) return;
    const idx = Math.max(0, (MC.S.clips || []).indexOf(clip));
    push("proxy_decision", Object.assign({ source: idx + 1, sourceWidth: cleanNumber(clip && clip.width),
      sourceHeight: cleanNumber(clip && clip.height), candidate: !!spec,
      targetWidth: cleanNumber(spec && spec.w), targetHeight: cleanNumber(spec && spec.h), scale: cleanNumber(spec && spec.scale) }, extra || {}));
  };
  D.proxyBuild = (phase, clip, data) => {
    if (!state || !state.active || !admin()) return;
    const idx = Math.max(0, (MC.S.clips || []).indexOf(clip)); push("proxy_" + phase, Object.assign({ source: idx + 1 }, data || {}));
  };
  D.sourceHandoff = (phase, data) => push("source_" + phase, Object.assign({
    bytes: cleanNumber(data && data.bytes), source: cleanNumber(data && data.source),
  }, data || {}));
  D.pagehide = () => {
    if (!state || !state.active || !admin()) return;
    push("pagehide", { liveProxyN: (MC.proxy && MC.proxy._live && MC.proxy._live.size) || 0 });
  };
  D.toolExit = report => {
    const r = report || {};
    push("tool_session_released", {
      reason: String(r.reason || "").slice(0, 60), clips: Number(r.clips) || 0,
      files: Number(r.files) || 0, videos: Number(r.videos) || 0,
      urls: Number(r.urls) || 0, proxies: Number(r.proxies) || 0,
      sources: Number(r.sources) || 0,
      workers: Number(r.workers) || 0, audioContexts: Number(r.audioContexts) || 0,
      result: Number(r.result) || 0,
    });
  };
  D.probeStart = () => push("opfs_probe_start", {});
  D.probeResult = (ok, error) => push("opfs_probe_result", { ok: !!ok, error: error ? errText(error) : "" });
  D.probePending = () => push("opfs_probe_pending_15s", { meaning: "Worker応答待ち。起動掃除はこの処理とは独立です" });
  D.sweepCycle = async trigger => {
    if (!admin() || !state || !state.active) return MC.exporter.opfsSweep();
    const before = await D.captureRaw(`${trigger}:掃除前`); let thrown = "";
    try { await MC.exporter.opfsSweep(); } catch (e) { thrown = errText(e); }
    const after = await D.captureRaw(`${trigger}:掃除後`); state.lastSnapshot = after;
    push("sweep", { trigger, before, after, freedObserved: Math.max(0, (before.opfs.bytes || 0) - (after.opfs.bytes || 0)),
      report: MC.exporter._lastSweepReport || null, thrown }); return after;
  };
  D.releaseSources = async () => {
    if (!state || !state.active || !admin()) return;
    if ((MC.ui && MC.ui._busy) || (MC.exporter && (MC.exporter.running || MC.exporter.recording))) {
      if (MC.ui) MC.ui.toast("分析・書き出し中は素材を外せません。完了してからお試しください"); return;
    }
    if (!(MC.S.clips || []).length) { if (MC.ui) MC.ui.toast("外せる素材がありません"); return; }
    if (MC.preview) MC.preview.pause();
    const settled = MC.media && MC.media.waitForIdle ? await MC.media.waitForIdle() : true;
    if (!settled) { if (MC.ui) MC.ui.toast("軽い判定が終わらないため、まだ素材を外しませんでした"); return; }
    const clips = [...MC.S.clips];
    if (MC.proxy) MC.proxy.disposeAll();
    for (const c of clips) {
      try { if (c.video) { c.video.pause(); c.video.removeAttribute("src"); c.video.load(); } } catch (_) {}
      /* 一括解除の途中でafterChange→focusNextActionを走らせると、3本→2本の
         一瞬に「仕上げの好み」が予約され、素材が空になった後に診断欄を塞ぐ。
         ここでは各clipの破棄だけを行い、最後に自走なしで1回描き直す。 */
      MC.media.removeClip(c.id, { deferAfterChange: true });
      /* removeClip後に残るローカル変数にも、File/HTMLVideoElementを残さない。 */
      c.file = null; c.video = null; c.url = "";
    }
    if (MC.media && MC.media.afterChange) MC.media.afterChange({ suppressNextAction: true });
    ["#fileInput", "#fileInputV"].forEach(sel => { const input = document.querySelector(sel); if (input) input.value = ""; });
    if (MC.preview) { MC.preview.soloId = null; MC.preview.draw(); }
    state.released = { at: now(), clips: clips.length, measured: false };
    push("app_sources_released", { clips: clips.length, quickQueueSettled: true,
      note: "File・video要素のsrc・Object URL・プロキシをMarchinZ側から外しました" });
    await D.capture("アプリ側の素材参照を外した後");
    if (MC.ui) MC.ui.toast("MarchinZ側の素材参照を外しました。設定の数値を記録してください");
  };
  D.markReturned = () => {
    if (!state || !state.active || !admin()) return;
    state.returned = { at: now(), measured: false }; push("safari_return_confirmed", {});
  };
  D.recordCheckpoint = async () => {
    if (!state || !state.active || !admin()) return;
    const input = document.getElementById("storageDiagGb"), gb = Number(input && input.value);
    if (!(gb >= 0)) { if (MC.ui && MC.ui.toast) MC.ui.toast("Safariの「書類とデータ」をGBで入力してください"); return; }
    const phase = phaseFor(), snap = await D.captureRaw(`Safari ${gb}GBの同時計測`);
    const cp = { at: now(), phase, safariGb: gb, safariBytes: Math.round(gb * 1e9), snapshot: snap,
      /* 0は設定画面の読取り途中・入力ミスの可能性が高い。記録は残し、差分計算だけから外す。 */
      validForDelta: gb > 0.01 };
    if (phase === "選択のみ後") state.selectionOnly.measured = true;
    if (phase === "通常取り込み・分析後") state.imported.measured = true;
    if (phase === "素材参照を外した後") state.released.measured = true;
    if (phase === "Safari完全終了後") state.returned.measured = true;
    const previous = [...(state.checkpoints || [])].reverse().find(x => x && x.validForDelta);
    state.lastRecord = { phase, safariGb: gb, opfsBytes: snap.opfs.bytes || 0,
      hasPrevious: !!previous, deltaSafariBytes: previous ? cp.safariBytes - previous.safariBytes : 0 };
    state.checkpoints.push(cp); state.lastSnapshot = snap; state.events.push({ at: cp.at, type: "checkpoint", data: cp });
    save(); if (input) input.value = "";
    /* 記録が終われば素材操作へ戻る。診断が作業画面を覆い続けないことを優先する。 */
    if (MC.isIOS) D._expanded = false;
    D.render();
    if (MC.ui) MC.ui.toast(cp.validForDelta ? recordText(state.lastRecord) : "0.00GBは記録しましたが、差分判定には使いません");
  };

  D.analysis = () => {
    const out = { verdict: "まだ判定材料が足りません", proxy: "未判定", sweep: "未計測", detail: [] };
    if (!state) return out;
    const ev = state.events || [], ps = ev.filter(e => e.type === "proxy_success"), pf = ev.filter(e => e.type === "proxy_failure"), pd = ev.filter(e => e.type === "proxy_decision");
    if (ps.length) out.proxy = `作成あり（${ps.length}本・${bytes(ps.reduce((s, e) => s + (e.data.bytes || 0), 0))}）`;
    else if (pf.length) out.proxy = `作成を試したが失敗（${pf.length}本）`;
    else if (pd.length && pd.every(e => !e.data.candidate)) out.proxy = "作成対象にならなかった";
    const sw = ev.filter(e => e.type === "sweep").slice(-1)[0];
    if (sw) { const r = sw.data.report || {}; out.sweep = `${r.deep ? "深い掃除" : "保守的な掃除"}・実測解放 ${bytes(sw.data.freedObserved)}` + (r.error || sw.data.thrown ? `・エラー ${r.error || sw.data.thrown}` : ""); }
    const cps = (state.checkpoints || []).filter(c => c.validForDelta !== false);
    const compare = (a, b, label) => {
      if (!a || !b) return null;
      const safari = b.safariBytes - a.safariBytes, opfs = (b.snapshot.opfs.bytes || 0) - (a.snapshot.opfs.bytes || 0);
      const r = { safari, opfs, unexplained: safari - opfs, error: a.snapshot.opfs.error || b.snapshot.opfs.error };
      out.detail.push(`${label}: Safari差 ${bytes(safari)} / OPFS差 ${bytes(opfs)} / OPFSで説明できない差 ${bytes(r.unexplained)}`); return r;
    };
    if (cps.length >= 2) {
      /* 診断を続けたまま通常取り込みを挟むことがある。開始値から最後の値までは
         全体像として残すが、これを「選択だけ」の増加と取り違えないよう明記する。 */
      const all = compare(cps[0], cps[cps.length - 1], "診断開始からの累計（途中の通常取り込みを含む）");
      if (all.error) out.verdict = "OPFS計測エラーがあり、まだ分類できません";
      else if (all.safari > 300e6 && Math.abs(all.opfs) < all.safari * 0.25) out.verdict = "Safari内部コピー側の増加が強く疑われます（OPFSでは説明できません）";
      else if (all.opfs > 300e6 && all.opfs >= all.safari * 0.5) out.verdict = ps.length ? "OPFS増加を確認。プロキシの寄与も実測されました" : "OPFS内の素材・書き出しデータ増加を確認しました";
      else if (all.safari < -300e6 && all.opfs > -100e6) out.verdict = "Safari終了後にOPFS以外の領域が解放された可能性が高いです";
      else out.verdict = "増減が混在しています。次の地点を記録すると分類できます";
    }
    const picked = cps.find(c => c.phase === "選択のみ後");
    /* ②は「選択した直前」と「選択だけを行った直後」の差である。
       初回の基準値と比べると、その間に行った通常取り込みまで②の責任に
       見えてしまう(優さんの実機で 10.88GB と誤表示した経路)。 */
    const pickBefore = state.selectionOnly && state.selectionOnly.at
      ? cps.filter(c => c.at < state.selectionOnly.at).slice(-1)[0]
      : (cps.find(c => c.phase === "基準値") || cps[0]);
    const pick = compare(pickBefore, picked, "選択だけの直前記録との差");
    if (pick && !pick.error && pick.safari > 300e6 && Math.abs(pick.opfs) < pick.safari * 0.25) {
      out.verdict = "ファイル選択だけでSafari内部コピー側が増えた可能性が高いです";
    }
    const released = cps.find(c => c.phase === "素材参照を外した後");
    if (released) {
      const before = cps.filter(c => c.at < released.at).slice(-1)[0], r = compare(before, released, "MarchinZ側の参照解除");
      if (r && !r.error) {
        if (r.safari < -300e6 && r.opfs > -100e6) out.verdict = "MarchinZ側の素材参照を外した後にOPFS外の領域が解放されました";
        else if (r.safari > -300e6) out.detail.push("素材参照を外してもSafariの数値は大きく減っていません");
      }
    }
    const returned = cps.find(c => c.phase === "Safari完全終了後");
    if (returned) {
      const before = cps.filter(c => c.at < returned.at).slice(-1)[0], r = compare(before, returned, "Safari完全終了の区間");
      if (r && !r.error && r.safari < -300e6 && r.opfs > -100e6) out.verdict = "Safari完全終了後にOPFS外の領域が解放されました";
    }
    return out;
  };
  D.report = () => {
    if (!state) state = load(); const a = D.analysis();
    const lines = [
      `MarchinZ Safari容量診断 ${document.documentElement.getAttribute("data-mz-version") || "版不明"}`,
      `診断ID: ${state.runId || "未開始"}`, `開始: ${state.startedAt ? stamp(state.startedAt) : "未開始"}`,
      `端末: ${navigator.userAgent}`, "", `判定: ${a.verdict}`, `プロキシ: ${a.proxy}`, `起動掃除: ${a.sweep}`,
      ...a.detail, `過去試行: ${(state.history || []).length}件（今回の差分計算には不使用）`, "", "【今回のSafari 書類とデータの記録】",
    ];
    (state.checkpoints || []).forEach((c, i) => lines.push(`${i + 1}. ${stamp(c.at)} ${c.phase}: Safari ${c.safariGb.toFixed(2)} GB / OPFS ${bytes(c.snapshot.opfs.bytes)}${c.validForDelta === false ? " / 差分判定から除外" : ""}`));
    lines.push("", "【今回の素材（ファイル名なし）】");
    (state.clips || []).forEach(c => lines.push(`素材${c.source}: ${bytes(c.bytes)} / ${c.width}x${c.height} / ${c.duration == null ? "?" : c.duration.toFixed(1)}秒 / ${c.type}`));
    lines.push("", "【今回のイベント】");
    for (const e of (state.events || [])) {
      if (e.type === "snapshot") {
        const o = e.data.opfs || {}, est = e.data.estimate || {};
        lines.push(`${stamp(e.at)} snapshot(${e.data.reason}): OPFS ${bytes(o.bytes)} ${o.n}件 [${Object.keys(o.categories || {}).map(k => `${k}:${bytes(o.categories[k].bytes)}`).join(", ") || "空"}] / storage.usage ${bytes(est.usage)}${o.error ? " / ERROR " + o.error : ""}`);
      } else if (e.type === "sweep") {
        const r = e.data.report || {}; lines.push(`${stamp(e.at)} sweep(${e.data.trigger}): ${r.deep ? "深" : "保守"} / before ${bytes(e.data.before.opfs.bytes)} -> after ${bytes(e.data.after.opfs.bytes)} / 解放 ${bytes(e.data.freedObserved)}${r.error ? " / ERROR " + r.error : ""}`);
      } else if (e.type === "checkpoint") lines.push(`${stamp(e.at)} checkpoint(${e.data.phase}): Safari ${e.data.safariGb.toFixed(2)} GB / OPFS ${bytes(e.data.snapshot.opfs.bytes)}`);
      else lines.push(`${stamp(e.at)} ${e.type}: ${JSON.stringify(e.data)}`);
    }
    lines.push("", "※動画本体・ファイル名は記録していません。通信送信もしていません。"); return lines.join("\n");
  };
  D.copy = async () => {
    const text = D.report();
    try { await navigator.clipboard.writeText(text); if (MC.ui) MC.ui.toast("診断レポートをコピーしました"); }
    catch (_) { const ta = document.getElementById("storageDiagReport"); if (ta) { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); } if (MC.ui) MC.ui.toast("下の記録を選択しました。長押しでコピーしてください"); }
  };
  D.render = () => {
    const host = document.getElementById("storageDiag"); if (!host) return;
    if (!admin()) {
      document.body.classList.remove("mz-storage-diag-active");
      host.hidden = true; host.innerHTML = ""; return;
    }
    if (!state) state = load();
    D.placeHost();
    host.hidden = false;
    /* 診断中は工程が進んでも入口を見失わせない。おまかせの全画面分析・
       書き出し全画面の上にも、CSSがこの印を使って記録欄を前面へ出す。
       管理者が「分析後に入力欄が無い」と実機報告したため(2026-08-08)。 */
    document.body.classList.toggle("mz-storage-diag-active", !!state.active);
    if (!state.active) {
      host.innerHTML = `<div class="sd-head"><div><b>Safari容量診断（管理者専用）</b><span>動画は送信せず、原因の数字だけ端末内に記録します。</span></div></div>${state.notice ? `<p class="sd-notice">${state.notice}</p>` : ""}<button type="button" class="btn sd-primary" id="storageDiagStart">新しい試行を開始</button>`;
      host.querySelector("#storageDiagStart").onclick = () => D.start(); return;
    }
    const a = D.analysis(), cps = state.checkpoints || [], hasClips = !!(MC.S.clips || []).length;
    const baselineReady = hasBaseline();
    const returnedPending = state.returned && !state.returned.measured;
    const completedByReturn = state.returned && state.returned.measured;
    const canMarkReturned = (state.selectionOnly || state.imported) && !completedByReturn;
    let next = cps.length === 0 ? "① いまの「書類とデータ」を入力して、基準値を記録してください"
      : state.selectionOnly && !state.selectionOnly.measured ? "② 「選択だけ」の直後の数値を入力してください"
      : returnedPending ? "⑤ Safari完全終了後の数値を入力してください"
      : completedByReturn ? "⑤ Safari完全終了後まで記録済みです。レポートをコピーしてください"
      : !state.selectionOnly ? "② まず「選択だけを試す」で、動画を処理せずに選択直後を測れます"
      : !state.imported ? "③ 通常の「動画を選ぶ」から分析まで進め、数値を入力してください"
      : !state.imported.measured ? "③ 通常取り込み・分析後の数値を入力してください"
      : !state.released ? "④ 分析が終わっていれば「MarchinZ側の素材参照を外す」を押してください"
      : !state.released.measured ? "④ 素材参照を外した後の数値を入力してください"
      : !state.returned ? "⑤ Safariを完全終了して開き直したら「Safariを開き直した」を押してください"
      : !state.returned.measured ? "⑤ Safari完全終了後の数値を入力してください"
      : "今回の試行は記録済みです。レポートをコピーしてください";
    const snap = state.lastSnapshot;
    const compactNext = cps.length === 0 ? "① 基準値を記録"
      : state.selectionOnly && !state.selectionOnly.measured ? "② 選択後の数値を記録"
      : returnedPending ? "⑤ 再起動後の数値を記録"
      : completedByReturn ? "⑤ 再起動後まで記録済み"
      : !state.selectionOnly ? "② 選択だけを試す"
      : !state.imported ? "③ 3本を選んで分析"
      : !state.imported.measured ? "③ 分析後の数値を記録"
      : !state.released ? "④ 素材参照を外す"
      : !state.released.measured ? "④ 解除後の数値を記録"
      : !state.returned ? "⑤ Safariを開き直す"
      : !state.returned.measured ? "⑤ 再起動後の数値を記録" : "記録完了";
    const compact = !!MC.isIOS && !D._expanded;
    if (compact) {
      host.classList.add("sd-compact");
      const compactStatus = recordText(state.lastRecord) || compactNext;
      host.innerHTML = `<div class="sd-compact-bar"><div><b>Safari容量診断中</b><span>${compactStatus}</span></div><button type="button" class="btn ghost" id="storageDiagToggle" aria-expanded="false">開く</button></div>`;
      host.querySelector("#storageDiagToggle").onclick = () => { D._expanded = true; D.render(); };
      return;
    }
    host.classList.remove("sd-compact");
    host.innerHTML = `<div class="sd-head"><div><b>Safari容量診断中</b><span>${next}</span></div><div class="sd-head-actions"><span class="sd-live">記録中</span><button type="button" class="btn ghost sd-fold" id="storageDiagToggle" aria-expanded="true">たたむ</button></div></div>
      <div class="sd-result"><b>${a.verdict}</b>${state.lastRecord ? `<span class="sd-recorded">${recordText(state.lastRecord)}</span>` : ""}<span>プロキシ: ${a.proxy}</span><span>掃除: ${a.sweep}</span><span>現在のOPFS: ${snap ? `${bytes(snap.opfs.bytes)}（${snap.opfs.n}件）` : "計測前"}</span></div>
      <div class="sd-plan"><b>今回の試行で分けること</b><span>①基準値　②ファイル選択だけ　③通常の分析　④MarchinZ側の参照解除　⑤Safari完全終了後</span><div class="sd-plan-actions"><div class="sd-release-wrap"><button type="button" class="btn ghost" id="storageDiagOnly" ${baselineReady ? "" : "disabled"} aria-describedby="storageDiagOnlyHint">② 選択だけを試す（動画を処理しない）</button>${baselineReady ? "" : `<span id="storageDiagOnlyHint" class="sd-release-hint">①基準値を記録すると使えます</span>`}</div><input id="storageDiagOnlyInput" type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" multiple hidden><div class="sd-release-wrap"><button type="button" class="btn ghost" id="storageDiagRelease" ${hasClips ? "" : "disabled"} aria-describedby="storageDiagReleaseHint">④ MarchinZ側の素材参照を外す</button>${hasClips ? "" : `<span id="storageDiagReleaseHint" class="sd-release-hint">③通常取り込み後に使えます</span>`}</div><button type="button" class="btn ghost" id="storageDiagReturned" ${canMarkReturned ? "" : "disabled"}>⑤ Safariを開き直した</button></div></div>
      <label class="sd-label" for="storageDiagGb">設定 → Safari →「書類とデータ」</label><div class="sd-measure"><input id="storageDiagGb" type="number" min="0" step="0.01" inputmode="decimal" placeholder="例 5.49"><span>GB</span><button type="button" class="btn" id="storageDiagRecord">この数値を記録</button></div>
      <div class="sd-actions"><button type="button" class="btn ghost" id="storageDiagNew">新しい試行</button><button type="button" class="btn ghost" id="storageDiagSnap">内部だけ再計測</button><button type="button" class="btn ghost" id="storageDiagCopy">レポートをコピー</button><button type="button" class="btn ghost" id="storageDiagStop">診断を終了・記録削除</button></div><textarea id="storageDiagReport" class="sd-report" readonly hidden aria-label="診断レポート"></textarea>`;
    host.querySelector("#storageDiagRecord").onclick = () => D.recordCheckpoint();
    host.querySelector("#storageDiagSnap").onclick = () => D.capture("手動再計測");
    host.querySelector("#storageDiagCopy").onclick = () => D.copy();
    host.querySelector("#storageDiagNew").onclick = () => D.start();
    host.querySelector("#storageDiagStop").onclick = () => D.stop();
    host.querySelector("#storageDiagOnly").onclick = () => {
      if (D.allowPicker()) host.querySelector("#storageDiagOnlyInput").click();
    };
    host.querySelector("#storageDiagOnlyInput").onchange = e => { const files = [...e.currentTarget.files]; e.currentTarget.value = ""; D.selectionOnly(files); };
    host.querySelector("#storageDiagRelease").onclick = () => D.releaseSources();
    host.querySelector("#storageDiagReturned").onclick = () => D.markReturned();
    host.querySelector("#storageDiagToggle").onclick = () => { D._expanded = false; D.render(); };
  };
  D._test = { fresh, bytes, category, sumCats, phaseFor, recordText, hasBaseline,
    setState: s => { state = s; }, getState: () => state, archive, blankRun };
  return D;
})();
