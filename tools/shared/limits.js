"use strict";
/* ============ 端末の見分け（唯一の正本 2026-08-01） ============
   同じ規則が4箇所に散っていた ─ state.js(MC.isIOS) / visual.js×2(SIMD回避) /
   このファイル(上限の判定)。UAの書式が変わったとき、直し漏れた場所だけが
   別の答えを返す。このセッションだけで「規則が2実装に割れて静かに壊れる」を
   何度も踏んでいるので、ここに1つだけ置く。

   ★ limits.js は全ツールで最初に読まれる(index.html の script 順)。
     だから端末判定はここに置ける ─ 逆に state.js へ置くと共有側から見えない */
window.MZDevice = (() => {
  const ua = navigator.userAgent || "";
  /* iPadは「デスクトップ用サイトを表示」が既定なので UA では Mac に見える。
     タッチ点数で見分ける */
  const iPadDesktopUA = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const ios = /iP(hone|ad|od)/.test(ua) || iPadDesktopUA;
  const mobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || iPadDesktopUA;
  /* iOS/Safari 16.4 の SIMD 誤答バグ。顔検出(ONNX)で誤った結果を返す */
  const m = ua.match(/(?:iPhone|iPad).*OS (\d+)_(\d+)/);
  const simdBroken = (!!m && +m[1] === 16 && +m[2] === 4) || iPadDesktopUA;
  return { ua, iPadDesktopUA, ios, mobile, bigDevice: !mobile, simdBroken };
})();

/* ============ クリエイターツール共通: 取り込み・書き出し制限 ============
   会員種別(ゲスト/登録/管理者)と**端末(スマホ・タブレット / パソコン)**の
   2軸で決める(2026-07-31 優さん指示)。

     　　　　　　　　　書き出し          取り込み(1本)
     ゲスト(端末問わず)   30秒              5分
     登録 × スマホ         30秒 or 60秒     5分
     登録 × パソコン      10分              15分
     管理者・手元環境     上限なし          上限なし
     ※取り込める本数は全員 3本まで
     ※自動スイッチング × スマホ は 30秒(**登録しても伸びない技術的な天井**)
       縦型・ワイプは登録すれば 60秒 を選べる

   端末を軸に入れた理由: スマホは動画を丸ごとメモリに載せるため、長い書き出しが
   途中で落ちる(iPhone実機で8分12秒が62%で停止)。落ちる長さを許可しておいて
   「落ちました」と言うより、最初から届く長さだけを見せる方が親切。
   ゲストは端末に関わらず30秒(登録の壁を端末でブレさせない)。
   登録×スマホは30秒か60秒を「長さと始まり」で選ぶ(2026-08-05 優さん指示)。
   スマホの登録メリット = 書き出し60秒 + 「別のシーン」が何本でも
   (maxExtraScenes: ゲスト1本 → 無制限)。こだわりはPC×登録限定(proAllowed)。

   書き出しは3つの長さから選ぶ方式にした(EXPORT_PRESETS)。上限を超える
   プリセットは鍵つきで見せ、「登録すると/パソコンだと使える」と伝える。

   Privacyの動画は作業範囲方式(最大60秒を選ぶ)のため、誰でも10分まで。

   本体サイト(auth.js)が管理者ログイン時に localStorage へ印を書き、
   ツール側(同一オリジン)はそれを読むだけ。ツールにFirebase SDKを読ませない
   (ツールは端末内完結・軽量が売りのため)。
   開発中(localhost / file:// で開いているとき)も同じく上限なしで動かす。

   ※この上限はあくまで端末の負荷・誤操作を防ぐための目安で、秘密を守る仕組みではない。
     長尺・大量の素材はブラウザのメモリを使い切って落ちることがある。 */

window.MZ_LIMITS = (() => {
  const KEY = "mz_admin_unlimited_v1";
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // 印は30日で失効(共有端末での置き去り対策)
  let admin = false;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    admin = Boolean(raw && raw.admin && Date.now() - (raw.ts || 0) < MAX_AGE_MS);
  } catch (e) { admin = false; }

  // 登録ユーザー(ログイン中)の印。本体サイトのauth.jsがログイン時に書き、ログアウトで消す
  let member = false;
  let beta = false;   // βテスト参加者(2026-07-23)。auth.js が印に beta を書く
  try {
    const raw = JSON.parse(localStorage.getItem("mz_member_v1") || "null");
    member = Boolean(raw && raw.member && Date.now() - (raw.ts || 0) < MAX_AGE_MS);
    beta = member && Boolean(raw && raw.beta);
  } catch (e) { member = false; beta = false; }

  // 手元で開いているとき(開発・動作確認用)。本番ドメインでは決してtrueにならない。
  // 私用IPは「10.example.com」のような外部ドメインを拾わないよう、IPv4の形を確かめてから判定する
  const host = location.hostname;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  const privateIp = Boolean(ip) && (
    ip[1] === "10"
    || (ip[1] === "192" && ip[2] === "168")
    || (ip[1] === "172" && Number(ip[2]) >= 16 && Number(ip[2]) <= 31)
  );
  const local = location.protocol === "file:"
    || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
    || /\.local$/i.test(host)
    || privateIp;

  const unlimited = admin || local;

  /* 端末の種別。スマホ・タブレットか、パソコンか(2026-07-31)。
     iPadは「デスクトップ用サイトを表示」が既定なので UA では Mac に見える。
     タッチ点数で見分ける(Privacy/visual.js が SIMD 判定で使っているのと同じ手) */
  const { mobile, bigDevice } = window.MZDevice;   // 判定は上の1箇所だけ

  /* βテスト参加者の特典・上限拡大は**ここで beta を参照して**足す(2026-07-23)。
     例: maxExportSec: unlimited ? Infinity : beta ? 900 : ...
     将来の有料会員も同じ型(profileの属性→auth.jsが印→ここで参照)で1箇所に集める */
  const L = {
    admin, local, member, beta, unlimited, mobile, bigDevice,
    /* Privacyの動画モザイクを使える人。privacy/js/ui.js と Switcher の
       renderFaceNote が**両方ここを見る**(2026-07-31)。以前は条件のコピーが
       2箇所にあり、片方を変えるともう片方が嘘になる構造だった */
    privacyVideoAllowed: admin,
    /* 「こだわり」を選べる人。ここ1箇所が正本(条件のコピーを増やさない)。
       ★ 2026-08-02 優さん指示「こだわりは、pcだけにしよう」:
         登録ユーザー **かつ パソコン**(bigDevice)。細かい調整のUIはPC向けで、
         スマホは「おまかせ」が本線。admin/手元環境(unlimited)は開発・検証のため
         端末を問わず通す(上限系と同じ扱い)。
       ★ おまかせは誰でも使える ─ ここで縛るのは「こだわり」だけ */
    proAllowed: unlimited || (member && bigDevice),
    /* 取り込める1本の長さ(ReAngle用)。登録 × パソコン だけ15分、それ以外は5分。
       15分あるのは、複数カメラの回し始めのズレ(実測で最大5分超)を
       吸収したうえでショウ全体が入るようにするため(2026-08-05: 12分→15分) */
    maxVideoSec: unlimited ? Infinity : (member && bigDevice) ? 900.5 : 300.5,
    videoLimitLabel: unlimited ? "上限なし" : (member && bigDevice) ? "15分" : "5分",   // エラーメッセージ用

    /* ---- 取り込める1本の長さ(2026-08-05 優さん指示で 5分/15分 へ) ----
       ★ 2026-07-31 のマーチング4団体レビューでは、入口を5分で弾いていたため
         8分半のランスルーを撮った人が「短く切り出してからお試しください」と
         言われ、その切り出す道具はツールの中に無い、という行き止まりになっていた。
         そこで入口を技術的な天井(スマホ20分/PC40分)まで開けた経緯がある。
       ★ 2026-08-05、優さんの決定で**プランの壁を入口に戻した**(5分/15分)。
         スマホでは8分半のランスルーは取り込めない ─ パソコン(15分)へ誘導する。
         書き出しが30〜60秒になったこととセットの判断。
       ★ maxVideoSec(ReAngle用)と同じ値になったが、意味は別物なので分けたまま
         にする ─ 片方だけ動かしたいときに条件のコピーを作らないため。 */
    maxSourceSec: unlimited ? Infinity : (member && bigDevice) ? 900.5 : 300.5,
    sourceLimitLabel: unlimited ? "上限なし" : (member && bigDevice) ? "15分" : "5分",

    /* 書き出せる長さ(IN〜OUTの範囲)。取り込みとは別枠。
       ゲスト30秒 / 登録×スマホ 60秒 / 登録×パソコン 10分
       (2026-08-05 優さん決定: 59秒→30秒、登録×スマホは 2分→60秒)。
       登録×スマホは 30秒 か 60秒 を「長さと始まり」で選ぶ。
       ※端末のメモリ上限(MC.exporter.MEM_HARD_LIMIT)とは別で、
         実際にはどちらか厳しい方が効く */
    maxExportSec: unlimited ? Infinity
      : !member ? 30
      : bigDevice ? 600 : 60,
    /* ラベルも unlimited を見る。数値は Infinity なのにラベルだけ
       「30秒」と出ていた(管理者は member の印を持たないため。2026-07-31) */
    exportLimitLabel: unlimited ? "上限なし" : !member ? "30秒" : bigDevice ? "10分" : "60秒",
    /* 完成後の「別のシーンも作る」の回数(2026-08-02 優さん決定⑭)。
       ゲストは1本まで・登録は何本でも。判定の正本はここ1箇所で、
       ui.js は renderSceneOffers(表示)と makeAnotherScene(実行)の両方で参照する。
       数えるのはセッション内だけ(リロードでリセットは許容 ─ 別シーンは
       メモリ上の解析が生きている間しか速く作れないので、永続化する意味が薄い) */
    maxExtraScenes: (member || unlimited) ? Infinity : 1,
    /* 登録ユーザーの完成尺。ゲストに「登録すると何分まで作れるか」を
       案内するときにも使うため、ロールに依らない定数として持つ。
       いま使っている端末で登録したらどうなるかを言う(スマホで「10分」と
       言われても、登録しても3分なので嘘になる) */
    memberExportLabel: bigDevice ? "10分" : "60秒",   // 「登録すると」の案内用(unlimitedでは使わない)
    // Privacyの動画は誰でも10分(モザイク作業は選んだ範囲だけのため)
    maxPrivacyVideoSec: unlimited ? Infinity : 600.5,
    maxPhotos: unlimited ? Infinity : member ? 5 : 1,   // 一度に扱える写真の枚数
    maxRangeSec: unlimited ? Infinity : 60,      // Privacyでモザイク作業できる範囲
    minRangeSec: 10,

    /* Vlog(2026-07-20改定): 枠の数・素材尺・完成尺。
       Switcher/ReAngleの maxVideoSec とは別枠で持つ(用途が違うので decouple)。
       写真(maxVlogPhotos)・ロゴ(maxVlogLogos)は現時点でUIが無い先行定義。
       挿入型の写真素材はVlogにまだ実装されていないため、値だけ用意してある。 */
    maxVlogClipSec: unlimited ? Infinity : member ? 600 : 300,     // 1本の尺: 登録10分/ゲスト5分
    vlogClipLimitLabel: member ? "10分" : "5分",
    maxVlogInterviews: member || unlimited ? 3 : 1,
    maxVlogInserts: unlimited ? Infinity : member ? 8 : 4,          // Bロール: 登録8/ゲスト4
    maxVlogLogos: unlimited ? Infinity : member ? 1 : 0,            // ロゴ: 登録1/ゲスト不可
    maxVlogPhotos: unlimited ? Infinity : member ? 8 : 0,           // 写真: 登録8枚/ゲスト不可(未実装枠)
    maxVlogBgm: 3,
    vlogMinSec: 181,                                   // MarchinZのYouTube一覧に載せられる下限(3分01秒)
    vlogMaxSec: unlimited ? Infinity : member ? 300 : 180,          // 完成: 登録5分/ゲスト3分
    vlogBitrate: 8e6,                                  // 書き出しビットレート(将来のexporter用)
  };

  /* ---- 書き出す長さの選択肢(2026-07-31 優さん指示) ----
     「30秒 / 60秒 / 2分 / 8分30秒前後」の4つから選ぶ(2026-08-05)。
     使えないものは**消さずに鍵つきで見せる**。何をすれば使えるようになるかを
     その場で言うため(消してしまうと、そもそも存在に気づけない)。
     full の実尺は「演奏まるごと(最大 maxExportSec)」なので、呼ぶ側が
     演奏の長さで丸める。ここの sec は上限比較と表示のための代表値 */
  /* ★ 30秒を独立した選択肢にした(2026-08-05 優さん指示)。
     「ゲストは30秒 / 登録×スマホは30秒か60秒を最初に選ぶ」という決まりなので、
     縮めた1枚では表せない ─ 30と60が**並んで選べる**必要がある。
     59→60(端数をやめた) */
  L.EXPORT_PRESETS = [
    { id: "s30",   label: "ショート",   sec: 30,  hint: "SNSに投稿しやすい長さ" },
    { id: "short", label: "スタンダード", sec: 60, hint: "1分でまとめる長さ" },
    { id: "mid",   label: "ミドル",     sec: 120, hint: "2分に収める長さ" },
    { id: "full",  label: "まるごと",   sec: 510, hint: "演奏全体", whole: true },
  ];

  /* ---- モードごとの天井(2026-08-04 優さん指示) ----
     「自動スイッチングはスマホでは30秒までに。その分高性能にする」。
     ★ これは**プランの壁ではなく技術的な天井**なので、登録しても伸びない。
       自動スイッチングは全カメラを並行してデコードし、切り替えのたびに
       別のカメラへシークする ─ Switcher の3モードの中でいちばん重い。
       縦型・ワイプは1〜2台しか同時に触らないので、この天井は掛けない。
     ★ 使い方: Switcher 側は maxExportSec を直接読まず、
       maxExportSecFor(MC.S.mode) で聞く。判定の正本はここ1箇所に置く
       (条件のコピーを増やすと、片方を変えたときもう片方が嘘になる) */
  L.SWITCH_MOBILE_SEC = 30;
  /* mode: "switch" | "vertical" | "wipe" | null(モードを問わない) */
  L.modeCapSec = mode =>
    (mode === "switch" && mobile && !unlimited) ? L.SWITCH_MOBILE_SEC : Infinity;
  /* いまの人・いまの端末・いまのモードで書き出せる秒数 */
  L.maxExportSecFor = mode => Math.min(L.maxExportSec, L.modeCapSec(mode));
  /* モードの天井が効いているか(＝登録しても伸びない状況か) */
  L.modeCapped = mode => L.modeCapSec(mode) < L.maxExportSec;
  L.exportLimitLabelFor = mode =>
    L.modeCapped(mode) ? `${L.SWITCH_MOBILE_SEC}秒` : L.exportLimitLabel;

  /* いまの人・いまの端末で使えるかを添えて返す。
     locked のときは「何をすれば使えるか」を1文で持たせる */
  L.exportPresetsFor = mode => {
    const memberHere = bigDevice ? 600 : 60;    // いまの端末で登録したときの上限
    const cap = L.maxExportSecFor(mode);
    const capped = L.modeCapped(mode);
    return L.EXPORT_PRESETS.map(p => {
      const locked = p.sec > cap;
      let unlock = "";
      if (locked) {
        /* ★ 何をすれば使えるかを言う。相手によって道が違う(2026-08-05 優さん指示):
             ゲスト        「登録すると」と「パソコンだと」の**両方**を見せる
             登録×スマホ   「パソコンだと」だけ(登録はもう済んでいる)
             天井が理由    どちらも言わない ─ 登録してもパソコンでも伸びない
           ★ 天井(自動スイッチング×スマホ=30秒)は**プランの壁ではない**ので、
             ここで「登録すれば」と言うと嘘になる。
             失う話(30秒)と得る話(高画質)を同じ一行に置き、
             理由と次の一手は押したときの案内(showUnlockHelp)に持たせる */
        if (capped) unlock = `スマホでは${L.SWITCH_MOBILE_SEC}秒まで（そのぶん高画質）`;
        else if (!member && p.sec <= memberHere) unlock = `無料登録で${L.memberExportLabel}まで`;
        else if (!member) unlock = "無料登録して、パソコンで開くと使えます";
        else unlock = "パソコンで開くと10分まで";
      }
      return { ...p, locked, unlock };
    });
  };

  // 他ツール(Privacy/Vlog/ReAngle)はモードを持たないので、従来どおりの入口を残す
  L.exportPresets = () => L.exportPresetsFor(null);

  /* 上限なし: 上限の文言([data-limit-note])を隠して帯を出す。
     登録ユーザー: 文言を data-limit-note-member の内容(静的テキスト)に差し替える */
  L.applyToDom = () => {
    if (!L.unlimited) {
      if (L.member) {
        document.querySelectorAll("[data-limit-note-member]").forEach(el => {
          el.textContent = el.getAttribute("data-limit-note-member");
        });
      }
      return;
    }
    document.querySelectorAll("[data-limit-note]").forEach(el => { el.hidden = true; });
    if (document.getElementById("adminLimitBadge")) return;
    const p = document.createElement("p");
    p.id = "adminLimitBadge";
    p.className = "admin-limit-badge";
    p.innerHTML = L.admin
      ? '<i class="fa-solid fa-unlock"></i> 管理者としてログイン中のため、長さ・枚数の上限なしで取り込めます。'
      : '<i class="fa-solid fa-laptop-code"></i> 手元の環境で開いているため、長さ・枚数の上限なしで取り込めます。';
    const host = document.querySelector("main") || document.body;
    host.insertBefore(p, host.firstChild);
  };

  /* 使える条件をひと言で。ゲストには「ゲストはN・登録ならM」、
     登録済みには自分の上限だけを簡潔に出す(自分に関係ない情報を読ませない) */
  L.renderPlanNote = () => {
    const hosts = document.querySelectorAll("[data-mz-plan]");
    if (!hosts.length) return;
    const kind = hosts[0].getAttribute("data-mz-plan");   // "video" | "photo" | "vlog"
    if (kind === "vlog") {
      // Vlogは上限が複数種あるため専用の文言にする
      const html = L.unlimited
        ? '<p class="mz-plan">上限なしで使えます（〜5分）。</p>'
        : L.member
          ? '<p class="mz-plan">1本10分まで・インタビュー3人・インサート映像8本・ロゴ1枚・写真8枚。'
            + '完成は3分01秒〜5分まで使えます。</p>'
          : '<p class="mz-plan">ゲストは1本5分まで・インタビュー1人・インサート映像4本まで'
            + '（ロゴ・写真は使えません）。完成は3分まで。'
            + '登録すると10分・3人・8本・ロゴ1枚・写真8枚・5分に。 <a href="/#signup">無料登録</a></p>';
      hosts.forEach(el => { el.innerHTML = html; });
      return;
    }
    /* 素材の上限は端末で変わる。スマホは登録しても5分のままなので、
       「登録すると素材が15分に」と書くと嘘になる(2026-07-31) */
    const memberVideoHere = bigDevice ? "15分" : "5分";
    const g = kind === "photo" ? "1枚" : "5分";
    const m = kind === "photo" ? "5枚" : memberVideoHere;
    let html;
    if (L.unlimited) {
      html = '<p class="mz-plan">上限なしで使えます。</p>';
    } else if (L.member) {
      /* 「取り込める素材の長さ」と「書き出せる完成の長さ」は別枠なので、
         どちらがどれだけ使えるのかを1文で言い切る(2026-07-21 優さん指示) */
      html = kind === "photo"
        ? `<p class="mz-plan">${m}まで使えます。</p>`
        : `<p class="mz-plan">素材は${L.videoLimitLabel}まで使用でき、完成は${L.exportLimitLabel}までです。`
          + (mobile ? "パソコンで開くと素材15分・完成10分になります。" : "")
          + "</p>";
    } else if (kind === "photo") {
      html = `<p class="mz-plan">ゲストは${g}まで、登録ユーザーは${m}まで。`
        + ' <a href="/#signup">無料登録</a></p>';
    } else {
      /* ★ 伸びるものだけを言う(2026-08-02 ⑬)。ゲストが3分になった結果、
         スマホでは登録しても完成が伸びない(3分→3分)。「登録すると3分に」と
         書くと嘘の誘い文句になる ─ 実際に変わる項目だけ並べる */
      const same = g === m;                                      // 素材が伸びない端末か
      const gain = L.memberExportLabel !== L.exportLimitLabel;   // 完成が伸びる端末か
      const perks = [
        ...(same ? [] : [`素材${m}`]),
        ...(gain ? [`完成${L.memberExportLabel}`] : []),
      ];
      html = `<p class="mz-plan">ゲストは素材${g}・完成${L.exportLimitLabel}まで。`
        + (perks.length ? `登録すると${perks.join("・")}に。` : "")
        + ' <a href="/#signup">無料登録</a></p>';
    }
    hosts.forEach(el => { el.innerHTML = html; });
  };

  /* ゲストにだけ「登録すると何が使えるようになるか」を見せる(2026-07-21)。
     ログイン済み・管理者・手元環境には出さない(自分に関係ない情報を読ませない)。
     文言はツールごと(body[data-mz-tool])に変える */
  L.renderSignupPerks = () => {
    if (L.member || L.unlimited) return;
    const host = document.querySelector("[data-mz-plan]");
    if (!host || document.getElementById("mzSignupPerks")) return;
    const tool = document.body.getAttribute("data-mz-tool") || "";
    /* 端末で変わる項目は、いま使っている端末の値で書く(2026-07-31)。
       スマホで「15分になります」と出しても、登録しても5分のままで嘘になる */
    const vLine = bigDevice ? "取り込める動画: 5分 → 15分" : null;
    /* ★ 端末ごとに実際に伸びる値だけを言う(2026-08-05: 30秒/60秒/10分)。
       こだわりはPC×登録だけ(⑩)なのでスマホには書かない(嘘の誘い文句を残さない) */
    const eLine = `書き出せる長さ: 30秒 → ${bigDevice ? "10分(ショウ全体が入ります)" : "60秒"}`;
    const per = {
      switcher: [
        vLine,
        eLine,
        /* 別のシーンはゲスト1本まで → 登録で何本でも(2026-08-02 ⑭) */
        "完成後の「別のシーン」: 1本まで → 何本でも",
        bigDevice ? null : "パソコンで開くと、10分まで書き出せます",
        bigDevice ? "「こだわり」設定(同期・レイアウト・仕上げの調整)" : null,
      ].filter(Boolean),
      reangle: [
        vLine,
        eLine,
      ].filter(Boolean),
      privacy: [
        "一度に扱える写真: 1枚 → 5枚",
      ],
      vlog: [
        "素材1本の長さ: 5分 → 10分",
        "インタビュー: 1人 → 3人",
        "インサート映像(Bロール): 4本 → 8本",
        "団体ロゴ入れ・完成5分まで",
      ],
    }[tool] || [];
    if (!per.length) return;
    const div = document.createElement("div");
    div.id = "mzSignupPerks";
    div.className = "mz-signup-perks";
    div.innerHTML = '<p class="msp-title"><i class="fa-solid fa-unlock" aria-hidden="true"></i> MarchinZに無料登録すると</p>'
      + `<ul>${per.map(t => `<li>${t}</li>`).join("")}</ul>`
      + '<a class="msp-btn" href="/#signup">無料登録して全部使う</a>';
    host.appendChild(div);
  };

  const boot = () => { L.applyToDom(); L.renderPlanNote(); L.renderSignupPerks(); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
  return L;
})();
