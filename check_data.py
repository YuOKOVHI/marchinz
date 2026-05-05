#!/usr/bin/env python3
"""data.json と大会動画 CSV（2 本同時）の整合を検査する（ビルド後の確認用）。

`sync_csv_to_json.SOURCE_CSVS` と同じ並び・同じ 2 ファイルを必ずまとめて検査する。
片方だけの CSV では `check_data.py` を通さない運用にしてください。
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from sync_csv_to_json import SOURCE_CSVS

ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT / "data.json"
CSV_PATHS = SOURCE_CSVS
YOUTUBE_LIST_PATH = ROOT / "YouTubeリスト.csv"

EXPECTED_FIELDS = (
    "種別",
    "分類",
    "動画での表示名",
    "団体/チーム名",
    "団体ID",
    "配信日",
    "大会名",
    "URL",
    "動画配信元",
    "動画配信元URL",
    "動画配信元ロゴURL",
)

YOUTUBE_URL_FIELDS = (
    "最新動画URL",
    "動画視聴回数1位URL",
    "動画視聴回数2位URL",
    "動画視聴回数3位URL",
    "動画視聴回数4位URL",
    "最新LIVE URL",
    "LIVE視聴回数1位URL",
    "LIVE視聴回数2位URL",
    "LIVE視聴回数3位URL",
    "LIVE視聴回数4位URL",
)


def _is_url_or_empty(value: str) -> bool:
    t = str(value or "").strip()
    return t == "" or t.startswith("http://") or t.startswith("https://")


def validate_youtube_list_csv(errs: list[str]) -> None:
    if not YOUTUBE_LIST_PATH.is_file():
        errs.append(f"CSV なし: {YOUTUBE_LIST_PATH}")
        return
    with YOUTUBE_LIST_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=2):
            name = str(row.get("チャンネル名") or "").strip() or f"(row {idx})"
            extra = row.get(None)
            if extra:
                errs.append(f"YouTubeリスト列ずれ: {name} / line {idx} / extra={extra!r}")
            for key in YOUTUBE_URL_FIELDS:
                v = str(row.get(key) or "").strip()
                if not _is_url_or_empty(v):
                    errs.append(f"YouTubeリストURL不正: {name} / {key}={v!r}")


def main() -> int:
    errs: list[str] = []
    if not JSON_PATH.is_file():
        errs.append(f"ない: {JSON_PATH}")
        print("\n".join(errs), file=sys.stderr)
        return 1
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    rows = data.get("rows")
    if not isinstance(rows, list):
        errs.append("data.json: rows が配列ではない")
        print("\n".join(errs), file=sys.stderr)
        return 1
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            errs.append(f"rows[{i}] がオブジェクトではない")
            continue
        for k in EXPECTED_FIELDS:
            if k not in r:
                errs.append(f"rows[{i}]: キー不足 {k}")
    csv_total = 0
    for csv_path in CSV_PATHS:
        if not csv_path.is_file():
            errs.append(f"CSV なし: {csv_path}")
            continue
        with csv_path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            if tuple(reader.fieldnames or ()) != EXPECTED_FIELDS:
                errs.append(
                    f"CSV ヘッダー不一致({csv_path.name}): {reader.fieldnames!r} != {EXPECTED_FIELDS!r}"
                )
            csv_rows = list(reader)
            csv_total += len(csv_rows)
    if csv_total != len(rows):
        errs.append(f"件数不一致: JSON {len(rows)} / CSV合算 {csv_total}")
    validate_youtube_list_csv(errs)
    if errs:
        print("\n".join(errs), file=sys.stderr)
        return 1
    names = " + ".join(p.name for p in CSV_PATHS)
    print(f"OK: {len(rows)} 行（JSON・列名・CSV 合算件数／{names}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
