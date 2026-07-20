"use strict";
/* ============ プレビュー: 複数<video>の同期再生 + rAF描画 ============ */

MC.preview = {
  canvas: null, ctx: null, _lastDrift: 0,
  /* プレビュー専用の重ね描き(カメラ名バッジ・範囲外の案内)を出すか。
     実時間録画(exportRealtime)はこのcanvasをそのまま録るため、録画中はfalseにする */
  overlayOn: true,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.applyPreset();
    const loop = ts => { this.tick(ts); this._lastTick = performance.now(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    // rAFが発火しない環境(バックグラウンドタブ・一部の埋め込みブラウザ)の保険。
    // これが無いと時刻が進まず、プレビューが止まって「スイッチングされない」ように見える。
    // 再生中だけに限定する(止まっているときまで描き続けると電池と熱を無駄に使う)
    clearInterval(this._fallbackIv);
    this._fallbackIv = setInterval(() => {
      if (!MC.S.playing) return;
      if (performance.now() - (this._lastTick || 0) > 250) {
        this.tick(performance.now());
        this._lastTick = performance.now();
      }
    }, 150);
  },

  applyPreset() {
    const { w, h } = MC.PRESETS[MC.S.preset];
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  },

  masterClip() {
    return MC.getClip(MC.S.audioClipId) || MC.activeClips()[0] || MC.S.clips[0] || null;
  },

  /* 再生・シークの対象: 表示中の素材(静止画以外)+音声のみクリップ */
  playClips() {
    const set = new Set(MC.activeClips().filter(c => !c.isImage));
    const a = MC.getClip(MC.S.audioClipId);
    if (a && a.isAudio) set.add(a);
    return [...set];
  },

  applyMute() {
    MC.S.clips.forEach(c => { if (c.video) c.video.muted = c.id !== MC.S.audioClipId; });
  },

  seek(t) {
    const dur = MC.timelineDuration();
    this._lastCurId = null;   // 飛んだ先のカメラを次のtickで確実に再生し直す
    MC.S.t = Math.max(0, Math.min(t, dur));
    for (const c of this.playClips()) {
      const local = MC.S.t - c.offset;
      c.video.currentTime = Math.max(0, Math.min(local, Math.max(0, c.duration - 0.05)));
    }
  },

  async play() {
    const m = this.masterClip();
    if (!m) return;
    const [tIn, tOut] = MC.trimRange();
    if (MC.S.t < tIn || MC.S.t >= tOut - 0.05) this.seek(tIn);
    this.applyMute();
    MC.S.playing = true;
    for (const c of this.playClips()) {
      const local = MC.S.t - c.offset;
      if (local >= 0 && local < c.duration) {
        c.video.currentTime = local;
        let p = c.video.play();
        if (p) p.catch(() => {
          // 自動再生ポリシーで音声付きがブロックされたらミュートで再生継続
          c.video.muted = true;
          c.video.play().catch(() => {});
          if (c.id === MC.S.audioClipId) MC.ui.toast("🔇 ブラウザ設定により音声なしで再生中(もう一度▶で音が出ます)");
        });
      }
    }
    MC.ui.updateTransport();
  },

  pause() {
    MC.S.playing = false;
    MC.S.clips.forEach(c => { if (!c.video) return; try { c.video.pause(); c.video.playbackRate = 1; } catch (e) {} });
    MC.ui.updateTransport();
  },

  toggle() { MC.S.playing ? this.pause() : this.play(); },

  tick(ts) {
    this.applyPreset();
    if (MC.S.playing) {
      const m = this.masterClip();
      if (m) MC.S.t = m.video.currentTime + m.offset;
      const [, tOut] = MC.trimRange();
      if (MC.S.t >= tOut || (m && m.video.ended)) { this.pause(); }
      if (ts - this._lastDrift > 500) {
        this._lastDrift = ts;
        this.driftFix();
      }
      // カットが切り替わった瞬間、その素材がまだ再生されていなければ即開始する
      // (driftFix待ちだと切替直後の最大0.5秒が静止画に見える)
      const curId = MC.cutAt(MC.S.t).cur;
      if (curId !== this._lastCurId) {
        this._lastCurId = curId;
        this.ensurePlaying(curId);
      }
      MC.ui.updateTransport();
    }
    this.draw();
  },

  /* 指定クリップが範囲内なのに止まっていたら、その場で再生を始める */
  ensurePlaying(id) {
    const c = MC.getClip(id);
    if (!c || !c.video || !MC.S.playing) return;
    const want = MC.S.t - c.offset;
    if (want < 0 || want > c.duration) return;
    if (c.video.paused) {
      c.video.currentTime = want;
      c.video.play().catch(() => {});
    }
  },

  /* マスター(音声担当)基準のドリフト補正 */
  driftFix() {
    const m = this.masterClip();
    for (const c of this.playClips()) {
      if (c === m) continue;
      const v = c.video;
      const want = MC.S.t - c.offset;
      if (want < 0 || want > c.duration) { if (!v.paused) v.pause(); continue; }
      if (v.paused && MC.S.playing) { v.currentTime = want; v.play().catch(() => {}); continue; }
      const d = v.currentTime - want;
      if (Math.abs(d) > 0.06) { v.currentTime = want; v.playbackRate = 1; }
      else if (Math.abs(d) > 0.025) v.playbackRate = d > 0 ? 0.98 : 1.02;
      else v.playbackRate = 1;
    }
  },

  /* 素材ゼロのときの空状態(黒い矩形だけを見せない) */
  drawEmpty() {
    const W = this.canvas.width, H = this.canvas.height, ctx = this.ctx;
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const base = Math.min(W, H);
    ctx.font = `${Math.round(base * 0.10)}px sans-serif`;
    ctx.fillText("🎬", W / 2, H / 2 - base * 0.09);
    ctx.font = `500 ${Math.round(base * 0.042)}px -apple-system, sans-serif`;
    ctx.fillText("素材を入れると", W / 2, H / 2 + base * 0.03);
    ctx.fillText("ここにプレビューが出ます", W / 2, H / 2 + base * 0.095);
  },

  /* いまどの素材が映っているかをプレビュー左下に出す(カット割モードのみ)。
     切り替わっているかが一目で分かるようにするためのプレビュー専用表示で、
     書き出す映像には入らない */
  drawCamBadge() {
    if (!this.overlayOn) return;
    const L = MC.LAYOUTS[MC.S.layoutId];
    if (!L || (L.type !== "switch" && L.type !== "wipe")) return;
    const cut = MC.cutAt(MC.S.t);
    const clips = MC.media.slotClips();
    const idx = clips.findIndex(c => c.id === cut.cur);
    if (idx < 0) return;
    const W = this.canvas.width, H = this.canvas.height, ctx = this.ctx;
    const base = Math.min(W, H);
    const fs = Math.round(base * 0.05);   // 小さいプレビューでも読める大きさ
    const label = `カメラ${idx + 1}`;
    ctx.save();
    ctx.font = `700 ${fs}px -apple-system, sans-serif`;
    const padX = fs * 0.62, padY = fs * 0.42;
    const tw = ctx.measureText(label).width;
    const bw = tw + padX * 2, bh = fs + padY * 2;
    const bx = base * 0.03, by = H - bh - base * 0.03;
    const r = bh / 2;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(8, 12, 18, 0.62)";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + padX, by + bh / 2 + fs * 0.04);
    ctx.restore();
  },

  /* 現在位置が書き出し範囲(IN〜OUT)の外なら、その旨をプレビューへ重ねる。
     プレビュー専用(書き出しはexporterが範囲内だけを描くため焼き込まれない) */
  drawRangeNotice() {
    if (!this.overlayOn) return;
    const dur = MC.timelineDuration();
    if (!dur) return;
    const [tIn, tOut] = MC.trimRange();
    if (MC.S.t >= tIn - 0.01 && MC.S.t <= tOut + 0.01) return;
    const W = this.canvas.width, H = this.canvas.height, ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(6, 10, 16, 0.55)";
    ctx.fillRect(0, 0, W, H);
    const base = Math.min(W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(base * 0.05)}px -apple-system, sans-serif`;
    ctx.fillText("ここは書き出されません", W / 2, H / 2 - base * 0.035);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `500 ${Math.round(base * 0.034)}px -apple-system, sans-serif`;
    ctx.fillText(MC.S.t < tIn ? "書き出しは IN の位置から始まります" : "書き出しは OUT の位置で終わります", W / 2, H / 2 + base * 0.03);
    ctx.restore();
  },

  draw() {
    if (!MC.S.clips.length) { this.drawEmpty(); return; }
    MC.drawComposite(this.ctx, this.canvas.width, this.canvas.height, MC.S.t, id => {
      const c = MC.getClip(id);
      if (!c) return null;
      if (c.isImage) return { source: c.img, w: c.width, h: c.height, rotation: 0 };  // 静止画は常に表示
      if (!c.video || !c.video.videoWidth) return null;
      const local = MC.S.t - c.offset;
      if (local < -0.05 || local > c.duration + 0.05) return null;
      // <video>はブラウザが回転を適用済みなので rotation=0
      return { source: c.video, w: c.video.videoWidth, h: c.video.videoHeight, rotation: 0 };
    });
    this.drawCamBadge();
    this.drawRangeNotice();
  },
};
