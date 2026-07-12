#!/usr/bin/env python3
"""note の公式 RSS を取得して marchinz-notes.inline.js を生成する。

対象アカウント(ACCOUNTS)の記事を新しい順にまとめ、
    window.__MARCHINZ_NOTES = [ {account, accountLabel, title, url, pubDate, thumb}, ... ];
という 1 行の inline.js を書き出す(youtube-list.inline.js と同じ流儀)。

- Netlify のビルド前(netlify_prebuild_refresh.sh)とローカルの双方で実行できる。
- 依存はシステム Python 3 の標準ライブラリのみ(Mac に Homebrew 無し方針に合わせる)。
- ネット取得に全滅したときは、既存の inline.js を温存してビルドを壊さない。

使い方:
    python3 export_notes_feed.py            # 生成
    python3 export_notes_feed.py --dry-run  # 生成せず先頭だけ表示
"""

import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

# 表示名は index.html の既存表記・RSS の channel title に合わせて固定
ACCOUNTS = [
    {"handle": "marching_story", "label": "ちゃみ｜マーチング♪"},
    {"handle": "marching_matsuri", "label": "Marching notes™︎ byマーチング祭®︎"},
]

NS = {
    "media": "http://search.yahoo.com/mrss/",
    "dc": "http://purl.org/dc/elements/1.1/",
}
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "marchinz-notes.inline.js")
PER_ACCOUNT = 12  # 1 アカウントあたり取り込む最大件数
UA = "Mozilla/5.0 (compatible; MarchinZ-notes-fetcher/1.0)"


def fetch_rss(handle):
    url = "https://note.com/{}/rss".format(handle)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as res:
        return res.read()


def to_iso(pubdate):
    try:
        return parsedate_to_datetime(pubdate).isoformat()
    except Exception:
        return ""


def parse_items(handle, label, xml_bytes):
    channel = ET.fromstring(xml_bytes).find("channel")
    if channel is None:
        return []
    items = []
    for it in channel.findall("item")[:PER_ACCOUNT]:
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        if not title or not link:
            continue
        thumb_el = it.find("media:thumbnail", NS)
        thumb = thumb_el.text.strip() if thumb_el is not None and thumb_el.text else ""
        items.append({
            "account": handle,
            "accountLabel": label,
            "title": title,
            "url": link,
            "pubDate": to_iso(it.findtext("pubDate") or ""),
            "thumb": thumb,
        })
    return items


def main():
    dry_run = "--dry-run" in sys.argv
    all_items = []
    ok = 0
    for acc in ACCOUNTS:
        try:
            xml_bytes = fetch_rss(acc["handle"])
            items = parse_items(acc["handle"], acc["label"], xml_bytes)
            all_items.extend(items)
            ok += 1
            print("[notes] {}: {} items".format(acc["handle"], len(items)))
        except Exception as e:  # noqa: BLE001 - ネット/パース失敗はまとめて握る
            print("[notes] WARN {} failed: {}".format(acc["handle"], e), file=sys.stderr)

    if ok == 0:
        # 全滅時は既存ファイルを温存(初回だけ既存が無いので失敗扱い)
        if os.path.exists(OUT_PATH):
            print("[notes] all fetch failed; keep existing inline.js", file=sys.stderr)
            return 0
        print("[notes] all fetch failed and no existing file", file=sys.stderr)
        return 1

    all_items.sort(key=lambda x: x["pubDate"], reverse=True)
    payload = "window.__MARCHINZ_NOTES = " + json.dumps(all_items, ensure_ascii=False) + ";\n"

    if dry_run:
        print(payload[:600])
        return 0

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(payload)
    print("[notes] wrote {} ({} items)".format(OUT_PATH, len(all_items)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
