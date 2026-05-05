#!/usr/bin/env python3
"""YouTube Data API v3 で YouTube リストを生成する。

目的:
- 既存 UI が読む `YouTubeリスト.csv` と `youtube-list.inline.js` を API 由来で更新
- 失敗時のため既存ファイルをバックアップしてから書き込み

前提:
- 環境変数 `YOUTUBE_API_KEY` に API キーを設定
- `site-nav.js` の channels 配列を正としてチャンネル一覧を取得
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import TypeVar

ROOT = Path(__file__).resolve().parent
SITE_NAV = ROOT / "site-nav.js"
OUT_CSV = ROOT / "YouTubeリスト.csv"
OUT_INLINE = ROOT / "youtube-list.inline.js"

FIELDNAMES = (
    "ロゴ画像URL",
    "チャンネル名",
    "チャンネルURL",
    "最新動画URL",
    "最新動画タイトル",
    "最新動画再生回数",
    "最新動画配信日",
    "動画視聴回数1位URL",
    "動画視聴回数1位タイトル",
    "動画視聴回数1位再生回数",
    "動画視聴回数2位URL",
    "動画視聴回数2位タイトル",
    "動画視聴回数2位再生回数",
    "動画視聴回数3位URL",
    "動画視聴回数3位タイトル",
    "動画視聴回数3位再生回数",
    "動画視聴回数4位URL",
    "動画視聴回数4位タイトル",
    "動画視聴回数4位再生回数",
    "最新LIVE URL",
    "最新LIVEタイトル",
    "最新LIVE再生回数",
    "最新LIVE配信日",
    "LIVE視聴回数1位URL",
    "LIVE視聴回数1位タイトル",
    "LIVE視聴回数1位再生回数",
    "LIVE視聴回数2位URL",
    "LIVE視聴回数2位タイトル",
    "LIVE視聴回数2位再生回数",
    "LIVE視聴回数3位URL",
    "LIVE視聴回数3位タイトル",
    "LIVE視聴回数3位再生回数",
    "LIVE視聴回数4位URL",
    "LIVE視聴回数4位タイトル",
    "LIVE視聴回数4位再生回数",
)


def parse_channels_from_site_nav(text: str) -> list[tuple[str, str]]:
    m = re.search(r"(?:const|let)\s+channels\s*=\s*\[", text)
    if not m:
        raise ValueError("site-nav.js から channels 配列を見つけられません")
    s = m.start()
    m_end = re.search(r"(?:const|let)\s+videoMetaByUrl\s*=", text[s:])
    if not m_end:
        raise ValueError("site-nav.js から videoMetaByUrl を見つけられません")
    e = s + m_end.start()
    section = text[s:e]
    lines = section.splitlines()
    pairs: list[tuple[str, str]] = []
    for i, line in enumerate(lines):
        m_name = re.search(r'name:\s*"((?:[^"\\]|\\.)*)"', line)
        if not m_name:
            continue
        name = m_name.group(1).replace('\\"', '"')
        for j in range(i + 1, min(i + 12, len(lines))):
            m_url = re.search(r'url:\s*"([^"]+)"', lines[j])
            if m_url and "youtube.com" in m_url.group(1):
                pairs.append((name, m_url.group(1)))
                break
    return pairs


def iso_to_ymd(raw: str) -> str:
    t = (raw or "").strip()
    if not t:
        return ""
    if len(t) >= 10:
        return t[:10]
    return ""


def parse_duration_seconds(iso_dur: str) -> int:
    # PT1H2M3S / PT45S / PT10M
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso_dur or "")
    if not m:
        return 0
    h = int(m.group(1) or "0")
    mm = int(m.group(2) or "0")
    s = int(m.group(3) or "0")
    return h * 3600 + mm * 60 + s


def normalize_channel_url(url: str) -> str:
    u = urllib.parse.urlparse((url or "").strip())
    if not u.scheme:
        return ""
    return urllib.parse.urlunparse((u.scheme, u.netloc, u.path.rstrip("/"), "", "", ""))


def extract_channel_id_or_handle(url: str) -> tuple[str, str, str]:
    p = urllib.parse.urlparse(url)
    path = (p.path or "").strip("/")
    parts = path.split("/") if path else []
    if len(parts) >= 2 and parts[0] == "channel" and parts[1].startswith("UC"):
        return parts[1], "", ""
    if parts and parts[0].startswith("@"):
        return "", parts[0][1:], ""
    if len(parts) >= 2 and parts[0] == "user":
        return "", "", parts[1]
    return "", "", ""


def api_get(api_key: str, endpoint: str, params: dict[str, str]) -> dict:
    q = dict(params)
    q["key"] = api_key
    url = f"https://www.googleapis.com/youtube/v3/{endpoint}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


T = TypeVar("T")


def chunked(arr: list[T], n: int) -> list[list[T]]:
    return [arr[i : i + n] for i in range(0, len(arr), n)]


def backup_file(path: Path) -> None:
    if not path.exists():
        return
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = path.with_suffix(path.suffix + f".bak.{ts}")
    shutil.copy2(path, bak)


def is_short(item: dict) -> bool:
    title = str(item.get("title") or "")
    desc = str(item.get("description") or "")
    tags = " ".join(item.get("tags") or [])
    blob = f"{title}\n{desc}\n{tags}".lower()
    lb = str(item.get("live_broadcast") or "")
    if lb in ("live", "upcoming"):
        return False
    if "#shorts" in blob or "＃shorts" in blob or " shorts" in blob or "ショート" in blob:
        return True
    duration_sec = int(item.get("duration_sec") or 0)
    # Shorts 混入抑止を優先して 3分以下を短尺として除外
    if 0 < duration_sec <= 180:
        return True
    return False


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}" if video_id else ""


def rank_by_views(items: list[dict], take: int) -> list[dict]:
    s = sorted(
        items,
        key=lambda x: (
            -int(x.get("view_count") or 0),
            str(x.get("published_at") or ""),
        ),
    )
    return s[:take]


def latest_by_date(items: list[dict]) -> dict | None:
    if not items:
        return None
    return max(items, key=lambda x: str(x.get("published_at") or ""))


def build_row_for_channel(api_key: str, display_name: str, channel_url: str, max_items: int) -> dict[str, str]:
    row = {k: "" for k in FIELDNAMES}
    row["チャンネル名"] = display_name
    row["チャンネルURL"] = normalize_channel_url(channel_url)

    cid, handle, username = extract_channel_id_or_handle(channel_url)
    channel_item = None
    if cid:
        d = api_get(
            api_key,
            "channels",
            {"part": "id,snippet,contentDetails", "id": cid},
        )
        items = d.get("items") or []
        channel_item = items[0] if items else None
    elif handle:
        d = api_get(
            api_key,
            "channels",
            {"part": "id,snippet,contentDetails", "forHandle": handle},
        )
        items = d.get("items") or []
        channel_item = items[0] if items else None
    elif username:
        d = api_get(
            api_key,
            "channels",
            {"part": "id,snippet,contentDetails", "forUsername": username},
        )
        items = d.get("items") or []
        channel_item = items[0] if items else None

    if not channel_item:
        return row

    snippet = channel_item.get("snippet") or {}
    thumbs = snippet.get("thumbnails") or {}
    row["ロゴ画像URL"] = (
        (thumbs.get("high") or {}).get("url")
        or (thumbs.get("medium") or {}).get("url")
        or (thumbs.get("default") or {}).get("url")
        or ""
    )
    row["チャンネル名"] = str(snippet.get("title") or display_name).strip() or display_name

    uploads = (((channel_item.get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads") or "").strip()
    if not uploads:
        return row

    # uploads playlist から videoId 群を収集
    video_ids: list[str] = []
    page_token = ""
    remaining = max(1, max_items)
    while remaining > 0:
        take = min(50, remaining)
        params = {
            "part": "contentDetails,snippet,status",
            "playlistId": uploads,
            "maxResults": str(take),
        }
        if page_token:
            params["pageToken"] = page_token
        d = api_get(api_key, "playlistItems", params)
        for it in d.get("items") or []:
            vid = (((it.get("contentDetails") or {}).get("videoId")) or "").strip()
            if vid:
                video_ids.append(vid)
        remaining -= take
        page_token = str(d.get("nextPageToken") or "")
        if not page_token:
            break

    if not video_ids:
        return row

    details: dict[str, dict] = {}
    for ch in chunked(video_ids, 50):
        d = api_get(
            api_key,
            "videos",
            {
                "part": "snippet,contentDetails,statistics,liveStreamingDetails,status",
                "id": ",".join(ch),
                "maxResults": "50",
            },
        )
        for it in d.get("items") or []:
            vid = str(it.get("id") or "").strip()
            if not vid:
                continue
            sn = it.get("snippet") or {}
            cd = it.get("contentDetails") or {}
            st = it.get("statistics") or {}
            lbc = str(sn.get("liveBroadcastContent") or "")
            lsd = it.get("liveStreamingDetails") or {}
            obj = {
                "id": vid,
                "title": str(sn.get("title") or ""),
                "published_at": str(sn.get("publishedAt") or ""),
                "view_count": int(st.get("viewCount") or 0),
                "duration_sec": parse_duration_seconds(str(cd.get("duration") or "")),
                "description": str(sn.get("description") or ""),
                "tags": list(sn.get("tags") or []),
                "live_broadcast": lbc,
                "has_live_details": bool(lsd),
            }
            details[vid] = obj

    vids = [details[v] for v in video_ids if v in details]
    normal_videos = [v for v in vids if not is_short(v)]

    latest_video = latest_by_date(normal_videos)
    if latest_video:
        row["最新動画URL"] = watch_url(latest_video["id"])
        row["最新動画タイトル"] = latest_video["title"]
        row["最新動画再生回数"] = str(latest_video["view_count"])
        row["最新動画配信日"] = iso_to_ymd(latest_video["published_at"])

    top4_video = rank_by_views(normal_videos, 4)
    vf = [
        ("動画視聴回数1位URL", "動画視聴回数1位タイトル", "動画視聴回数1位再生回数"),
        ("動画視聴回数2位URL", "動画視聴回数2位タイトル", "動画視聴回数2位再生回数"),
        ("動画視聴回数3位URL", "動画視聴回数3位タイトル", "動画視聴回数3位再生回数"),
        ("動画視聴回数4位URL", "動画視聴回数4位タイトル", "動画視聴回数4位再生回数"),
    ]
    for i, it in enumerate(top4_video):
        row[vf[i][0]] = watch_url(it["id"])
        row[vf[i][1]] = it["title"]
        row[vf[i][2]] = str(it["view_count"])

    # 新ルール: 4枠は「最新1 + 人気3（通常動画/LIVE混合）」に統一
    # LIVE専用枠は使わない（表示もLIVEラベルを出さない）
    for k in (
        "最新LIVE URL",
        "最新LIVEタイトル",
        "最新LIVE再生回数",
        "最新LIVE配信日",
        "LIVE視聴回数1位URL",
        "LIVE視聴回数1位タイトル",
        "LIVE視聴回数1位再生回数",
        "LIVE視聴回数2位URL",
        "LIVE視聴回数2位タイトル",
        "LIVE視聴回数2位再生回数",
        "LIVE視聴回数3位URL",
        "LIVE視聴回数3位タイトル",
        "LIVE視聴回数3位再生回数",
        "LIVE視聴回数4位URL",
        "LIVE視聴回数4位タイトル",
        "LIVE視聴回数4位再生回数",
    ):
        row[k] = ""

    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-channels", type=int, default=0, help="0 なら全チャンネル")
    ap.add_argument("--max-items", type=int, default=120, help="チャンネルごとに拾う uploads 件数上限")
    ap.add_argument("--dry-run", action="store_true", help="書き込みせず件数のみ表示")
    args = ap.parse_args()

    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: 環境変数 YOUTUBE_API_KEY が未設定です", file=sys.stderr)
        return 2

    pairs = parse_channels_from_site_nav(SITE_NAV.read_text(encoding="utf-8"))
    if args.max_channels > 0:
        pairs = pairs[: args.max_channels]
    if not pairs:
        print("ERROR: channels が 0 件です", file=sys.stderr)
        return 2

    rows: list[dict[str, str]] = []
    for i, (name, url) in enumerate(pairs, start=1):
        print(f"[{i}/{len(pairs)}] {name}", file=sys.stderr)
        try:
            rows.append(build_row_for_channel(api_key, name, url, args.max_items))
        except Exception as ex:  # noqa: BLE001
            print(f"  warn: {name}: {ex}", file=sys.stderr)
            row = {k: "" for k in FIELDNAMES}
            row["チャンネル名"] = name
            row["チャンネルURL"] = normalize_channel_url(url)
            rows.append(row)

    if args.dry_run:
        print(f"DRY-RUN OK: rows={len(rows)}")
        return 0

    backup_file(OUT_CSV)
    backup_file(OUT_INLINE)
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(FIELDNAMES))
        w.writeheader()
        w.writerows(rows)
    OUT_INLINE.write_text(
        "window.__YOUTUBE_LIST_ROWS = " + json.dumps(rows, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    # 粗いクォータ目安（search.list 不使用設計）
    n = len(rows)
    estimated_units = (n + 49) // 50 + n + n
    print(
        f"OK: {OUT_CSV} / {OUT_INLINE}（{n} 行, 1回更新の概算 {estimated_units} units）",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
