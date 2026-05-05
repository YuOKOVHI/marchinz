#!/usr/bin/env python3
"""Fetch @marching-matsuri metadata and update 大会動画リスト_マーチング祭.csv（正）と data.json。

正のデータは「大会動画リスト_マーチング祭.csv」。団体名などは CSV を編集し、反映は次で行う:
  python3 sync_csv_to_json.py

通常の更新（増分）:
  python3 build_data.py
  - 既存の CSV の行はそのまま残し、fetch_meta.json の「情報取得日」より後に
    アップロードされた動画の行だけを追記します（同じ URL は二重にしない）。
  - 完了後、CSV と fetch_meta.json と data.json を更新します。

全件の取り直し（注意: CSV の手動修正は消えます）:
  python3 build_data.py --full
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

from sync_csv_to_json import (
    FIELDNAMES,
    META_DATE,
    META_SITE,
    load_meta,
    read_csv_rows,
    save_meta,
    write_data_json,
)

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "_metadata_cache.json"
OUT_CSV = ROOT / "大会動画リスト_マーチング祭.csv"
OUT_JSON = ROOT / "data.json"
TEAM_INDEX = ROOT / "team_index.json"

YT_DLP = shutil.which("yt-dlp") or str(
    Path.home() / "Library/Python/3.9/bin/yt-dlp"
)
CHANNEL = "https://www.youtube.com/@marching-matsuri"

# YouTube 動画 ID は通常 11 文字（英数・-_）
_YT_ID = re.compile(r"^[\w-]{11}$")

SKIP_SUBSTR = (
    "目次",
    "開会式",
    "閉会",
    "閉幕",
    "休憩",
    "再開",
    "インターバル",
    "表彰",
    "結果発表",
    "審査員講評",
    "講評",
    "アナウンス",
    "after movie",
    "CM",
    "ハイライト",
    "配信開始",
    "配信終了",
    "待機",
    "テスト配信",
    "演奏準備",
    "マーチング祭よりクラウド",
    "ご来賓紹介",
    "ご来賓挨拶",
)


def run(cmd: list[str], timeout: int = 300) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[:2000] or str(p.returncode))
    return p.stdout


def flat_ids(url: str) -> list[str]:
    out = run(
        [YT_DLP, "--flat-playlist", "--print", "%(id)s", url],
        timeout=600,
    )
    ids: list[str] = []
    for line in out.splitlines():
        x = line.strip()
        if x and _YT_ID.match(x):
            ids.append(x)
    return list(dict.fromkeys(ids))


def fetch_video(vid: str) -> dict:
    out = run(
        [
            YT_DLP,
            "--skip-download",
            "--dump-single-json",
            f"https://www.youtube.com/watch?v={vid}",
        ],
        timeout=120,
    )
    return json.loads(out)


def load_cache() -> dict:
    if not CACHE.is_file():
        return {}
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"warn: キャッシュが壊れているため空から再取得します: {e}", file=sys.stderr)
        return {}


def save_cache(c: dict) -> None:
    CACHE.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")


def fmt_date(ud: str | None) -> str:
    if ud and len(ud) == 8 and ud.isdigit():
        return f"{ud[:4]}-{ud[4:6]}-{ud[6:8]}"
    return ""


def parse_iso_date(s: str | None) -> date | None:
    if not s or not isinstance(s, str):
        return None
    t = s.strip()
    if len(t) >= 10 and t[4] == "-" and t[7] == "-":
        try:
            return datetime.strptime(t[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def video_upload_date(d: dict) -> date | None:
    return parse_iso_date(fmt_date(d.get("upload_date")))


def max_haishin_date(rows: list[dict]) -> date | None:
    best: date | None = None
    for r in rows:
        if not isinstance(r, dict):
            continue
        d = parse_iso_date(str(r.get("配信日") or "").strip())
        if d is None:
            continue
        if best is None or d > best:
            best = d
    return best


def is_short(d: dict) -> bool:
    """ショート動画は一覧から除外する（対象外）。"""
    url = (d.get("webpage_url") or "") + (d.get("original_url") or "")
    if "/shorts/" in url.lower():
        return True
    blob = ((d.get("title") or "") + (d.get("description") or "")[:800]).lower()
    if "#shorts" in blob or "＃shorts" in blob:
        return True
    if re.search(r"#[\s\u3000]*shorts", blob, re.I):
        return True
    return False


def classify_title(title: str) -> str:
    """配信・動画タイトルに MIX3 / mix3 / スリークロス を含む → スリークロスチーム、それ以外 → マーチング団体等。"""
    if not title:
        return "マーチング団体等"
    t_cf = title.casefold()
    if "mix3" in t_cf or "スリークロス" in title:
        return "スリークロスチーム"
    return "マーチング団体等"


def load_team_index() -> dict:
    """Load team_index.json (by_team / by_video)."""
    if not TEAM_INDEX.is_file():
        return {"by_team": {}, "by_video": {}}
    try:
        raw = json.loads(TEAM_INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"warn: team_index.json が不正のため索引なしで続行: {e}", file=sys.stderr)
        return {"by_team": {}, "by_video": {}}
    bt = raw.get("by_team") if isinstance(raw.get("by_team"), dict) else {}
    bv = raw.get("by_video") if isinstance(raw.get("by_video"), dict) else {}
    return {"by_team": bt, "by_video": bv}


def resolve_org_name(team: str, vid: str, index: dict) -> str:
    by_vid = index.get("by_video") or {}
    if vid in by_vid:
        ent = by_vid[vid]
        if isinstance(ent, str):
            return ent.strip()
        if isinstance(ent, dict):
            return (
                ent.get("団体/チーム名") or ent.get("団体名") or ""
            ).strip()
    by_team = index.get("by_team") or {}
    return (by_team.get(team) or "").strip()


def skip_kouyasai(title: str) -> bool:
    return "後夜祭" in (title or "")


def org_team_column(display: str, vid: str, index: dict) -> str:
    """団体/チーム名: 索引があればそれ、なければ動画での表示名をコピー。"""
    r = resolve_org_name(display, vid, index)
    return r if r else display


def normalize_row(r: dict) -> dict:
    """全フィールドを str にそろえ、前後空白を除去。"""
    keys = (
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
    )
    out = {}
    for k in keys:
        v = r.get(k)
        out[k] = (v if v is not None else "").strip() if isinstance(v, str) else str(v or "").strip()
    return out


def channel_fields(d: dict) -> tuple[str, str]:
    """yt-dlp メタからチャンネル表示名と URL。"""
    name = (d.get("channel") or d.get("uploader") or "").strip()
    url = (d.get("channel_url") or d.get("uploader_url") or "").strip()
    return name, url


def validate_rows(rows: list[dict]) -> list[str]:
    """人間向け警告メッセージのリスト（致命的でない）。"""
    warnings: list[str] = []
    ok_kinds = ("ライブ（チャプター）", "ライブ（チャプターなし）", "動画")
    ok_cat = ("スリークロスチーム", "マーチング団体等")

    def url_ok(u: str) -> bool:
        if not u.startswith("https://"):
            return False
        if "youtube.com/watch?v=" in u:
            return True
        return "youtu.be/" in u

    for i, r in enumerate(rows):
        if r.get("種別") not in ok_kinds:
            warnings.append(f"行{i}: 不明な種別 {r.get('種別')!r}")
        if r.get("分類") not in ok_cat:
            warnings.append(f"行{i}: 不明な分類 {r.get('分類')!r}")
        u = r.get("URL") or ""
        if not url_ok(u):
            warnings.append(f"行{i}: URLが想定外 {u[:100]!r}")
        if not (r.get("大会名") or "").strip():
            warnings.append(f"行{i}: 大会名が空")
    return warnings


def skip_chapter(title: str) -> bool:
    t = title.strip()
    if not t:
        return True
    if t.startswith("配信開始") or t == "配信開始" or "【配信開始】" in t:
        return True
    if t in ("開始", "終了", "END"):
        return True
    for s in SKIP_SUBSTR:
        if s in t:
            return True
    return False


def rows_from_stream(vid: str, d: dict, team_index: dict) -> list[dict]:
    rows: list[dict] = []
    full_title = (d.get("title") or "").strip()
    if skip_kouyasai(full_title):
        return rows
    date_s = fmt_date(d.get("upload_date"))
    chapters = d.get("chapters") or []
    ch_name, ch_url = channel_fields(d)
    if chapters:
        for c in chapters:
            ct = (c.get("title") or "").strip()
            if skip_chapter(ct):
                continue
            st = int(float(c.get("start_time") or 0))
            ot = org_team_column(ct, vid, team_index)
            rows.append(
                {
                    "種別": "ライブ（チャプター）",
                    "分類": classify_title(full_title),
                    "動画での表示名": ct,
                    "団体/チーム名": ot,
                    "配信日": date_s,
                    "大会名": full_title,
                    "URL": f"https://www.youtube.com/watch?v={vid}&t={st}s",
                    "動画配信元": ch_name,
                    "動画配信元URL": ch_url,
                }
            )
    else:
        placeholder = "(チャプター未設定)"
        ot = org_team_column(placeholder, vid, team_index)
        rows.append(
            {
                "種別": "ライブ（チャプターなし）",
                "分類": classify_title(full_title),
                "動画での表示名": placeholder,
                "団体/チーム名": ot,
                "団体ID": "",
                "配信日": date_s,
                "大会名": full_title,
                "URL": f"https://www.youtube.com/watch?v={vid}",
                "動画配信元": ch_name,
                "動画配信元URL": ch_url,
            }
        )
    return rows


def rows_from_uploaded_video(vid: str, d: dict, team_index: dict) -> list[dict]:
    full_title = (d.get("title") or "").strip()
    if skip_kouyasai(full_title):
        return []
    date_s = fmt_date(d.get("upload_date"))
    url = f"https://www.youtube.com/watch?v={vid}"
    parts = re.findall(r"【([^】]+)】", full_title)
    team = parts[0].strip() if parts else full_title[:120]
    ot = org_team_column(team, vid, team_index)
    ch_name, ch_url = channel_fields(d)
    return [
        {
            "種別": "動画",
            "分類": classify_title(full_title),
            "動画での表示名": team,
            "団体/チーム名": ot,
            "団体ID": "",
            "配信日": date_s,
            "大会名": full_title,
            "URL": url,
            "動画配信元": ch_name,
            "動画配信元URL": ch_url,
        }
    ]


def determine_since_cutoff(
    info_date_str: str | None, existing_rows: list[dict]
) -> date | None:
    """増分更新の基準日（この日より後の配信日だけ追加）。情報取得日が無ければ既存行の最新配信日。"""
    d = parse_iso_date(info_date_str)
    if d is not None:
        return d
    return max_haishin_date(existing_rows)


def row_sort_key(r: dict) -> tuple[str, str]:
    pd = str(r.get("配信日") or "")
    url = str(r.get("URL") or "")
    return (pd, url)


def merge_rows(existing: list[dict], new: list[dict]) -> list[dict]:
    urls = {str(r.get("URL") or "") for r in existing if isinstance(r, dict)}
    out = [normalize_row(dict(r)) for r in existing if isinstance(r, dict)]
    for r in new:
        if not isinstance(r, dict):
            continue
        nr = normalize_row(r)
        u = nr.get("URL") or ""
        if u in urls:
            continue
        urls.add(u)
        out.append(nr)
    out.sort(key=row_sort_key, reverse=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="マーチング祭チャンネルから data.json / 大会動画リスト_マーチング祭.csv を生成")
    ap.add_argument(
        "--full",
        action="store_true",
        help="チャンネルから全件を取り直し、既存の一覧を置き換える",
    )
    ap.add_argument(
        "--since",
        default="",
        help="この日付(YYYY-MM-DD)より後の配信日だけを対象に増分取得する（例: 2026-03-19）",
    )
    args = ap.parse_args()
    if args.full:
        print(
            "warn: --full は 大会動画リスト_マーチング祭.csv をチャンネル取得結果で置き換えます。"
            "手動で直した団体名などは失われます。",
            file=sys.stderr,
        )

    cache = load_cache()
    stream_ids = flat_ids(f"{CHANNEL}/streams")
    video_ids = flat_ids(f"{CHANNEL}/videos")
    all_ids = list(dict.fromkeys(stream_ids + video_ids))

    for i, vid in enumerate(all_ids):
        need = vid not in cache or bool(cache.get(vid, {}).get("_error"))
        if need:
            try:
                cache[vid] = fetch_video(vid)
                save_cache(cache)
            except Exception as e:
                print(f"warn: {vid} {e}", file=sys.stderr)
                cache[vid] = {"_error": str(e)}
                save_cache(cache)
        if (i + 1) % 20 == 0:
            print(f"metadata {i+1}/{len(all_ids)}", file=sys.stderr)

    team_index = load_team_index()
    today = date.today().isoformat()

    existing_rows = read_csv_rows()
    meta = load_meta()
    prev_info_date = (meta.get(META_DATE) or "").strip() or None

    incremental = not args.full and bool(existing_rows)

    since_cutoff: date | None = None
    if incremental:
        since_cutoff = determine_since_cutoff(prev_info_date, existing_rows)
        if since_cutoff is None:
            print(
                "info: 情報取得日も既存の配信日もないため、全件取得で上書きします。",
                file=sys.stderr,
            )
            incremental = False

    if args.full:
        incremental = False
    elif args.since:
        forced = parse_iso_date(args.since)
        if forced is None:
            raise SystemExit(f"--since の形式が不正です: {args.since!r}（YYYY-MM-DD）")
        incremental = True
        since_cutoff = forced

    built: list[dict] = []

    def include_video(d: dict) -> bool:
        if not incremental:
            return True
        ud = video_upload_date(d)
        if ud is None:
            return False
        return ud > since_cutoff  # type: ignore[operator]

    # --- Live streams (chapters) ---
    for vid in stream_ids:
        d = cache.get(vid)
        if not d or d.get("_error"):
            continue
        if not include_video(d):
            continue
        built.extend(rows_from_stream(vid, d, team_index))

    # --- Videos tab（ショート動画は出力しない） ---
    for vid in video_ids:
        d = cache.get(vid)
        if not d or d.get("_error"):
            continue
        if is_short(d):
            continue
        if not include_video(d):
            continue
        built.extend(rows_from_uploaded_video(vid, d, team_index))

    if incremental:
        rows = merge_rows(existing_rows, built)
        mode_msg = "incremental"
    else:
        rows = [normalize_row(r) for r in built]
        rows.sort(key=row_sort_key, reverse=True)
        mode_msg = "full"

    for w in validate_rows(rows):
        print(f"check: {w}", file=sys.stderr)

    out_meta = {META_SITE: CHANNEL, META_DATE: today}
    save_meta(out_meta)
    write_data_json(rows, out_meta)

    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(FIELDNAMES))
        w.writeheader()
        w.writerows(rows)

    print(
        f"mode={mode_msg} rows={len(rows)} (+{len(built)} from channel) "
        f"-> {OUT_JSON} {OUT_CSV}  {META_DATE}={today}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
