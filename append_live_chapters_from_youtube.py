#!/usr/bin/env python3
"""大会動画リスト_マーチング祭.csv（唯一の正）に、単一動画のチャプター行を追記する。yt-dlp でメタ取得。

必ず CSV を経由する: 本スクリプトは既定で 010_MarchinZ/大会動画リスト_マーチング祭.csv を書き換える。
続けて python3 sync_csv_to_json.py と check_data.py を実行すること（順序は docs/OPS_GUIDE.md）。

アーカイブが公開されチャプター情報がメタにあるときのみ有効。
配信前のみの URL では yt-dlp が失敗するためチャプター行は作れない。

例（アーカイブ公開後）:
  python3 append_live_chapters_from_youtube.py --video-id <VIDEO_ID> [--replace]
  python3 sync_csv_to_json.py
  python3 check_data.py

--replace は、同じ動画 ID を含む既存 CSV 行を先に削除してからマージする。
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

from sync_csv_to_json import FIELDNAMES, OUT_CSV

from build_data import fetch_video, load_team_index, merge_rows, read_csv_rows, rows_from_stream


def parse_video_arg(s: str) -> str:
    s = s.strip()
    if re.fullmatch(r"[\w-]{11}", s):
        return s
    m = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{11})", s)
    if m:
        return m.group(1)
    m = re.search(r"youtube\.com/live/([\w-]{11})", s)
    if m:
        return m.group(1)
    raise SystemExit(f"動画 ID を認識できません: {s!r}")


def url_has_vid(u: str, vid: str) -> bool:
    if not u:
        return False
    if vid in u:
        return True
    return f"v={vid}" in u or f"/live/{vid}" in u


def filter_out_video(existing: list[dict], vid: str) -> list[dict]:
    return [
        r
        for r in existing
        if isinstance(r, dict) and not url_has_vid(str(r.get("URL") or ""), vid)
    ]


def write_csv(rows: list[dict], dest: Path) -> None:
    with dest.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(FIELDNAMES))
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description="YouTube アーカイブからチャプター行を CSV に追記")
    ap.add_argument("--video-id", required=True, help="動画 ID または watch/live 形式の URL")
    ap.add_argument(
        "--replace",
        action="store_true",
        help="同じ動画 ID の既存 CSV 行を削除してから追記する",
    )
    ap.add_argument(
        "--csv",
        type=Path,
        default=None,
        help=f"対象 CSV（既定: {OUT_CSV}）",
    )
    args = ap.parse_args()

    vid = parse_video_arg(args.video_id)
    csv_path = args.csv if args.csv is not None else OUT_CSV

    try:
        d = fetch_video(vid)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1
    except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as e:
        print(str(e), file=sys.stderr)
        return 1

    team_index = load_team_index()
    new_rows = rows_from_stream(vid, d, team_index)

    existing = read_csv_rows(csv_path) if csv_path.is_file() else []
    base = filter_out_video(existing, vid) if args.replace else existing
    merged = merge_rows(base, new_rows)

    write_csv(merged, csv_path)
    print(
        f"OK: {csv_path} {len(existing)}→{len(merged)} "
        f"（チャプター行 {len(new_rows)} をマージ・重複除外 URL は merge_rows 準拠）",
        file=sys.stderr,
    )
    print("次: python3 sync_csv_to_json.py && python3 check_data.py", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
