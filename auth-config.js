// Firebase Console > Project settings / App Check から設定してください。
window.MLL_AUTH_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAb_Su40o_uVll_cu5gbBrB8rDqB2fYj5Q",
    authDomain: "marchinz.netlify.app",
    projectId: "marchinz-app",
    storageBucket: "marchinz-app.firebasestorage.app",
    appId: "1:772638244522:web:e93a75bc4b79225cb81ad3",
  },
  publicRedirectUrl: "https://marchinz.netlify.app/#top",
  adminEmails: ["marchinz2026@gmail.com"],
  // App Check（reCAPTCHA v3）。空のままでは初期化しない（既存ユーザーへの影響なし）。
  // 1) reCAPTCHA v3 サイトキーを発行し recaptchaSiteKey に設定
  // 2) Firebase Console → App Check で Web アプリ登録・メトリクス確認
  // 3) 問題なければ Firestore / Storage の Enforcement を有効化
  // localhost: debug: true でデバッグトークンを Console に登録するか debugToken を指定
  appCheck: {
    recaptchaSiteKey: "6Lf2VfgsAAAAAMoZDrtHVRz_bbAGjiKxk4E7tNjy",
    debug: false,
    debugToken: "",
  },
};
