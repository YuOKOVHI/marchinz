#!/usr/bin/env python3
"""site-nav.js の YouTube チャンネル一覧から、指標付き CSV（youtube-list/YouTubeリスト.csv）を生成する。

各チャンネルについて yt-dlp で以下を取得する（取得失敗セルは空・取得件数は --playlist-end で上限）。
- ロゴ: チャンネルページ（--playlist-items 0）の thumbnails
- 動画: .../videos プレイリスト（視聴回数で 1〜3 位、日付で最新）
- LIVE: .../streams プレイリスト（なければ空欄。視聴回数 1〜2 位、日付で最新）

前提: python3 -m yt_dlp が使えること。ネットワーク必須。

例:
  python3 export_youtube_list_csv.py
  python3 export_youtube_list_csv.py --max-channels 3
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse, urlunparse

ROOT = Path(__file__).resolve().parent
SITE_NAV = ROOT / "site-nav.js"
YOUTUBE_LIST_DIR = ROOT / "youtube-list"
OUT_DEFAULT = YOUTUBE_LIST_DIR / "YouTubeリスト.csv"
OUT_INLINE_JS = YOUTUBE_LIST_DIR / "youtube-list.inline.js"


def strip_query(url: str) -> str:
    p = urlparse(url.strip())
    return urlunparse((p.scheme, p.netloc, p.path, "", "", ""))


def videos_tab_url(base: str) -> str:
    u = strip_query(base).rstrip("/")
    if u.endswith("/videos"):
        return u
    return f"{u}/videos"


def streams_tab_url(base: str) -> str:
    u = strip_query(base).rstrip("/")
    if u.endswith("/videos"):
        u = u[: -len("/videos")]
    return f"{u}/streams"


def channel_page_url(base: str) -> str:
    return strip_query(base).rstrip("/")


def parse_channels_from_site_nav(text: str) -> list[tuple[str, str]]:
    m = re.search(r"(?:const|let)\s+channels\s*=\s*\[", text)
    if not m:
        raise ValueError("channels 配列を site-nav.js から検出できません")
    s = m.start()
    m_end = re.search(r"(?:const|let)\s+videoMetaByUrl\s*=", text[s:])
    if not m_end:
        raise ValueError("videoMetaByUrl を site-nav.js から検出できません")
    e = s + m_end.start()
    section = text[s:e]
    lines = section.splitlines()
    pairs: list[tuple[str, str]] = []
    for i, line in enumerate(lines):
        m = re.search(r'name:\s*"((?:[^"\\]|\\.)*)"', line)
        if not m:
            continue
        name = m.group(1).replace('\\"', '"')
        for j in range(i + 1, min(i + 10, len(lines))):
            m2 = re.search(r'url:\s*"([^"]+)"', lines[j])
            if m2 and "youtube.com" in m2.group(1):
                pairs.append((name, m2.group(1)))
                break
    return pairs


def is_short_entry(e: dict | None) -> bool:
    if not e or not isinstance(e, dict):
        return True
    u = (e.get("webpage_url") or "") + str(e.get("url") or "")
    if "/shorts/" in u.lower():
        return True
    t = (e.get("title") or "")
    if "#shorts" in t.lower() or "＃shorts" in t:
        return True
    d = e.get("duration")
    if isinstance(d, (int, float)) and d <= 60:
        return True
    return False


def watch_url(e: dict) -> str:
    u = e.get("webpage_url") or ""
    if u.startswith("http"):
        return u
    vid = e.get("id")
    return f"https://www.youtube.com/watch?v={vid}" if vid else ""


def run_ytdl_json(url: str, extra: list[str], timeout: int = 480) -> tuple[dict | None, str]:
    cmd = [
        "python3",
        "-m",
        "yt_dlp",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--quiet",
        *extra,
        url,
    ]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        # yt-dlp は「一部フォーマットがスキップされた」だけでも rc!=0 になることがあります。
        # stdout が JSON としてパースできる場合は採用して、失敗扱いで捨てない。
        try:
            j = json.loads(p.stdout)
            err = (p.stderr or "")[-800:]
            return j, err
        except json.JSONDecodeError:
            err = (p.stderr or "")[-800:]
            return None, err
    try:
        return json.loads(p.stdout), ""
    except json.JSONDecodeError as ex:
        return None, str(ex)


def thumbnail_from_channel(channel_json: dict) -> str:
    th = channel_json.get("thumbnails") or []
    if th:
        last = th[-1]
        if isinstance(last, dict) and last.get("url"):
            return str(last["url"])
    t = channel_json.get("thumbnail")
    return str(t).strip() if t else ""


def filter_non_short(entries: list | None) -> list[dict]:
    if not entries:
        return []
    out: list[dict] = []
    for e in entries:
        if not e or not isinstance(e, dict):
            continue
        if is_short_entry(e):
            continue
        out.append(e)
    return out


def rank_by_views(entries: list[dict], take: int) -> list[dict]:
    keyed = [(int(e.get("view_count") or 0), e) for e in entries]
    keyed.sort(key=lambda x: (-x[0], -float(x[1].get("timestamp") or 0)))
    out: list[dict] = []
    seen: set[str] = set()
    for _, e in keyed:
        vid = e.get("id")
        sid = str(vid or "")
        if sid and sid in seen:
            continue
        if sid:
            seen.add(sid)
        out.append(e)
        if len(out) >= take:
            break
    return out


def latest_by_date(entries: list[dict]) -> dict | None:
    best: dict | None = None
    best_ts = -1.0
    for e in entries:
        stm = e.get("timestamp")
        if isinstance(stm, (int, float)) and stm > 0:
            k = float(stm)
        else:
            ud = str(e.get("upload_date") or "")
            k = float(ud) if ud.isdigit() and len(ud) == 8 else -1.0
        if k > best_ts:
            best_ts = k
            best = e
    return best


def fetch_channel_logo(base_url: str) -> str:
    u = channel_page_url(base_url)
    j, err = run_ytdl_json(u, ["--playlist-items", "0"], timeout=180)
    if not j:
        print(f"  warn logo: {base_url}: {err[:200]}", file=sys.stderr)
        return ""
    return thumbnail_from_channel(j)


def fetch_tab(url: str, playlist_end: int) -> tuple[list | None, str]:
    meta, err = run_ytdl_json(
        url,
        [f"--playlist-end={playlist_end}"],
        timeout=720,
    )
    if not meta:
        return None, err
    return meta.get("entries") or [], err


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


def row_for_channel(display_name: str, channel_url: str, playlist_end: int) -> dict[str, str]:
    out = {k: "" for k in FIELDNAMES}
    out["チャンネル名"] = display_name
    out["チャンネルURL"] = strip_query(channel_url)

    logo = fetch_channel_logo(channel_url)
    out["ロゴ画像URL"] = logo

    v_tab = videos_tab_url(channel_url)
    ventries, verr = fetch_tab(v_tab, playlist_end)
    if ventries is None:
        print(f"  warn videos: {display_name}: {verr[-300:]}", file=sys.stderr)
    else:
        vids_only = filter_non_short(ventries)
        lat = latest_by_date(vids_only)
        if lat:
            out["最新動画URL"] = watch_url(lat)
            out["最新動画タイトル"] = str(lat.get("title") or "")
            out["最新動画再生回数"] = str(int(lat.get("view_count") or 0))
            ud = str(lat.get("upload_date") or "")
            out["最新動画配信日"] = f"{ud[:4]}-{ud[4:6]}-{ud[6:8]}" if len(ud) == 8 and ud.isdigit() else ""
        top4 = rank_by_views(vids_only, 4)
        rank_fields = [
            ("動画視聴回数1位URL", "動画視聴回数1位タイトル", "動画視聴回数1位再生回数"),
            ("動画視聴回数2位URL", "動画視聴回数2位タイトル", "動画視聴回数2位再生回数"),
            ("動画視聴回数3位URL", "動画視聴回数3位タイトル", "動画視聴回数3位再生回数"),
            ("動画視聴回数4位URL", "動画視聴回数4位タイトル", "動画視聴回数4位再生回数"),
        ]
        for i, pair in enumerate(rank_fields):
            if i >= len(top4):
                break
            e = top4[i]
            out[pair[0]] = watch_url(e)
            out[pair[1]] = str(e.get("title") or "")
            out[pair[2]] = str(int(e.get("view_count") or 0))

    s_tab = streams_tab_url(channel_url)
    sentries, serr = fetch_tab(s_tab, min(playlist_end, 150))
    if sentries is None:
        low = (serr or "").lower()
        if "does not have a streams tab" not in low:
            print(f"  warn streams: {display_name}: {(serr or '')[-400:]}", file=sys.stderr)
    else:
        lives = filter_non_short(sentries)
        latest_l = latest_by_date(lives)
        if latest_l:
            out["最新LIVE URL"] = watch_url(latest_l)
            out["最新LIVEタイトル"] = str(latest_l.get("title") or "")
            out["最新LIVE再生回数"] = str(int(latest_l.get("view_count") or 0))
            ud = str(latest_l.get("upload_date") or "")
            out["最新LIVE配信日"] = f"{ud[:4]}-{ud[4:6]}-{ud[6:8]}" if len(ud) == 8 and ud.isdigit() else ""
        top_live = rank_by_views(lives, 4)
        lf = [
            ("LIVE視聴回数1位URL", "LIVE視聴回数1位タイトル", "LIVE視聴回数1位再生回数"),
            ("LIVE視聴回数2位URL", "LIVE視聴回数2位タイトル", "LIVE視聴回数2位再生回数"),
            ("LIVE視聴回数3位URL", "LIVE視聴回数3位タイトル", "LIVE視聴回数3位再生回数"),
            ("LIVE視聴回数4位URL", "LIVE視聴回数4位タイトル", "LIVE視聴回数4位再生回数"),
        ]
        for i, pair in enumerate(lf):
            if i >= len(top_live):
                break
            e = top_live[i]
            out[pair[0]] = watch_url(e)
            out[pair[1]] = str(e.get("title") or "")
            out[pair[2]] = str(int(e.get("view_count") or 0))

    return out


def _fetch_one(task: tuple[int, int, str, str, int]) -> dict[str, str]:
    idx, total, name, url, playlist_end = task
    print(f"[{idx + 1}/{total}] {name}", file=sys.stderr)
    return row_for_channel(name, url, playlist_end)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", type=Path, default=OUT_DEFAULT)
    ap.add_argument(
        "--playlist-end",
        type=int,
        default=120,
        help="各タブから取得する上限本数（多いほど視聴回数順が正確）",
    )
    ap.add_argument("--max-channels", type=int, default=0, help="0 で全チャンネル")
    ap.add_argument(
        "--workers",
        type=int,
        default=3,
        help="並列チャンネル処理数（過大にすると YouTube 側に負荷／ブロックされやすいです）",
    )
    args = ap.parse_args()

    text = SITE_NAV.read_text(encoding="utf-8")
    pairs = parse_channels_from_site_nav(text)
    if args.max_channels > 0:
        pairs = pairs[: args.max_channels]

    n = len(pairs)
    tasks = [
        (i, n, name, url, args.playlist_end) for i, (name, url) in enumerate(pairs)
    ]
    wn = max(1, min(args.workers, n))
    with ThreadPoolExecutor(max_workers=wn) as pool:
        rows = list(pool.map(_fetch_one, tasks))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    OUT_INLINE_JS.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(FIELDNAMES))
        w.writeheader()
        w.writerows(rows)
    OUT_INLINE_JS.write_text(
        "window.__YOUTUBE_LIST_ROWS = " + json.dumps(rows, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"OK {args.output} / {OUT_INLINE_JS}（{len(rows)} 行）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
