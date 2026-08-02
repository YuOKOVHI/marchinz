"use strict";
/* ============ クリエイターツール共通: 長い作業のセッション保護 ============
   同期・解析・書き出しはどれも「このタブが生きて、見えたままであること」が前提。
   その前提が崩れる3つの現実を、まとめてここで面倒みる。

   ① タブを閉じる/リロードされる      → beforeunload で一度だけ引き止める
   ② 画面がロックされる               → Wake Lock。消えると rAF もデコーダも止まる
   ③ 通知を開いて Safari ごと凍結する → タイマーだけが期限切れで先に発火し、
                                        まだ健全な処理を「応答なし」で殺す

   ■ ③ について（2026-07-24 優さん実機報告）
   書き出し中に LINE 等の通知を開くと、iOS Safari はタブごと凍結する
   （setTimeout も Worker も止まる）。復帰した瞬間、たまっていた setTimeout が
   worker の応答より先に発火し、成功しかけていた書き出しが中断された。
   patientTimeout は「隠れていた事実があれば測り直す」ことでこれを避ける。
   見えたままの本物のハングは、従来どおり ms で打ち切る。

   ■ なぜ共通化したか（2026-07-25）
   ①②③はすべて Switcher にしか無く、Privacy / ReAngle には**ゼロ**だった。
   同じ iPhone で同じ長さの書き出しをするツールなのに、片方だけが守られていた。
   Wake Lock は Switcher と Vlog がそれぞれ別に実装していた（内容は同じ）。
   demux と同じ「4回フォークした4製品」の症状なので、同じ日に1本へ寄せた。

   ■ 使い方
     <script src="/tools/shared/session.js"></script>
     ...
     try {
       MZ_SESSION.guardLeave(true);    // 離脱ガード + 画面を消させない
       await 重い処理();
     } finally {
       MZ_SESSION.guardLeave(false);   // 必ず finally で戻す
     }
   タイムアウトを仕掛けるときは setTimeout ではなくこちらを使う:
     const cancel = MZ_SESSION.patientTimeout(() => 諦める処理(), 8000);
     ... 成功したら cancel();

   効かない環境（Wake Lock 非対応・省電力モード・非表示タブ）では静かに諦める。
   処理そのものは決して止めない。 */

window.MZ_SESSION = (() => {

  const S = {
    /* 画面が隠れた回数。patientTimeout が「隠れていた事実」を知るための世代番号。
       テストから直接いじれるよう、あえてクロージャではなくプロパティに置く */
    _visEpoch: 0,

    /* ---- ③ 隠れていた時間を数えないタイムアウト ---- */
    patientTimeout(fn, ms) {
      let epoch = S._visEpoch;
      let tm;
      const fire = () => {
        if (document.visibilityState === "hidden" || S._visEpoch !== epoch) {
          epoch = S._visEpoch;   // 隠れていた間は無かったことにして再計測
          tm = setTimeout(fire, ms);
          return;
        }
        fn();
      };
      tm = setTimeout(fire, ms);
      return () => clearTimeout(tm);
    },

    /* ---- ②' Wake Lock を断られた端末の代替: 極小動画の再生 ----
       (2026-08-02 実機: iPhoneの低電力モードは wakeLock.request を
       "Permission was denied" で断る。画面が消える → Safari ごと凍結 →
       復帰した瞬間に見張りが306秒の空白を見て書き出しを止める、が実際に起きた)

       ★ 効く条件は WebKit の実装で決まっている(HTMLMediaElement::
       shouldDisableSleep / mediaType / canProduceAudio を実読 2026-08-02):
       ・loop だと問答無用で消灯を抑止しない(loop() → SleepType::None)
       ・muted / volume=0 だと canProduceAudio()=false → VideoAudio 扱いに
         ならず抑止しない
       ・映像+音声の両トラックが必要(video-only も抑止しない)
       つまり「muted な video-only の loop」は3重に無効。NoSleep.js が
       muted にせず・loop にせず・timeupdate で先頭へ巻き戻すのは全部このため。

       下の _WAKE_MP4 は 64x64 H.264(6fps) + 無音のAAC(12kHz mono, 各4Bの
       無音フレーム)の2秒・約2KB。afconvert(macOS標準)で無音AACを作り、
       Pythonで映像トラックと結合した(箱構造・NAL整合は再パースで検証済み)。
       音声トラックは**入っているが中身は完全な無音**なので何も鳴らない。

       muted にしないため play() にはユーザー操作の活性が要る。おまかせは
       タップ起点なので初回は通る見込み。断られたら次のタップで再挑戦する
       (_wakeRetryOn)。一度ユーザー操作で再生できた <video> は、以後は
       操作なしで play() し直せる(WebKitは制限を要素ごとに解除する)ので、
       復帰時の再生し直しは同じ要素を使い回す。

       デコーダの口を1つ使うが、競合はしない根拠:
       ・書き出し中は parkVideoElements() がプレビューの <video> 3本を
         手放している(src を外す)ので、この1本は**3本の跡地に1本**でしかない
       ・64x64@6fps は 1080p の 1/500 以下の画素数。iOSのHWデコーダは
         解像度合計で律速されるため、実質ゼロ負荷
       ・エンコーダ(VideoEncoder)とは別資源

       display:none や画面外(left:-9999px)は iOS が「見えていない動画」として
       止めるため、1〜2px を右下に不透明度1%で置く。 */
    _wakeVideo: null,
    _videoAwake: false,
    _WAKE_MP4: "data:video/mp4;base64,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",
    /* play() がユーザー操作の活性切れで断られたとき、次のタップで再挑戦する */
    _wakeRetryFn: null,
    _wakeRetryOn() {
      if (S._wakeRetryFn) return;
      const fn = () => {
        S._wakeRetryOff();
        const v = S._wakeVideo;
        if (S._wantAwake && v && v.paused) {
          Promise.resolve(v.play()).then(() => {
            if (S._wakeVideo === v) S._videoAwake = true;
          }).catch(() => { S._wakeRetryOn(); });
        }
      };
      S._wakeRetryFn = fn;
      document.addEventListener("touchend", fn, true);
      document.addEventListener("pointerdown", fn, true);
    },
    _wakeRetryOff() {
      const fn = S._wakeRetryFn;
      if (!fn) return;
      S._wakeRetryFn = null;
      document.removeEventListener("touchend", fn, true);
      document.removeEventListener("pointerdown", fn, true);
    },
    async _wakeVideoStart() {
      /* 二重に立てない。既にあるのに止まっていたら(隠れたタブでOSが
         止めるのは実測済み)、再生だけやり直す */
      if (S._wakeVideo) {
        const v0 = S._wakeVideo;
        if (v0.paused) {
          try {
            await v0.play();
            /* play() を待つ間に keepAwake(false) が来ていたら成功扱いにしない */
            if (S._wakeVideo === v0) { S._videoAwake = true; S._wakeRetryOff(); }
          } catch (e) {
            if (S._wakeVideo === v0) S._wakeRetryOn();
          }
        }
        return S._videoAwake;
      }
      let v = null;
      try {
        v = document.createElement("video");
        /* muted にも loop にもしない(上の WebKit 実読メモ)。音声トラックは
           完全な無音なので、muted でなくても何も鳴らない */
        v.playsInline = true;
        v.setAttribute("playsinline", "");
        v.volume = 1;                       // volume=0 も抑止が効かなくなる
        v.setAttribute("aria-hidden", "true");
        v.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;" +
                          "opacity:0.01;pointer-events:none;z-index:-1;";
        /* loop の代わり: 終端に着く前に少し巻き戻す(NoSleep.js と同じ)。
           終端に着くと sentEndEvent でも抑止が切れるため、ended にも保険 */
        v.addEventListener("timeupdate", () => {
          if (v.currentTime > 1) v.currentTime = 0.01 + Math.random() * 0.3;
        });
        v.addEventListener("ended", () => {
          if (S._wakeVideo === v && S._wantAwake) {
            Promise.resolve(v.play()).catch(() => {});
          }
        });
        v.src = S._WAKE_MP4;
        (document.body || document.documentElement).appendChild(v);
        S._wakeVideo = v;
        await v.play();
        /* play() を待つ間に keepAwake(false) が来ていたら、成功扱いにしない */
        if (S._wakeVideo !== v) return false;
        S._videoAwake = true;
        S._wakeRetryOff();
        if (window.MC && MC.log) MC.log("画面は動画の再生で点けたままにします(Wake Lockの代役)");
      } catch (e) {
        /* 要素は残す(次のタップ・復帰時に同じ要素で再挑戦するため)。
           片づけは keepAwake(false) → _wakeVideoStop() の仕事 */
        if (S._wakeVideo === v) S._wakeRetryOn();
        if (window.MC && MC.log) MC.log("代役の動画も再生できません: " + ((e && (e.message || e.name)) || e));
      }
      return S._videoAwake;
    },
    _wakeVideoStop() {
      S._wakeRetryOff();
      const v = S._wakeVideo;
      S._wakeVideo = null;
      S._videoAwake = false;
      if (!v) return;
      try { v.pause(); } catch (e) {}
      try { v.removeAttribute("src"); if (v.load) v.load(); } catch (e) {}   // デコーダを確実に返す
      try { if (v.remove) v.remove(); } catch (e) {}
    },

    /* ---- ② 画面を点けたままにする ----
       want=true で取得、false で解放。何度呼んでも安全（冪等）。
       画面が一度でも消えると OS 側が解放するので、復帰時に取り直す（下の listener）。 */
    _wakeLock: null,
    _wantAwake: false,
    async keepAwake(want) {
      S._wantAwake = !!want;
      try {
        if (want && !S._wakeLock && navigator.wakeLock) {
          /* ★ 自分の錠前かどうかを見てから消す(2026-08-01 レビュー)。
             前は共有の S._wakeLock をそのまま null にしていた。
             解放 → すぐ取り直し、の順に起きると（自走の終わりに一度返して
             書き出しの頭でまた取る、がまさにこれ）、**新しい錠前を持ったまま**
             古い解放通知が来て null にしてしまう。以後 awake が嘘になり、
             次の復帰でもう1本重ねて取る ─ 解放されるのは最後の1本だけ */
          const lk = await navigator.wakeLock.request("screen");
          lk.addEventListener("release", () => { if (S._wakeLock === lk) S._wakeLock = null; });
          S._wakeLock = lk;
        } else if (!want && S._wakeLock) {
          const w = S._wakeLock;
          S._wakeLock = null;
          await w.release();
        }
        if (S._wakeLock) {
          S._wakeDenied = null;
          S._wakeVideoStop();       // 本物の錠前が取れたら代役は返す(デコーダを空ける)
        } else if (want && !navigator.wakeLock) {
          /* 仕組みそのものが無い端末(旧iOS等)も、代役の動画で点けたままにする */
          await S._wakeVideoStart();
        }
        if (!want) S._wakeVideoStop();
      } catch (e) {
        /* ★ 黙って諦めない(2026-08-01 実機)。iPhoneは低電力モードだと
           画面消灯の抑止を断る。断られたことが分からないと
           「おまかせの最中に勝手に落ちる」という形でしか現れず、
           原因に辿り着けない。断られた事実を残し、画面から言えるようにする */
        S._wakeLock = null;
        S._wakeDenied = want ? ((e && (e.message || e.name)) || "理由不明") : null;
        if (want && window.MC && MC.log) MC.log("画面の消灯を止められません: " + S._wakeDenied);
        /* ★ 断られたら代役を立てる(2026-08-02 実機: 低電力モードの
           "Permission was denied")。代役が回っていれば実際に画面は消えないので、
           awake=true / wakeDenied=null として扱う(下のゲッター)。
           代役まで失敗したときだけ、従来の「ときどき画面を触ってください」が出る */
        if (want) await S._wakeVideoStart();
        if (!want) S._wakeVideoStop();
      }
    },

    /* ---- ① 作業中の離脱を引き止める + ② をまとめて面倒みる ----
       文言はブラウザ側が決める（独自文字列は無視される）。
       ツール固有の見た目（帯・中断ノート等）はここには置かない。呼び出し側の責任。 */
    _guarded: false,
    _onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    },
    guardLeave(on) {
      on = !!on;
      if (on === S._guarded) return;
      S._guarded = on;
      if (on) {
        window.addEventListener("beforeunload", S._onBeforeUnload);
        S.keepAwake(true);
      } else {
        window.removeEventListener("beforeunload", S._onBeforeUnload);
        S.keepAwake(false);
      }
    },

    /* いま作業中とみなされているか（呼び出し側が状態を二重に持たなくて済む） */
    get guarded() { return S._guarded; },
    /* いま画面の消灯を止められているか。止められないなら呼び出し側が案内を出す。
       ★ 代役の動画が回っていれば true(実際に画面は消えない)。
       wakeDenied も同様に null を返し、#asWake の警告は
       「本命も代役も両方だめだったとき」だけ出る(意味を変えない) */
    get awake() { return !!S._wakeLock || S._videoAwake; },
    get wakeDenied() { return S._videoAwake ? null : (S._wakeDenied || null); },
  };

  document.addEventListener("visibilitychange", () => {
    S._visEpoch++;
    /* ③ 復帰時の再取得。消灯・アプリ切替で Wake Lock は解放されるため、
       作業中のまま戻ってきたら黙って取り直す。
       代役の動画も、隠れている間は OS に止められることがあるので、
       keepAwake(true) → _wakeVideoStart() の「止まっていたら再生し直す」が効く
       (同じ要素の play() し直しは、一度ユーザー操作で再生できていれば操作なしで通る) */
    if (S._wantAwake && document.visibilityState === "visible" &&
        (!S._wakeLock || (S._wakeVideo && S._wakeVideo.paused))) S.keepAwake(true);
  });

  return S;
})();
