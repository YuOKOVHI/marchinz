#!/usr/bin/env python3
"""マイページ(プロフィール)が実際にJSを実行して壊れていないかを確かめる。

## なぜ必要か

2026-08-06、マイページで「読み込みに失敗しました」が発生した。真因は
user-profile-page.js の renderMLL() 呼び出し(と event_log_diary の
authorDisplay)で、スコープに存在しない変数 profile を参照する
ReferenceError(正しくは pdata)。

  ヘッダー(名前・アバター)は先行描画済みの別変数(profileEarly)で表示 ✓
  → しかし renderMLL() の引数を組み立てる瞬間に例外が飛ぶ
  → MarchinZ Log / Note / YouTube の件数は 0 のまま止まる
  → 外側の catch が「読み込みに失敗しました」を表示

**このバグは check_production.py では検知できない。** あちらは static な
HTML/JSON の中身しか見ておらず、この不具合はブラウザが JS を実行して
初めて発生する実行時エラーだから。ここでは Playwright(headless Chromium)で
実際にページを開き、コンソールにエラーが出ていないか・画面が壊れていないかを
直接確かめる。

renderMLL() は「本人」だけでなく「MarchinZ Log を公開設定にしている訪問者」
でも通る同じコードパスなので、ログイン不要で公開プロフィールを開くだけで
同じ不具合を再現・検知できる。

## 検査する不変条件

  1. (Layer A / 静的) user-profile-page.js に、今回とまったく同じ形の
     バグ(スコープ外の "profile." 参照)が復活していないか
  2. (Layer B / 実行時) 指定した公開プロフィールを開いて:
       a. 未捕捉の例外(pageerror)が出ていないこと
       b. catch に握られた読み込み失敗(console.warn "[profile] load")の中身が、
          **JSコードのバグの証拠**(ReferenceError / TypeError /
          is not defined / is not a function)を含んでいないこと
          ── 2026-08-06 の profile 未定義バグはこの形でしか観測できない
          (loadAndRender の catch が例外を握るので pageerror には出ない)
       c. MarchinZ Log/Note/大会動画/YouTube/通知/運営より の6タブが、
          それぞれアイコンをちょうど1個だけ持つこと
          (2026-08-06 に見つかった decorateProfileTabs() の二重挿入の再発を見張る)
       d. 未来日の MarchinZ Log があれば、参加スタイルでなく「予定」と
          表示されていること(該当ログが無ければこの項目はスキップ)
       e. 「本人の状態に戻したとき、通知ペインを表示できる」こと
          (2026-08-06 の「スマホから通知が読めない」の再発ガード)
  4. (Layer A4 / 静的) 通知が読めなくなる形の再発:
       ・訪問者フラグ(data-mz-prof-visitor)の確定が loadAndRender の中=
         どの early return よりも前にあること。中ほどにあると、認証の復帰待ちで
         抜けた回に古い値が残り、本人なのに通知の中身だけが消える
       ・通知ペインを消す規則が、出し分け(訪問者・プレビュー・読み込み中・
         対象なし・凍結)以外の条件で増えていないこと

## ヘッドレス環境の限界(重要・正直に書く)

  Firebase App Check(reCAPTCHA v3)が headless Chromium を bot と判定し、
  トークン交換が 403 になる → Firestore の読み取り自体が通らない。
  そのため CI では:
    - Firestore データが要る描画(renderMLL 以降)には**到達できない**。
      2026-08-06 の profile 未定義バグ自体は、CI の実行時チェック(Layer B)
      では踏めない(データ取得の手前で FirebaseError になるため)。
      このクラスは Layer A(静的シグネチャ)と Layer A2(配信ドリフト検知)が受け持つ
    - Layer B が受け持つのは「データ取得より手前で起きる」壊れ方:
      スクリプトの構文エラー・初期化時の未捕捉例外・アイコンの二重挿入
      (DOM 静的なので App Check と無関係に検査できる)など
  中身の表示まで含めた完全確認は、優さんの実機/ローカルの実ブラウザで行う。

  3. (Layer A2 / 配信ドリフト) 本番が配信中の user-profile-page.js /
     marchinz-icons.js が、リポジトリ HEAD のコミット実体と一致すること。
     check_production.py の版チェックは index.html の data-mz-version しか
     見ないため、**版番の変わらないバグ修正**(まさに今回の2コミット)が
     未デプロイのまま残っても検知できない。ファイル実体の一致で見る。

## 消費するもの

  - Netlify のビルドクレジット: 消費しない(読むだけ。commit も push もしない)
  - GitHub Actions: public リポジトリのため無料。Playwright の起動を含め
    1回あたり1分弱

## 使い方

    python3 check_profile_integrity.py                  # 既定のUID一覧を検査
    python3 check_profile_integrity.py --uid <UID>       # 個別に指定(複数可)
    python3 check_profile_integrity.py --base <URL>      # 別環境

終了コード: 0=正常 / 1=異常あり / 2=検査自体を実行できなかった
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BASE = "https://marchinz.netlify.app"

# ★ 優さんの公開プロフィール2件(2026-08-06、優さん本人から取得)。
#   どちらも MarchinZ Log を公開設定にしているため、ログイン不要で
#   renderMLL() の同じコードパスを通せる。1件が空/退会等で使えなくなった
#   場合に備えて複数件を見る。
DEFAULT_UIDS = [
    "yY6dAULKJkTdt9PIF7zzzrrS60I3",
    "ZAJbOeezhIT16aVWlYJzupv9X9s1",
]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def fetch(url: str, timeout: float = 20.0) -> tuple[int, str]:
    """(HTTPステータス, 本文) を返す。取得できなければ (0, 理由)。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def check_static_regression(base: str, problems: list[str], notes: list[str]) -> None:
    """Layer A: 今回とまったく同じ形の再発(スコープ外の profile. 参照)を、
    ブラウザを使わず数秒で検知する。renderHeader(profile, targetUid) 自身の
    引数としての正当な使用は除外する(その関数の中でだけは profile が実在する)。"""
    print("== Layer A: 静的な再発ガード ==")
    status, body = fetch(base + "/user-profile-page.js")
    if status != 200:
        problems.append(f"user-profile-page.js の取得に失敗(HTTP {status})")
        return
    # ★ 掴んだものが本当に当該JSかを確かめる(2026-08-06 レビューP2)。
    #   netlify.toml の SPA フォールバック(/* → /index.html)があるので、
    #   JSが消えても 200 で HTML が返る。そのとき profile. は当然見つからず
    #   「OK 参照なし」と印字してしまい、Layer A 単独の判定が信用できなくなる
    if "renderMLL" not in body or body.lstrip()[:9].lower() == "<!doctype":
        problems.append("user-profile-page.js の中身がJSではない"
                        "(SPAフォールバックのHTMLを掴んだ可能性。配信の確認を)")
        return

    # ★ 許可範囲は**波括弧の対応**で取る(2026-08-06 レビューP1)。
    #   以前は「開始行 +60行」の行数ベースで、実測の余裕は10行しかなかった
    #   (renderHeader は 50行)。11行足しただけで正当な参照が窓の外へ出て誤検知、
    #   逆に短くリファクタすると次の関数が窓に入って見逃しになる。
    #   対象も renderHeader 決め打ちをやめ、**引数に profile を取る関数すべて**を
    #   許可範囲にする ─ その中でだけ profile は実在する。
    lines = body.splitlines()
    allow = []          # (開始行index, 終了行index) の配列
    found_any = False
    for m in re.finditer(r"function\s+(\w+)\s*\(([^)]*)\)\s*\{", body):
        params = m.group(2)
        if not re.search(r"\bprofile\b", params):
            continue
        found_any = True
        # 対応する閉じ括弧まで数える(文字列・コメントは無視する簡易版だが、
        # 行数固定よりはるかに安全。ズレたら下の found_any 側で気づける)
        depth, j = 0, m.end() - 1
        while j < len(body):
            if body[j] == "{":
                depth += 1
            elif body[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        allow.append((body.count("\n", 0, m.start()), body.count("\n", 0, j)))

    def allowed(idx: int) -> bool:
        return any(a <= idx <= b for a, b in allow)

    bad_lines = []
    for i, line in enumerate(lines):
        if allowed(i):
            continue
        # ★ フィールド名を決め打ちしない(2026-08-06 レビューP1)。
        #   4つだけを見ていたため、別フィールドや pdata 系のタイポは素通りだった
        if re.search(r"(?<![\w.$])profile\.[A-Za-z_$]", line):
            bad_lines.append((i + 1, line.strip()))

    if bad_lines:
        for ln, text in bad_lines:
            problems.append(f"user-profile-page.js:{ln} にスコープ外の profile. 参照が復活: {text}")
    else:
        print("  OK  スコープ外の profile. 参照なし")

    if not found_any:
        notes.append("引数に profile を取る関数が1つも見つからなかった"
                      "(ファイル構造が変わった可能性。許可リストの前提が崩れていないか確認を)")


def check_deploy_drift(base: str, problems: list[str], notes: list[str]) -> None:
    """Layer A2: マイページ系ファイルの本番配信物が、リポジトリ HEAD と
    一致しているか。2026-08-06 の実害: 修正コミット済みなのに未push/未デプロイの
    まま、本番では他人のプロフィールが壊れ続けていた。data-mz-version は
    こういう「版番の変わらない修正」を見ていない。"""
    import subprocess

    print("== Layer A2: 配信ドリフト(本番 vs HEAD) ==")
    files = ["user-profile-page.js", "marchinz-icons.js"]
    for f in files:
        try:
            head = subprocess.run(
                ["git", "show", f"HEAD:{f}"], cwd=ROOT,
                capture_output=True, text=True, check=True,
            ).stdout
        except Exception as e:
            notes.append(f"HEAD:{f} を読めない({e})。checkout の無い環境では省略")
            continue
        status, body = fetch(f"{base}/{f}")
        if status != 200:
            problems.append(f"本番の {f} が HTTP {status}")
            continue
        if body.strip() != head.strip():
            msg = (f"本番の {f} が HEAD と一致しない(未デプロイの修正が残っているか、"
                   "本番だけ古い)。push/デプロイの状態を確認してください")
            # ★ Netlify のビルドが5分で終わらなかった回は「注意」に落とす
            #   (2026-08-06 レビューP1)。ビルド時間は note の RSS 取得など
            #   外部ネットワークに依存してブレるので、遅延が障害に化けないように
            if os.environ.get("MZ_DEPLOY_LAGGED") == "1":
                notes.append(msg + " ※ビルド待ちが5分で終わらなかった回のため注意扱い")
            else:
                problems.append(msg)
        else:
            print(f"  OK  {f} は HEAD と一致")


def check_asset_version_bump(problems: list[str], notes: list[str]) -> None:
    """Layer A3: JS を直したのに index.html の ?v= を据え置いた再発を捕まえる。

    2026-08-06 の実例: アイコン重複を直したコミット(1cc1283)自身が
    marchinz-icons.js?v=1.26.28 を据え置いていた。旧JSをキャッシュした端末は
    直したはずのバグを再現し続けるが、**Layer A/A2/B はどれも緑のまま通る** ─
    A2 はファイル実体しか比べず、B は毎回まっさらなブラウザで取得するため。
    ここだけが参照側(index.html の ?v=)を見る層。
    """
    import subprocess

    print("== Layer A3: ?v= の据え置き ==")
    watched = ["user-profile-page.js", "marchinz-icons.js"]
    try:
        head_html = subprocess.run(
            ["git", "show", "HEAD:index.html"], cwd=ROOT,
            capture_output=True, text=True, check=True).stdout
    except Exception as e:
        notes.append(f"HEAD:index.html を読めない({e})。Layer A3 は省略")
        return

    for f in watched:
        m = re.search(re.escape(f) + r"\?v=([0-9.]+)", head_html)
        if not m:
            notes.append(f"index.html に {f}?v= の参照が見つからない(構成が変わった?)")
            continue
        ver = m.group(1)
        try:
            # そのJSを最後に変えたコミットで、index.html の ?v= も一緒に動いたか
            last = subprocess.run(
                ["git", "log", "-1", "--format=%H", "--", f], cwd=ROOT,
                capture_output=True, text=True, check=True).stdout.strip()
            if not last:
                continue
            prev_html = subprocess.run(
                ["git", "show", f"{last}^:index.html"], cwd=ROOT,
                capture_output=True, text=True, check=True).stdout
        except Exception:
            continue  # 浅いcloneや初回コミットでは判定しない
        pm = re.search(re.escape(f) + r"\?v=([0-9.]+)", prev_html)
        if pm and pm.group(1) == ver:
            problems.append(
                f"{f} を直した {last[:7]} で index.html の ?v= が据え置き({ver})。"
                "旧JSをキャッシュした端末は直る前の挙動のままになります")
        else:
            print(f"  OK  {f}?v={ver} はJSの変更と一緒に動いている")


def check_notif_visibility_guard(base: str, problems: list[str], notes: list[str]) -> None:
    """Layer A4: 通知が読めなくなる再発を静的に捕まえる。

    2026-08-06 の実害(優さん実機「スマホから通知が読めない/パソコンならいけた」):
      styles.css の
        html[data-mz-prof-visitor="1"] #prof-pane-notifs { display:none !important }
      は正しい。壊れていたのは**フラグを更新する場所**で、
      loadAndRenderCore の中ほど(認証の復帰待ちで抜ける early return より後)
      にしか無かった。他人のプロフィール → 自分のマイページ、と移ると
      待ちで一度抜けてフラグが "1" のまま残り、
      **通知タブは押せてバッジも出るのに中身だけが消える**。

    ここで見張るのは2つ:
      (1) フラグの確定が loadAndRender(包み側)にある = どの early return よりも前
      (2) 通知ペインを消す規則が、visitor フラグ以外の条件で増えていない
          (無条件に隠す規則が入ると、本人でも読めなくなる)
    """
    print("== Layer A4: 通知が読めなくなる再発ガード ==")
    status, js = fetch(base + "/user-profile-page.js")
    if status != 200 or "renderMLL" not in js:
        problems.append(f"user-profile-page.js を読めない(HTTP {status})。Layer A4 は判定不能")
        return

    ATTR = "data-mz-prof-visitor"
    if ATTR not in js:
        problems.append(f"{ATTR} を設定する処理が消えている"
                        "(通知ペインの出し分けが壊れている可能性)")
        return

    # (1) loadAndRender(包み側)の中で、core を呼ぶ**前**に確定しているか。
    #     波括弧の対応で関数の範囲を取り、core 呼び出しの位置と比べる
    m = re.search(r"async\s+function\s+loadAndRender\s*\(\s*\)\s*\{", js)
    if not m:
        notes.append("loadAndRender が見つからない(構造が変わった?)。Layer A4 の(1)は省略")
    else:
        depth, j = 0, m.end() - 1
        while j < len(js):
            if js[j] == "{":
                depth += 1
            elif js[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = js[m.start():j]
        core_at = body.find("loadAndRenderCore(")
        attr_at = body.find(ATTR)
        if attr_at < 0 or (core_at >= 0 and attr_at > core_at):
            problems.append(
                f"{ATTR} の確定が loadAndRender の中に無い(または core 呼び出しより後)。"
                "認証の復帰待ちで抜けた回に古い値が残り、本人なのに通知の中身が"
                "消える(2026-08-06 の再発)")
        else:
            print("  OK  訪問者フラグは early return より前で確定している")

    # (2) 通知ペインを消す規則が visitor フラグ以外に増えていないか
    st, css = fetch(base + "/styles.css")
    if st != 200:
        notes.append(f"styles.css を読めない(HTTP {st})。Layer A4 の(2)は省略")
        return
    # 「#prof-pane-notifs を含み display:none を持つ」規則の条件部を集める
    bad = []
    for mm in re.finditer(r"([^{}]*#prof-pane-notifs[^{}]*)\{([^}]*)\}", css):
        sel, decl = mm.group(1), mm.group(2)
        if "display" not in decl or "none" not in decl:
            continue
        # 正当な出し分け(訪問者・他会員視点プレビュー・読み込み中・対象なし・凍結)
        ok = any(k in sel for k in (
            "data-mz-prof-visitor", "data-mz-prof-guest-preview",
            "--loading", "--no-target", "--banned-limited"))
        if not ok:
            bad.append(" ".join(sel.split())[:90])
    if bad:
        for s in bad:
            problems.append(f"通知ペインを無条件に近い条件で隠す規則がある: {s}")
    else:
        print("  OK  通知ペインを隠すのは出し分けの規則だけ")


def check_live_profile(base: str, uid: str, problems: list[str], notes: list[str]) -> None:
    """Layer B: 実際にブラウザでプロフィールを開いて確かめる。"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        problems.append("playwright が入っていない(pip install playwright && "
                         "playwright install --with-deps chromium が必要)")
        return

    url = f"{base}/#profile?uid={uid}&tab=mll"

    # ヘッドレス環境で必ず出る既知ノイズ(App Check の 403、ストレージAPI、
    # 計測系の中断)。これを赤にすると毎回鳴って見張りが死ぬので除外する。
    KNOWN_NOISE = re.compile(
        r"requestStorageAccess"
        # ★ 読み込み失敗はステータスを問わず除外(2026-08-06 レビューP1)。
        #   以前は 403 だけで、Google Fonts / jsdelivr(cropperjs 等)が一時的に
        #   4xx・5xx・タイムアウトを返した回に、サイトは無傷なのに赤くなっていた。
        #   赤にするのは未捕捉例外(pageerror)と CODE_BUG に限る
        r"|Failed to load resource"
        r"|net::ERR_"
        r"|appCheck|AppCheck|recaptcha|ReCaptcha",
    )
    # コードのバグの証拠。App Check に弾かれただけの FirebaseError とは
    # 文面で確実に区別できる(2026-08-06 の profile 未定義バグは
    # "ReferenceError: profile is not defined" としてここに現れる)
    CODE_BUG = re.compile(
        r"ReferenceError|TypeError|SyntaxError"
        r"|is not defined|is not a function|Cannot read properties",
    )

    page_errors: list[str] = []      # 未捕捉の例外(常に赤)
    console_errors: list[str] = []   # console.error(ノイズ除外後に赤)
    warn_bugs: list[str] = []        # catch に握られたコードバグ(赤)

    def on_console(msg):
        text = msg.text
        if msg.type == "error" and not KNOWN_NOISE.search(text):
            console_errors.append(text)
        # loadAndRender の catch は console.warn("[profile] load", e) に落とす。
        # ここにコードバグの証拠があれば、画面の失敗表示の真因はコード側
        if msg.type in ("warning", "error") and CODE_BUG.search(text):
            warn_bugs.append(text)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", on_console)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # Firestore(App Check 拒否含む)の往復と描画の完了を待つ
            page.wait_for_timeout(6000)
        except Exception as e:
            problems.append(f"[{uid}] ページの読み込み自体に失敗: {e}")
            browser.close()
            return

        # a) 未捕捉の例外
        for e in page_errors[:5]:
            problems.append(f"[{uid}] 未捕捉の例外: {e}")
        for e in console_errors[:5]:
            problems.append(f"[{uid}] コンソールエラー: {e}")

        # b) catch に握られたコードバグ(2026-08-06 のバグはこの形で出る)
        for e in warn_bugs[:5]:
            problems.append(f"[{uid}] コードのバグによる読み込み失敗: {e}")

        # b-2) ★ このUIDの「中身」まで見られたかを毎回記録する(2026-08-06 レビューP1)。
        #      App Check が headless を弾くと Firestore に到達せず、Layer B が
        #      実際に測っているのは index.html の静的DOMだけになる ─ 実測で
        #      **存在しないUIDを渡しても結果が完全に同じ**だった。
        #      docstring に書くだけでは運用中に見えないので、出力に必ず残す。
        try:
            name = page.evaluate(
                "() => (document.querySelector('.user-profile-display-name')"
                "?.textContent || '').trim()")
        except Exception:
            name = ""
        if not name:
            notes.append(f"[{uid}] このUIDの中身は未検証"
                          "(App Check により Firestore へ到達せず)。"
                          "この回の Layer B が見たのは静的DOMと実行時エラーだけです")
        else:
            print(f"  OK  [{uid}] 表示名まで描画された: {name[:20]}")

        # c) 6タブのアイコン重複チェック(2026-08-06 decorateProfileTabs 二重挿入の再発ガード)
        tab_ids = ["prof-tab-mll", "prof-tab-logdiary", "prof-tab-videos",
                   "prof-tab-yt", "prof-tab-notifs", "prof-tab-ops"]
        for tid in tab_ids:
            try:
                count = page.locator(f"#{tid} > i").count()
            except Exception:
                count = -1
            if count == 0:
                notes.append(f"[{uid}] #{tid} にアイコンが1つも無い(タブ自体が無いのかも)")
            elif count > 1:
                problems.append(f"[{uid}] #{tid} のアイコンが{count}個重複している")

        # c-2) 「本人だったら通知の中身が出せるか」(2026-08-06 実機報告の再発ガード)。
        #      CI は常に訪問者として見るので、通知ペインが消えているのは**正しい**。
        #      測るべきは「訪問者フラグを本人相当に戻したとき、ちゃんと出せるか」。
        #      これで、フラグ以外の理由で永久に隠す規則が入った回を捕まえられる。
        #      触った属性は必ず元へ戻す(この後の検査に影響させない)。
        try:
            res = page.evaluate(
                """() => {
                  const html = document.documentElement;
                  const pane = document.querySelector('#prof-pane-notifs');
                  if (!pane) return { missing: true };
                  const layout = document.querySelector('.user-profile-layout');
                  const before = html.getAttribute('data-mz-prof-visitor');
                  const hiddenBefore = pane.hidden;
                  // ★ CI は App Check で Firestore へ到達できず、レイアウトが
                  //   --no-target(対象なし)のまま残る。その状態も一緒に戻さないと
                  //   「本人なら出せるか」ではなく「読み込めていないか」を測ってしまう
                  //   (最初の実走でこの誤検知を踏んだ)
                  const layoutWas = layout ? layout.className : null;
                  if (layout) {
                    layout.classList.remove('user-profile-layout--no-target',
                                            'user-profile-layout--loading',
                                            'user-profile-layout--banned-limited');
                  }
                  html.setAttribute('data-mz-prof-visitor', '');
                  html.setAttribute('data-mz-prof-guest-preview', '');
                  pane.hidden = false;
                  const shown = getComputedStyle(pane).display !== 'none';
                  // 触ったものを全部戻す
                  if (before === null) html.removeAttribute('data-mz-prof-visitor');
                  else html.setAttribute('data-mz-prof-visitor', before);
                  html.setAttribute('data-mz-prof-guest-preview', '');
                  if (layout && layoutWas !== null) layout.className = layoutWas;
                  pane.hidden = hiddenBefore;
                  return { missing: false, shown, flagWas: before };
                }"""
            )
            if res.get("missing"):
                problems.append(f"[{uid}] 通知ペイン(#prof-pane-notifs)がページに無い")
            elif not res.get("shown"):
                problems.append(
                    f"[{uid}] 本人の状態に戻しても通知ペインが display:none のまま。"
                    "訪問者フラグ以外の理由で消えている(2026-08-06 の再発)")
            else:
                print(f"  OK  [{uid}] 本人の状態なら通知ペインは表示できる"
                      f"(いまの訪問者フラグ={res.get('flagWas')!r})")
        except Exception as e:
            notes.append(f"[{uid}] 通知ペインの出し分けを確かめられなかった: {e}")

        # d) 未来日ログの「予定」表示(ベストエフォート。該当ログが無ければ何も起きない)
        try:
            violations = page.evaluate(
                """() => {
                  const rows = [...document.querySelectorAll('.user-profile-mll-row')];
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  const bad = [];
                  for (const row of rows) {
                    const dateEl = row.querySelector('.user-profile-mll-date');
                    const hintEl = row.querySelector('.user-profile-mll-role-hint');
                    if (!dateEl || !hintEl) continue;
                    const m = dateEl.textContent.match(/(\\d+)年\\s*(\\d+)月\\s*(\\d+)日/);
                    if (!m) continue;
                    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
                    if (d > today && hintEl.textContent.trim() !== '予定') {
                      bad.push(dateEl.textContent.trim() + ' / ' + hintEl.textContent.trim());
                    }
                  }
                  return bad;
                }"""
            )
        except Exception as e:
            violations = []
            notes.append(f"[{uid}] 未来日チェックを実行できず: {e}")
        for v in violations:
            problems.append(f"[{uid}] 未来日ログが「予定」表示になっていない: {v}")

        browser.close()

    # ★ このUIDで問題を1つでも積んだなら「OK」と言わない(2026-08-06 レビュー)。
    #   以前はアイコン重複を6件積んだ直後でも「OK」と印字しており、
    #   ログを読む人が「OKなのになぜ赤?」で混乱していた
    mine = [p for p in problems if p.startswith(f"[{uid}]")]
    if mine:
        print(f"  NG  [{uid}] {len(mine)} 件の問題(上の一覧参照)")
    elif not page_errors and not console_errors and not warn_bugs:
        print(f"  OK  [{uid}] 未捕捉例外0件・コードバグの痕跡なし")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE, help="検査するサイトのURL")
    ap.add_argument("--uid", action="append", dest="uids", default=None,
                     help="検査する公開プロフィールのUID(複数指定可)")
    ap.add_argument("--skip-static", action="store_true", help="Layer A(静的チェック)を省く")
    ap.add_argument("--skip-live", action="store_true", help="Layer B(ブラウザ検査)を省く")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    uids = args.uids or DEFAULT_UIDS

    problems: list[str] = []
    notes: list[str] = []

    if not args.skip_static:
        check_static_regression(base, problems, notes)
        check_deploy_drift(base, problems, notes)
        check_asset_version_bump(problems, notes)
        check_notif_visibility_guard(base, problems, notes)

    if not args.skip_live:
        print("== Layer B: 実際にブラウザで開いて確かめる ==")
        for uid in uids:
            check_live_profile(base, uid, problems, notes)

    print()
    if problems:
        print(f"NG: {len(problems)} 件の問題があります")
        for p in problems:
            print(f"  - {p}")
    else:
        print("OK: マイページは正常です")
    for n in notes:
        print(f"  (参考) {n}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("## マイページ健全性チェック\n\n")
            fh.write(f"対象: {base}\n\n")
            if problems:
                fh.write(f"**{len(problems)} 件の問題**\n\n")
                for p in problems:
                    fh.write(f"- {p}\n")
            else:
                fh.write("問題ありません。\n")
            # ★ notes も必ず出す(2026-08-06 レビューP2)。「許可リストの前提が
            #   崩れた」「アイコンが1つも無い」といった**見張りが目を失った信号**が、
            #   これまで標準出力の奥にしか残っていなかった
            if notes:
                fh.write("\n### 参考(見張り自身の状態)\n\n")
                for n in notes:
                    fh.write(f"- {n}\n")

    return 1 if problems else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as ex:  # noqa: BLE001
        print(f"ERROR: 検査を実行できませんでした: {ex}", file=sys.stderr)
        raise SystemExit(2)
