"use strict";
/* ============ プレビュー: 複数<video>の同期再生 + rAF描画 ============ */

MC.preview = {
  canvas: null, ctx: null, _lastDrift: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.applyPreset();
    const loop = ts => { this.tick(ts); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
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
      MC.ui.updateTransport();
    }
    this.draw();
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

  draw() {
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
  },
};
