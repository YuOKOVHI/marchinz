#!/usr/bin/env python3
"""大会動画CSV（複数）が正。ここから data.json と data.inline.js を再生成する。

取り込み・追記時の順序は必ず:
  1) この CSV を更新する（単一 URL の追加は手書きまたは append_live_chapters_from_youtube.py）
     ・「団体ID」列は任意（空ならアプリが団体名から決定論 ID にフォールバック）。表記ゆれを束ねるときだけ手で同一 ID を振る。
  2) python3 sync_csv_to_json.py（SOURCE_CSVS の大会動画CSVを常に併読）
  3) python3 check_data.py（全CSVとJSONの列・件数を同時検査）

data.json と data.inline.js を別々に編集しない。詳細は docs/OPS_GUIDE.md 参照。

メタデータ（取得サイト・情報取得日）は fetch_meta.json で管理。
初回のみ、fetch_meta.json が無ければ data.json から引き継ぎます。
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRIMARY_CSV = ROOT / "大会動画リスト_マーチング祭.csv"
DRUMCORPS_CSV = ROOT / "大会動画リスト_DrumcorpsfunTV.csv"
FLO_MARCHING_CSV = ROOT / "大会動画リスト_FloMarching_DCI.csv"
POV_CSV = ROOT / "大会動画リスト_POV.csv"
# 表示・取り込みの順序: マーチング祭 → DCJ → DCI → POV。
SOURCE_CSVS = (PRIMARY_CSV, DRUMCORPS_CSV, FLO_MARCHING_CSV, POV_CSV)
# backward compatibility for scripts importing OUT_CSV
OUT_CSV = PRIMARY_CSV
OUT_JSON = ROOT / "data.json"
OUT_INLINE = ROOT / "data.inline.js"
INDEX_HTML = ROOT / "index.html"
META_FILE = ROOT / "fetch_meta.json"

META_SITE = "取得サイト"
META_DATE = "情報取得日"

DEFAULT_SITE = "https://www.youtube.com/@marching-matsuri"

FIELDNAMES = (
    "種別",
    "分類",
    "動画での表示名",
    "団体/チーム名",
    "団体ID",
    "配信日",
    "大会名",
    "元動画タイトル",
    "URL",
    "動画配信元",
    "動画配信元URL",
    "動画配信元ロゴURL",
)


def _strip_bom_key(k: str) -> str:
    return (k or "").strip().lstrip("\ufeff")


def normalize_row(r: dict) -> dict:
    by_clean = {_strip_bom_key(k): v for k, v in r.items()}
    out = {}
    for k in FIELDNAMES:
        v = by_clean.get(k)
        if isinstance(v, str):
            out[k] = v.strip()
        else:
            out[k] = str(v or "").strip()
    return out


def load_meta() -> dict:
    """取得サイト・情報取得日。fetch_meta.json 優先、無ければ data.json から移行。"""
    if META_FILE.is_file():
        try:
            raw = json.loads(META_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raw = {}
        site = raw.get(META_SITE)
        info = raw.get(META_DATE)
        return {
            META_SITE: site if isinstance(site, str) and site.strip() else DEFAULT_SITE,
            META_DATE: info.strip() if isinstance(info, str) else "",
        }
    if OUT_JSON.is_file():
        try:
            raw = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raw = {}
        site = raw.get(META_SITE)
        date_s = raw.get(META_DATE)
        return {
            META_SITE: site.strip() if isinstance(site, str) and site.strip() else DEFAULT_SITE,
            META_DATE: date_s.strip() if isinstance(date_s, str) else "",
        }
    return {META_SITE: DEFAULT_SITE, META_DATE: ""}


def save_meta(meta: dict) -> None:
    """build_data から情報取得日を更新するときに使う。"""
    META_FILE.write_text(
        json.dumps(
            {
                META_SITE: meta.get(META_SITE, DEFAULT_SITE),
                META_DATE: meta.get(META_DATE, ""),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def read_csv_rows(csv_path: Path | None = None) -> list[dict]:
    path = csv_path or PRIMARY_CSV
    if not path.is_file():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows: list[dict] = []
        for r in reader:
            if not r:
                continue
            rows.append(normalize_row(dict(r)))
    return rows


def read_all_rows() -> list[dict]:
    out: list[dict] = []
    for p in SOURCE_CSVS:
        out.extend(read_csv_rows(p))
    return out


def build_payload(rows: list[dict], meta: dict | None = None) -> dict:
    m = meta if meta is not None else load_meta()
    return {
        META_SITE: m.get(META_SITE, DEFAULT_SITE),
        META_DATE: m.get(META_DATE, ""),
        "rows": rows,
    }


def write_data_json(rows: list[dict], meta: dict | None = None) -> None:
    """rows とメタから data.json と data.inline.js を書く。"""
    payload = build_payload(rows, meta)
    OUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    OUT_INLINE.write_text(
        "window.__MARCHINZ_DATA = " + json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def update_inline_cache_key() -> str:
    """data.inline.js の内容に連動して、HTML側のキャッシュキーを更新する。

    大会動画の正本CSVだけが日次更新される場合でも、静的キャッシュが古い
    data.inline.js を返さないようにする。アプリ本体の版番号は変更しない。
    """
    digest = hashlib.sha256(OUT_INLINE.read_bytes()).hexdigest()[:12]
    cache_key = f"data-{digest}"
    text = INDEX_HTML.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(data\.inline\.js\?v=)[^"\']+',
        rf'\g<1>{cache_key}',
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError("index.html 内の data.inline.js キャッシュキーを特定できません")
    if updated != text:
        INDEX_HTML.write_text(updated, encoding="utf-8")
    return cache_key


def main() -> int:
    rows = read_all_rows()
    meta = load_meta()
    if not META_FILE.is_file() and OUT_JSON.is_file():
        save_meta(meta)
    write_data_json(rows, meta)
    cache_key = update_inline_cache_key()
    print(
        f"OK: {OUT_JSON} + {OUT_INLINE}（{len(rows)} 行、キャッシュキー {cache_key}、正は {', '.join(str(p.name) for p in SOURCE_CSVS)}）",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
