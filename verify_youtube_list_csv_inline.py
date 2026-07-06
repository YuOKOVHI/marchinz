#!/usr/bin/env python3
"""YouTubeリスト.csv と youtube-list/youtube-list.inline.js の内容が一致するか検証する。

- API 再生成（export_youtube_list_via_api.py）は両方を同時に書くが、手編集・片方だけのコミットでズレると
  サイトは inline のみ読むため「CSV は新しいのに表示が古い」等が起きる。
- 本スクリプトは CI・デプロイ前・手動 sync 後に実行し、ズレをブロックする。

使い方（010_MarchinZ で）:
  python3 verify_youtube_list_csv_inline.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
YOUTUBE_LIST_DIR = ROOT / "youtube-list"
CSV_PATH = YOUTUBE_LIST_DIR / "YouTubeリスト.csv"
INLINE_PATH = YOUTUBE_LIST_DIR / "youtube-list.inline.js"

EXPECTED_MIN_COLS = 20


def clean_header(name: str) -> str:
    return (name or "").strip().lstrip("\ufeff")


def load_rows_from_csv() -> tuple[list[dict[str, str]] | None, str]:
    if not CSV_PATH.is_file():
        return None, f"CSV なし: {CSV_PATH}"
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return None, "CSV にヘッダーがありません"
        names = [clean_header(n) for n in reader.fieldnames]
        if len(names) < EXPECTED_MIN_COLS:
            return None, f"CSV 列数が不足: {len(names)}"
        rows: list[dict[str, str]] = []
        for raw in reader:
            row: dict[str, str] = {}
            for old_name, new_name in zip(reader.fieldnames or [], names):
                row[new_name] = (raw.get(old_name) or "").strip()
            rows.append(row)
    if not rows:
        return None, "CSV にデータ行がありません"
    return rows, ""


def load_rows_from_inline() -> tuple[list[dict[str, str]] | None, str]:
    if not INLINE_PATH.is_file():
        return None, f"inline なし: {INLINE_PATH}"
    text = INLINE_PATH.read_text(encoding="utf-8")
    m = re.match(r"window\.__YOUTUBE_LIST_ROWS\s*=\s*(.+);\s*$", text, re.S)
    if not m:
        return None, f"{INLINE_PATH.name}: 想定フォーマットではありません"
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        return None, f"{INLINE_PATH.name}: JSON 解析失敗: {e}"
    if not isinstance(data, list):
        return None, f"{INLINE_PATH.name}: ルートが配列ではありません"
    rows: list[dict[str, str]] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            return None, f"{INLINE_PATH.name}: rows[{i}] がオブジェクトではありません"
        rows.append({str(k): str(v).strip() if v is not None else "" for k, v in item.items()})
    if not rows:
        return None, f"{INLINE_PATH.name}: データ行がありません"
    return rows, ""


def verify_youtube_csv_inline_match() -> tuple[bool, str]:
    csv_rows, err = load_rows_from_csv()
    if csv_rows is None:
        return False, err
    inl_rows, err2 = load_rows_from_inline()
    if inl_rows is None:
        return False, err2
    if len(csv_rows) != len(inl_rows):
        return (
            False,
            f"YouTubeリスト: チャンネル数不一致 CSV={len(csv_rows)} inline={len(inl_rows)}",
        )
    header_keys = list(csv_rows[0].keys())
    for i, (ra, rb) in enumerate(zip(csv_rows, inl_rows)):
        name = ra.get("チャンネル名") or rb.get("チャンネル名") or f"(#{i + 1})"
        for k in header_keys:
            va = str(ra.get(k, "")).strip()
            vb = str(rb.get(k, "")).strip()
            if va != vb:
                return (
                    False,
                    f"YouTubeリスト不一致: row={i + 1} チャンネル={name!r} 列={k!r} "
                    f"CSV={va[:120]!r} inline={vb[:120]!r}",
                )
        extra = set(rb) - set(ra)
        if extra:
            return False, f"YouTubeリスト不一致: row={i + 1} {name!r} inline に余計なキー {extra!r}"
    return True, ""


def main() -> int:
    ok, msg = verify_youtube_csv_inline_match()
    if not ok:
        print(msg, file=sys.stderr)
        print(
            "ヒント: CSV を正として `python3 sync_youtube_list_csv_to_inline.py` を実行し、"
            "両ファイルをまとめてコミットしてください。",
            file=sys.stderr,
        )
        return 1
    csv_rows, _ = load_rows_from_csv()
    print(f"OK: YouTubeリスト.csv と youtube-list.inline.js が一致（{len(csv_rows)} チャンネル）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
