#!/usr/bin/env python3
"""大会動画 CSV に「団体ID」列を付与し、空欄をブラウザと同じ決定論 ID で埋める。

- 列が無ければ「団体/チーム名」の直後に挿入する。
- 既に入っている「団体ID」はそのまま（手で同一 ID に複数の団体名を寄せる＝表記ゆれ対策）。
- 似ている名前を自動で束ねる処理はしない（曖昧マージなし）。

例:
  python3 migrate_csv_org_id.py
  python3 migrate_csv_org_id.py 大会動画リスト_マーチング祭.csv
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from marchinz_org_id import stable_org_id_for_team_name

ROOT = Path(__file__).resolve().parent

_ID_OK = re.compile(r"^[A-Za-z0-9_-]{1,48}$")


def valid_csv_org_id(s: str) -> bool:
    return bool(_ID_OK.fullmatch((s or "").strip()))


def insert_field(fieldnames: list[str], key: str, after: str) -> list[str]:
    if key in fieldnames:
        return fieldnames
    if after not in fieldnames:
        raise SystemExit(f"列 {after!r} が見つかりません: {fieldnames!r}")
    i = fieldnames.index(after) + 1
    return fieldnames[:i] + [key] + fieldnames[i:]


def migrate_file(path: Path) -> int:
    if not path.is_file():
        print(f"skip: ない {path}", file=sys.stderr)
        return 0
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        raw_fields = list(reader.fieldnames or [])
        rows = [dict(r) for r in reader]

    fieldnames = insert_field(raw_fields, "団体ID", "団体/チーム名")
    changed = 0

    taken: dict[str, str] = {}
    name_to_id: dict[str, str] = {}

    for row in rows:
        name = (row.get("団体/チーム名") or "").strip()
        oid = (row.get("団体ID") or "").strip()
        if oid and not valid_csv_org_id(oid):
            row["団体ID"] = ""
            oid = ""
            changed += 1
        if not oid:
            continue
        if oid not in taken:
            taken[oid] = name
        if name:
            name_to_id[name] = oid

    for row in rows:
        name = (row.get("団体/チーム名") or "").strip()
        oid = (row.get("団体ID") or "").strip()
        if oid:
            continue
        if not name:
            continue
        id0 = stable_org_id_for_team_name(name)
        idv = id0
        salt = 0
        while idv in taken and taken[idv] != name:
            salt += 1
            idv = stable_org_id_for_team_name(f"{name}\x00{salt}")
        row["団体ID"] = idv
        taken[idv] = name
        name_to_id[name] = idv
        changed += 1

    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fieldnames})

    print(f"OK: {path.name}（団体ID 列・空欄埋め。変更セル数の目安: {changed}）", file=sys.stderr)
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description="CSV に団体ID列を追加し空欄を埋める")
    ap.add_argument(
        "paths",
        nargs="*",
        type=Path,
        default=[
            ROOT / "大会動画リスト_マーチング祭.csv",
            ROOT / "大会動画リスト_DrumcorpsfunTV.csv",
            ROOT / "大会動画リスト_FloMarching_DCI.csv",
            ROOT / "大会動画リスト_POV.csv",
        ],
        help="対象 CSV（省略時はマーチング祭 + DrumcorpsfunTV + FloMarching + POV）",
    )
    args = ap.parse_args()
    total = 0
    for p in args.paths:
        total += migrate_file(p.resolve())
    print(f"done: 合計 {total} セル更新相当", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
