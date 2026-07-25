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

    /* ---- ② 画面を点けたままにする ----
       want=true で取得、false で解放。何度呼んでも安全（冪等）。
       画面が一度でも消えると OS 側が解放するので、復帰時に取り直す（下の listener）。 */
    _wakeLock: null,
    _wantAwake: false,
    async keepAwake(want) {
      S._wantAwake = !!want;
      try {
        if (want && !S._wakeLock && navigator.wakeLock) {
          S._wakeLock = await navigator.wakeLock.request("screen");
          S._wakeLock.addEventListener("release", () => { S._wakeLock = null; });
        } else if (!want && S._wakeLock) {
          const w = S._wakeLock;
          S._wakeLock = null;
          await w.release();
        }
      } catch (_) {
        // 非対応・省電力モード・非表示タブ等。画面ロック対策なしで続行する
        S._wakeLock = null;
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
  };

  document.addEventListener("visibilitychange", () => {
    S._visEpoch++;
    /* ③ 復帰時の再取得。消灯・アプリ切替で Wake Lock は解放されるため、
       作業中のまま戻ってきたら黙って取り直す */
    if (S._wantAwake && !S._wakeLock && document.visibilityState === "visible") S.keepAwake(true);
  });

  return S;
})();
