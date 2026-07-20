"use strict";
/* ============ タイムライン編集UI (Phase 2) ============
   スイッチング/ワイプ時にカットのブロック帯を表示。
   操作対象は「いま再生ヘッドがある(=プレビューに出ている)カット」。
   境界はドラッグで移動(拍にスナップ)。タッチ(Pointer Events)対応。 */

MC.timeline = { selected: -1 };

MC.timeline.PALETTE = ["#e8590c", "#2f9e44", "#1971c2", "#9c36b5"];

MC.timeline.color = clipId => {
  const i = MC.S.clips.findIndex(c => c.id === clipId);
  return MC.timeline.PALETTE[Math.max(0, i) % MC.timeline.PALETTE.length];
};

MC.timeline.visible = () => {
  const L = MC.LAYOUTS[MC.S.layoutId];
  return (L.type === "switch" || L.type === "wipe") && MC.S.cutList.length > 0;
};

/* いま再生ヘッドがあるカットの index。プレビューに出ている画そのもの。
   ツールバーの操作対象はこれに統一する(タップ選択に頼らない) */
MC.timeline.currentIndex = () => {
  const cl = MC.S.cutList;
  if (!cl.length) return -1;
  const t = MC.S.t;
  let idx = -1;
  for (let i = 0; i < cl.length; i++) {
    if (cl[i].t <= t + 1e-6) idx = i; else break;
  }
  return idx < 0 ? 0 : idx;   // IN より前を指していても先頭カットを対象にする
};

/* グローバル秒→タイムライン帯の% */
MC.timeline.pct = t => {
  const dur = MC.timelineDuration() || 1;
  return Math.max(0, Math.min(100, t / dur * 100));
};

MC.timeline.render = () => {
  const wrap = MC.ui.$("#timelineWrap");
  const strip = MC.ui.$("#timelineStrip");
  if (!MC.timeline.visible()) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  strip.innerHTML = "";
  const cl = MC.S.cutList;
  const [tIn, tOut] = MC.trimRange();
  for (let i = 0; i < cl.length; i++) {
    const start = cl[i].t;
    const end = i + 1 < cl.length ? cl[i + 1].t : tOut;
    const clip = MC.getClip(cl[i].clipId);
    const camIdx = MC.S.clips.findIndex(c => c.id === cl[i].clipId);
    const b = document.createElement("div");
    b.className = "tl-block" + (MC.timeline.currentIndex() === i ? " selected" : "");
    b.style.left = MC.timeline.pct(start) + "%";
    b.style.width = Math.max(0.5, MC.timeline.pct(end) - MC.timeline.pct(start)) + "%";
    b.style.background = MC.timeline.color(cl[i].clipId);
    b.innerHTML = `<span class="tl-label">C${camIdx + 1}${cl[i].trans === "dissolve" ? " ◇" : ""}</span>`;
    b.title = clip ? clip.name : "";
    b.onclick = e => {
      e.stopPropagation();
      // タップ=そこへ移動。操作対象は常に「プレビューに出ているカット」なので、
      // 移動した結果このカットが対象になる
      MC.preview.seek(start + 0.01);
      MC.timeline.render();
    };
    // 境界ドラッグハンドル(先頭セグメント以外)
    if (i > 0) {
      const h = document.createElement("div");
      h.className = "tl-handle";
      h.onpointerdown = ev => MC.timeline.dragBoundary(ev, i, strip);
      b.appendChild(h);
    }
    strip.appendChild(b);
  }
  // 再生ヘッド
  const head = document.createElement("div");
  head.className = "tl-head";
  head.id = "tlHead";
  head.style.left = MC.timeline.pct(MC.S.t) + "%";
  strip.appendChild(head);
  MC.timeline.renderToolbar();
};

MC.timeline.renderToolbar = () => {
  const bar = MC.ui.$("#timelineToolbar");
  const cl = MC.S.cutList;
  const i = MC.timeline.currentIndex();
  if (i < 0 || i >= cl.length) { bar.style.display = "none"; return; }
  bar.style.display = "flex";

  const start = cl[i].t;
  const end = i + 1 < cl.length ? cl[i + 1].t : MC.trimRange()[1];
  bar.querySelector(".tl-info").innerHTML =
    `<strong>いま映っているカット</strong>`
    + `<span class="tl-info-sub">${MC.ui.fmtTime(start)} 〜 ${MC.ui.fmtTime(end)}</span>`;

  /* カメラは順送りではなく直接選ばせる。どれが今出ているかも一目で分かる */
  const box = MC.ui.$("#tlCamPicker");
  box.innerHTML = "";
  MC.S.clips.filter(c => !c.isAudio && !c.isImage).forEach((c, ci) => {
    const b = document.createElement("button");
    const on = c.id === cl[i].clipId;
    b.type = "button";
    b.className = "tl-cam" + (on ? " on" : "");
    b.style.setProperty("--cam", MC.timeline.color(c.id));
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.title = c.name;
    b.innerHTML = `<span class="tl-cam-no">C${ci + 1}</span>`
      + `<span class="tl-cam-name">${MC.ui.esc(MC.timeline.shortName(c.name))}</span>`;
    b.onclick = () => MC.timeline.setCamera(c.id);
    box.appendChild(b);
  });
};

/* ボタンに載せる短い名前。拡張子を落とし、長い場合は中間を省く。
   実素材は「Timeline 1.mov / Timeline 2.mov」のように末尾で見分けるため、
   先頭だけ残す切り方(Timeline …)では区別できなくなる */
MC.timeline.shortName = name => {
  const base = String(name || "").replace(/\.[^.]+$/, "");
  if (base.length <= 12) return base;
  return base.slice(0, 5) + "…" + base.slice(-5);
};

/* いま映っているカットのカメラを差し替える */
MC.timeline.setCamera = clipId => {
  const i = MC.timeline.currentIndex();
  const e = MC.S.cutList[i];
  if (!e || e.clipId === clipId) return;
  e.clipId = clipId;
  MC.saveState(); MC.timeline.render(); MC.preview.draw();
};

/* 境界ドラッグ(拍スナップ) */
MC.timeline.dragBoundary = (ev, i, strip) => {
  ev.preventDefault(); ev.stopPropagation();
  const rect = strip.getBoundingClientRect();
  const dur = MC.timelineDuration();
  const cl = MC.S.cutList;
  const audioClip = MC.getClip(MC.S.audioClipId);
  const beats = audioClip && audioClip.beatsData
    ? audioClip.beatsData.beats.map(b => b + audioClip.offset) : null;
  const move = e => {
    let t = Math.max(0, Math.min(dur, (e.clientX - rect.left) / rect.width * dur));
    // 拍スナップ(±0.25秒以内)
    if (beats) {
      let best = null, bd = 0.25;
      for (const b of beats) { const d = Math.abs(b - t); if (d < bd) { bd = d; best = b; } }
      if (best != null) t = best;
    }
    // 隣接境界と最低0.5秒は空ける
    const lo = (i > 0 ? cl[i - 1].t : 0) + 0.5;
    const hi = (i + 1 < cl.length ? cl[i + 1].t : dur) - 0.5;
    cl[i].t = Math.max(lo, Math.min(hi, t));
    MC.timeline.render();
    MC.preview.seek(cl[i].t + 0.01);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    MC.saveState();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};

/* 再生中の再生ヘッド更新(renderより軽い) */
MC.timeline.updateHead = () => {
  const head = document.getElementById("tlHead");
  if (head) head.style.left = MC.timeline.pct(MC.S.t) + "%";
};
