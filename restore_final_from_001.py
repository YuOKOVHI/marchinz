#!/usr/bin/env python3
"""動画リスト_001.csv を参照に、「FINAL」が空白化された列だけ 大会動画リスト_マーチング祭.csv を復元する。

想定: 誤って `FINAL` → 半角スペース したあと、参照 CSV には正しい `FINAL` が残っている。
行順・件数は両方一致していること。

使い方:
  python3 restore_final_from_001.py
  python3 sync_csv_to_json.py
  python3 check_data.py
"""
from __future__ import annotations

import csv
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAIN = ROOT / "大会動画リスト_マーチング祭.csv"
REF = ROOT / "動画リスト_001.csv"

FIELDNAMES = (
    "種別",
    "分類",
    "動画での表示名",
    "団体/チーム名",
    "配信日",
    "大会名",
    "URL",
    "動画配信元",
    "動画配信元URL",
)

COLUMNS = ("動画での表示名", "団体/チーム名", "大会名")


def load_rows(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    return list(csv.DictReader(text.splitlines()))


def main() -> int:
    if not MAIN.is_file() or not REF.is_file():
        print("大会動画リスト_マーチング祭.csv または 動画リスト_001.csv が見つかりません。", file=sys.stderr)
        return 1

    main_rows = load_rows(MAIN)
    ref_rows = load_rows(REF)

    if len(main_rows) != len(ref_rows):
        print(
            f"行数が一致しません: 動画リスト {len(main_rows)} / 参照 {len(ref_rows)}",
            file=sys.stderr,
        )
        return 1

    patched = 0
    for m, r in zip(main_rows, ref_rows):
        for col in COLUMNS:
            a = (m.get(col) or "").strip()
            b = (r.get(col) or "").strip()
            if a == b:
                continue
            # 参照の FINAL をすべて 1 スペースにしたものが正側と一致 → 正側を参照で上書き
            if a == b.replace("FINAL", " "):
                m[col] = r.get(col, "")
                patched += 1

    if patched:
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=FIELDNAMES, lineterminator="\n")
        w.writeheader()
        for row in main_rows:
            w.writerow({k: (row.get(k) or "") for k in FIELDNAMES})
        MAIN.write_text("\ufeff" + buf.getvalue(), encoding="utf-8")

    print(f"復元したフィールド数: {patched}（参照: {REF.name} → 正: {MAIN.name}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
