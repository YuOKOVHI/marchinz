"use strict";
/* ============ MarchinZ Vlog: プレビュー再生 ============
   plan を <video> 要素で実時間再生し、MV.compose で canvas に描く。
   書き出し(高速経路)と同じ合成関数を通るので、見たものがそのまま出る。

   音はぜんぶ WebAudio のゲインで制御する。iOS Safari は media 要素の
   volume 書き換えを無視するため、要素音量ではダッキングできない。
   経路: <video>/<audio> → MediaElementSource → GainNode → master → 出力。
   実時間書き出しは master から MediaStreamDestination へ分岐して録る。 */

MV.preview = {
  playing: false,
  _raf: 0, _lastNow: 0,
  _actx: null, _master: null, _dest: null,
  _bgmEls: new Map(),     // bgmId -> <audio>
};

MV.preview.init = () => {
  const cv = MV.ui.$("#previewCanvas");
  MV.preview.canvas = cv;
  MV.preview.ctx = cv.getContext("2d");

  MV.ui.$("#playBtn").onclick = () => {
    if (MV.preview.playing) MV.preview.pause(); else MV.preview.play();
  };
  const scrub = MV.ui.$("#scrub");
  scrub.oninput = () => {
    const plan = MV.S.plan;
    if (!plan) return;
    MV.preview.seek(scrub.value / 1000 * plan.totalSec);
  };

  /* rAF は非表示タブで止まる。setInterval の保険で最低 4fps は動かす
     (rAF単独依存で全停止した v1.37.2 の教訓) */
  const loop = () => {
    MV.preview._raf = requestAnimationFrame(loop);
    MV.preview.tick();
  };
  loop();
  setInterval(() => MV.preview.tick(true), 250);
};

/* plan ができた/変わったときに呼ぶ */
MV.preview.show = () => {
  const plan = MV.S.plan;
  if (!plan) return;
  const cv = MV.preview.canvas;
  cv.width = plan.W; cv.height = plan.H;
  MV.ui.$("#stageSec").hidden = false;
  MV.preview.pause();
  MV.preview.seek(0);
  MV.preview.renderStrip();
  MV.preview.draw();
};

/* ---------- 音のグラフ ---------- */
MV.preview.audio = () => {
  if (MV.preview._actx) return MV.preview._actx;
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  MV.preview._actx = actx;
  MV.preview._master = actx.createGain();
  MV.preview._master.connect(actx.destination);
  return actx;
};

/* 要素をグラフへ配線(1要素1回だけ)。muted にすると WebAudio 側も無音に
   なるので、要素は unmuted のままゲインで黙らせる */
MV.preview.tap = el => {
  if (el._mvGain) return el._mvGain;
  const actx = MV.preview.audio();
  const src = actx.createMediaElementSource(el);
  const g = actx.createGain();
  g.gain.value = 0;
  src.connect(g); g.connect(MV.preview._master);
  el._mvGain = g;
  el.muted = false;
  return g;
};

/* 実時間書き出し用: master の分岐先(録音ストリーム) */
MV.preview.captureAudioStream = () => {
  MV.preview.audio();
  if (!MV.preview._dest) {
    MV.preview._dest = MV.preview._actx.createMediaStreamDestination();
    MV.preview._master.connect(MV.preview._dest);
  }
  return MV.preview._dest.stream;
};

/* BGMの<audio>要素(遅延生成) */
MV.preview.bgmEl = bgm => {
  let el = MV.preview._bgmEls.get(bgm.id);
  if (!el) {
    el = document.createElement("audio");
    el.src = bgm.url;
    el.preload = "auto";
    MV.preview._bgmEls.set(bgm.id, el);
  }
  return el;
};

/* ---------- 再生制御 ---------- */
MV.preview.play = async () => {
  if (!MV.S.plan) return;
  const actx = MV.preview.audio();
  try { await actx.resume(); } catch (_) {}
  if (MV.S.t >= MV.S.plan.totalSec - 0.05) MV.S.t = 0;
  MV.preview.playing = true;
  MV.S.playing = true;
  MV.preview._lastNow = performance.now();
  MV.ui.$("#playBtn").innerHTML = '<i class="fa-solid fa-pause"></i>';
};

MV.preview.pause = () => {
  MV.preview.playing = false;
  MV.S.playing = false;
  MV.allClips().forEach(c => { try { c.video.pause(); } catch (_) {} });
  MV.preview._bgmEls.forEach(el => { try { el.pause(); } catch (_) {} });
  const btn = MV.ui.$("#playBtn");
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i>';
};

MV.preview.seek = t => {
  const plan = MV.S.plan;
  if (!plan) return;
  MV.S.t = Math.max(0, Math.min(plan.totalSec, t));
  MV.preview._appliedSeg = -1;   // 次の tick で必ずメディアを合わせ直す
  MV.preview.draw();
  MV.preview.updateTransport();
};

/* ---------- 毎フレーム ---------- */
MV.preview.tick = fromInterval => {
  const plan = MV.S.plan;
  if (!plan || MV.ui.$("#stageSec").hidden) return;
  if (MV.preview.playing) {
    const now = performance.now();
    MV.S.t += (now - MV.preview._lastNow) / 1000;
    MV.preview._lastNow = now;
    if (MV.S.t >= plan.totalSec) {
      MV.S.t = plan.totalSec;
      MV.preview.pause();
    }
    MV.preview.syncMedia();
    MV.preview.updateTransport();
  }
  /* 停止中は draw を間引く(intervalからの呼び出しでは描かない) */
  if (MV.preview.playing || !fromInterval) MV.preview.draw();
};

/* 再生位置に合わせて、鳴るべき要素だけを鳴らす */
MV.preview.syncMedia = () => {
  const plan = MV.S.plan;
  const t = MV.S.t;
  const i = MV.segIndexAt(plan, t);
  const seg = plan.segments[i];
  const active = new Map();   // el -> {want, gain}

  const addClip = (clipId, srcSec, gain) => {
    const c = MV.getClip(clipId);
    if (!c) return;
    active.set(c.video, { want: srcSec, gain });
  };

  if (seg.kind === "video") {
    const inBRoll = seg.bRoll && t >= seg.bRoll.tA && t < seg.bRoll.tB;
    /* 本体は絵にも音にも要る(bRoll中も音は本体の音)。 */
    const xf = seg.transIn > 0 && t - seg.t0 < seg.transIn ? (t - seg.t0) / seg.transIn : 1;
    addClip(seg.clipId, seg.srcIn + (t - seg.t0), seg.ambient ? seg.ambientGain * xf : 0);
    if (inBRoll) addClip(seg.bRoll.clipId, seg.bRoll.srcIn + (t - seg.bRoll.tA), 0);
  }
  /* ディゾルブ中は前セグメントの絵と音が残る(音はフェードアウト) */
  if (i > 0 && seg.transIn > 0 && t - seg.t0 < seg.transIn) {
    const prev = plan.segments[i - 1];
    if (prev.kind === "video") {
      const fade = 1 - (t - seg.t0) / seg.transIn;
      addClip(prev.clipId, prev.srcIn + (t - prev.t0), prev.ambient ? prev.ambientGain * fade : 0);
    }
  }

  /* 素材の再生・停止・ゲイン反映 */
  MV.allClips().forEach(c => {
    const v = c.video;
    const a = active.get(v);
    if (!a) {
      if (!v.paused) v.pause();
      if (v._mvGain) v._mvGain.gain.value = 0;
      return;
    }
    MV.preview.tap(v);
    v._mvGain.gain.value = a.gain;
    if (Math.abs(v.currentTime - a.want) > 0.35) v.currentTime = a.want;
    if (v.paused) v.play().catch(() => {});
  });

  /* BGM */
  const duck = MV.preview.duckGain(plan, t);
  plan.bgm.forEach(entry => {
    const inRange = t >= entry.t0 && t < entry.t1;
    const bgm = MV.S.bgms.find(b => b.id === entry.bgmId);
    if (!bgm) return;
    const el = MV.preview.bgmEl(bgm);
    if (!inRange) {
      /* 自分の範囲外。他のエントリが同じ曲を使うかもしれないので止めるだけ */
      if (![...plan.bgm].some(e2 => e2.bgmId === entry.bgmId && t >= e2.t0 && t < e2.t1)
          && !el.paused) el.pause();
      return;
    }
    MV.preview.tap(el);
    const rel = t - entry.t0;
    const fadeIn = entry.fadeIn > 0 ? Math.min(1, rel / entry.fadeIn) : 1;
    const fadeOut = entry.fadeOut > 0 ? Math.min(1, (entry.t1 - t) / entry.fadeOut) : 1;
    el._mvGain.gain.value = entry.gain * duck * Math.min(fadeIn, fadeOut);
    const want = entry.srcIn + rel;
    if (Math.abs(el.currentTime - want) > 0.4) el.currentTime = want;
    if (el.paused) el.play().catch(() => {});
  });
};

/* ダッキング係数(0.15秒で下がり、0.3秒で戻る簡易ランプ) */
MV.preview.duckGain = (plan, t) => {
  let g = 1;
  for (const r of plan.duckRanges) {
    const low = r.deep ? 0.1 : 0.251;    // -12dB(deepは-20dB)
    if (t >= r.t0 && t <= r.t1) {
      const inRamp = Math.min(1, (t - r.t0) / 0.15);
      const outRamp = Math.min(1, (r.t1 - t) / 0.3);
      const depth = Math.min(inRamp, outRamp);
      g = Math.min(g, 1 - (1 - low) * depth);
    }
  }
  return g;
};

/* ---------- 描画 ---------- */
MV.preview.draw = () => {
  const plan = MV.S.plan;
  if (!plan) return;
  MV.compose(MV.preview.ctx, plan.W, plan.H, MV.S.t, req => {
    const c = MV.getClip(req.clipId);
    if (!c || !c.video.videoWidth) return null;
    /* 停止中(スクラブ)はここで seek する。再生中は syncMedia が合わせている */
    if (!MV.preview.playing && Math.abs(c.video.currentTime - req.srcSec) > 0.35) {
      c.video.currentTime = Math.max(0, Math.min(c.duration - 0.05, req.srcSec));
    }
    return { source: c.video, w: c.video.videoWidth, h: c.video.videoHeight, rotation: 0 };
  });
  MV.preview.highlightStrip();
};

MV.preview.updateTransport = () => {
  const plan = MV.S.plan;
  if (!plan) return;
  MV.ui.$("#timeLabel").textContent =
    `${MV.ui.fmtClock(MV.S.t)} / ${MV.ui.fmtClock(plan.totalSec)}`;
  const scrub = MV.ui.$("#scrub");
  if (document.activeElement !== scrub) {
    scrub.value = Math.round(MV.S.t / plan.totalSec * 1000);
  }
};

/* ---------- ブロック帯(構成の見える化+タップで移動) ---------- */
MV.preview.renderStrip = () => {
  const plan = MV.S.plan;
  const host = MV.ui.$("#blockStrip");
  if (!plan || !host) return;
  /* セグメントをブロック単位にまとめる(インサートのカット数だけ並べると細かすぎる) */
  const groups = [];
  for (const s of plan.segments) {
    const last = groups[groups.length - 1];
    if (last && last.blockId === s.blockId) { last.t1 = s.t1; continue; }
    groups.push({ blockId: s.blockId, label: s.label, t0: s.t0, t1: s.t1 });
  }
  MV.preview._strip = groups;
  host.innerHTML = groups.map((g, i) =>
    `<span data-strip="${i}" style="flex-grow:${Math.max(1, Math.round((g.t1 - g.t0) * 10))}"
       title="${MV.ui.esc(g.label)}">${MV.ui.esc(g.label)}</span>`).join("");
  host.querySelectorAll("[data-strip]").forEach(el => {
    el.onclick = () => {
      const g = groups[Number(el.getAttribute("data-strip"))];
      MV.preview.seek(g.t0 + 0.01);
    };
  });
};

MV.preview.highlightStrip = () => {
  const groups = MV.preview._strip;
  const host = MV.ui.$("#blockStrip");
  if (!groups || !host) return;
  const t = MV.S.t;
  const idx = groups.findIndex(g => t >= g.t0 && t < g.t1);
  host.querySelectorAll("[data-strip]").forEach((el, i) => {
    el.classList.toggle("on", i === idx);
  });
};
