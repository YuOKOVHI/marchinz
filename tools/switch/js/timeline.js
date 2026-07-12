"use strict";
/* ============ タイムライン編集UI (Phase 2) ============
   スイッチング/ワイプ時にカットのブロック帯を表示。
   タップ=ブロック選択→ツールバーで カメラ変更/カット⇄ディゾルブ/前と結合。
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
    b.className = "tl-block" + (MC.timeline.selected === i ? " selected" : "");
    b.style.left = MC.timeline.pct(start) + "%";
    b.style.width = Math.max(0.5, MC.timeline.pct(end) - MC.timeline.pct(start)) + "%";
    b.style.background = MC.timeline.color(cl[i].clipId);
    b.innerHTML = `<span class="tl-label">C${camIdx + 1}${cl[i].trans === "dissolve" ? " ◇" : ""}</span>`;
    b.title = clip ? clip.name : "";
    b.onclick = e => {
      e.stopPropagation();
      MC.timeline.selected = MC.timeline.selected === i ? -1 : i;
      MC.timeline.render();
      MC.preview.seek(start + 0.01);
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
  const i = MC.timeline.selected;
  const cl = MC.S.cutList;
  if (i < 0 || i >= cl.length) { bar.style.display = "none"; return; }
  bar.style.display = "flex";
  const clip = MC.getClip(cl[i].clipId);
  bar.querySelector(".tl-info").textContent =
    `${clip ? clip.name.slice(0, 14) : "?"} / ${cl[i].trans === "dissolve" ? "ディゾルブ" : "カット"}`;
};

/* 選択セグメントの操作 */
MC.timeline.cycleCamera = () => {
  const e = MC.S.cutList[MC.timeline.selected];
  if (!e) return;
  const cams = MC.S.clips.map(c => c.id);
  e.clipId = cams[(cams.indexOf(e.clipId) + 1) % cams.length];
  MC.saveState(); MC.timeline.render(); MC.preview.draw();
};

MC.timeline.toggleTrans = () => {
  const e = MC.S.cutList[MC.timeline.selected];
  if (!e || MC.timeline.selected === 0) return;
  e.trans = e.trans === "dissolve" ? "cut" : "dissolve";
  e.dur = e.trans === "dissolve" ? MC.beats.DISSOLVE_DUR : 0;
  MC.saveState(); MC.timeline.render();
};

MC.timeline.mergePrev = () => {
  const i = MC.timeline.selected;
  if (i <= 0) return;
  MC.S.cutList.splice(i, 1);
  MC.timeline.selected = -1;
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
