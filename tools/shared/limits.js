"use strict";
/* ============ クリエイターツール共通: 取り込み・書き出し制限 ============
   会員種別(ゲスト/登録/管理者)と**端末(スマホ・タブレット / パソコン)**の
   2軸で決める(2026-07-31 優さん指示)。

     　　　　　　　　　書き出し(プランの壁)
     ゲスト(端末問わず)   1分未満
     登録 × スマホ         3分
     登録 × パソコン      10分
     管理者・手元環境     上限なし
     ※Switcherの取り込みはプランで縛らない。入口は技術的な天井
       (maxSourceSec: スマホ20分/パソコン40分)だけで、どこを何分使うかは
       「長さと始まり」で選ぶ(2026-07-31)。maxVideoSec はReAngle用に残る

   端末を軸に入れた理由: スマホは動画を丸ごとメモリに載せるため、長い書き出しが
   途中で落ちる(iPhone実機で8分12秒が62%で停止)。落ちる長さを許可しておいて
   「落ちました」と言うより、最初から届く長さだけを見せる方が親切。
   ゲストは端末に関わらず1分未満(登録の壁を端末でブレさせない。優さん判断)。

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
  const ua = navigator.userAgent || "";
  const iPadDesktopUA = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const mobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || iPadDesktopUA;
  const bigDevice = !mobile;   // パソコン(書き出しを長く許せる)

  /* βテスト参加者の特典・上限拡大は**ここで beta を参照して**足す(2026-07-23)。
     例: maxExportSec: unlimited ? Infinity : beta ? 900 : ...
     将来の有料会員も同じ型(profileの属性→auth.jsが印→ここで参照)で1箇所に集める */
  const L = {
    admin, local, member, beta, unlimited, mobile, bigDevice,
    /* Privacyの動画モザイクを使える人。privacy/js/ui.js と Switcher の
       renderFaceNote が**両方ここを見る**(2026-07-31)。以前は条件のコピーが
       2箇所にあり、片方を変えるともう片方が嘘になる構造だった */
    privacyVideoAllowed: admin,
    /* 取り込める1本の長さ。登録 × パソコン だけ12分、それ以外は5分。
       12分あるのは、複数カメラの回し始めのズレ(実測で最大5分超)を
       吸収したうえでショウ全体が入るようにするため */
    maxVideoSec: unlimited ? Infinity : (member && bigDevice) ? 720.5 : 300.5,
    videoLimitLabel: (member && bigDevice) ? "12分" : "5分",   // エラーメッセージ用

    /* ---- 取り込みの「技術的な天井」(2026-07-31 マーチング4団体レビュー) ----
       ★ maxVideoSec は**プランの壁**で、Switcher ではもう入口に置かない。
         入口で弾いていたため、8分半のランスルーを撮った人が
         「見せたい場面だけ短く切り出してからお試しください」と言われ、
         その切り出す道具はツールの中に無い、という行き止まりになっていた
         (4団体すべてが「1つだけ足すなら」にこれを挙げた)。

         Switcher には既に「長さと始まり」工程があり、そこで
         **どこを何分使うか**を選べる ─ 窓を選ぶUIは最初から存在していた。
         足りなかったのは入口だけなので、入口は技術的に耐えられる長さまで
         開き、プランの壁は出口(maxExportSec)で効かせる。

       天井の根拠: 同期の音声抽出(audio.js extract8k)は 8kHz モノ Float32 で
       1秒あたり32KB。20分=38MB / 40分=77MB。スマホで安全に持てるのは前者まで。
       映像解析も書き出しも MC.trimRange() の中しか見ないので、
       素材が長いこと自体は重くならない(実測でこの3経路を確認済み)。
       ReAngle には窓を選ぶ工程が無いので、あちらは maxVideoSec のまま */
    maxSourceSec: unlimited ? Infinity : (mobile ? 1200.5 : 2400.5),
    sourceLimitLabel: mobile ? "20分" : "40分",

    /* 書き出せる長さ(IN〜OUTの範囲)。取り込みとは別枠。
       ゲスト1分未満 / 登録×スマホ 3分 / 登録×パソコン 10分。
       ※端末のメモリ上限(MC.exporter.MEM_HARD_LIMIT)とは別で、
         実際にはどちらか厳しい方が効く */
    maxExportSec: unlimited ? Infinity
      : !member ? 59
      : bigDevice ? 600 : 180,
    exportLimitLabel: !member ? "1分未満" : bigDevice ? "10分" : "3分",
    /* 登録ユーザーの完成尺。ゲストに「登録すると何分まで作れるか」を
       案内するときにも使うため、ロールに依らない定数として持つ。
       いま使っている端末で登録したらどうなるかを言う(スマホで「10分」と
       言われても、登録しても3分なので嘘になる) */
    memberExportLabel: bigDevice ? "10分" : "3分",
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
     「1分未満 / 3分未満 / 8分30秒前後(おすすめ)」の3つから選ぶ。
     使えないものは**消さずに鍵つきで見せる**。何をすれば使えるようになるかを
     その場で言うため(消してしまうと、そもそも存在に気づけない)。
     full の実尺は「演奏まるごと(最大 maxExportSec)」なので、呼ぶ側が
     演奏の長さで丸める。ここの sec は上限比較と表示のための代表値 */
  L.EXPORT_PRESETS = [
    { id: "short", label: "ショート",   sec: 59,  hint: "SNSに出しやすい長さ" },
    { id: "mid",   label: "ミドル",     sec: 180, hint: "3分だけ切り出す長さ" },
    { id: "full",  label: "まるごと",   sec: 510, hint: "演奏ぜんぶ", whole: true },
  ];

  /* いまの人・いまの端末で使えるかを添えて返す。
     locked のときは「何をすれば使えるか」を1文で持たせる */
  L.exportPresets = () => {
    const memberHere = bigDevice ? 600 : 180;   // いまの端末で登録したときの上限
    return L.EXPORT_PRESETS.map(p => {
      const locked = p.sec > L.maxExportSec;
      let unlock = "";
      if (locked) {
        if (!member && p.sec <= memberHere) unlock = "無料登録で使えます";
        else if (!member) unlock = "無料登録して、パソコンで開くと使えます";
        else unlock = "パソコンで開くと使えます";
      }
      return { ...p, locked, unlock };
    });
  };

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
       「登録すると素材が12分に」と書くと嘘になる(2026-07-31) */
    const memberVideoHere = bigDevice ? "12分" : "5分";
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
          + (mobile ? "パソコンで開くと素材12分・完成10分になります。" : "")
          + "</p>";
    } else if (kind === "photo") {
      html = `<p class="mz-plan">ゲストは${g}まで、登録ユーザーは${m}まで。`
        + ' <a href="/#signup">無料登録</a></p>';
    } else {
      /* 素材の上限が登録で変わらない端末(スマホ)では、完成の話だけをする */
      const same = g === m;
      html = `<p class="mz-plan">ゲストは素材${g}・完成${L.exportLimitLabel}まで。`
        + (same ? `登録すると完成が${L.memberExportLabel}に。`
                : `登録すると素材${m}・完成${L.memberExportLabel}に。`)
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
       スマホで「12分になります」と出しても、登録しても5分のままで嘘になる */
    const vLine = bigDevice ? "取り込める動画: 5分 → 12分" : null;
    const eLine = `書き出せる長さ: 1分未満 → ${bigDevice ? "10分(ショウ全体が入ります)" : "3分"}`;
    const per = {
      switcher: [
        vLine,
        eLine,
        bigDevice ? null : "パソコンで開くと、さらに10分まで書き出せます",
        "「こだわり」設定(同期・レイアウト・仕上げの調整)",
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
