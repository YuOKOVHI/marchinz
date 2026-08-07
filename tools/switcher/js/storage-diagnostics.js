"use strict";
/* Safari「書類とデータ」の管理者専用診断。
   動画本体・ファイル名は保存/送信しない。選択量、実解像度、プロキシの実行結果、
   OPFS内訳とiPhone設定画面の数値を同じ時刻で結び、少ない試行で原因を分ける。 */

MC.storageDiag = (() => {
  const D = {};
  const KEY = "mz_storage_diag_v2";
  const MAX_EVENTS = 120;
  const MAX_ITEMS = 80;
  let state = null;

  const admin = () => Boolean(window.MZ_LIMITS && MZ_LIMITS.admin);
  const now = () => Date.now();
  const errText = e => String((e && (e.message || e.name)) || e || "不明").slice(0, 240);
  const bytes = n => {
    n = Number(n) || 0;
    const sign = n < 0 ? "−" : ""; n = Math.abs(n);
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
    schema: 2, active: false, runId: "", startedAt: 0,
    events: [], checkpoints: [], clips: [], lastSnapshot: null,
  });
  const load = () => {
    if (!admin()) return fresh();
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && v.schema === 2) return Object.assign(fresh(), v);
    } catch (_) {}
    return fresh();
  };
  const save = () => {
    if (!admin() || !state) return;
    state.events = state.events.slice(-MAX_EVENTS);
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

  D.captureRaw = async reason => {
    const snap = {
      at: now(), reason: String(reason || "手動計測"),
      estimate: { supported: false, usage: null, quota: null, details: null, error: "" },
      locks: { supported: false, held: [], pending: [], error: "" },
      opfs: { supported: false, directory: false, n: 0, bytes: 0, categories: {}, items: [], error: "" },
    };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        snap.estimate.supported = true;
        const e = await navigator.storage.estimate();
        snap.estimate.usage = cleanNumber(e && e.usage);
        snap.estimate.quota = cleanNumber(e && e.quota);
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
      const dir = await root.getDirectoryHandle(MC.exporter.OPFS_DIR, { create: false }).catch(e => {
        if (e && e.name === "NotFoundError") return null;
        throw e;
      });
      if (!dir) return snap;
      snap.opfs.directory = true;
      const raw = [];
      for await (const [name, handle] of dir.entries()) {
        let size = 0, mtime = 0, readError = "";
        try { const f = await handle.getFile(); size = f.size || 0; mtime = f.lastModified || 0; }
        catch (e) { readError = errText(e); }
        raw.push({ id: anonId(name), category: category(name), bytes: size,
          ageSec: mtime ? Math.max(0, Math.round((now() - mtime) / 1000)) : null,
          readError });
      }
      raw.sort((a, b) => b.bytes - a.bytes);
      snap.opfs.n = raw.length;
      snap.opfs.bytes = raw.reduce((s, v) => s + v.bytes, 0);
      snap.opfs.categories = sumCats(raw);
      snap.opfs.items = raw.slice(0, MAX_ITEMS);
    } catch (e) { snap.opfs.error = errText(e); }
    return snap;
  };

  D.capture = async reason => {
    if (!admin() || !state || !state.active) return null;
    const snap = await D.captureRaw(reason);
    state.lastSnapshot = snap;
    state.events.push({ at: snap.at, type: "snapshot", data: snap });
    save(); D.render();
    return snap;
  };

  D.start = async () => {
    if (!admin()) return;
    state = fresh(); state.active = true; state.startedAt = now();
    state.runId = `${state.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    save(); D.render();
    await D.capture("診断開始");
  };
  D.stop = () => {
    if (!admin()) return;
    try { localStorage.removeItem(KEY); } catch (_) {}
    state = fresh(); D.render();
  };
  D.init = () => {
    state = load();
    const host = document.getElementById("storageDiag");
    if (host) host.hidden = !admin();
    D.render();
    if (admin() && state.active) push("page_open", {
      version: document.documentElement.getAttribute("data-mz-version") || "",
      ios: !!MC.isIOS,
    });
  };
  D.beforeImport = files => {
    if (!state || !state.active || !admin()) return;
    const arr = Array.from(files || []);
    push("files_selected", { n: arr.length,
      bytes: arr.reduce((s, f) => s + (Number(f.size) || 0), 0),
      types: arr.map(f => String(f.type || "unknown").slice(0, 40)) });
  };
  D.clipLoaded = clip => {
    if (!state || !state.active || !admin() || !clip) return;
    const no = state.clips.length + 1;
    const c = { source: no, bytes: cleanNumber(clip.size || (clip.file && clip.file.size)),
      width: cleanNumber(clip.width), height: cleanNumber(clip.height),
      duration: cleanNumber(clip.duration), type: String((clip.file && clip.file.type) || "unknown").slice(0, 40) };
    state.clips.push(c); push("clip_loaded", c);
  };
  D.proxyDecision = (clip, spec, extra) => {
    if (!state || !state.active || !admin()) return;
    const idx = Math.max(0, (MC.S.clips || []).indexOf(clip));
    push("proxy_decision", Object.assign({ source: idx + 1,
      sourceWidth: cleanNumber(clip && clip.width), sourceHeight: cleanNumber(clip && clip.height),
      candidate: !!spec,
      targetWidth: cleanNumber(spec && spec.w), targetHeight: cleanNumber(spec && spec.h),
      scale: cleanNumber(spec && spec.scale),
    }, extra || {}));
  };
  D.proxyBuild = (phase, clip, data) => {
    if (!state || !state.active || !admin()) return;
    const idx = Math.max(0, (MC.S.clips || []).indexOf(clip));
    push("proxy_" + phase, Object.assign({ source: idx + 1 }, data || {}));
  };
  D.pagehide = () => {
    if (!state || !state.active || !admin()) return;
    push("pagehide", { liveProxyN: (MC.proxy && MC.proxy._live && MC.proxy._live.size) || 0 });
  };
  D.probeStart = () => push("opfs_probe_start", {});
  D.probeResult = (ok, error) => push("opfs_probe_result", {
    ok: !!ok, error: error ? errText(error) : "",
  });
  D.probePending = () => push("opfs_probe_pending_15s", {
    meaning: "Worker応答待ち。起動掃除はこの処理とは独立です",
  });
  D.sweepCycle = async trigger => {
    if (!admin() || !state || !state.active) return MC.exporter.opfsSweep();
    const before = await D.captureRaw(`${trigger}:掃除前`);
    let thrown = "";
    try { await MC.exporter.opfsSweep(); } catch (e) { thrown = errText(e); }
    const after = await D.captureRaw(`${trigger}:掃除後`);
    state.lastSnapshot = after;
    push("sweep", { trigger, before, after,
      freedObserved: Math.max(0, (before.opfs.bytes || 0) - (after.opfs.bytes || 0)),
      report: MC.exporter._lastSweepReport || null, thrown });
    return after;
  };
  D.recordCheckpoint = async () => {
    if (!state || !state.active || !admin()) return;
    const input = document.getElementById("storageDiagGb");
    const gb = Number(input && input.value);
    if (!(gb >= 0)) { if (MC.ui && MC.ui.toast) MC.ui.toast("Safariの「書類とデータ」をGBで入力してください"); return; }
    const snap = await D.captureRaw(`Safari ${gb}GBの同時計測`);
    const cp = { at: now(), safariGb: gb, safariBytes: Math.round(gb * 1e9), snapshot: snap };
    state.checkpoints.push(cp); state.lastSnapshot = snap;
    state.events.push({ at: cp.at, type: "checkpoint", data: cp });
    save(); if (input) input.value = ""; D.render();
  };

  D.analysis = () => {
    const out = { verdict: "まだ判定材料が足りません", proxy: "未判定", sweep: "未計測", detail: [] };
    if (!state) return out;
    const ev = state.events || [];
    const ps = ev.filter(e => e.type === "proxy_success");
    const pf = ev.filter(e => e.type === "proxy_failure");
    const pd = ev.filter(e => e.type === "proxy_decision");
    if (ps.length) out.proxy = `作成あり（${ps.length}本・${bytes(ps.reduce((s, e) => s + (e.data.bytes || 0), 0))}）`;
    else if (pf.length) out.proxy = `作成を試したが失敗（${pf.length}本）`;
    else if (pd.length && pd.every(e => !e.data.candidate)) out.proxy = "作成対象にならなかった";
    const sw = ev.filter(e => e.type === "sweep").slice(-1)[0];
    if (sw) {
      const r = sw.data.report || {};
      out.sweep = `${r.deep ? "深い掃除" : "保守的な掃除"}・実測解放 ${bytes(sw.data.freedObserved)}`
        + (r.error || sw.data.thrown ? `・エラー ${r.error || sw.data.thrown}` : "");
    }
    const cp = state.checkpoints || [];
    if (cp.length >= 2) {
      const a = cp[0], b = cp[cp.length - 1];
      const safariDelta = b.safariBytes - a.safariBytes;
      const opfsDelta = (b.snapshot.opfs.bytes || 0) - (a.snapshot.opfs.bytes || 0);
      const unexplained = safariDelta - opfsDelta;
      out.detail.push(`Safari差 ${bytes(safariDelta)} / OPFS差 ${bytes(opfsDelta)} / OPFSで説明できない差 ${bytes(unexplained)}`);
      const opfsError = a.snapshot.opfs.error || b.snapshot.opfs.error;
      if (opfsError) out.verdict = "OPFS計測エラーがあり、まだ分類できません";
      else if (safariDelta > 300e6 && Math.abs(opfsDelta) < safariDelta * 0.25) {
        out.verdict = "Safari内部コピー側の増加が強く疑われます（OPFSでは説明できません）";
      } else if (opfsDelta > 300e6 && opfsDelta >= safariDelta * 0.5) {
        out.verdict = ps.length ? "OPFS増加を確認。プロキシの寄与も実測されました" : "OPFS内の書き出しデータ増加を確認しました";
      } else if (safariDelta < -300e6 && opfsDelta > -100e6) {
        out.verdict = "Safari終了後にOPFS以外の領域が解放された可能性が高いです";
      } else out.verdict = "増減が混在しています。もう1地点だけ測ると分類できます";
    }
    return out;
  };

  D.report = () => {
    if (!state) state = load();
    const a = D.analysis();
    const lines = [
      `MarchinZ Safari容量診断 ${document.documentElement.getAttribute("data-mz-version") || "版不明"}`,
      `診断ID: ${state.runId || "未開始"}`, `開始: ${state.startedAt ? stamp(state.startedAt) : "未開始"}`,
      `端末: ${navigator.userAgent}`, "", `判定: ${a.verdict}`, `プロキシ: ${a.proxy}`, `起動掃除: ${a.sweep}`,
      ...a.detail, "", "【Safari 書類とデータの記録】",
    ];
    (state.checkpoints || []).forEach((c, i) => lines.push(
      `${i + 1}. ${stamp(c.at)} Safari ${c.safariGb.toFixed(2)} GB / OPFS ${bytes(c.snapshot.opfs.bytes)}`));
    lines.push("", "【素材（ファイル名なし）】");
    (state.clips || []).forEach(c => lines.push(
      `素材${c.source}: ${bytes(c.bytes)} / ${c.width}x${c.height} / ${c.duration == null ? "?" : c.duration.toFixed(1)}秒 / ${c.type}`));
    lines.push("", "【イベント】");
    for (const e of (state.events || [])) {
      if (e.type === "snapshot") {
        const o = e.data.opfs || {}, est = e.data.estimate || {};
        lines.push(`${stamp(e.at)} snapshot(${e.data.reason}): OPFS ${bytes(o.bytes)} ${o.n}件 [${Object.keys(o.categories || {}).map(k => `${k}:${bytes(o.categories[k].bytes)}`).join(", ") || "空"}] / storage.usage ${bytes(est.usage)}${o.error ? " / ERROR " + o.error : ""}`);
      } else if (e.type === "sweep") {
        const r = e.data.report || {};
        lines.push(`${stamp(e.at)} sweep(${e.data.trigger}): ${r.deep ? "深" : "保守"} / before ${bytes(e.data.before.opfs.bytes)} -> after ${bytes(e.data.after.opfs.bytes)} / 解放 ${bytes(e.data.freedObserved)}${r.error ? " / ERROR " + r.error : ""}`);
      } else if (e.type === "checkpoint") {
        lines.push(`${stamp(e.at)} checkpoint: Safari ${e.data.safariGb.toFixed(2)} GB / OPFS ${bytes(e.data.snapshot.opfs.bytes)}`);
      } else {
        lines.push(`${stamp(e.at)} ${e.type}: ${JSON.stringify(e.data)}`);
      }
    }
    lines.push("", "※動画本体・ファイル名は記録していません。通信送信もしていません。");
    return lines.join("\n");
  };

  D.copy = async () => {
    const text = D.report();
    try { await navigator.clipboard.writeText(text); if (MC.ui) MC.ui.toast("診断レポートをコピーしました"); }
    catch (_) {
      const ta = document.getElementById("storageDiagReport");
      if (ta) { ta.hidden = false; ta.value = text; ta.focus(); ta.select(); }
      if (MC.ui) MC.ui.toast("下の記録を選択しました。長押しでコピーしてください");
    }
  };
  D.render = () => {
    const host = document.getElementById("storageDiag");
    if (!host) return;
    if (!admin()) { host.hidden = true; host.innerHTML = ""; return; }
    if (!state) state = load();
    host.hidden = false;
    if (!state.active) {
      host.innerHTML = `<div class="sd-head"><div><b>Safari容量診断（管理者専用）</b><span>動画は送信せず、原因の数字だけ端末内に記録します。</span></div></div>
        <button type="button" class="btn sd-primary" id="storageDiagStart">診断を開始</button>`;
      host.querySelector("#storageDiagStart").onclick = () => D.start();
      return;
    }
    const a = D.analysis(), cps = state.checkpoints || [];
    const next = cps.length === 0 ? "① いまの「書類とデータ」を入力してください"
      : cps.length === 1 ? "② 動画を選び、分析画面まで進めてから、もう一度入力してください"
      : "③ Safariを完全終了→開き直した後の数値を入力すると、残留領域を分けられます";
    const snap = state.lastSnapshot;
    host.innerHTML = `<div class="sd-head"><div><b>Safari容量診断中</b><span>${next}</span></div><span class="sd-live">記録中</span></div>
      <div class="sd-result"><b>${a.verdict}</b><span>プロキシ: ${a.proxy}</span><span>掃除: ${a.sweep}</span>
        <span>現在のOPFS: ${snap ? `${bytes(snap.opfs.bytes)}（${snap.opfs.n}件）` : "計測前"}</span></div>
      <label class="sd-label" for="storageDiagGb">設定 → Safari →「書類とデータ」</label>
      <div class="sd-measure"><input id="storageDiagGb" type="number" min="0" step="0.01" inputmode="decimal" placeholder="例 5.49"><span>GB</span><button type="button" class="btn" id="storageDiagRecord">この数値を記録</button></div>
      <div class="sd-actions"><button type="button" class="btn ghost" id="storageDiagSnap">内部だけ再計測</button><button type="button" class="btn ghost" id="storageDiagCopy">レポートをコピー</button><button type="button" class="btn ghost" id="storageDiagStop">診断を終了・記録削除</button></div>
      <textarea id="storageDiagReport" class="sd-report" readonly hidden aria-label="診断レポート"></textarea>`;
    host.querySelector("#storageDiagRecord").onclick = () => D.recordCheckpoint();
    host.querySelector("#storageDiagSnap").onclick = () => D.capture("手動再計測");
    host.querySelector("#storageDiagCopy").onclick = () => D.copy();
    host.querySelector("#storageDiagStop").onclick = () => D.stop();
  };

  D._test = { fresh, category, sumCats, bytes, setState: s => { state = s; }, getState: () => state };
  return D;
})();
