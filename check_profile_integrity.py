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

    # renderHeader(profile, targetUid) { ... } の中身だけを許容範囲として除外する。
    # ざっくり「function renderHeader(profile, targetUid) {」から対応する閉じ括弧
    # までを飛ばす代わりに、行番号ベースで「renderHeader 内の profile.」だけを
    # 許可リストにする(この関数はブロックが大きくないため、開始行から300行を
    # 安全マージンとして許可範囲にする簡易実装)。
    lines = body.splitlines()
    allow_from = allow_to = -1
    for i, line in enumerate(lines):
        if re.search(r"function\s+renderHeader\s*\(\s*profile\s*,", line):
            allow_from = i
            allow_to = i + 60  # renderHeader は実測40行未満。余裕を持って60行
            break

    bad_lines = []
    for i, line in enumerate(lines):
        if allow_from <= i <= allow_to:
            continue
        if re.search(r"\bprofile\.(display_name|avatar_url|marchinz_public_id|updated_at)\b", line):
            bad_lines.append((i + 1, line.strip()))

    if bad_lines:
        for ln, text in bad_lines:
            problems.append(f"user-profile-page.js:{ln} にスコープ外の profile. 参照が復活: {text}")
    else:
        print("  OK  スコープ外の profile. 参照なし")

    if allow_from < 0:
        notes.append("renderHeader(profile, targetUid) が見つからなかった"
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
            problems.append(
                f"本番の {f} が HEAD と一致しない(未デプロイの修正が残っているか、"
                "本番だけ古い)。push/デプロイの状態を確認してください")
        else:
            print(f"  OK  {f} は HEAD と一致")


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
        r"|Failed to load resource.*403"
        r"|net::ERR_ABORTED"
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

    if not page_errors and not console_errors and not warn_bugs:
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

    return 1 if problems else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as ex:  # noqa: BLE001
        print(f"ERROR: 検査を実行できませんでした: {ex}", file=sys.stderr)
        raise SystemExit(2)
