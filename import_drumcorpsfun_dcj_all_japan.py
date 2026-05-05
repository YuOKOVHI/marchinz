#!/usr/bin/env python3
"""DrumcorpsfunTV から「DCJ  ALL JAPAN」を含む動画だけ抽出し、別CSVへ出力する。"""
from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
from pathlib import Path

from marchinz_org_id import stable_org_id_for_team_name

ROOT = Path(__file__).resolve().parent
OUT_CSV = ROOT / "大会動画リスト_DrumcorpsfunTV.csv"

CHANNEL_NAME = "DrumcorpsfunTV"
CHANNEL_URL = "https://www.youtube.com/@DrumcorpsfunTV"
VIDEOS_URL = "https://www.youtube.com/@DrumcorpsfunTV/videos"
KEYWORD = "ALL JAPAN"

FIELDNAMES = (
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


def run_ytdlp_json(url: str) -> dict:
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--skip-download",
        "--playlist-end",
        "400",
        url,
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout or "yt-dlp error").strip())
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"yt-dlp json parse error: {e}") from e


def ymd(upload_date: str) -> str:
    s = str(upload_date or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return ""


def norm_ws(s: str) -> str:
    return " ".join(str(s or "").split()).strip().lower()


def extract_org_name_from_title(title: str) -> str:
    t = str(title or "").strip()
    if not t:
        return ""
    pat = re.compile(r"dcj\s+all\s+japan\s+championships", re.IGNORECASE)
    m = pat.search(t)
    if not m:
        return ""
    tail = t[m.end() :].strip()
    tail = tail.lstrip(" :：-－|｜/／　")
    # 余分な連続空白を正規化
    tail = " ".join(tail.split()).strip()
    return tail


def build_rows() -> list[dict]:
    data = run_ytdlp_json(VIDEOS_URL)
    entries = data.get("entries") or []
    out: list[dict] = []
    key_norm = norm_ws(KEYWORD)
    for e in entries:
        if not isinstance(e, dict):
            continue
        title = str(e.get("title") or "").strip()
        if key_norm not in norm_ws(title):
            continue
        vid = str(e.get("id") or "").strip()
        if not vid:
            continue
        details = {}
        try:
            details = run_ytdlp_json(f"https://www.youtube.com/watch?v={vid}")
        except RuntimeError:
            details = {}
        org_name = extract_org_name_from_title(title) or CHANNEL_NAME
        row = {
            "種別": "動画",
            "分類": "マーチング団体等",
            "動画での表示名": org_name,
            "団体/チーム名": org_name,
            "団体ID": stable_org_id_for_team_name(org_name),
            "配信日": ymd(str(details.get("upload_date") or e.get("upload_date") or "")),
            "大会名": title,
            "URL": f"https://www.youtube.com/watch?v={vid}",
            "動画配信元": CHANNEL_NAME,
            "動画配信元URL": CHANNEL_URL,
        }
        out.append(row)
    out.sort(key=lambda r: (r.get("配信日") or "", r.get("大会名") or ""), reverse=True)
    return out


def write_csv(rows: list[dict]) -> None:
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        for r in rows:
            w.writerow({k: str(r.get(k, "")).strip() for k in FIELDNAMES})


def main() -> int:
    rows = build_rows()
    write_csv(rows)
    print(f"OK: {OUT_CSV} ({len(rows)} rows)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

