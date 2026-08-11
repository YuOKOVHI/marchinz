#!/usr/bin/env python3
"""FloMarching の10分以上の FULL SHOWを、DCI大会動画CSVへ取り込む。

採用条件（AND）:
  1. 動画時間が600秒以上
  2. タイトル、またはサムネイルのOCR文字列に "FULL SHOW" がある

サムネイル条件はYouTubeメタデータだけでは判定できないため、macOS Visionで
画像そのものをOCRする。CSVを正として data.json / data.inline.js は
sync_csv_to_json.py から生成する。
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

from marchinz_org_id import stable_org_id_for_team_name
from sync_csv_to_json import FIELDNAMES

ROOT = Path(__file__).resolve().parent
OUT_CSV = ROOT / "大会動画リスト_FloMarching_DCI.csv"
OCR_SOURCE = ROOT / "flomarching_thumbnail_ocr.m"

CHANNEL_NAME = "FloMarching"
CHANNEL_URL = "https://www.youtube.com/@FloMarching"
VIDEOS_URL = f"{CHANNEL_URL}/videos"
MIN_DURATION_SECONDS = 10 * 60
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 Chrome/140 Safari/537.36"
)

TEAM_ALIASES = (
    ("phantom regiment alumni", "Phantom Regiment Alumni Corps"),
    ("reading buccaneers", "Reading Buccaneers"),
    ("santa clara vanguard", "Santa Clara Vanguard"),
    ("carolina crown", "Carolina Crown"),
    ("pacific crest", "Pacific Crest"),
    ("phantom regiment", "Phantom Regiment"),
    ("blue stars", "Blue Stars"),
    ("blue devils", "Blue Devils"),
    ("mandarins", "Mandarins"),
    ("troopers", "Troopers"),
    ("colts", "Colts"),
    ("gold", "Gold"),
)

# YouTubeの動画タイトルは収録形式（Multi Cam / With Audioなど）中心なので、
# MarchinZでは大会・団体・ショウ名を先頭から読める表記に正規化する。
# 元動画のタイトル・概要欄・サムネイルを照合した既存採用動画の確定表記。
DISPLAY_TITLE_BY_VIDEO_ID = {
    "-DBuhBRi1Tk": "【2026 DCI All-Age World Championship】Reading Buccaneers「Simplexity」【Finals】",
    "4l_xlpbnjgM": "【2026 DCI World Championship】Phantom Regiment Alumni Corps「70th Anniversary Show（Spartacus）」【Semifinals】",
    "C2XcEJ0DBKE": "【2026 DCI World Championship】Troopers「Into Darkness」【Finals】",
    "Ajjf41rENx4": "【2026 DCI World Championship】Pacific Crest「Irresistible」【Semifinals】",
    "L_wn6u6SmvA": "【2026 DCI World Championship】Colts「American Experiment」【Semifinals】",
    "0_QOeBS3whQ": "【2026 DCI World Championship】Gold「Luminous」【Prelims】",
    "xjlAlBohQtI": "【2026 DCI World Championship】Carolina Crown「The Doors of Perception」【Prelims】",
    "sBrMxhBWKD0": "【2026 DCI West】Gold「Luminous」",
    "uW2gL-lpyBU": "【2026 DCI West】Blue Devils / Santa Clara Vanguard 合同アンコール",
    "Jv3hrJdsCqk": "【2026 SCV Showcase】Santa Clara Vanguard「With Reckless Abandon」",
    "9KZ8jMP5BfY": "【2025 DCI World Championship】Mandarins「If I Must Fall」【Finals】",
    "V7K8XhIkVFw": "【2025 DCI Southwestern Championship】Gold「The Demon Barber of Fleet Street」",
    "jWASCL1lVBI": "【2021 DCI Celebration】Mandarins「Beyond the Canvas」",
    "hv1xpcgXwLs": "【2021 Music on the March】Blue Stars「@ The Top of the World」",
    "Jwm29vnh_0w": "【2021 Drums on Parade】Phantom Regiment「Harmonic Journey」",
}


def normalized_letters(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).upper()
    return "".join(ch for ch in value if ch.isalnum())


def contains_full_show(value: str) -> bool:
    return "FULLSHOW" in normalized_letters(value)


def run_ytdlp_playlist(limit: int = 0) -> list[dict]:
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--skip-download",
    ]
    if limit > 0:
        cmd.extend(["--playlist-end", str(limit)])
    cmd.append(VIDEOS_URL)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "yt-dlp error").strip())
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"yt-dlp JSON parse error: {exc}") from exc
    rows = []
    for entry in payload.get("entries") or []:
        if not isinstance(entry, dict):
            continue
        video_id = str(entry.get("id") or "").strip()
        title = str(entry.get("title") or "").strip()
        if video_id and title:
            rows.append({"id": video_id, "title": title})
    return rows


def fetch_bytes(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urlopen(req, timeout=30) as response:
        return response.read()


def download_thumbnail(video_id: str, out_dir: Path) -> Path | None:
    dest = out_dir / f"{video_id}.jpg"
    if dest.is_file() and dest.stat().st_size > 1000:
        return dest
    for name in ("maxresdefault", "sddefault", "hqdefault"):
        try:
            data = fetch_bytes(f"https://i.ytimg.com/vi/{video_id}/{name}.jpg")
        except Exception:  # noqa: BLE001 - 別サイズへフォールバックする
            continue
        if len(data) > 1000:
            dest.write_bytes(data)
            return dest
    return None


def ensure_ocr_binary(cache_dir: Path) -> Path:
    if sys.platform != "darwin":
        raise RuntimeError("サムネイルOCRはmacOS Visionを使うため、Macで実行してください")
    binary = cache_dir / "flomarching_thumbnail_ocr"
    if binary.is_file() and binary.stat().st_mtime >= OCR_SOURCE.stat().st_mtime:
        return binary
    module_cache = cache_dir / "clang-module-cache"
    module_cache.mkdir(parents=True, exist_ok=True)
    cmd = [
        "clang",
        "-fobjc-arc",
        f"-fmodules-cache-path={module_cache}",
        str(OCR_SOURCE),
        "-framework",
        "Foundation",
        "-framework",
        "Vision",
        "-framework",
        "ImageIO",
        "-framework",
        "CoreGraphics",
        "-o",
        str(binary),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "OCR helper compile error").strip())
    return binary


def parse_ocr_output(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.replace("\x00", "").splitlines():
        if "\t" not in line:
            continue
        filename, recognized = line.split("\t", 1)
        out[Path(filename).stem] = recognized
    return out


def run_ocr_group(binary: Path, paths: list[Path]) -> dict[str, str]:
    if not paths:
        return {}
    proc = subprocess.run(
        [str(binary), *map(str, paths)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    parsed = parse_ocr_output(proc.stdout.decode("utf-8", errors="replace"))
    if proc.returncode == 0:
        return parsed
    if len(paths) == 1:
        return parsed
    middle = len(paths) // 2
    parsed.update(run_ocr_group(binary, paths[:middle]))
    parsed.update(run_ocr_group(binary, paths[middle:]))
    return parsed


def thumbnail_texts(entries: list[dict], cache_dir: Path) -> dict[str, str]:
    thumb_dir = cache_dir / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=16) as pool:
        paths = list(pool.map(lambda row: download_thumbnail(row["id"], thumb_dir), entries))
    existing = [path for path in paths if path is not None]
    if len(existing) != len(entries):
        print(f"WARN: サムネイル取得 {len(existing)}/{len(entries)}", file=sys.stderr)
    binary = ensure_ocr_binary(cache_dir)
    out: dict[str, str] = {}
    for start in range(0, len(existing), 16):
        out.update(run_ocr_group(binary, existing[start : start + 16]))
        if start and start % 160 == 0:
            print(f"OCR: {start}/{len(existing)}", file=sys.stderr)
    missing = sorted(path.stem for path in existing if path.stem not in out)
    if missing:
        raise RuntimeError(
            f"OCR結果が不足しています（{len(missing)}件）。CSVは更新しません: "
            + ", ".join(missing[:8])
        )
    return out


def fetch_watch_meta(entry: dict) -> dict:
    video_id = entry["id"]
    html = fetch_bytes(f"https://www.youtube.com/watch?v={video_id}").decode(
        "utf-8", errors="replace"
    )
    length_hits = re.findall(r'"lengthSeconds":"(\d+)"', html)
    date_hits = re.findall(r'<meta itemprop="datePublished" content="([^"]+)"', html)
    duration = int(length_hits[0]) if length_hits else 0
    date = date_hits[0][:10] if date_hits else ""
    return {**entry, "duration": duration, "date": date}


def org_name_for(title: str) -> str:
    low = unicodedata.normalize("NFKC", title).lower()
    if "blue devils" in low and "santa clara vanguard" in low:
        return "Blue Devils / Santa Clara Vanguard"
    for needle, name in TEAM_ALIASES:
        if re.search(rf"\b{re.escape(needle)}\b", low):
            return name
    return "DCI"


def build_rows(entries: list[dict], ocr_by_id: dict[str, str]) -> tuple[list[dict], list[dict]]:
    candidates = []
    for entry in entries:
        title_match = contains_full_show(entry["title"])
        thumb_match = contains_full_show(ocr_by_id.get(entry["id"], ""))
        if title_match or thumb_match:
            candidates.append({**entry, "title_match": title_match, "thumbnail_match": thumb_match})

    with ThreadPoolExecutor(max_workers=5) as pool:
        details = list(pool.map(fetch_watch_meta, candidates))

    kept = [row for row in details if row["duration"] >= MIN_DURATION_SECONDS]
    out = []
    for item in kept:
        org = org_name_for(item["title"])
        out.append(
            {
                "種別": "動画",
                "分類": "海外",
                "動画での表示名": org,
                "団体/チーム名": org,
                "団体ID": stable_org_id_for_team_name(org),
                "配信日": item["date"],
                "大会名": DISPLAY_TITLE_BY_VIDEO_ID.get(item["id"], item["title"]),
                "元動画タイトル": item["title"],
                "URL": f"https://www.youtube.com/watch?v={item['id']}",
                "動画配信元": CHANNEL_NAME,
                "動画配信元URL": CHANNEL_URL,
                "動画配信元ロゴURL": "",
            }
        )
    out.sort(key=lambda row: (row["配信日"], row["大会名"]), reverse=True)
    return out, details


def write_csv(rows: list[dict]) -> None:
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: str(row.get(key, "")).strip() for key in FIELDNAMES})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--playlist-end", type=int, default=0, help="0は全公開動画")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "marchinz-flomarching-cache",
    )
    parser.add_argument("--skip-thumbnail-ocr", action="store_true", help="タイトル一致だけ確認")
    parser.add_argument("--dry-run", action="store_true", help="CSVを書かず判定だけ表示")
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    entries = run_ytdlp_playlist(args.playlist_end)
    ocr = {} if args.skip_thumbnail_ocr else thumbnail_texts(entries, args.cache_dir)
    rows, details = build_rows(entries, ocr)
    if not rows:
        raise RuntimeError("条件に合う動画が0件でした。CSVは更新しません")
    for item in details:
        status = "KEEP" if item["duration"] >= MIN_DURATION_SECONDS else "DROP"
        reason = "+".join(
            key
            for key, matched in (
                ("title", item["title_match"]),
                ("thumbnail", item["thumbnail_match"]),
            )
            if matched
        )
        print(
            f"{status}: {item['duration']:>4}s [{reason}] {item['title']}",
            file=sys.stderr,
        )
    if not args.dry_run:
        write_csv(rows)
        print(f"OK: {OUT_CSV.name} ({len(rows)} rows)", file=sys.stderr)
    else:
        print(f"DRY RUN: {len(rows)} rows", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
