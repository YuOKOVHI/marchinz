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
  syncFloatShape(override) {
    const holder = document.querySelector(".canvas-holder");
    if (!holder) return;
    const pr = override || MC.PRESETS[MC.S.preset];
    const tall = !!pr && pr.h > pr.w;
    holder.classList.toggle("float-tall", tall);
  },

  applyPreset() {
    /* 傾きの確認中は、完成の比率(縦9:16など)ではなく**素材そのものの向き**で見せる
       (2026-07-29 優さん指示「傾き修正は、横向きの動画で」)。
       横で撮った動画を縦枠に cover-crop すると左右が大きく切れ、
       いちばん頼りになる水平の手がかり(ヤードライン・フロアライン・壁の境目)が
       画面の外へ出てしまう。ここだけ素材のアスペクトに合わせる */
    if (document.body.dataset.mzjPhase === "tilt" && this.soloId != null) {
      const c = MC.getClip(this.soloId);
      if (c && c.width && c.height) {
        const long = 1280;
        const land = c.width >= c.height;
        const w2 = land ? long : Math.round(long * c.width / c.height / 2) * 2;
        const h2 = land ? Math.round(long * c.height / c.width / 2) * 2 : long;
        if (this.canvas.width !== w2 || this.canvas.height !== h2) {
          this.canvas.width = w2; this.canvas.height = h2;
        }
        this.syncFloatShape(land ? { w: 16, h: 9 } : { w: 9, h: 16 });
        return;
      }
    }
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

  /* 再生・シークの候補すべて(静止画以外)+音声のみクリップ。
     ★これは「回しうる全部」であって「いま回すべきもの」ではない。
       いま回すべきものは visibleClips() が決める */
  playClips() {
    const set = new Set(MC.activeClips().filter(c => !c.isImage));
    const a = MC.getClip(MC.S.audioClipId);
    if (a && a.isAudio) set.add(a);
    return [...set];
  },

  /* 先読みの秒数。切替のこれだけ前から、次のカメラを回しておく */
  PREROLL: 2.0,

  /* いま実際に回すべきクリップ(2026-08-01)。
     それまでは playClips() 全部を再生していた ─ 自動スイッチングでは
     画面に出るのは1台なのに、**裏で3本が回り続けていた**。
     iPhoneで10分再生し続ける前提に立つなら、この無駄は許容できない。

     ★ 何が画面に出るかは MC.neededIds(t) が唯一の正本。書き出しが
       「出番のないカメラをデコードしない」判定に使っているのと同じ関数を使う。
       ここで独自に条件を書くと、drawComposite と規則が2実装に割れて
       黒コマになる(layout.js の警告と同じ理由)。 */
  visibleClips() {
    const set = new Set();
    /* ★ ここで .video の有無を条件にしない。playClips() と**同じ物差し**で
       集合を作り、要素が無い場合の守りは参照する側(play/driftFix)に置く。
       物差しが2つあると、片方だけ空になって静かに壊れる */
    const add = id => {
      if (id == null) return;
      const c = MC.getClip(id);
      if (c && !c.isImage) set.add(c);
    };
    MC.neededIds(MC.S.t).forEach(add);
    /* 次のカットのカメラを先に回しておく。止まった状態から seek すると
       切替の瞬間にコマが飛ぶ(実測ではなく既知の挙動としての予防) */
    const nx = MC.nextCutAt && MC.nextCutAt(MC.S.t);
    if (nx && nx.t - MC.S.t <= this.PREROLL) add(nx.clipId);
    /* 音声担当は時計そのもの(tick が currentTime を読む)。必ず回す */
    const m = MC.getClip(MC.S.audioClipId);
    if (m) set.add(m);
    return [...set];
  },

  applyMute() {
    /* ★ おまかせの解析画面(mz-auto-stage)の間は全部消す(2026-08-06 実機報告
       「分析中に音がなる」)。open() が play() 後に全ミュートしても、解析で
       stats が確定した瞬間の renderAudio → applyMute が音声担当だけ解禁して
       鳴っていた。個々の呼び出し側で消すのではなく、正本のここで守る。
       書き出し中(exporter.running)は除外: リアルタイム録画は音声担当の
       <video> から録るため、ここで消すと完成品が無音になる(スピーカーは
       exportRealtime 側が別途黙らせる) */
    const analyzing = document.body.classList.contains("mz-auto-stage")
      && !(MC.exporter && MC.exporter.running);
    MC.S.clips.forEach(c => {
      if (c.video) c.video.muted = analyzing || c.id !== MC.S.audioClipId;
    });
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
    /* 回すのは「いま画面に出るもの＋次のカット＋音声担当」だけ(2026-08-01)。
       残りは driftFix が必要になった時点で起こす */
    for (const c of this.visibleClips()) {
      if (!c.video) continue;
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
    /* ★ ここが要。以前は playClips() 全部を見て、止まっている本を
       片っ端から起こしていた ─ つまり「見えていない本を止める」だけでは
       0.5秒後にこの関数が全部起こし直してしまう。
       いま回すべき集合を先に決め、そこに居ない本は止める(2026-08-01) */
    const vis = new Set(this.visibleClips());
    for (const c of this.playClips()) {
      const v = c.video;
      if (!v) continue;
      if (!vis.has(c)) { if (!v.paused) v.pause(); continue; }   // 出番が無い=止める
      if (c === m) continue;
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
    /* 呼び名は「動画N」に統一(2026-08-01)。素材カード・傾き・音声の選択が
       すべて「動画N」なのに、プレビューのバッジだけ「カメラN」だった */
    const label = armedId != null ? `動画${idx + 1}（まだ確定していません）` : `動画${idx + 1}`;
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
    /* ★ 補足と進み具合を返す(2026-08-01)。drawRangeNotice は前から busy.sub を
       渡していたが、ここが返していなかったので**常に undefined**＝
       主役のプレビューには「映像分析中…」としか出ず、いま何をしているかは
       画面の別の場所を探さないと分からなかった。
       MZP が持っている「いま何をしているか」をそのまま借りる */
    const sub = String(cur.sub || cur.label || "");
    /* 円の進捗に渡す割合。確定進捗(run)ならそれを使う。
       おまかせ/こだわりの音の読み込みは MZP 側が pulse(不確定)で回っており
       ratio を持たないので、段の中の実測(_innerRaw)を借りる ─
       いちばん長く無言になるのがこの区間で、%が出せる唯一の場所 */
    let ratio = (cur.state === "run" && cur.ratio > 0) ? cur.ratio : null;
    const as = MC.ui && MC.ui.autoStage;
    /* ★ おまかせ中は**全体通算**(autoStage.ratio=重み付きの0→100が一度きり)を使う
       (2026-08-02 優さん指摘「円のゲージが戻るように見える時がある」)。
       cur.ratio や _innerRaw は「その段の中の%」で、音の読み込み(0→100)→
       映像解析(0→100)と**同じ画面の中で何度も0へ巻き戻る**。下の画面の
       進捗バーと同じ数字になるので、2つの%が食い違う混乱も消える */
    const asEl = document.getElementById("autoStage");
    const asOn = !!(as && asEl && !asEl.hidden);
    if (asOn) ratio = as.ratio();
    else if (ratio == null && as && as._innerRaw > 0) ratio = as._innerRaw;
    /* ★ 単調増加の保証(同上)。同じ仕事の間は、前回より小さい値を無視する。
       仕事の切れ目(おまかせの開始時刻 or MZPのハンドル)が変わったら数え直す。
       確定値が無い合間も最後の値を保つ ─ 輪が不確定の伸縮に落ちて
       「縮んで戻った」ように見えるのを防ぐ */
    const gKey = asOn ? "as:" + (MC.ui._autoT0 || 0) : cur;
    if (this._gaugeKey !== gKey) { this._gaugeKey = gKey; this._gaugeMax = 0; }
    if (ratio != null) {
      if (ratio < this._gaugeMax) ratio = this._gaugeMax;
      else this._gaugeMax = ratio;
    } else if (this._gaugeMax > 0) {
      ratio = this._gaugeMax;
    }
    return { label, sub, ratio, dots: ".".repeat(Math.floor(Date.now() / 400) % 4) };
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
    if (busy) {
      this.drawOverlayMessage(busy.label + busy.dots, busy.sub,
        { spinner: true, ratio: busy.ratio });
      return;
    }
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
    /* ★ 大きさの係数(2026-08-02 優さん指示「真ん中のゲージとテキストを動画に
       対して6〜7割の大きさに。特に縦型はもっと大きく」)。
       固定pxでなく描画領域比で決める。基準は min(W,H) のまま、作業中
       (ゲージつき)の一式だけを拡大する ─ 「ここは書き出されません」等の
       常設案内まで巨大化させない。
       縦型(9x16)は canvas 1080px 幅が画面では375pxまで縮み、同じ係数でも
       いちばん小さく見えるので係数をさらに大きく取る。
       実測(タイトル「映像分析中…」+ゲージの塊): 16:9=短辺の約69%、
       9:16=幅の約76%(数値は QA ㊲ が常時見張る。2.2 だと84%で7割を超えた) */
    const F = spin ? (H > W ? 2.0 : 1.8) : 1;
    ctx.save();
    ctx.fillStyle = "rgba(6, 10, 16, 0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (!spin) {
      const cy = H / 2;
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.round(base * 0.05)}px -apple-system, sans-serif`;
      ctx.fillText(title, W / 2, sub ? cy - base * 0.035 : cy);
      if (sub) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = `500 ${Math.round(base * 0.034)}px -apple-system, sans-serif`;
        /* 幅を超える補足は切る。溢れると左右が枠の外へ消えて、
           真ん中だけが読める意味不明な行になる */
        ctx.fillText(this.fitText(ctx, sub, W * 0.86), W / 2, cy + base * 0.03);
      }
      ctx.restore();
      return;
    }
    {
      /* ============ 円の進捗(2026-08-01 優さん指示) ============
         **始点と終点を真上(12時)にそろえる**。canvas の角度0は3時なので
         -π/2 を基準にする。以前は弧をぐるぐる回していたため、始点も終点も
         毎フレーム動き、どこから始まってどこで終わるのかが無かった。

         ・進み具合が分かるとき(確定): 12時から時計回りに ratio ぶん伸ばす。
           100%でちょうど12時へ戻る＝一周した形が「終わり」になる
         ・分からないとき(不確定): 始点は12時に固定したまま、終点だけが
           12時から一周して12時へ戻る(sin なので折り返しでも飛ばない)。
           回転させると始点まで動いてしまうので、伸縮で見せる

         canvas は 1080〜1920px、表示は 375px 幅まで縮むので、
         見た目で分かる大きさにするには canvas 上でかなり大きく描く必要がある */
      /* ============ 並びとレイアウト(2026-08-02 優さん指示②) ============
         上から「動画タイトル(補足) → 円ゲージ → 説明の文字」の縦順に固定し、
         それぞれを輪の半径+間隔で機械的に離す ─ 重なりが構造的に起きない。
         以前は輪を上・文字を中央に置く座標計算で、縦型(F=2.0)では
         説明の中心が輪の下端より上に来て、文字が輪に食い込んでいた(実機)。

         ★ 文字の大きさはゲージと独立に上限を持つ(2026-08-02 優さん指示①
           「フェーズの文字が大きくて見えない」)。ゲージ拡大の係数 F を
           文字にそのまま掛けると、縦型では説明が幅からはみ出す */
      const TOP = -Math.PI / 2;              // 真上(12時)
      /* ★ 上限は**幅**でも抑える(2026-08-04 優さん実機指摘「縦動画だけ
         読み込み中の文字が大きい。自動スイッチングは問題なし」)。
         base = min(W,H) は 9:16 も 16:9 もどちらも 1080 なので、
         短辺だけで上限を決めると**両方まったく同じ絶対px**になる。
         ところが画面幅に対応するのは W のほうなので、
           縦型 9:16(W=1080) … 45.4px ＝ 幅の 4.20%
           横型16:9(W=1920) … 45.4px ＝ 幅の 2.36%   ← 縦型は 1.78倍
         と、短辺＝幅になる縦型でだけ相対的に肥大していた。
         輪(r)は「特に縦型は大きく」の指示どおり base×F のまま触らない ─
         大きくしたかったのはゲージであって、文字ではない */
      const tFont = Math.min(Math.round(base * 0.05 * F), Math.round(base * 0.058),
                             Math.round(W * 0.033));
      const sFont = Math.min(Math.round(base * 0.034 * F), Math.round(base * 0.042),
                             Math.round(W * 0.024));
      const r = base * 0.09 * F;             // 輪の大きさは F(6〜7割指示)に連動
      const cx = W / 2, cyS = H / 2 - base * 0.02;
      const gap = base * 0.035;
      const lw = Math.max(3, base * 0.013 * F);
      const det = (opts.ratio != null && isFinite(opts.ratio) && opts.ratio > 0);
      const pct = det ? Math.max(0, Math.min(1, opts.ratio)) : 0;
      const t = (Date.now() % 2600) / 2600;
      const sweep = det ? pct * Math.PI * 2
                        : Math.max(0.12, Math.sin(t * Math.PI)) * Math.PI * 2;
      const subY = cyS - r - gap - sFont / 2;      // 動画タイトル(輪の上)
      const titleY = cyS + r + gap + tFont / 2;    // 説明の文字(輪の下)
      if (sub) {
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.font = `600 ${sFont}px -apple-system, sans-serif`;
        ctx.fillText(this.fitText(ctx, sub, W * 0.86), W / 2, subY);
      }
      ctx.lineCap = "round";
      ctx.beginPath();                       // 下地の輪(残りがどれだけかが分かる)
      ctx.arc(cx, cyS, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cyS, r, TOP, TOP + sweep);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = lw;
      ctx.stroke();
      if (det) {                             // 輪の中に%。12時が始点だと一目で分かる
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = `700 ${Math.min(Math.round(base * 0.038 * F), Math.round(base * 0.05))}px -apple-system, sans-serif`;
        ctx.fillText(`${Math.round(pct * 100)}%`, cx, cyS);
      }
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${tFont}px -apple-system, sans-serif`;
      ctx.fillText(this.fitText(ctx, title, W * 0.86), W / 2, titleY);
      ctx.restore();
      /* QA が「順序と重なりゼロ」を実測できるよう寸法を返す(描画には影響しない) */
      return { subY, subFont: sFont, ringTop: cyS - r - lw / 2, ringBottom: cyS + r + lw / 2,
               titleY, titleFont: tFont, r, base, F };
    }
  },

  /* 与えた幅に収まるところまで縮めて「…」を付ける */
  fitText(ctx, s, maxW) {
    s = String(s || "");
    if (!s || ctx.measureText(s).width <= maxW) return s;
    for (let n = s.length - 1; n > 0; n--) {
      const t = s.slice(0, n) + "…";
      if (ctx.measureText(t).width <= maxW) return t;
    }
    return s;
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
