"use strict";
/* ============ ユーザータイプ(だれ向けの画面にするか) ============
   ①マーチングファン ②マーチングプレイヤー ③クリエイター/スタッフ の3つ。
   TOPの並びとメニューの見せ方を、その人がいちばん使うものから並べるために使う。

   設計の要点(2026-07-21 優さん指示):
   - 既定は必ず「ファン」。未設定・不明な値・読み取り失敗はすべてファンに倒す。
     すでに登録済みの人も、何もしなければファンとして扱う(移行で驚かせない)
   - 登録時に選べる。選ばなければファン
   - あとから設定で変更できる
   - 保存は2層:
       localStorage … 画面の即時反映用。ログインしていなくても効く
       Firestore    … ログイン中の人の正本(端末をまたいで持ち回る)
     読むときは localStorage を先に見る(描画をFirestore待ちにしない)

   既存の profile_attributes(プレイヤー/指導者/保護者…の複数選択)とは別物。
   あちらは「プロフィールに出す肩書き」、こちらは「画面の出し分け」。
   混ぜると、肩書きを増やすたびに画面が変わってしまう。 */

window.MZUserType = (() => {
  const KEY = "mz_user_type_v1";
  const DEFAULT = "fan";

  const TYPES = Object.freeze({
    fan: {
      id: "fan",
      label: "マーチングファン",
      short: "ファン",
      desc: "見る・応援する。大会動画やメディアを中心に",
      icon: "fa-heart",
    },
    player: {
      id: "player",
      label: "マーチングプレイヤー",
      short: "プレイヤー",
      desc: "演奏する・練習する。練習記録や仲間とのやりとりを中心に",
      icon: "fa-drum",
    },
    creator: {
      id: "creator",
      label: "クリエイター / スタッフ",
      short: "クリエイター",
      desc: "撮る・作る・運営する。制作ツールやイベント運営を中心に",
      icon: "fa-camera",
    },
  });

  const isValid = v => Object.prototype.hasOwnProperty.call(TYPES, String(v || ""));

  /* 保存されている値。未設定・不正・読めない場合は null(「まだ選ばれていない」) */
  function readLocal() {
    try {
      const v = localStorage.getItem(KEY);
      return isValid(v) ? v : null;
    } catch (_) { return null; }   // プライベートモード等
  }

  /* いまのタイプ。何があっても必ず有効な値を返す */
  function get() { return readLocal() || DEFAULT; }

  function info(id) { return TYPES[isValid(id) ? id : DEFAULT]; }

  /* 変更を知らせる。TOP・メニュー・設定が同じ出来事を見て描き直せるようにする
     (呼び出し側が互いを知らなくて済む) */
  function emit(type) {
    document.documentElement.setAttribute("data-mz-usertype", type);
    try {
      window.dispatchEvent(new CustomEvent("mz:usertype", { detail: { type } }));
    } catch (_) {}
  }

  /* 保存。ログイン中なら Firestore にも書くが、画面は待たせない */
  function set(type, opts) {
    const next = isValid(type) ? type : DEFAULT;
    try { localStorage.setItem(KEY, next); } catch (_) {}
    emit(next);
    if (!(opts && opts.skipRemote)) saveRemote(next);
    return next;
  }

  function saveRemote(type) {
    const auth = window.MLL_AUTH;
    if (!auth || !auth.getUser || !auth.getDb) return;
    const user = auth.getUser();
    const db = auth.getDb();
    if (!user || !user.id || !db) return;
    try {
      db.collection("mll_profiles").doc(user.id).set(
        { user_type: type, updated_at: new Date().toISOString() },
        { merge: true }
      ).catch(() => { /* 通信できなくても localStorage で動く */ });
    } catch (_) {}
  }

  /* ログイン時に呼ぶ。Firestore の値を取り込む。
     未設定(既存ユーザー)なら「ファン」を書き戻して以後ブレないようにする */
  function adoptRemote(data) {
    const remote = data && data.user_type;
    if (isValid(remote)) {
      try { localStorage.setItem(KEY, remote); } catch (_) {}
      emit(remote);
      return remote;
    }
    /* リモート未設定。ここで無条件に「ファン」を書くと、ログイン前に選んだ値や、
       通信できずに保存しそこねた値が、ログインのたびに巻き戻る。
       手元に選ばれた値があるならそれを正とし、リモートへ書き戻す */
    const local = readLocal();
    const cur = local || DEFAULT;
    try { localStorage.setItem(KEY, cur); } catch (_) {}
    emit(cur);
    saveRemote(cur);   // 既存の登録者はここで「ファン」が確定する(優さん指示)
    return cur;
  }

  /* 登録の途中で選んだ値。ログイン完了後に拾って保存する
     (登録フローはページ遷移をまたぐため、sessionStorageで持ち回る) */
  const PENDING = "mz_pending_user_type";
  function setPending(type) {
    try { sessionStorage.setItem(PENDING, isValid(type) ? type : DEFAULT); } catch (_) {}
  }
  function takePending() {
    try {
      const v = sessionStorage.getItem(PENDING);
      sessionStorage.removeItem(PENDING);
      return isValid(v) ? v : null;
    } catch (_) { return null; }
  }

  // 起動時に属性を入れておく(CSSで出し分けたい箇所のため)
  emit(get());

  return { TYPES, DEFAULT, get, set, info, isValid, adoptRemote, setPending, takePending };
})();
