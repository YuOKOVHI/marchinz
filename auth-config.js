// Firebase Console > Project settings から設定してください。
// 例:
// window.MLL_AUTH_CONFIG = {
//   firebase: {
//     apiKey: "...",
//     authDomain: "...firebaseapp.com",
//     projectId: "...",
//     storageBucket: "...appspot.com",
//     appId: "...",
//   },
//   appCheck: {
//     // Firebase Console → App Check → Web アプリ → reCAPTCHA v3 の「サイトキー」（公開前提で問題ない）
//     recaptchaSiteKey: "6L…",
//     // ローカルだけ: true にするとブラウザコンソールにデバッグトークンが出る → Console の App Check で登録
//     debug: false,
//     // 登録済みデバッグトークンを文字列で渡す（任意）。debug より優先。
//     // debugToken: "xxxx-xxxx-…",
//   },
//   publicRedirectUrl: "https://marchinz.netlify.app/#mll",
//   adminEmails: ["your-admin@gmail.com"],
// };
window.MLL_AUTH_CONFIG = window.MLL_AUTH_CONFIG || {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    appId: "",
  },
  appCheck: {
    recaptchaSiteKey: "",
    debug: false,
  },
  publicRedirectUrl: "https://marchinz.netlify.app/#mll",
  adminEmails: ["marchinz2026@gmail.com"],
};
