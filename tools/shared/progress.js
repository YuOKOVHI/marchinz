"use strict";
/* ============ MarchinZ 共通 進捗コンポーネント ============
   「いま何をしているか」を常に見せるための共通部品。Privacy / Switcher 共用。
   外部ライブラリなし・ビルドなし・iOS Safari 16+。

   進捗の型は4つ:
     set()    確定  … %が出せる(書き出し、スキャン)
     count()  件数  … 中身の%は不明だが n件中m件目は言える(音声抽出、写真)
     pulse()  不確定 … %不明だが画面は生きている(モデル読み込み、波形照合)
     frozen() 凍結  … 画面が数秒止まる処理。アニメも止まるので、動きで安心させず
                      「いまから止まります」と先に伝える(拍の解析、演奏区間の検出)

   同時に走る処理は1つという前提(既存UIもボタンを無効化して単発実行にしている)。 */

window.MZP = (function () {
  const ETA_MIN_MS = 5000;      // これ未満の経過では残り時間を出さない(推定が外れて信用を落とす)
  const ETA_MIN_RATIO = 0.10;   // 進捗がこれ未満でも出さない
  const ETA_GIVEN_MIN_MS = 3000; // 実測を渡された場合の待ち(序盤の助走で外れるぶんだけ)

  /* 進捗バーの帯。確定進捗のときだけインラインで幅を持たせ、
     それ以外(pulse=不定 / frozen)は CSS のアニメーション用の幅へ返す */
  const setFill = (el, determinate, width) => {
    if (!el) return;
    if (determinate) el.style.width = width;
    else if (el.style.width) el.style.width = "";
  };
  const SLOW_MS = 8000;         // 「時間がかかっています」を足すまで
  const CANCEL_MS = 25000;      // 中止ボタンを出すまで
  const CHIP_MS = 2500;         // 完了表示をチップへ畳むまで
  const DEFAULT_DELAY = 350;    // これ未満で終わる処理は描画しない(ちらつき防止)

  let dock = null, dockIO = null, current = null;

  /* ---- 下部固定ミニバー(1個だけ作って使い回す) ---- */
  function ensureDock() {
    if (dock) return dock;
    dock = document.createElement("div");
    dock.className = "mzp-dock";
    dock.setAttribute("aria-hidden", "true");   // 読み上げはインライン側が担う(二重読み上げ防止)
    dock.innerHTML =
      '<div class="mzp-dock-row">' +
        '<span class="mzp-dock-chapter"></span>' +
        '<span class="mzp-dock-label"></span>' +
        '<span class="mzp-dock-pct"></span>' +
      '</div>' +
      '<div class="mzp-dock-track"><div class="mzp-dock-fill"></div></div>';
    document.body.appendChild(dock);
    return dock;
  }

  function showDock(on) {
    ensureDock();
    dock.classList.toggle("show", !!on);
    document.body.classList.toggle("mzp-docked", !!on);
    /* 実測した高さを配る(2026-07-25)。journey.js の --mz-journey-h と同じ方式。
       下部の固定要素(親指バー・中断ノート)がこの上へ積めるようにする。
       以前は各所が 69px / 3.6rem といった数値を個別に持っており、
       タブバーが増えた(07-24)ときに中断ノートだけ追随せず、
       実測で主ボタンを72%覆っていた */
    const root = document.documentElement.style;
    if (on) {
      const h = Math.round(dock.getBoundingClientRect().height);
      if (h > 0) root.setProperty("--mz-dock-h", h + "px");
    } else {
      root.removeProperty("--mz-dock-h");
    }
  }

  /* ---- 描画の保証: 画面を止める処理の直前に必ず呼ぶ ----
     MessageChannel だけではペイント完了までは保証されないため、rAF を2回挟む。
     ただし非表示タブ(アプリを切り替えた等)ではrAFが来ないので、
     一定時間で必ず先へ進める(ここで待ち続けると処理そのものが止まってしまう) */
  function paint() {
    return new Promise(res => {
      let done = false;
      const finish = () => { if (!done) { done = true; res(); } };
      setTimeout(finish, 250);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const ch = new MessageChannel();
        ch.port1.onmessage = finish;
        ch.port2.postMessage(0);
      }));
    });
  }

  /* 長いファイル名を丸める(先頭12字+…+拡張子) */
  function shortName(name) {
    if (!name) return "";
    if (name.length <= 20) return name;
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";
    return name.slice(0, 12) + "…" + ext;
  }

  function fmtEta(sec) {
    if (!isFinite(sec) || sec < 0) return "";
    if (sec < 10) return "まもなく完了";
    if (sec < 60) return `残り約${Math.ceil(sec / 10) * 10}秒`;
    return `残り約${Math.ceil(sec / 60)}分`;
  }

  /* 予想の終了時刻。長い処理では「あと何分」より「何時に終わるか」の方が
     待てる(2026-07-21 優さん指示)。1分未満は出さない(秒単位で揺れて不安になる) */
  function fmtEndAt(sec) {
    if (!isFinite(sec) || sec < 60) return "";
    const d = new Date(Date.now() + sec * 1000);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}頃終わり`;
  }

  class Handle {
    constructor(o) {
      this.opt = o;
      this.t0 = performance.now();
      this.ratio = 0;
      this.steps = o.steps || 0;
      this.stepNo = o.steps ? 1 : 0;
      this.label = o.label || "";
      this.sub = o.sub || "";
      this.eta = null;
      this.state = "run";
      this.closed = false;
      this.el = null;
      this.mountEl = typeof o.mount === "string" ? document.querySelector(o.mount) : o.mount;
      this._delayTm = setTimeout(() => this._mount(), o.delay == null ? DEFAULT_DELAY : o.delay);
      /* 「時間がかかっています」を出すまでの時間。呼び出し側が所要を知っている
         処理(書き出しは設計上10〜15分)では 0 を渡して黙らせる ─ 既定の8秒で
         出すと、正常な待ちの間ずっと異常を宣告し続けることになる(2026-07-26) */
      const slowMs = o.slowMs == null ? SLOW_MS : o.slowMs;
      this._slowTm = slowMs > 0
        ? setTimeout(() => { this._slow = true; this._render(); }, slowMs) : 0;
      this._cancelTm = o.cancel
        ? setTimeout(() => { this._cancelable = true; this._render(); }, CANCEL_MS) : 0;
      if (current && !current.closed) current.close();   // 前の進捗が残っていたら片付ける
      current = this;
    }

    _mount() {
      if (this.closed || this.el || !this.mountEl) return;
      const el = document.createElement("div");
      el.className = "mzp";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML =
        '<div class="mzp-head">' +
          '<span class="mzp-step"></span>' +
          '<span class="mzp-label"></span>' +
          '<span class="mzp-pct"></span>' +
        '</div>' +
        '<div class="mzp-track"><div class="mzp-fill"></div></div>' +
        '<div class="mzp-meta"><span class="mzp-sub"></span><span class="mzp-eta"></span></div>' +
        '<button type="button" class="mzp-cancel">中止する</button>';
      this.mountEl.textContent = "";
      this.mountEl.appendChild(el);
      this.el = el;
      el.querySelector(".mzp-cancel").onclick = () => {
        el.querySelector(".mzp-cancel").disabled = true;
        el.querySelector(".mzp-label").textContent = "中止しています…";
        if (this.opt.cancel) this.opt.cancel();
      };
      // インラインが画面外へ出たらミニバーを出す(スクロールで見失わないように)
      if ("IntersectionObserver" in window) {
        this._io = new IntersectionObserver(es => {
          if (this.closed || this.state === "chip") return;
          showDock(!es[0].isIntersecting);
        }, { rootMargin: "-24px 0px -24px 0px", threshold: 0 });
        this._io.observe(el);
        dockIO = this._io;
      }
      this._render();
    }

    _render() {
      if (this.closed) return;
      const running = this.state === "run";
      const pctTxt = (running && this.ratio > 0)
        ? `${Math.min(99, Math.max(2, Math.round(this.ratio * 100)))}%` : "";
      let sub = this.sub;
      if (this.state === "frozen" && !sub) sub = "この間、数秒だけ画面が止まります";
      if (this._slow && running && !sub) sub = "時間がかかっています。そのままお待ちください";
      let etaTxt = this._etaVisible() ? fmtEta(this.eta) : "";
      if (etaTxt) {
        const at = fmtEndAt(this.eta);
        if (at) etaTxt += ` / ${at}`;
      }
      /* 段表示は「いま何段目か」であって、バーが確定進捗かどうかとは別の話。
         run だけを条件にすると `p.step(n,...).pulse()` の呼び方で
         step() が描いた直後に pulse() が同じtickで消してしまい、段表示が
         一度も画面に出ない(2026-07-26。おまかせの段数を入れた当日に発覚) */
      const alive = running || this.state === "pulse" || this.state === "frozen";
      const stepTxt = (this.steps && alive) ? `${this.stepNo}/${this.steps}` : "";
      const width = `${Math.max(2, Math.round((this.state === "done" ? 1 : this.ratio) * 100))}%`;

      if (this.el) {
        const el = this.el;
        el.dataset.state = this.state;
        el.classList.toggle("is-cancelable", !!this._cancelable && running);
        el.querySelector(".mzp-step").textContent = stepTxt;
        el.querySelector(".mzp-label").textContent = this.label;
        el.querySelector(".mzp-pct").textContent = pctTxt;
        el.querySelector(".mzp-sub").textContent = sub;
        el.querySelector(".mzp-eta").textContent = etaTxt;
        /* pulse/frozen へ戻ったらインラインの width を捨てて CSS(34%+スライド)に返す。
           残したままだと、直前が99%だった場合に「幅99%の帯を -115%〜315% へ
           動かす」になり、周期の大半で帯が枠の外に出て空の溝に見える。
           おまかせの「カットを割っています…」(director.js:63)が実際にこれだった */
        setFill(el.querySelector(".mzp-fill"), running || this.state === "done", width);
      }
      if (dock && dock.classList.contains("show")) {
        dock.dataset.state = this.state;
        dock.querySelector(".mzp-dock-chapter").textContent = this.opt.chapter || "";
        dock.querySelector(".mzp-dock-label").textContent = this.label;
        dock.querySelector(".mzp-dock-pct").textContent = pctTxt;
        setFill(dock.querySelector(".mzp-dock-fill"), running || this.state === "done", width);
      }
    }

    _etaVisible() {
      if (this.eta == null || this.state !== "run") return false;
      if (performance.now() - this.t0 < ETA_GIVEN_MIN_MS) return false;
      /* 呼び出し側が実測から eta を渡してきたなら、進捗の比率で止めない。
         書き出しは10〜15分かかるので ratio>10% に届くのが約2分後になり、
         「あと何分か」を一番知りたい最初の2分だけ画面から時間が消えていた
         (2026-07-26)。自前推定(比率から割り戻す)のときだけ従来の門を残す */
      if (this._etaGiven) return true;
      return performance.now() - this.t0 > ETA_MIN_MS && this.ratio > ETA_MIN_RATIO;
    }

    _apply(o) {
      if (!o) return;
      if (o.sub !== undefined) this.sub = o.sub;
      if (o.eta !== undefined) { this.eta = o.eta; this._etaGiven = true; }
      if (o.cancelable) this._cancelable = true;
    }

    /* ---- 確定進捗 ---- */
    set(ratio, label, o) {
      if (isFinite(ratio)) this.ratio = Math.max(0, Math.min(1, ratio));
      if (label) this.label = label;
      this.state = "run";
      this._apply(o);
      if (!o || o.eta === undefined) {   // 呼び出し側が渡さないときは経過から推定
        const el = (performance.now() - this.t0) / 1000;
        this.eta = this.ratio > 0.02 ? el / this.ratio - el : null;
      }
      this._render();
      return this;
    }

    /* ---- 件数進捗 ---- */
    count(i, n, o) {
      this.ratio = n ? i / n : 0;
      this.state = "run";
      const unit = (o && o.unit) || "件目";
      const name = o && o.name ? "・" + shortName(o.name) : "";
      this.sub = n > 1 ? `${i} / ${n} ${unit}${name}` : (name ? name.slice(1) : "");
      if (o) this._apply({ eta: o.eta, cancelable: o.cancelable });
      this._render();
      return this;
    }

    /* ---- 段階を進める ---- */
    step(n, label, o) {
      this.stepNo = n;
      if (label) this.label = label;
      this.state = "run";
      this._apply(o);
      this._render();
      return this;
    }

    /* ---- 不確定(画面は生きている) ---- */
    pulse(label, o) {
      if (label) this.label = label;
      this.state = "pulse";
      this.eta = null;
      this._apply(o);
      this._render();
      return this;
    }

    /* ---- 凍結(画面が止まる。呼んだあと MZP.paint() してから重い処理へ) ---- */
    frozen(label, o) {
      if (label) this.label = label;
      this.state = "frozen";
      this.eta = null;
      // 前の副文言が残っていると停止予告が出せないので、明示指定が無ければ空に戻す
      this.sub = (o && o.sub) || "";
      this._apply(o);
      this._mount();   // 止まる前に必ず出す(遅延表示を待たない)
      this._render();
      return this;
    }

    done(msg, o) {
      if (this.closed) return this;
      this._clearTimers();
      this.state = "done";
      this.ratio = 1;
      if (msg) this.label = msg;
      this.sub = (o && o.sub) || "";
      this._mount();   // 遅延中に終わった場合も完了だけは見せる
      this._render();
      showDock(false);
      if (current === this) current = null;
      if (o && o.chip === false) { setTimeout(() => this.close(), 900); return this; }
      setTimeout(() => {
        if (this.closed || !this.el) return;
        this.state = "chip";
        this.el.dataset.state = "chip";
        this._detachIO();
      }, CHIP_MS);
      return this;
    }

    fail(msg, o) {
      this._clearTimers();
      this.state = "fail";
      this.label = msg || "うまくいきませんでした";
      this.sub = (o && o.sub) || "";
      this._mount();
      this._render();
      showDock(false);
      if (this.el && o && o.retry) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mzp-retry";
        b.textContent = "もう一度ためす";
        b.onclick = () => { const f = o.retry; this.close(); f(); };
        this.el.appendChild(b);
      }
      if (this.el && o && o.detail) {
        const d = document.createElement("details");
        d.className = "mzp-detail";
        const s = document.createElement("summary");
        s.textContent = "詳しく";
        const p = document.createElement("p");
        p.textContent = o.detail;   // textContentで入れる(内容をそのままHTMLにしない)
        d.appendChild(s); d.appendChild(p);
        this.el.appendChild(d);
      }
      if (current === this) current = null;
      return this;
    }

    close() {
      this._clearTimers();
      this._detachIO();
      this.closed = true;
      if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
      this.el = null;
      showDock(false);
      if (current === this) current = null;
    }

    _detachIO() {
      if (this._io) { this._io.disconnect(); if (dockIO === this._io) dockIO = null; this._io = null; }
    }
    _clearTimers() {
      clearTimeout(this._delayTm); clearTimeout(this._slowTm); clearTimeout(this._cancelTm);
    }

    /* ---- 既存コールバックのアダプタ(呼び出し側を書き換えずに繋ぐ) ---- */
    legacy() { return (r, s, o) => this.set(r, s, o); }
    legacyStatus() { return s => (s ? this.pulse(s) : this.done()); }
  }

  return {
    start: o => new Handle(o || {}),
    paint, shortName, fmtEta,
    get current() { return current; },
  };
})();
