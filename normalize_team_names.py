#!/usr/bin/env python3
"""大会動画リスト_マーチング祭.csv の「団体/チーム名」の表記ゆれを揃える（再現可能・手修正の補助）。

使い方（010_MarchinZ で）:

  python3 normalize_team_names.py --dry-run   # 変更案だけ表示（CSV は書き換えない）
  python3 normalize_team_names.py             # 問題なければ本適用

仕様:
  1. Unicode NFKC 正規化 + 連続空白の圧縮
  2. 明示マップ（団体単位での別名統合）

※ 団体単位での判断が必要なものだけマップしている（迷うものは統合しない）。
"""
from __future__ import annotations

import argparse
import csv
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "大会動画リスト_マーチング祭.csv"


def nfkc_spaces(s: str) -> str:
    """NFKC 正規化＋連続空白の圧縮。Unicode 全文の 「（」「）」は半角へ落とさない。"""
    t = (s or "").strip()
    if not t:
        return ""
    token_o = "\ue100"
    token_c = "\ue101"
    t = t.replace("（", token_o).replace("）", token_c)
    t = unicodedata.normalize("NFKC", t)
    t = t.replace(token_o, "（").replace(token_c, "）")
    return " ".join(t.split())


# nfkc_spaces 済みキーでの置換 → 統一後の名前（CSV の正表記に合わせる）
REPLACE_AFTER_NFKC: dict[str, str] = {
    # Drum&Bugle は「&」まわりスペースなし表記（CSV 正）
    "Imperial Sound Drum & Bugle Corps": "Imperial Sound Drum&Bugle Corps",
    "Tokyo Phoenix Drum & Bugle Corps": "Tokyo Phoenix Drum&Bugle Corps",
    # THE FOCUS カラー系は小文字 color guard
    "THE FOCUS CG": "THE FOCUS color guard",
    "THE FOCUS Color Guard": "THE FOCUS color guard",
    "THE FOCUS colorguard": "THE FOCUS color guard",
    # 横浜隼人ほか見出し内のゆれ（スペース有無）
    "THE 永野STARS": "THE 永野 STARS",
    # Jr. と Team の間など
    "東海学院大学Jr.マーチングバンドTeam KOBADAI": "東海学院大学Jr.マーチングバンド Team KOBADAI",
    "東海学院大学Jr.マーチングバンドTeam SYU": "東海学院大学Jr.マーチングバンド TEAM SYU",
    "横浜市ジュニアマーチングバンドBayWind": "横浜市ジュニアマーチングバンド BayWind",
    "関東学院マーチングバンドWinds": "関東学院マーチングバンド Winds",
}


def normalize_team_name(raw: str) -> str:
    # 団体名がスペース1文字だけの行（意図的な「未設定」表現）を消さない
    if raw == " ":
        return " "

    s = nfkc_spaces(raw)
    if not s:
        return ""

    if s in REPLACE_AFTER_NFKC:
        s = REPLACE_AFTER_NFKC[s]

    if s == "THE FOCUS with エリック宮城":
        s = "THE FOCUS"

    if s == "Tokyo Phoenix":
        s = "Tokyo Phoenix Drum&Bugle Corps"

    if s == "Tokyo Phoenix Color Guard":
        s = "Tokyo Phoenix D&B Color Guard"

    if s == "Imperial Sound D&BC":
        s = "Imperial sound D&B Corps"

    # Keys は団体一覧で区別できるよう字面をクォート（CSV と同様）
    if s == "Keys":
        s = '"' + "Keys" + '"'

    # TOHO と TMB の同一チーム別表記（出典表記ゆれ対策）
    if s == "TOHO MARCHING BAND 3しまい":
        s = "TMB team 3しまい"

    # Via Jr.: NFKC と空白整理後、`〜チームZoo` と `〜チーム革命` で固定
    if s.startswith("Via Jr.") and ("チームZoo" in s or "チーム zoo" in s.lower()):
        s = "Via Jr. 〜チームZoo〜"
    elif s.startswith("Via Jr.") and "革命" in s:
        s = "Via Jr. 〜チーム革命〜"

    # つつじが丘ジュニアマーチングバンド の英語 / 略記ゆれ（同一団体扱い）
    if s in ("Tsutsujigaoka Jr. MarchingBand", "つつじが丘 Jr.MB"):
        s = "つつじが丘ジュニアマーチングバンド"

    # Bluujua（本体とコロガの表記）
    if s == "Bluujua Colorguard":
        s = "Bluujua"

    # 宇治市立：学校名の「槇/槙」混在の一方に（マーチングバンド名は schools 表記に合わせる）
    if s == "宇治市立槇島小学校マーチングバンド":
        s = "宇治市立槙島小学校マーチングバンド"

    # ゆかとしぃ / ゆかとしー（同一表記に）
    if s == "ゆかとしー":
        s = "ゆかとしぃ"

    # T&T / TT（短い略称の表記ゆれ）
    if s == "TT":
        s = "T&T"

    # imperial sound（小文字）→ 表記だけ整える（CG 出場行とフルコース名を区別するため D&BC には統合しない）
    if s == "imperial sound":
        s = "Imperial Sound"

    # 初回のみ NFKC により半角になる場合があったゆれを、団体検索での見た目に合わせて戻す
    restore_fw = {
        "小川(ちいかわ)": "小川（ちいかわ）",
        "きらきら星(ひとで)": "きらきら星（ひとで）",
        "忘羨(ワン シエン)": "忘羨（ワン シエン）",
        "Brass Bank(金管五重奏)": "Brass Bank（金管五重奏）",
    }
    if s in restore_fw:
        s = restore_fw[s]

    return s


def main(*, dry_run: bool) -> None:
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        if not fieldnames or "団体/チーム名" not in fieldnames:
            raise SystemExit("CSV に 団体/チーム名 列がありません")
        rows = list(reader)

    changes: list[tuple[int, str, str]] = []
    for i, row in enumerate(rows, start=2):
        col = "団体/チーム名"
        old = row.get(col) or ""
        new = normalize_team_name(old)
        if dry_run:
            if new != old:
                row[col] = old
                changes.append((i, old, new))
        else:
            row[col] = new
            if new != old:
                changes.append((i, old, new))

    if not dry_run:
        with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
            w.writeheader()
            w.writerows(rows)

    prefix = "[dry-run] " if dry_run else ""
    if dry_run:
        print(f"{prefix}{CSV_PATH.name} の「団体/チーム名」への変更予定（ファイルは変更していません）")
    else:
        print(f"OK: {CSV_PATH.name} の「団体/チーム名」を更新しました")
    print(f"{prefix}変更行数: {len(changes)}")
    if not changes:
        print(f"{prefix}差分はありません。")
        return
    summary: dict[tuple[str, str], list[int]] = {}
    for line, o, n in changes:
        key = (o, n)
        summary.setdefault(key, []).append(line)
    print(f"{prefix}（行番号 / 変更前 → 変更後）")
    for (o, n), lines in sorted(summary.items(), key=lambda x: (x[0][0], min(x[1]))):
        lineno = ",".join(str(x) for x in lines[:8])
        more = f" …+{len(lines) - 8}件" if len(lines) > 8 else ""
        print(f"{prefix}  L{lineno}{more}: {o!r} -> {n!r}")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="大会動画リスト_マーチング祭.csv の団体/チーム名を正規化（先に --dry-run で確認推奨）。"
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="変更内容だけ表示して CSV は書き換えない",
    )
    return ap.parse_args()


if __name__ == "__main__":
    ns = parse_args()
    main(dry_run=ns.dry_run)
