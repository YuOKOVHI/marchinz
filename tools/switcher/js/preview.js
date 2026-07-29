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
    /* 縮小品質(2026-07-29 プロビデオグラファー指摘)。既定は "low" = バイリニア単独で、
       1/2 を超える縮小(1920→1080 は0.5625倍)では入力画素を取りこぼし、
       スタンドの観客・ヤードライン・制服の飾緒といった高周波な被写体が
       モアレになる。GL側はミップマップを正しく作っているのに、最後の2D縮小で
       台無しになっていた。"high" で Skia のミップ縮小に切り替わる */
    this.ctx.imageSmoothingQuality = "high";
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
    this.startBusyWatch();   // 作業中オーバーレイのアニメーション
  },

  /* 縦型かどうかでフロートの大きさを変える(縦は高さが出て画面を塞ぐため) */
  syncFloatShape() {
    const holder = document.querySelector(".canvas-holder");
    if (!holder) return;
    const pr = MC.PRESETS[MC.S.preset];
    const tall = !!pr && pr.h > pr.w;
    holder.classList.toggle("float-tall", tall);
  },

  applyPreset() {
    this.syncFloatShape();
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
    MC.timeline.syncToPlayhead();
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
      MC.timeline.syncToPlayhead();   // 「いま映っているカット」の表示を追従させる
    }
    /* 書き出し中は描かない(2026-07-28 クラッシュ検証)。exporter が別の
       canvas+GLで同じ合成を回している最中に、こちらも60fpsで
       drawComposite+色シェーダを回し続けていた ─ 画面は書き出しの
       全画面(不透過)に覆われていて誰にも見えないのに、GPUとメモリを
       まるごと二重に使う。iPhoneが書き出し中に落ちる報告の本命 */
    if (MC.exporter && MC.exporter.running) return;
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
  /* 「もう一度タップ」待ちのカメラID。待ちが無ければ null。
     カット割/ワイプのときだけ効かせる(他のレイアウトはカットの概念が無い) */
  armedPreviewId() {
    const id = MC.timeline && MC.timeline.armedCam;
    if (id == null) return null;
    const L = MC.LAYOUTS[MC.S.layoutId];
    if (!L || (L.type !== "switch" && L.type !== "wipe")) return null;
    return MC.getClip(id) ? id : null;
  },

  drawCamBadge() {
    if (!this.overlayOn) return;
    const L = MC.LAYOUTS[MC.S.layoutId];
    if (!L || (L.type !== "switch" && L.type !== "wipe")) return;
    const cut = MC.cutAt(MC.S.t);
    const armedId = this.armedPreviewId();
    const clips = MC.media.slotClips();
    const idx = clips.findIndex(c => c.id === (armedId != null ? armedId : cut.cur));
    if (idx < 0) return;
    const W = this.canvas.width, H = this.canvas.height, ctx = this.ctx;
    const base = Math.min(W, H);
    const fs = Math.round(base * 0.05);   // 小さいプレビューでも読める大きさ
    const label = armedId != null ? `カメラ${idx + 1}（まだ確定していません）` : `カメラ${idx + 1}`;
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

  /* いま何をしているか。MZP の chapter で「分析」と「書き出し」を分ける。
     dots は動きを見せるためのアニメーション用 */
  busyLabel() {
    const cur = window.MZP && MZP.current;
    if (!cur || cur.closed || !["run", "pulse", "frozen"].includes(cur.state)) return null;
    const ch = String((cur.opt && cur.opt.chapter) || "");
    const label = ch.indexOf("書き出し") >= 0 ? "書き出し中" : "映像分析中";
    return { label, dots: ".".repeat(Math.floor(Date.now() / 400) % 4) };
  },

  /* 作業中は再生ループが回らないため、オーバーレイが静止して固まって見える。
     低頻度(400ms)で描き直して動いていることを見せる。コマ数を落としているのは
     書き出し処理を邪魔しないため。
     MZP.start は6箇所あり個別に仕込むと漏れるので、常時1本の監視に統一する */
  startBusyWatch() {
    if (this._busyTimer) return;
    this._busyTimer = setInterval(() => {
      if (MC.S.playing) return;                 // 再生中は tick が描いている
      if (MC.exporter && MC.exporter.running) return;   // 書き出し中は描かない(上のtickと同じ理由)
      const busy = MC.preview.busyLabel();
      if (busy) { MC.preview._wasBusy = true; try { MC.preview.draw(); } catch (err) {} return; }
      if (MC.preview._wasBusy) {                // 終わった直後に1回だけ通常表示へ戻す
        MC.preview._wasBusy = false;
        try { MC.preview.draw(); } catch (err) {}
      }
    }, 400);
  },

  /* 現在位置が書き出し範囲(IN〜OUT)の外なら、その旨をプレビューへ重ねる。
     プレビュー専用(書き出しはexporterが範囲内だけを描くため焼き込まれない) */
  drawRangeNotice() {
    if (!this.overlayOn) return;
    const dur = MC.timelineDuration();
    if (!dur) return;
    /* 作業中は書き出し範囲の話をしても仕方がないので、いま何をしているかだけ出す */
    const busy = this.busyLabel();
    if (busy) { this.drawOverlayMessage(busy.label + busy.dots, busy.sub, { spinner: true }); return; }
    const [tIn, tOut] = MC.trimRange();
    if (MC.S.t >= tIn - 0.01 && MC.S.t <= tOut + 0.01) return;
    this.drawOverlayMessage(
      "ここは書き出されません",
      MC.S.t < tIn ? "書き出しは IN の位置から始まります" : "書き出しは OUT の位置で終わります");
  },

  /* プレビュー上に重ねる案内。主文と補足の2行。
     opts.spinner で回る弧を足し、処理が生きていることを見せる */
  drawOverlayMessage(title, sub, opts) {
    const W = this.canvas.width, H = this.canvas.height, ctx = this.ctx;
    const base = Math.min(W, H);
    const spin = !!(opts && opts.spinner);
    ctx.save();
    ctx.fillStyle = "rgba(6, 10, 16, 0.55)";
    ctx.fillRect(0, 0, W, H);
    const cy = spin ? H / 2 + base * 0.02 : H / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(base * 0.05)}px -apple-system, sans-serif`;
    ctx.fillText(title, W / 2, sub ? cy - base * 0.035 : cy);
    if (sub) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `500 ${Math.round(base * 0.034)}px -apple-system, sans-serif`;
      ctx.fillText(sub, W / 2, cy + base * 0.03);
    }
    if (spin) {
      /* canvas は 1080〜1920px、表示は 375px 幅まで縮むので、
         見た目で分かる大きさにするには canvas 上でかなり大きく描く必要がある */
      const r = base * 0.09, a = (Date.now() / 1000) * 2.4;
      const cx = W / 2, cyS = H / 2 - base * 0.115;
      ctx.lineCap = "round";
      ctx.beginPath();                       // 下地の輪(回転が分かりやすくなる)
      ctx.arc(cx, cyS, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = Math.max(3, base * 0.013);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cyS, r, a, a + Math.PI * 0.7);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(3, base * 0.013);
      ctx.stroke();
    }
    ctx.restore();
  },

  draw() {
    if (!MC.S.clips.length) { this.drawEmpty(); return; }
    /* 傾き調整中は対象カメラだけを全面に出す(2026-07-24 優さん指示)。
       rot(水平補正)は MC.drawFull → prepSrc 経由で書き出しと同じ式が掛かる */
    if (this.soloId != null) {
      const sc = MC.getClip(this.soloId);
      if (sc && !sc.isAudio) {
        const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        MC.drawFull(ctx, W, H, this.soloId, id => {
          const cc = MC.getClip(id);
          if (!cc) return null;
          if (cc.isImage) return { source: cc.img, w: cc.width, h: cc.height, rotation: 0 };
          if (!cc.video || !cc.video.videoWidth) return null;
          return { source: cc.video, w: cc.video.videoWidth, h: cc.video.videoHeight, rotation: 0 };
        });
        // 何を見ているかのラベル(帯+カメラ名+角度)
        const fs = Math.round(W * 0.032);
        ctx.save();
        ctx.fillStyle = "rgba(8,12,18,0.62)";
        ctx.fillRect(0, 0, W, fs * 2.2);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${fs}px -apple-system, "Hiragino Sans", sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(`${MC.ui.shortName(sc.name)}  ${(+sc.rot || 0).toFixed(1)}°`,
          fs * 0.6, fs * 1.1);
        ctx.restore();
        /* まっすぐかどうかを見るための基準線(2026-07-28 レビューP0)。
           これが無いまま「まっすぐか確かめてください」と聞いていた ─
           0.1度を目視で判断する手がかりが画面に1つも無かった */
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = Math.max(1, W * 0.0016);
        for (const f of [1 / 3, 2 / 3]) {
          ctx.beginPath(); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(W * f, 0); ctx.lineTo(W * f, H); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(255,214,0,0.95)";
        ctx.lineWidth = Math.max(2, W * 0.0026);
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
        ctx.restore();
        return;
      }
    }
    /* 「もう一度タップ」待ちの間だけ、そのカメラの画をプレビューに出す(まだ確定ではない)。
       cutList / MC.cutAt は書き出しも通る道なので触らず、ここでソースだけ差し替える。
       差し替えるのは「いま映っているカット」の絵だけ。ワイプの子画面は対象外 */
    const armedId = this.armedPreviewId();
    MC.drawComposite(this.ctx, this.canvas.width, this.canvas.height, MC.S.t, id => {
      if (armedId != null && id === MC.cutAt(MC.S.t).cur) id = armedId;
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
