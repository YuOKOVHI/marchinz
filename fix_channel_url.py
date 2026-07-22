#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""チャンネルURLの変更を1コマンドで反映する運用スクリプト。

使い方:
    python3 fix_channel_url.py "ICHIKASHI ALUMNI CGT" "https://www.youtube.com/@ikalumni_2022"

やること(2026-07-21の事故の再発防止):
  1. site-nav.js(名簿の正本)の該当チャンネルのURLを差し替え
     URLをキーに使う他の表(videoMetaByUrl等)も含めて旧URLを全置換
  2. YouTubeリスト.csv も同じURLへ(バイト置換・CRLF維持)
  3. sync_youtube_list_csv_to_inline.py で inline を再生成
  4. verify_youtube_list_csv_inline.py / check_data.py で整合を確認
  5. 新URLが実在するか軽く確認(HTTP)

このリポジトリのYouTubeリストの構造:
  名簿(正本) = site-nav.js の channels 配列
  データ     = CSV / inline (botがAPIで生成するキャッシュ)
  ※ inlineだけ・CSVだけを直すと、botとCIの両方と喧嘩になる
"""
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAV = ROOT / "site-nav.js"
CSV = ROOT / "youtube-list" / "YouTubeリスト.csv"


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    name, new_url = sys.argv[1], sys.argv[2].strip()
    if not re.match(r"^https://www\.youtube\.com/", new_url):
        print(f"ERROR: YouTubeのURLではありません: {new_url}")
        return 2

    # --- 現在のURLを名簿から特定 ---
    nav = NAV.read_text(encoding="utf-8")
    m = re.search(
        r'name:\s*"' + re.escape(name) + r'"[\s\S]{0,400}?url:\s*"([^"]+)"', nav)
    if not m:
        print(f"ERROR: site-nav.js の名簿に「{name}」が見つかりません")
        return 2
    old_url = m.group(1)
    if old_url == new_url:
        print(f"変更不要: すでに {new_url} です")
        return 0
    print(f"旧URL: {old_url}")
    print(f"新URL: {new_url}")

    # --- 新URLの生存確認(YouTubeは存在しないハンドルに404を返す) ---
    try:
        req = urllib.request.Request(new_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as res:
            if res.status >= 400:
                print(f"ERROR: 新URLがHTTP {res.status} を返しました")
                return 1
    except Exception as ex:
        print(f"ERROR: 新URLへ到達できません: {ex}")
        return 1
    print("新URL: 到達OK")

    # --- 1) site-nav.js: 旧URLを全置換(名簿+URLキーの表) ---
    cnt_nav = nav.count(old_url)
    NAV.write_text(nav.replace(old_url, new_url), encoding="utf-8")
    print(f"site-nav.js: {cnt_nav}箇所を置換")

    # --- 2) CSV: バイト置換(CRLFと他行を触らない) ---
    raw = CSV.read_bytes()
    cnt_csv = raw.count(old_url.encode("utf-8"))
    if cnt_csv:
        CSV.write_bytes(raw.replace(old_url.encode("utf-8"), new_url.encode("utf-8")))
    print(f"CSV: {cnt_csv}箇所を置換")

    # --- 3) inline 再生成 → 4) 検証 ---
    for cmd in (
        [sys.executable, "sync_youtube_list_csv_to_inline.py"],
        [sys.executable, "verify_youtube_list_csv_inline.py"],
        [sys.executable, "check_data.py"],
    ):
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode != 0:
            print(f"ERROR: {' '.join(cmd[1:])} が失敗しました")
            return 1

    print()
    print("完了。あとは:")
    print("  1. git diff で確認 → commit")
    print("  2. push(要・優さんの許可)")
    print("  3. ロゴ・動画データはGitHub Actionsの手動実行か2日おきのbotが埋めます")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
