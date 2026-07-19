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

/* 書き出し完了カード。iOS(共有可)は「動画を保存」タップで初めて保存する */
MC.ui.showDone = res => {
  const share = MC.exporter.shareMode();
  const $ = MC.ui.$;
  $("#doneCard").hidden = false;
  if (share) {
    // iOS等: 共有シート保存が主導線、ダウンロードも選べる
    $("#saveBtn").style.display = "inline-flex";
    $("#doneText").innerHTML = `<span class="ok">✓ 準備できました(${(res.blob.size / 1e6).toFixed(1)}MB)</span>`;
    $("#doneNote").textContent = "「動画を保存」で写真(カメラロール)やファイルへ。「ダウンロード」でファイル保存もできます。";
    MC.ui.toast("✔ 準備できました。保存を押してください");
  } else {
    // PC/Mac: 自動ダウンロード済み。再ダウンロードだけ出す
    $("#saveBtn").style.display = "none";
    $("#doneText").innerHTML = `<span class="ok">✓ 「${res.name}」を保存しました(${(res.blob.size / 1e6).toFixed(1)}MB)</span>`;
    $("#doneNote").textContent = "ダウンロードに保存されています(もう一度保存するには「ダウンロード」)。";
    MC.ui.toast("✔ 書き出しが完了しました");
  }
};

/* 保存の実行。iOSはWeb Shareで写真/ファイルへ、それ以外はダウンロード */
MC.ui.saveResult = async () => {
  const r = MC.exporter.lastResult;
  if (!r) return;
  if (MC.exporter.shareMode()) {
    try {
      const file = new File([r.blob], r.name, { type: r.type || r.blob.type });
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === "AbortError") return;         // ユーザーがキャンセル
      MC.log("share失敗→ダウンロード:", e && e.message);
      MC.exporter.triggerDownload(r.blob, r.name);        // 最後の手段
    }
  } else {
    MC.exporter.triggerDownload(r.blob, r.name);
  }
};

MC.ui.fmtTime = s => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
};

/* innerHTMLへ流し込むファイル名等のHTMLエスケープ(自己XSS防止) */
MC.ui.esc = s => String(s).replace(/[&<>"']/g,
  ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

MC.ui.renderAll = () => {
  MC.ui.renderClips();
  MC.ui.renderAudio();
  MC.ui.renderLayout();
  MC.ui.renderFinish();
  MC.ui.renderExportMode();
  MC.ui.updateTransport();
  MC.timeline.render();
  MC.ui.$("#syncBtn").disabled = MC.S.clips.filter(c => !c.isImage).length < 2;
  MC.ui.$("#exportBtn").disabled = !MC.S.clips.length;
  MC.ui.refreshJourney();
};

/* ---- ジャーニーバー(どのフェーズにいるかの常時表示) ---- */
MC.ui.JOURNEY_SECTIONS = { mat: "#dropSec", sync: "#syncSec", polish: "#layoutSec", export: "#exportSec" };

MC.ui.initJourney = () => {
  MZJourney.init({
    container: MC.ui.$("#workspace"),
    phases: [
      { id: "mat",    label: "素材",     hint: "動画を入れてください（3つまで）" },
      { id: "sync",   label: "同期",     hint: "「波形で同期する」でズレを合わせます" },
      { id: "polish", label: "整える",   hint: "音声・レイアウト・仕上げを整えます" },
      { id: "export", label: "書き出す", hint: "「MP4を書き出す」で完成です" },
    ],
    doneHint: "書き出し完了。調整して書き出し直すこともできます",
    canSelect: () => true,   // タップ=そのセクションへ移動(状態は変えないので常に安全)
    onSelect: id => {
      const el = document.querySelector(MC.ui.JOURNEY_SECTIONS[id]);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  });
  MC.ui.refreshJourney();
};

/* stateからフェーズを導出してバーと現在セクションの強調を更新 */
MC.ui.refreshJourney = () => {
  if (!document.querySelector(".mzj")) return;   // 未初期化なら何もしない
  const slot = MC.media.slotClips();
  const vids = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
  const synced = vids.length >= 2
    ? vids.every(c => c.syncMethod !== "未同期")
    : slot.length > 0;   // 素材1つ(写真のみ含む)なら同期は不要=済み扱い
  const exported = !!MC.exporter.lastResult;
  const done = [];
  if (slot.length) done.push("mat");
  if (slot.length && synced) done.push("sync");
  if (exported) done.push("polish", "export");
  const current = !slot.length ? "mat"
    : (vids.length >= 2 && !synced) ? "sync"
    : exported ? "export" : "polish";
  MZJourney.set(current, done);
  // 現在フェーズのセクションをそっと強調
  document.querySelectorAll(".side .panel").forEach(p => p.classList.remove("phase-current"));
  const target = document.querySelector(MC.ui.JOURNEY_SECTIONS[current]);
  if (target) target.classList.add("phase-current");
};

/* --- クリップカード --- */
/* 動画1/2/3の3スロット。空きは選択ボタン、読み込み済みはクリップカード */
MC.ui.renderClips = () => {
  const box = MC.ui.$("#clipSlots");
  box.innerHTML = "";
  const vertical = MC.S.mode === "vertical";
  const slotClips = MC.media.slotClips();   // 音声のみを除く(動画+画像)
  for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
    const c = slotClips[slotIdx];
    const slot = document.createElement("div");
    slot.className = "clip-slot" + (c ? " filled" : " empty");
    const lb = document.createElement("div");
    lb.className = "clip-slot-label";
    const noun = vertical ? "素材" : "動画";
    lb.innerHTML = `<i class="fa-solid fa-video"></i> ${noun}${slotIdx + 1}${slotIdx === 2 ? "（なくてもOK）" : ""}`;
    slot.appendChild(lb);
    if (!c) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "clip-slot-add";
      btn.innerHTML = vertical
        ? 'タップして動画・写真を選ぶ<br><span class="hint">またはここにドロップ</span>'
        : 'タップして動画を選ぶ<br><span class="hint">またはここにドロップ</span>';
      btn.onclick = () => MC.ui.$(vertical ? "#fileInputV" : "#fileInput").click();
      slot.appendChild(btn);
      box.appendChild(slot);
      continue;
    }
    const card = document.createElement("div");
    card.className = "clip-card";
    const badgeCls = c.isImage ? "" : c.syncMethod === "基準" ? "ref" : c.syncMethod.startsWith("波形") ? "wave" : c.syncMethod.startsWith("タイムスタンプ") ? "ts" : "";
    const conf = c.confidence != null && isFinite(c.confidence) ? `信頼度${c.confidence.toFixed(1)}` : "";
    card.innerHTML = `
      ${c.thumb ? `<img class="clip-thumb" src="${c.thumb}">` : `<div class="clip-thumb"></div>`}
      <div class="clip-info">
        <div class="clip-name" title="${MC.ui.esc(c.name)}">${MC.ui.esc(c.name)}</div>
        <div class="clip-meta">${c.width}×${c.height}${c.isImage ? "・写真" : "・" + MC.ui.fmtTime(c.duration)}</div>
        ${c.isImage ? "" : `
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
        </div>`}
        <div class="pan-row">横位置 <input type="range" class="pan" min="0" max="1" step="0.01" value="${c.pan}"></div>
        ${MC.S.mode === "switch" ? `
        <div class="pan-row">役割 <select class="role-sel select-mini" title="自動カット割でこのカメラをどう扱うか">
          <option value="auto" ${c.role === "auto" ? "selected" : ""}>自動判定</option>
          <option value="wide" ${c.role === "wide" ? "selected" : ""}>引き（全体）</option>
          <option value="close" ${c.role === "close" ? "selected" : ""}>寄り（アップ）</option>
          <option value="pit" ${c.role === "pit" ? "selected" : ""}>フロントピット</option>
        </select></div>` : ""}
      </div>
      <button class="clip-remove" title="削除">✕</button>`;
    card.querySelectorAll(".nudge button").forEach(b =>
      b.onclick = () => MC.sync.nudge(c.id, parseFloat(b.dataset.n)));
    const listen = card.querySelector(".listen");
    if (listen) listen.onclick = () => MC.sync.listenCheck(c.id);
    card.querySelector(".pan").oninput = e => { c.pan = parseFloat(e.target.value); MC.saveState(); };
    const roleSel = card.querySelector(".role-sel");
    if (roleSel) roleSel.onchange = e => { c.role = e.target.value; MC.saveState(); };
    card.querySelector(".clip-remove").onclick = () => MC.media.removeClip(c.id);
    slot.appendChild(card);
    box.appendChild(slot);
  }
};

/* --- 音声選択 --- */
MC.ui.renderAudio = () => {
  const box = MC.ui.$("#audioChoices");
  const cands = MC.S.clips.filter(c => !c.isImage);   // 静止画に音は無い
  if (!cands.length) { box.innerHTML = `<span class="hint">クリップを読み込むと表示されます</span>`; return; }
  const reco = MC.audio.recommend();
  box.innerHTML = "";
  for (const c of cands) {
    const label = document.createElement("label");
    label.className = "audio-choice" + (MC.S.audioClipId === c.id ? " selected" : "");
    const stat = c.stats
      ? `音量${(20 * Math.log10(c.stats.rms || 1e-6)).toFixed(0)}dB${c.stats.clipRatio > 0.001 ? "・歪みあり⚠" : ""}`
      : (c.hasAudio === false ? "音声なし" : "未解析");
    label.innerHTML = `
      <input type="radio" name="audioClip" ${MC.S.audioClipId === c.id ? "checked" : ""} ${c.hasAudio === false ? "disabled" : ""}>
      ${c.isAudio ? '<i class="fa-solid fa-file-audio" title="取り込んだ音声ファイル"></i> ' : ""}<span>${MC.ui.esc(c.name.length > 18 ? c.name.slice(0, 17) + "…" : c.name)}</span>
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
  const conf = MC.ui.modeConf();
  const row = MC.ui.$("#presetRow");
  row.innerHTML = "";
  const presetIds = conf.presets.filter(id => MC.PRESETS[id]);
  for (const id of presetIds) {
    const p = MC.PRESETS[id];
    if (presetIds.length === 1) {
      // 選べる比率が1つだけなら、押せるボタンにせず現在のサイズを示すだけにする
      const fixed = document.createElement("span");
      fixed.className = "preset-fixed";
      fixed.textContent = `${p.label} ${p.w}×${p.h}`;
      row.appendChild(fixed);
      break;
    }
    const chip = document.createElement("button");
    chip.className = "preset-chip" + (MC.S.preset === id ? " selected" : "");
    chip.textContent = `${p.label} ${p.w}×${p.h}`;
    chip.onclick = () => { MC.S.preset = id; MC.preview.applyPreset(); MC.saveState(); MC.ui.renderLayout(); MC.ui.renderExportMode(); };
    row.appendChild(chip);
  }
  const sel = MC.ui.$("#layoutSelect");
  sel.innerHTML = "";
  const layoutIds = conf.layouts.filter(id => MC.LAYOUTS[id]);
  for (const id of layoutIds) {
    const o = document.createElement("option");
    o.value = id; o.textContent = MC.LAYOUTS[id].name;
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
    const pipCands = MC.media.slotClips();
    const ws = MC.ui.$("#wipeCamSelect");
    ws.innerHTML = pipCands.map(c =>
      `<option value="${c.id}" ${MC.S.wipeClipId === c.id ? "selected" : ""}>${MC.ui.esc(c.name.slice(0, 12))}</option>`).join("");
    const ws2 = MC.ui.$("#wipeCamSelect2");
    ws2.innerHTML = `<option value="">（なし）</option>` + pipCands.map(c =>
      `<option value="${c.id}" ${MC.S.wipeClipId2 === c.id ? "selected" : ""}>${MC.ui.esc(c.name.slice(0, 12))}</option>`).join("");
    MC.ui.$("#wipePosSelect").value = MC.S.wipePos;
    MC.ui.$("#wipePosSelect2").value = MC.S.wipePos2;
    MC.ui.$("#wipeSizeRange").value = MC.S.wipeSize;
  }
  // 境界線(分割セルとワイプ小窓の枠)
  MC.ui.$("#borderRow").style.display = MC.S.layoutId === "single" ? "none" : "flex";
  MC.ui.$("#borderToggle").checked = MC.S.borderOn;
  MC.ui.$("#borderColor").value = MC.S.borderColor;
  MC.ui.$("#borderWRange").value = MC.S.borderW;
  MC.ui.$("#borderWVal").textContent = MC.S.borderW + "px";
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
      MC.S.clips.map(c => `<option value="${c.id}" ${MC.S.slots[i] === c.id ? "selected" : ""}>${MC.ui.esc(c.name)}</option>`).join("");
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
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> MP4を書き出す';
  } else if (mode === "realtime") {
    const mp4 = MC.caps.recMime.startsWith("video/mp4");
    el.innerHTML = `<span class="warn">⚠ この端末は実時間録画モード(${mp4 ? "MP4" : "WebM"})。書き出し中は画面を閉じないでください</span>`;
    btn.innerHTML = `<i class="fa-solid fa-file-export"></i> ${mp4 ? "MP4" : "WebM"}を書き出す(実時間)`;
  } else if (mode === "mute") {
    el.innerHTML = `<span class="warn">⚠ 音声エンコード非対応 → 映像のみMP4</span>`;
    btn.innerHTML = '<i class="fa-solid fa-file-export"></i> MP4を書き出す(音声なし)';
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
  MC.ui.$("#playBtn").innerHTML = MC.S.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
  const [tIn, tOut] = MC.trimRange();
  MC.ui.$("#trimLabel").textContent = dur ? `書き出し範囲: ${MC.ui.fmtTime(tIn)} 〜 ${MC.ui.fmtTime(tOut)}` : "";
  MC.timeline.updateHead();
};

/* --- 最初のモード選択(縦型作成 / 自動スイッチング) ---
   presets/layouts = そのモードで選べるものだけ。ここに無い選択肢はUIに出さない */
MC.ui.MODES = {
  vertical: {
    preset: "9x16", layoutId: "v3", label: "縦型動画",   // 3分割縦積みが初期
    presets: ["9x16"],                                   // 縦型で固定(比率は選ばせない)
    layouts: ["v3", "v2", "big2", "single"],             // 横並べは廃止
  },
  switch: {
    preset: "16x9", layoutId: "switch", label: "自動スイッチング動画",
    presets: ["16x9", "9x16"],                            // 正方形は対象外
    layouts: ["switch", "wipe"],                          // スイッチングとワイプのみ
  },
};

/* いま選ばれているモードの設定 */
MC.ui.modeConf = () => MC.ui.MODES[MC.S.mode] || MC.ui.MODES.vertical;

/* 保存状態の復元やモード切替で、そのモードに無い比率/レイアウトが残らないように寄せる */
MC.ui.normalizeForMode = () => {
  const m = MC.ui.modeConf();
  if (!m.presets.includes(MC.S.preset)) MC.S.preset = m.preset;
  if (!m.layouts.includes(MC.S.layoutId)) MC.S.layoutId = m.layoutId;
};

MC.ui.chooseMode = (mode, { silent = false } = {}) => {
  const m = MC.ui.MODES[mode] || MC.ui.MODES.vertical;
  MC.S.mode = mode;
  if (!silent) { MC.S.preset = m.preset; MC.S.layoutId = m.layoutId; }
  MC.ui.normalizeForMode();
  if (!silent) MC.saveState();
  MC.ui.$("#modeSelect").hidden = true;
  MC.ui.$("#workspace").hidden = false;
  const lbl = MC.ui.$("#modeLabel");
  if (lbl) lbl.textContent = m.label;
  MC.preview.applyPreset();
  MC.ui.renderAll();
};

MC.ui.showModeSelect = () => {
  MC.preview.pause();  // 選択画面の裏で音が鳴り続けないように
  MC.ui.$("#workspace").hidden = true;
  MC.ui.$("#modeSelect").hidden = false;
};

/* --- イベント配線 --- */
MC.ui.wire = () => {
  const $ = MC.ui.$;

  document.querySelectorAll(".mode-card").forEach(card =>
    card.onclick = () => MC.ui.chooseMode(card.dataset.mode));
  $("#modeBackBtn").onclick = () => MC.ui.showModeSelect();

  const dz = $("#clipSlots"), fi = $("#fileInput"), fiv = $("#fileInputV");
  fi.onchange = () => { MC.media.addFiles([...fi.files]); fi.value = ""; };
  fiv.onchange = () => { MC.media.addFiles([...fiv.files]); fiv.value = ""; };
  const ai = $("#audioInput");
  $("#audioImportBtn").onclick = () => ai.click();
  ai.onchange = async () => {
    if (ai.files.length) await MC.media.addAudioFile(ai.files[0]);
    ai.value = "";
  };
  ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => MC.media.addFiles([...e.dataTransfer.files]));

  $("#syncBtn").onclick = async () => {
    $("#syncBtn").disabled = true;
    const p = MZP.start({ mount: "#syncStatus", chapter: "2. 同期", steps: 4,
                          label: "音を取り出しています…" });
    try {
      const r = await MC.sync.run(p);
      // カラー自動マッチ(初期ON)。失敗しても同期は成功扱い
      const vclips = MC.S.clips.filter(c => !c.isAudio && !c.isImage);
      if (MC.S.colorOn && vclips.length >= 2 && !vclips.some(c => c.colorT)) {
        p.step(3, "色をそろえています…");
        try { await MC.color.run(p); MC.ui.renderFinish(); }
        catch (e) { MC.log("自動カラーマッチ失敗:", e.message); }
      }
      // 最初と最後の自動カット(初期ON)。ユーザーがトリム済みなら触らない
      if (MC.S.autoTrim && MC.S.trimIn === 0 && MC.S.trimOut == null) {
        p.step(4, "最初と最後を探しています…");
        await MZP.paint();
        await MC.salute.autoTrim();
        MC.preview.seek(MC.trimRange()[0]);
      }
      const [ti, to] = MC.trimRange();
      p.done(r && r.low ? `ズレを合わせました(${r.low}本は手動調整をおすすめします)`
                        : "ズレを合わせました",
             { sub: MC.S.trimOut != null ? `書き出し範囲 ${MC.ui.fmtTime(ti)}〜${MC.ui.fmtTime(to)} を自動設定` : "" });
    } catch (e) {
      MC.ui.toast("⚠ 同期に失敗: " + e.message); console.error(e);
      p.fail("ズレを合わせられませんでした", { detail: e.message,
        retry: () => $("#syncBtn").click() });
    } finally { $("#syncBtn").disabled = MC.S.clips.length < 2; }
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
    const prog = $("#exportProgress");
    prog.style.display = "block";
    $("#doneCard").hidden = true;
    $("#exportBtn").disabled = true;
    $("#cancelBtn").style.display = "inline-block";
    const mode = MC.ui.exportMode();
    const p = MZP.start({
      mount: "#exportProgress", chapter: "6. 書き出し", delay: 0,
      label: mode === "realtime" ? "再生しながら録画しています…" : "映像を作っています…",
      sub: mode === "realtime" ? "画面を閉じずにお待ちください" : "",
      // 中止は枠の外の #cancelBtn が既に担っているので、ここでは出さない(二重表示の回避)
    });
    try {
      if (mode === "none") throw new Error("この環境では書き出しできません");
      const res = mode === "realtime"
        ? await MC.exporter.exportRealtime(p.legacy())
        : await MC.exporter.exportMP4(p.legacy());
      p.done("書き出しました", { chip: false });
      MC.ui.showDone(res);
    } catch (e) {
      console.error(e);
      if (e.message.includes("キャンセル")) {
        p.close();
        MC.ui.toast("書き出しを中止しました");
      } else {
        p.fail("書き出せませんでした", { detail: e.message });
      }
    } finally {
      $("#exportBtn").disabled = !MC.S.clips.length;
      $("#cancelBtn").style.display = "none";
      setTimeout(() => { prog.style.display = "none"; }, 2500);
    }
  };
  $("#cancelBtn").onclick = () => { MC.exporter.cancelFlag = true; };
  $("#saveBtn").onclick = () => MC.ui.saveResult();
  $("#downloadBtn").onclick = () => {
    const r = MC.exporter.lastResult;
    if (r) MC.exporter.triggerDownload(r.blob, r.name);
  };

  // --- Phase 2: 自動カット割+ワイプ+タイムライン ---
  $("#bpbSelect").onchange = e => { MC.S.beatsPerBar = parseInt(e.target.value); MC.saveState(); };
  MC.ui.renderLevel();
  $("#autocutBtn").onclick = async () => {
    $("#autocutBtn").disabled = true;
    MC.preview.pause();   // 解析中はvideo要素をシークで専有する
    const p = MZP.start({ mount: "#autocutStatus", chapter: "4. レイアウト",
                          delay: 0, steps: 3 });
    p.pulse("音楽を解析しています…");
    await MZP.paint();
    try {
      const r = await MC.director.run(p);
      p.done(`${r.bpm.toFixed(0)} BPM・${r.segments}カットを作りました`,
             { sub: `ディゾルブ${r.dissolves}回・タップで編集できます` });
      MC.timeline.selected = -1;
      MC.timeline.render();
      MC.preview.seek(MC.trimRange()[0]);
    } catch (e) {
      console.error(e);
      p.fail("カット割を作れませんでした", { detail: e.message });
    } finally { $("#autocutBtn").disabled = false; }
  };
  $("#wipeCamSelect").onchange = e => { MC.S.wipeClipId = parseInt(e.target.value); MC.saveState(); MC.preview.draw(); };
  $("#wipePosSelect").onchange = e => { MC.S.wipePos = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#wipeCamSelect2").onchange = e => { MC.S.wipeClipId2 = e.target.value ? parseInt(e.target.value) : null; MC.saveState(); MC.preview.draw(); };
  $("#wipePosSelect2").onchange = e => { MC.S.wipePos2 = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#wipeSizeRange").oninput = e => { MC.S.wipeSize = parseFloat(e.target.value); MC.saveState(); MC.preview.draw(); };
  // 境界線
  $("#borderToggle").onchange = e => { MC.S.borderOn = e.target.checked; MC.saveState(); MC.preview.draw(); };
  $("#borderColor").oninput = e => { MC.S.borderColor = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#borderWRange").oninput = e => {
    MC.S.borderW = parseInt(e.target.value);
    $("#borderWVal").textContent = MC.S.borderW + "px";
    MC.saveState(); MC.preview.draw();
  };
  $("#tlCamBtn").onclick = () => MC.timeline.cycleCamera();
  $("#tlTransBtn").onclick = () => MC.timeline.toggleTrans();
  $("#tlMergeBtn").onclick = () => MC.timeline.mergePrev();

  // --- Phase 3: 仕上げ ---
  $("#filterSelect").innerHTML = Object.entries(MC.color.FILTERS)
    .map(([id, f]) => `<option value="${id}">${f.name}</option>`).join("");
  $("#filterSelect").onchange = e => { MC.S.filterId = e.target.value; MC.saveState(); MC.preview.draw(); };
  $("#colorStrength").oninput = e => { MC.S.colorStrength = parseFloat(e.target.value); MC.saveState(); MC.preview.draw(); };
  $("#colorMatchBtn").onclick = async () => {
    $("#colorMatchBtn").disabled = true;
    const p = MZP.start({ mount: "#finishStatus", chapter: "5. 仕上げ",
                          label: "色を見比べています…" });
    try {
      await MC.color.run(p);
      p.done("色をそろえました", { sub: "音声に使うカメラに合わせています" });
      MC.ui.renderFinish(); MC.preview.draw();
    } catch (e) {
      console.error(e);
      p.fail("色をそろえられませんでした", { detail: e.message });
    } finally { $("#colorMatchBtn").disabled = false; }
  };
  $("#colorClearBtn").onclick = () => {
    MC.S.colorOn = false;
    MC.S.clips.forEach(c => { c.colorT = null; });
    MC.saveState(); MC.ui.renderFinish(); MC.preview.draw();
    $("#finishStatus").textContent = "";
  };
  const att = $("#autoTrimToggle");
  att.checked = MC.S.autoTrim;
  att.onchange = e => { MC.S.autoTrim = e.target.checked; MC.saveState(); };
  $("#saluteBtn").onclick = async () => {
    $("#saluteBtn").disabled = true;
    const p = MZP.start({ mount: "#finishStatus", chapter: "5. 仕上げ", delay: 0 });
    p.frozen("演奏のはじまりを探しています…");
    await MZP.paint();   // 画面が止まる前に、必ず表示を描いてから解析へ入る
    try {
      MC.ui._salute = await MC.salute.detect();
      const s = MC.ui._salute;
      $("#saluteRow").style.display = "flex";
      $("#saluteInfo").textContent =
        `演奏 ${MC.ui.fmtTime(s.musicStart)} 〜 ${s.musicEnd ? MC.ui.fmtTime(s.musicEnd) : "?"}`;
      p.done(`演奏のはじまりは ${MC.ui.fmtTime(s.musicStart)} でした`);
      MC.ui.renderScrubTicks();
    } catch (e) {
      p.fail("演奏のはじまりを見つけられませんでした", { detail: e.message });
    } finally { $("#saluteBtn").disabled = false; }
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
    MC.S.trimOut = Math.min(MC.timelineDuration(), s.musicEnd + MC.salute.OUT_AFTER);
    MC.saveState(); MC.ui.updateTransport();
    MC.ui.toast(`OUTを ${MC.ui.fmtTime(MC.S.trimOut)} に設定しました(演奏終了+${MC.salute.OUT_AFTER}秒)`);
  };
};

/* 切替頻度(1〜5)のセグメントコントロール */
MC.ui.LEVEL_HINTS = {
  1: "ゆったり・長尺", 2: "落ち着いた", 3: "標準",
  4: "テンポよく", 5: "細かい・激しい",
};
MC.ui.renderLevel = () => {
  const seg = MC.ui.$("#levelSeg");
  if (!seg) return;
  seg.querySelectorAll("button").forEach(b => {
    const lv = parseInt(b.dataset.lv);
    b.classList.toggle("selected", lv === MC.S.cutLevel);
    b.setAttribute("aria-checked", lv === MC.S.cutLevel ? "true" : "false");
    b.onclick = () => {
      MC.S.cutLevel = lv;
      MC.saveState();
      MC.ui.renderLevel();
    };
  });
  MC.ui.$("#levelHint").textContent = MC.ui.LEVEL_HINTS[MC.S.cutLevel] || "";
};

/* 仕上げパネルの状態反映(カラーマッチON表示+水平スライダー) */
MC.ui.renderFinish = () => {
  const on = MC.S.colorOn && MC.S.clips.some(c => c.colorT);
  MC.ui.$("#colorClearBtn").style.display = on ? "inline-block" : "none";
  MC.ui.$("#colorStrengthRow").style.display = on ? "flex" : "none";
  MC.ui.$("#colorStrength").value = MC.S.colorStrength;
  MC.ui.$("#filterSelect").value = MC.S.filterId;

  // 自動水平補正のマスターON/OFFトグル
  const htoggle = MC.ui.$("#horizonToggle");
  const rows = MC.ui.$("#horizonRows");
  if (htoggle) {
    htoggle.checked = !!MC.S.horizonOn;
    rows.style.display = MC.S.horizonOn ? "" : "none";
    htoggle.onchange = async e => {
      MC.S.horizonOn = e.target.checked;
      MC.saveState();
      if (MC.S.horizonOn) {
        // ONにしたら未設定(rot=0)のスロットを一括で自動検出。手動調整済みの値は温存。
        htoggle.disabled = true;
        MC.ui.$("#finishStatus").textContent = "水平の傾きを自動検出中…";
        try {
          for (const c of MC.S.clips) {
            if (c.rot) continue;
            try { const sug = await MC.horizon.suggest(c); if (sug != null && sug !== 0) c.rot = sug; } catch (_) { /* noop */ }
          }
        } finally { htoggle.disabled = false; }
        MC.ui.$("#finishStatus").textContent = "自動水平補正: ON";
        MC.saveState();
      } else {
        MC.ui.$("#finishStatus").textContent = "自動水平補正: OFF";
      }
      MC.ui.renderFinish();
      MC.preview.draw();
    };
  }

  rows.innerHTML = "";
  for (const c of MC.S.clips.filter(x => !x.isAudio && !x.isImage)) {
    const div = document.createElement("div");
    div.className = "slot-row";
    div.innerHTML = `
      <label title="${MC.ui.esc(c.name)}">${MC.ui.esc(c.name.length > 8 ? c.name.slice(0, 7) + "…" : c.name)}</label>
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
