#!/usr/bin/env python3
"""本番サイトを外から見て、壊れていないかを確かめる（1日1回）。

## なぜ必要か

これまでの検査はすべて「リポジトリの中身」を見ていた。だが 2026-07-22 に
起きたのは **リポジトリは正しいのに本番だけ古い/欠けている** という壊れ方で、
リポジトリをいくら見ても永遠に気づけなかった。

  名簿(site-nav.js) 正しい ✓ → bot がデータ生成 ✓ → CI 緑 ✓
  → しかし本番の画面にはチャンネルが出ていない ✗

原因は netlify.toml の ignore（データだけの push はビルドしない＝クレジット
節約のための正しい設計）と、実行時リフレッシュの取りこぼしの組み合わせ。
どちらも「異常」ではないので、誰もエラーを出さない。**無音で壊れる**。

そこで、本番URLを実際に取得して不変条件を検査する目をここに置く。

## 検査する不変条件

  1. 主要ページが 200 で返る（TOP・映像ツール4本）
  2. 本番の index.html の版が、リポジトリの HEAD と一致する
     （ズレ＝デプロイ失敗、またはデータのみ push が続いてビルドが止まっている）
  3. 名簿の全チャンネルが、**本番が配信中のデータで** ロゴを持っている
     （＝画面にカードが出る条件。7/22 の症状はこれで検知できる）
  4. 実行時リフレッシュの供給元（raw の inline）が生きていて、
     本番同梱データより新しいか同じ

## 消費するもの

  - Netlify のビルドクレジット: **消費しない**（読むだけ。commit も push も
    絶対にしない。異常はワークフローの失敗＝メール通知で伝える）
  - 帯域: 1回あたり約 400KB（月 12MB 程度）
  - GitHub Actions: public リポジトリのため無料。1回 15 秒ほど

## 使い方

    python3 check_production.py                    # 本番を検査
    python3 check_production.py --base <URL>       # 別環境（Deploy Preview 等）
    python3 check_production.py --skip-version     # 版の一致だけ見ない

終了コード: 0=正常 / 1=異常あり / 2=検査自体を実行できなかった
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
SITE_NAV = ROOT / "site-nav.js"
DEFAULT_BASE = "https://marchinz.netlify.app"
RAW_BASE = "https://raw.githubusercontent.com/YuOKOVHI/marchinz/main/"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 落ちていたら影響が大きいページ。(名前, パス, そのページにしか無い目印)
#
# 目印が要る理由: netlify.toml の SPA フォールバック(/* → /index.html, 200)に
# より、**存在しないURLでも HTTP 200 で TOP の HTML が返る**。ステータスだけ
# 見る検査は「常に合格」で何も証明しない(この検査を書いた当初やってしまった)。
PAGES = [
    ("TOP", "/", 'data-mz-version="'),
    ("Switcher", "/tools/switcher/", 'data-mz-tool="switcher"'),
    ("Vlog", "/tools/vlog/", 'data-mz-tool="vlog"'),
    ("Privacy", "/tools/privacy/", 'data-mz-tool="privacy"'),
    ("ReAngle", "/tools/reangle/", 'data-mz-tool="reangle"'),
]


def fetch(url: str, timeout: float = 20.0) -> tuple[int, str]:
    """(HTTPステータス, 本文) を返す。取得できなければ (0, 理由)。"""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "ja,en;q=0.8",
        "Cache-Control": "no-cache",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def parse_channels() -> list[tuple[str, str]]:
    """site-nav.js の channels から (表示名, URL)。
    取り出し方は export_youtube_list_via_api.py と同じ（あちらが正なので合わせる）。"""
    text = SITE_NAV.read_text(encoding="utf-8")
    m = re.search(r"(?:const|let)\s+channels\s*=\s*\[", text)
    if not m:
        raise ValueError("site-nav.js から channels 配列を見つけられません")
    s = m.start()
    m_end = re.search(r"(?:const|let)\s+videoMetaByUrl\s*=", text[s:])
    if not m_end:
        raise ValueError("site-nav.js から videoMetaByUrl を見つけられません")
    section = text[s:s + m_end.start()]
    lines = section.splitlines()
    pairs: list[tuple[str, str]] = []
    for i, line in enumerate(lines):
        m_name = re.search(r'name:\s*"((?:[^"\\]|\\.)*)"', line)
        if not m_name:
            continue
        name = m_name.group(1).replace('\\"', '"')
        for j in range(i + 1, min(i + 12, len(lines))):
            m_url = re.search(r'url:\s*"([^"]+)"', lines[j])
            if m_url and "youtube.com" in m_url.group(1):
                pairs.append((name, m_url.group(1)))
                break
    return pairs


def parse_inline_rows(js: str) -> list[dict]:
    """window.__YOUTUBE_LIST_ROWS = [...] の中身を取り出す。"""
    m = re.search(r"window\.__YOUTUBE_LIST_ROWS\s*=\s*(\[[\s\S]*?\])\s*;?\s*$", js.strip())
    if not m:
        m = re.search(r"window\.__YOUTUBE_LIST_ROWS\s*=\s*(\[[\s\S]*\])", js)
    if not m:
        raise ValueError("__YOUTUBE_LIST_ROWS を取り出せません")
    return json.loads(m.group(1))


def norm_url(u: str) -> str:
    return str(u or "").strip().rstrip("/").lower()


def head_version() -> str:
    """リポジトリ HEAD の index.html から版を読む（作業ツリーではなくコミット実体）。"""
    try:
        out = subprocess.run(
            ["git", "show", "HEAD:index.html"], cwd=ROOT,
            capture_output=True, text=True, check=True,
        ).stdout
    except Exception:
        out = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r'data-mz-version="([^"]+)"', out)
    return m.group(1) if m else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE, help="検査するサイトのURL")
    ap.add_argument("--skip-version", action="store_true", help="版の一致を見ない")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    problems: list[str] = []
    notes: list[str] = []

    # ---- 1) 主要ページが生きているか ----
    print("== ページの生存 ==")
    top_html = ""
    for name, path, marker in PAGES:
        status, body = fetch(base + path)
        has_marker = status == 200 and marker in body
        if name == "TOP" and status == 200:
            top_html = body
        mark = "OK " if has_marker else "NG "
        print(f"  {mark} {name:<10} {status} {base + path}")
        if status != 200:
            problems.append(f"{name} が HTTP {status}（{base + path}）")
        elif not has_marker:
            # SPAフォールバックに吸われている＝そのページが存在しない
            problems.append(
                f"{name} のページが見つかりません（{base + path} が別ページを返しています）")

    # ---- 2) 本番の版が HEAD と一致するか ----
    if not args.skip_version:
        print("== 版の一致 ==")
        want = head_version()
        got = ""
        if top_html:
            m = re.search(r'data-mz-version="([^"]+)"', top_html)
            got = m.group(1) if m else ""
        print(f"  HEAD={want or '不明'} / 本番={got or '不明'}")
        if want and got and want != got:
            problems.append(
                f"本番の版が古い（HEAD={want} / 本番={got}）。"
                "デプロイ失敗か、データのみの push が続いてビルドが止まっている可能性")
        elif not got:
            notes.append("本番の版を読み取れませんでした（TOPの取得失敗？）")

    # ---- 3) 本番が配信中のデータで、全チャンネルにロゴがあるか ----
    print("== チャンネルの中身（本番が配信しているデータ） ==")
    prod_url = f"{base}/youtube-list/youtube-list.inline.js"
    status, body = fetch(prod_url)
    prod_rows: list[dict] = []
    if status != 200:
        problems.append(f"本番の youtube-list.inline.js が HTTP {status}")
    else:
        try:
            prod_rows = parse_inline_rows(body)
        except Exception as e:
            problems.append(f"本番の youtube-list.inline.js を解釈できません: {e}")

    if prod_rows:
        by_url = {norm_url(r.get("チャンネルURL")): r for r in prod_rows}
        by_name = {str(r.get("チャンネル名") or "").strip(): r for r in prod_rows}
        try:
            roster = parse_channels()
        except Exception as e:
            print(f"  名簿を読めません: {e}", file=sys.stderr)
            roster = []
        empty: list[str] = []
        missing: list[str] = []
        for name, url in roster:
            row = by_url.get(norm_url(url)) or by_name.get(name)
            if row is None:
                missing.append(name)
            elif not str(row.get("ロゴ画像URL") or "").strip():
                empty.append(name)
        print(f"  名簿 {len(roster)} 件 / 本番データ {len(prod_rows)} 件")
        if missing:
            problems.append("本番のデータに無いチャンネル: " + "、".join(missing))
        if empty:
            problems.append(
                "本番で中身が空のチャンネル（画面にカードが出ません）: " + "、".join(empty))
        if not missing and not empty and roster:
            print("  OK  全チャンネルにロゴがあります")

    # ---- 4) 実行時リフレッシュの供給元が生きているか ----
    print("== 実行時リフレッシュの供給元（raw） ==")
    status, body = fetch(RAW_BASE + "youtube-list/youtube-list.inline.js")
    if status != 200:
        problems.append(f"raw の youtube-list.inline.js が HTTP {status}（実行時リフレッシュが効きません）")
    else:
        try:
            raw_rows = parse_inline_rows(body)
            raw_empty = [str(r.get("チャンネル名") or "") for r in raw_rows
                         if not str(r.get("ロゴ画像URL") or "").strip()]
            print(f"  OK  raw {len(raw_rows)} 件 / 中身が空 {len(raw_empty)} 件")
            if raw_empty:
                # raw が空なら本番も直らない。bot 側の問題として知らせる
                problems.append("raw（botの出力）で中身が空: " + "、".join(raw_empty))
        except Exception as e:
            problems.append(f"raw の inline を解釈できません: {e}")

    # ---- まとめ ----
    print()
    if problems:
        print(f"NG: {len(problems)} 件の問題があります")
        for p in problems:
            print(f"  - {p}")
    else:
        print("OK: 本番は正常です")
    for n in notes:
        print(f"  （参考）{n}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("## 本番ヘルスチェック\n\n")
            fh.write(f"対象: {base}\n\n")
            if problems:
                fh.write(f"**{len(problems)} 件の問題**\n\n")
                for p in problems:
                    fh.write(f"- {p}\n")
                fh.write("\n直し方の目安:\n\n")
                fh.write("- 版が古い → 何かコード変更を push すればビルドが走ります\n")
                fh.write("- 中身が空のチャンネル → Actions の "
                         "「YouTube + note refresh」を手動実行\n")
                fh.write("- URL が変わっている → "
                         '`python3 fix_channel_url.py "チャンネル名" "新URL"`\n')
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
