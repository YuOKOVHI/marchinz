"use strict";
/* ============ UI描画とイベント ============ */

MC.ui = {};
MC.ui.$ = s => document.querySelector(s);

MC.ui.toast = msg => {
  const el = MC.ui.$("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(MC.ui._toastTm);
  MC.ui._toastTm = setTimeout(() => el.classList.remove("show"), 3500);
};

MC.ui.fmtTime = s => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};

MC.ui.renderAll = () => {
  MC.ui.renderClips();
  MC.ui.renderAudio();
  MC.ui.renderLayout();
  MC.ui.renderFinish();
  MC.ui.renderExportMode();
  MC.ui.updateTransport();
  MC.timeline.render();
  MC.ui.$("#syncBtn").disabled = MC.S.clips.length < 2;
  MC.ui.$("#exportBtn").disabled = !MC.S.clips.length;
};

/* --- クリップカード --- */
MC.ui.renderClips = () => {
  const box = MC.ui.$("#clipCards");
  box.innerHTML = "";
  for (const c of MC.S.clips) {
    const card = document.createElement("div");
    card.className = "clip-card";
    const badgeCls = c.syncMethod === "基準" ? "ref" : c.syncMethod.startsWith("波形") ? "wave" : c.syncMethod.startsWith("タイムスタンプ") ? "ts" : "";
    const conf = c.confidence != null && isFinite(c.confidence) ? `信頼度${c.confidence.toFixed(1)}` : "";
    card.innerHTML = `
      ${c.thumb ? `<img class="clip-thumb" src="${c.thumb}">` : `<div class="clip-thumb"></div>`}
      <div class="clip-info">
        <div class="clip-name" title="${c.name}">${c.name}</div>
        <div class="clip-meta">${c.width}×${c.height}・${MC.ui.fmtTime(c.duration)}</div>
        <div class="clip-sync">
          <span class="sync-badge ${badgeCls}">${c.syncMethod}</span>
          <span>${c.offset ? "+" + c.offset.toFixed(3) + "s" : "0s"}</span>
          <span class="hint">${conf}</span>
        </div>
        <div class="clip-sync">
          <span class="nudge">
            <button data-n="-1">-1s</button><button data-n="-0.1">-0.1</button><button data-n="-0.033">-1f</button>
            <button data-n="0.033">+1f</button><button data-n="0.1">+0.1</button><button data-n="1">+1s</button>
          </span>
          <button class="btn small ghost listen" title="基準と重ねて試聴">🎧</button>
        </div>
        <div class="pan-row">横位置 <input type="range" class="pan" min="0" max="1" step="0.01" value="${c.pan}"></div>
      </div>
      <button class="clip-remove" title="削除">✕</button>`;
    card.querySelectorAll(".nudge button").forEach(b =>
      b.onclick = () => MC.sync.nudge(c.id, parseFloat(b.dataset.n)));
    card.querySelector(".listen").onclick = () => MC.sync.listenCheck(c.id);
    card.querySelector(".pan").oninput = e => { c.pan = parseFloat(e.target.value); MC.saveState(); };
    card.querySelector(".clip-remove").onclick = () => MC.media.removeClip(c.id);
    box.appendChild(card);
  }
};

/* --- 音声選択 --- */
MC.ui.renderAudio = () => {
  const box = MC.ui.$("#audioChoices");
  if (!MC.S.clips.length) { box.innerHTML = `<span class="hint">クリップを読み込むと表示されます</span>`; return; }
  const reco = MC.audio.recommend();
  box.innerHTML = "";
  for (const c of MC.S.clips) {
    const label = document.createElement("label");
    label.className = "audio-choice" + (MC.S.audioClipId === c.id ? " selected" : "");
    const stat = c.stats
      ? `音量${(20 * Math.log10(c.stats.rms || 1e-6)).toFixed(0)}dB${c.stats.clipRatio > 0.001 ? "・歪みあり⚠️" : ""}`
      : (c.hasAudio === false ? "音声なし" : "未解析");
    label.innerHTML = `
      <input type="radio" name="audioClip" ${MC.S.audioClipId === c.id ? "checked" : ""} ${c.hasAudio === false ? "disabled" : ""}>
      <span>${c.name.length > 18 ? c.name.slice(0, 17) + "…" : c.name}</span>
      ${reco && reco.id === c.id ? `<span class="reco-badge">おすすめ</span>` : ""}
      <span class="audio-stat">${stat}</span>`;
    label.querySelector("input").onchange = () => {
      MC.S.audioClipId = c.id;
      MC.preview.applyMute();
      MC.ui.renderAudio();
    };
    box.appendChild(label);
  }
};

/* --- プリセット/レイアウト/スロット --- */
MC.ui.renderLayout = () => {
  const row = MC.ui.$("#presetRow");
  row.innerHTML = "";
  for (const [id, p] of Object.entries(MC.PRESETS)) {
    const chip = document.createElement("button");
    chip.className = "preset-chip" + (MC.S.preset === id ? " selected" : "");
    chip.textContent = `${p.label} ${p.w}×${p.h}`;
    chip.onclick = () => { MC.S.preset = id; MC.preview.applyPreset(); MC.saveState(); MC.ui.renderLayout(); MC.ui.renderExportMode(); };
    row.appendChild(chip);
  }
  const sel = MC.ui.$("#layoutSelect");
  sel.innerHTML = "";
  for (const [id, L] of Object.entries(MC.LAYOUTS)) {
    const o = document.createElement("option");
    o.value = id; o.textContent = L.name;
    if (id === MC.S.layoutId) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => { MC.S.layoutId = sel.value; MC.saveState(); MC.ui.renderLayout(); MC.timeline.render(); };
  // スイッチング/ワイプは自動カット割パネル、それ以外はスロット割当
  const L = MC.LAYOUTS[MC.S.layoutId];
  const isCutMode = L.type === "switch" || L.type === "wipe";
  MC.ui.$("#autocutPanel").style.display = isCutMode ? "block" : "none";
  MC.ui.$("#wipeOpts").style.display = L.type === "wipe" ? "flex" : "none";
  if (L.type === "wipe") {
    const ws = MC.ui.$("#wipeCamSelect");
    ws.innerHTML = MC.S.clips.map(c =>
      `<option value="${c.id}" ${MC.S.wipeClipId === c.id ? "selected" : ""}>${c.name.slice(0, 12)}</option>`).join("");
    MC.ui.$("#wipePosSelect").value = MC.S.wipePos;
    MC.ui.$("#wipeSizeRange").value = MC.S.wipeSize;
  }
  MC.ui.$("#bpbSelect").value = String(MC.S.beatsPerBar);
  // スロット割当
  const rows = MC.ui.$("#slotRows");
  rows.innerHTML = "";
  const n = isCutMode ? 0 : L.n;
  for (let i = 0; i < n; i++) {
    const div = document.createElement("div");
    div.className = "slot-row";
    div.innerHTML = `<label>カメラ ${i + 1}</label>`;
    const s = document.createElement("select");
    s.innerHTML = `<option value="">（なし）</option>` +
      MC.S.clips.map(c => `<option value="${c.id}" ${MC.S.slots[i] === c.id ? "selected" : ""}>${c.name}</option>`).join("");
    s.onchange = () => { MC.S.slots[i] = s.value ? parseInt(s.value) : null; MC.saveState(); };
    div.appendChild(s);
    rows.appendChild(div);
  }
};

/* --- 書き出しモード判定と表示 ---
   fast    : WebCodecs MP4(高速・H.264+AAC)
   realtime: MediaRecorder実時間録画(Safariはmp4/Chromeはwebm)
   mute    : WebCodecs MP4 映像のみ  */
MC.ui.exportMode = () => {
  if (MC.caps.h264 && MC.caps.aac) return "fast";
  if (MC.caps.recMime) return "realtime";
  if (MC.caps.h264) return "mute";
  return "none";
};

MC.ui.renderExportMode = () => {
  const el = MC.ui.$("#exportMode");
  const btn = MC.ui.$("#exportBtn");
  const mode = MC.ui.exportMode();
  if (mode === "fast") {
    el.innerHTML = `<span class="ok">✓ MP4 (H.264+AAC) 高速書き出し — そのままSNSに投稿できます</span>`;
    btn.textContent = "📤 MP4を書き出す";
  } else if (mode === "realtime") {
    const mp4 = MC.caps.recMime.startsWith("video/mp4");
    el.innerHTML = `<span class="warn">⚠ この端末は実時間録画モード(${mp4 ? "MP4" : "WebM"})。書き出し中は画面を閉じないでください</span>`;
    btn.textContent = `📤 ${mp4 ? "MP4" : "WebM"}を書き出す(実時間)`;
  } else if (mode === "mute") {
    el.innerHTML = `<span class="warn">⚠ 音声エンコード非対応 → 映像のみMP4</span>`;
    btn.textContent = "📤 MP4を書き出す(音声なし)";
  } else {
    el.innerHTML = `<span class="err">✗ この環境では書き出しできません(Safari/Chromeの最新版をお使いください)</span>`;
    btn.textContent = "書き出し不可";
  }
};

/* --- トランスポート --- */
MC.ui.updateTransport = () => {
  const dur = MC.timelineDuration();
  const scrub = MC.ui.$("#scrub");
  if (parseFloat(scrub.max) !== dur) scrub.max = dur;
  if (!MC.ui._scrubbing) scrub.value = MC.S.t;
  MC.ui.$("#timeLabel").textContent = `${MC.ui.fmtTime(MC.S.t)} / ${MC.ui.fmtTime(dur)}`;
  MC.ui.$("#playBtn").textContent = MC.S.playing ? "⏸" : "▶";
  const [tIn, tOut] = MC.trimRange();
  MC.ui.$("#trimLabel").textContent = dur ? `書き出し範囲: ${MC.ui.fmtTime(tIn)} 〜 ${MC.ui.fmtTime(tOut)}` : "";
  MC.timeline.updateHead();
};

/* --- 最初のモード選択(縦型作成 / 自動スイッチング) --- */
MC.ui.MODES = {
  vertical: { preset: "9x16", layoutId: "v2",     label: "縦型動画" },
  switch:   { preset: "16x9", layoutId: "switch", label: "自動スイッチング動画" },
};

MC.ui.chooseMode = (mode, { silent = false } = {}) => {
  const m = MC.ui.MODES[mode] || MC.ui.MODES.vertical;
  MC.S.mode = mode;
  if (!silent) { MC.S.preset = m.preset; MC.S.layoutId = m.layoutId; MC.saveState(); }
  MC.ui.$("#modeSelect").hidden = true;
  MC.ui.$("#workspace").hidden = false;
  const lbl = MC.ui.$("#modeLabel");
  if (lbl) lbl.textContent = m.label;
  MC.preview.applyPreset();
  MC.ui.renderAll();
};

MC.ui.showModeSelect = () => {
  MC.ui.$("#workspace").hidden = true;
  MC.ui.$("#modeSelect").hidden = false;
};

/* --- イベント配線 --- */
MC.ui.wire = () => {
  const $ = MC.ui.$;

  document.querySelectorAll(".mode-card").forEach(card =>
    card.onclick = () => MC.ui.chooseMode(card.dataset.mode));
  $("#modeBackBtn").onclick = () => MC.ui.showModeSelect();

  const dz = $("#dropZone"), fi = $("#fileInput");
  dz.onclick = () => fi.click();
  fi.onchange = () => { MC.media.addFiles([...fi.files]); fi.value = ""; };
  ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => MC.media.addFiles([...e.dataTransfer.files]));

  $("#syncBtn").onclick = async () => {
    $("#syncBtn").disabled = true;
    try { await MC.sync.run(s => { $("#syncStatus").textContent = s; }); }
    catch (e) { MC.ui.toast("⚠️ 同期に失敗: " + e.message); console.error(e); }
    finally { $("#syncBtn").disabled = MC.S.clips.length < 2; $("#syncStatus").textContent = ""; }
  };

  $("#playBtn").onclick = () => MC.preview.toggle();
  const scrub = $("#scrub");
  scrub.oninput = () => { MC.ui._scrubbing = true; MC.preview.pause(); MC.preview.seek(parseFloat(scrub.value)); MC.ui.updateTransport(); };
  scrub.onchange = () => { MC.ui._scrubbing = false; };

  $("#trimInBtn").onclick = () => { MC.S.trimIn = MC.S.t; if (MC.S.trimOut != null && MC.S.trimOut <= MC.S.trimIn) MC.S.trimOut = null; MC.saveState(); MC.ui.updateTransport(); };
  $("#trimOutBtn").onclick = () => { if (MC.S.t > MC.S.trimIn + 0.1) { MC.S.trimOut = MC.S.t; MC.saveState(); MC.ui.updateTransport(); } };
  $("#trimResetBtn").onclick = () => { MC.S.trimIn = 0; MC.S.trimOut = null; MC.saveState(); MC.ui.updateTransport(); };

  $("#exportBtn").onclick = async () => {
    if (MC.exporter.running) return;
    MC.preview.pause();
    const prog = $("#exportProgress"), fill = $("#progressFill"), txt = $("#progressText");
    prog.style.display = "block";
    $("#exportBtn").disabled = true;
    $("#cancelBtn").style.display = "inline-block";
    const onProgress = (r, s) => { fill.style.width = `${Math.round(r * 100)}%`; txt.textContent = s; };
    try {
      const mode = MC.ui.exportMode();
      if (mode === "none") throw new Error("この環境では書き出しできません");
      const res = mode === "realtime"
        ? await MC.exporter.exportRealtime(onProgress)
        : await MC.exporter.exportMP4(onProgress);
      onProgress(1, "完了");
      MC.ui.toast(`書き出し完了 ✅ ${res.name}(${(res.blob.size / 1e6).toFixed(1)}MB)`);
    } catch (e) {
      MC.ui.toast(e.message.includes("キャンセル") ? "書き出しを中止しました" : "⚠️ 書き出し失敗: " + e.message);
      console.error(e);
    } finally {
      $("#exportBtn").disabled = !MC.S.clips.length;
      $("#cancelBtn").style.display = "none";
      setTimeout(() => { prog.style.display = "none"; fill.style.width = "0%"; }, 2500);
    }
  };
  $("#cancelBtn").onclick = () => { MC.exporter.cancelFlag = true; };

  // --- Phase 2: 自動カット割+ワイプ+タイムライン ---
  $("#bpbSelect").onchange = e => { MC.S.beatsPerBar = parseInt(e.target.value); MC.saveState(); };
  $("#autocutBtn").onclick = async () => {
    const st = $("#autocutStatus");
    $("#autocutBtn").disabled = true;
    st.textContent = "拍を解析中…";
    try {
      await MC.yield();
      const r = await MC.beats.autocut();
      st.innerHTML = `<span class="ok">✓ ${r.bpm.toFixed(0)} BPM・${r.segments}カットを生成しました(タップで編集できます)</span>`;
      MC.timeline.selected = -1;
      MC.timeline.render();
      MC.preview.seek(MC.trimRange()[0]);
    } catch (e) {
      st.innerHTML = `<span class="err">⚠ ${e.message}</span>`;
      console.error(e);
    } finally { $("#autocutBtn").disabled = false; }
  };
  $("#wipeCamSelect").onchange = e => { MC.S.wipeClipId = parseInt(e.target.value); MC.saveState(); MC.preview.draw(); };
  $("#wipePosSelect").onchange = e => { MC.S.wipePos = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#wipeSizeRange").oninput = e => { MC.S.wipeSize = parseFloat(e.target.value); MC.saveState(); MC.preview.draw(); };
  $("#tlCamBtn").onclick = () => MC.timeline.cycleCamera();
  $("#tlTransBtn").onclick = () => MC.timeline.toggleTrans();
  $("#tlMergeBtn").onclick = () => MC.timeline.mergePrev();

  // --- Phase 3: 仕上げ ---
  $("#filterSelect").innerHTML = Object.entries(MC.color.FILTERS)
    .map(([id, f]) => `<option value="${id}">${f.name}</option>`).join("");
  $("#filterSelect").onchange = e => { MC.S.filterId = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#colorStrength").oninput = e => { MC.S.colorStrength = parseFloat(e.target.value); MC.saveState(); MC.preview.draw(); };
  $("#colorMatchBtn").onclick = async () => {
    const st = $("#finishStatus");
    $("#colorMatchBtn").disabled = true;
    try {
      await MC.color.run(s => { st.textContent = s; });
      st.innerHTML = `<span class="ok">✓ 基準(音声カメラ)に合わせて色を補正しました</span>`;
      MC.ui.renderFinish(); MC.preview.draw();
    } catch (e) { st.innerHTML = `<span class="err">⚠ ${e.message}</span>`; console.error(e); }
    finally { $("#colorMatchBtn").disabled = false; }
  };
  $("#colorClearBtn").onclick = () => {
    MC.S.colorOn = false;
    MC.S.clips.forEach(c => { c.colorT = null; });
    MC.saveState(); MC.ui.renderFinish(); MC.preview.draw();
    $("#finishStatus").textContent = "";
  };
  $("#saluteBtn").onclick = async () => {
    const st = $("#finishStatus");
    $("#saluteBtn").disabled = true;
    st.textContent = "音の流れを解析中…";
    try {
      MC.ui._salute = await MC.salute.detect();
      const s = MC.ui._salute;
      $("#saluteRow").style.display = "flex";
      $("#saluteInfo").textContent =
        `演奏 ${MC.ui.fmtTime(s.musicStart)} 〜 ${s.musicEnd ? MC.ui.fmtTime(s.musicEnd) : "?"}`;
      st.textContent = "";
      MC.ui.renderScrubTicks();
    } catch (e) { st.innerHTML = `<span class="err">⚠ ${e.message}</span>`; }
    finally { $("#saluteBtn").disabled = false; }
  };
  $("#saluteInBtn").onclick = () => {
    const s = MC.ui._salute; if (!s) return;
    const pre = parseFloat($("#preRoll").value) || 0;
    MC.S.trimIn = Math.max(0, s.musicStart - pre);
    if (MC.S.trimOut != null && MC.S.trimOut <= MC.S.trimIn) MC.S.trimOut = null;
    MC.saveState(); MC.ui.updateTransport(); MC.preview.seek(MC.S.trimIn);
    MC.ui.toast(`INを ${MC.ui.fmtTime(MC.S.trimIn)} に設定しました(演奏開始の${pre}秒前)`);
  };
  $("#saluteOutBtn").onclick = () => {
    const s = MC.ui._salute; if (!s || s.musicEnd == null) { MC.ui.toast("終了位置は検出できていません"); return; }
    MC.S.trimOut = Math.min(MC.timelineDuration(), s.musicEnd + 3);
    MC.saveState(); MC.ui.updateTransport();
    MC.ui.toast(`OUTを ${MC.ui.fmtTime(MC.S.trimOut)} に設定しました(演奏終了+3秒)`);
  };
};

/* 仕上げパネルの状態反映(カラーマッチON表示+水平スライダー) */
MC.ui.renderFinish = () => {
  const on = MC.S.colorOn && MC.S.clips.some(c => c.colorT);
  MC.ui.$("#colorClearBtn").style.display = on ? "inline-block" : "none";
  MC.ui.$("#colorStrengthRow").style.display = on ? "flex" : "none";
  MC.ui.$("#colorStrength").value = MC.S.colorStrength;
  MC.ui.$("#filterSelect").value = MC.S.filterId;
  const rows = MC.ui.$("#horizonRows");
  rows.innerHTML = "";
  for (const c of MC.S.clips) {
    const div = document.createElement("div");
    div.className = "slot-row";
    div.innerHTML = `
      <label title="${c.name}">${c.name.length > 8 ? c.name.slice(0, 7) + "…" : c.name}</label>
      <input type="range" class="hrot" min="-5" max="5" step="0.1" value="${c.rot || 0}" style="flex:1; accent-color:var(--acc)">
      <span class="hval hint" style="width:44px; text-align:right">${(c.rot || 0).toFixed(1)}°</span>
      <button class="btn small hauto" title="傾きを自動検出">📐</button>`;
    const slider = div.querySelector(".hrot"), val = div.querySelector(".hval");
    slider.oninput = e => {
      c.rot = parseFloat(e.target.value);
      val.textContent = c.rot.toFixed(1) + "°";
      MC.saveState(); MC.preview.draw();
    };
    div.querySelector(".hauto").onclick = async ev => {
      ev.target.disabled = true;
      try {
        const sug = await MC.horizon.suggest(c);
        if (sug == null || sug === 0) MC.ui.toast(`${c.name}: 傾きは検出されませんでした`);
        else {
          c.rot = sug; slider.value = sug; val.textContent = sug.toFixed(1) + "°";
          MC.saveState(); MC.preview.draw();
          MC.ui.toast(`${c.name}: ${sug.toFixed(1)}° の水平補正を提案・適用(スライダーで調整可)`);
        }
      } finally { ev.target.disabled = false; }
    };
    rows.appendChild(div);
  }
};

/* サリュート検出結果をスクラブバー上のマーカーで表示 */
MC.ui.renderScrubTicks = () => {
  const box = MC.ui.$("#scrubTicks");
  box.innerHTML = "";
  const s = MC.ui._salute;
  const dur = MC.timelineDuration();
  if (!s || !dur) return;
  const mk = (t, cls, label) => {
    if (t == null) return;
    const el = document.createElement("div");
    el.className = "scrub-tick " + cls;
    el.style.left = (t / dur * 100) + "%";
    el.title = label;
    box.appendChild(el);
  };
  mk(s.musicStart, "start", "演奏開始");
  mk(s.musicEnd, "end", "演奏終了");
};
