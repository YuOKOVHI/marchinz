#!/usr/bin/env python3
"""
YouTubeリスト.csv → youtube-list/youtube-list.inline.js 同期（単一の正: CSV）。

使い方（010_MarchinZ ディレクトリで）:
  python3 sync_youtube_list_csv_to_inline.py
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
YOUTUBE_LIST_DIR = ROOT / "youtube-list"
CSV_PATH = YOUTUBE_LIST_DIR / "YouTubeリスト.csv"
OUT_PATH = YOUTUBE_LIST_DIR / "youtube-list.inline.js"

EXPECTED_MIN_COLS = 20


def clean_header(name: str) -> str:
    """Excel 等の UTF-8 BOM が先頭列名に付くのを除去（ロゴ列キー不一致防止）。"""
    return (name or "").strip().lstrip("\ufeff")


def main() -> int:
    if not CSV_PATH.is_file():
        print(f"error: missing {CSV_PATH}", file=sys.stderr)
        return 1
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("error: CSV has no header row", file=sys.stderr)
            return 1
        names = [clean_header(n) for n in reader.fieldnames]
        if len(names) < EXPECTED_MIN_COLS:
            print(
                f"error: unexpected column count {len(names)}",
                file=sys.stderr,
            )
            return 1
        rows: list[dict[str, str]] = []
        for raw in reader:
            row = {}
            for old_name, new_name in zip(reader.fieldnames or [], names):
                row[new_name] = (raw.get(old_name) or "").strip()
            rows.append(row)
    if not rows:
        print("error: no data rows in CSV", file=sys.stderr)
        return 1
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        "window.__YOUTUBE_LIST_ROWS = " + body + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT_PATH} ({len(rows)} channels)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
