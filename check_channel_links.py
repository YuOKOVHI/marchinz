#!/usr/bin/env python3
"""YouTubeチャンネルURLのリンク切れを検出する。

site-nav.js の channels 配列を正として、各チャンネルURLへ実際にアクセスし、
404(チャンネル消滅・ハンドル変更)を見つけて知らせる。

## なぜ必要か

export_youtube_list_via_api.py は、APIでチャンネルを引けなかったとき
「チャンネル名とURLだけ、他は全部空」の行を静かに作る(例外も警告も出ない)。
その結果、YouTubeリストに中身の無いカードが並ぶだけで、誰も気づけない。

2026-07-21、ICHIKASHI ALUMNI CGT が @ichikashialumnicgt2562 から
@ikalumni_2022 へ移った際にこれを踏んだ。優さんが画面を見て気づくまで
分からなかったため、自動で気づける仕組みとしてこれを用意した。

## 使い方

    python3 check_channel_links.py            # 全チャンネルを確認
    python3 check_channel_links.py --quiet    # 切れているものだけ表示
    python3 check_channel_links.py --offline  # 通信せず、既存データの空欄から疑いを出す

終了コード: 0=全部生きている / 1=切れているものがある / 2=実行できなかった

GitHub Actions では $GITHUB_STEP_SUMMARY にも書き出すので、
ワークフローの実行結果ページに一覧が残る。
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
SITE_NAV = ROOT / "site-nav.js"
INLINE = ROOT / "youtube-list" / "youtube-list.inline.js"

# UA を付けないと YouTube がボット扱いで別のページを返すことがある
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def parse_channels() -> list[tuple[str, str]]:
    """site-nav.js の channels から (表示名, URL) を取り出す。
    取り出し方は export_youtube_list_via_api.py と同じ(あちらが正なので合わせる)。"""
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


def parse_data_json_sources() -> list[tuple[str, str]]:
    """data.json の「動画配信元URL」。channels に載っていない配信元(チャンネルID
    形式で書かれたものなど)もここから拾う。動画カードのリンク先になるため、
    切れると視聴者が飛べなくなる。"""
    path = ROOT / "data.json"
    if not path.exists():
        return []
    rows = json.loads(path.read_text(encoding="utf-8")).get("rows", [])
    seen: dict[str, str] = {}
    for r in rows:
        url = (r.get("動画配信元URL") or "").strip()
        if url.startswith("http") and url not in seen:
            seen[url] = (r.get("動画配信元") or "(名前なし)").strip()
    return [(name, url) for url, name in seen.items()]


def check_url(url: str, timeout: float = 15.0) -> tuple[bool, str]:
    """(生きているか, 説明) を返す。判断できないときは「生きている」側に倒す
    (通信の一時失敗でリンク切れと騒がないため)。"""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "ja,en;q=0.8",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return True, f"HTTP {res.status}"
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False, "HTTP 404（チャンネルが見つかりません）"
        if e.code == 429:
            return True, "HTTP 429（アクセス制限。判定を保留）"
        return True, f"HTTP {e.code}（判定を保留）"
    except Exception as e:  # 通信断・タイムアウト等
        return True, f"確認できず（{type(e).__name__}）"


def load_empty_rows() -> list[tuple[str, str]]:
    """youtube-list.inline.js で中身が空になっているチャンネル。
    リンクが切れると必ずこの形になるので、通信せずに疑いを出せる。"""
    if not INLINE.exists():
        return []
    s = INLINE.read_text(encoding="utf-8")
    m = re.search(r"=\s*(\[.*\])\s*;?\s*$", s, re.S)
    if not m:
        return []
    rows = json.loads(m.group(1))
    return [(r.get("チャンネル名", ""), r.get("チャンネルURL", ""))
            for r in rows
            if not r.get("最新動画URL") and not r.get("動画視聴回数1位URL")]


def report(broken: list[tuple[str, str, str, str]], suspect: list[tuple[str, str]]) -> None:
    """人が読む形で結果を出す。Actions ではサマリにも残す。"""
    lines: list[str] = []
    if broken:
        lines.append("## ⚠ リンクが切れているチャンネル\n")
        lines.append("| チャンネル名 | URL | 状態 | 書いてある場所 |")
        lines.append("| --- | --- | --- | --- |")
        for name, url, why, where in broken:
            lines.append(f"| {name} | {url} | {why} | {where} |")
        lines.append("")
        lines.append("**直し方**: 新しいチャンネルURLを調べて書き換えてください。")
        lines.append("")
        lines.append("- `site-nav.js` … `channels` 内の該当 `url:`"
                     "(`youtube-list.inline.js` は2日おきの自動更新で追随します)")
        lines.append("- `data.json` … 該当行の「動画配信元URL」"
                     "(元CSVがある場合はそちらも)")
    if suspect:
        lines.append("")
        lines.append("## 中身が空のチャンネル（表示が寂しくなっています）\n")
        for name, url in suspect:
            lines.append(f"- {name} … {url}")
        lines.append("")
        lines.append("URLは生きているので、動画がまだ無いか、"
                     "URL変更直後で次回の自動更新を待っている状態です。")
    text = "\n".join(lines)
    if text:
        print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary and text:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="YouTubeチャンネルのリンク切れを調べる")
    ap.add_argument("--quiet", action="store_true", help="切れているものだけ表示する")
    ap.add_argument("--offline", action="store_true", help="通信せず、既存データの空欄だけを見る")
    ap.add_argument("--interval", type=float, default=0.3, help="確認の間隔（秒）")
    args = ap.parse_args()

    try:
        pairs = parse_channels()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    if not pairs:
        print("ERROR: channels が 0 件です", file=sys.stderr)
        return 2

    # data.json の配信元URLのうち、channels に無いものを足す(重複は見ない)
    known = {u for _, u in pairs}
    targets = [(n, u, "site-nav.js") for n, u in pairs]
    targets += [(n, u, "data.json") for n, u in parse_data_json_sources() if u not in known]

    empty = {url for _, url in load_empty_rows()}

    if args.offline:
        # 通信しない。空欄をそのまま「疑い」として出す
        suspect = [(n, u) for n, u in pairs if u in empty]
        if suspect:
            print(f"中身が空のチャンネルが {len(suspect)} 件あります"
                  f"（リンク切れの可能性。通信して確かめるには --offline を外してください）")
            for n, u in suspect:
                print(f"  ? {n}  {u}")
            return 1
        print(f"OK: {len(pairs)}チャンネルすべて中身が入っています")
        return 0

    broken: list[tuple[str, str, str, str]] = []
    alive_but_empty: list[tuple[str, str]] = []
    for i, (name, url, where) in enumerate(targets, start=1):
        ok, why = check_url(url)
        if not args.quiet:
            mark = "OK " if ok else "NG "
            print(f"[{i}/{len(targets)}] {mark} {name}  {why}", file=sys.stderr)
        if not ok:
            broken.append((name, url, why, where))
        elif url in empty:
            alive_but_empty.append((name, url))
        if i < len(targets):
            time.sleep(args.interval)   # 一気に叩かない

    report(broken, alive_but_empty)

    if broken:
        print(f"\n切れているチャンネル: {len(broken)}件", file=sys.stderr)
        return 1
    print(f"\nOK: {len(targets)}件すべて生きています"
          + (f"（うち{len(alive_but_empty)}件は中身が空）" if alive_but_empty else ""),
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
