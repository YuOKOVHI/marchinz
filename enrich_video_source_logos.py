#!/usr/bin/env python3
"""大会動画CSVの配信元チャンネル画像を YouTube Data API で補完する。

POV は個人チャンネルが多く、MarchinZ の公式YouTubeチャンネル一覧だけでは
アイコンを解決できない。CSVを正本として、チャンネルIDを50件ずつ問い合わせ、
空の「動画配信元ロゴURL」を埋める。チャンネルURLが空の古い行は、動画IDから
配信元チャンネルを復元して /channel/UC... へ正規化する。

APIキーや動画本体は保存・出力しない。APIキーがない、一部バッチが一時失敗した
場合でも、日次のPOV更新そのものを止めない（--strict を除く）。
"""
from __future__ import annotations

import argparse
import csv
from html.parser import HTMLParser
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_CSV = ROOT / "大会動画リスト_POV.csv"
CHANNEL_ID_RE = re.compile(r"(?:youtube\.com/)?channel/(UC[\w-]+)", re.I)
HANDLE_RE = re.compile(r"(?:youtube\.com/)?@([\w.-]+)", re.I)
USERNAME_RE = re.compile(r"(?:youtube\.com/)?user/([\w.-]+)", re.I)
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
LOGO_FIELD = "動画配信元ロゴURL"
CHANNEL_URL_FIELD = "動画配信元URL"
CHANNEL_NAME_FIELD = "動画配信元"
VIDEO_URL_FIELD = "URL"
CHANNELS_ENDPOINT = "https://www.googleapis.com/youtube/v3/channels"
VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos"
RETRYABLE_CODES = {429, 500, 502, 503, 504}
PUBLIC_CHANNEL_ENDPOINT = "https://www.youtube.com/channel/{}"
PUBLIC_VIDEO_ENDPOINT = "https://www.youtube.com/watch?v={}"
PUBLIC_CHANNEL_ID_RE = re.compile(r'"(?:channelId|externalId)":"(UC[\\w-]+)"')


class OgImageParser(HTMLParser):
    """Extract the public Open Graph image without depending on attribute order."""

    def __init__(self) -> None:
        super().__init__()
        self.image_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "meta" or self.image_url:
            return
        values = {key.lower(): (value or "") for key, value in attrs}
        if values.get("property", "").lower() == "og:image":
            self.image_url = values.get("content", "").strip()


def chunks(values: list[str], size: int = 50):
    for start in range(0, len(values), size):
        yield values[start : start + size]


def channel_id_from_url(value: str) -> str:
    match = CHANNEL_ID_RE.search((value or "").strip())
    return match.group(1) if match else ""


def handle_from_url(value: str) -> str:
    match = HANDLE_RE.search((value or "").strip())
    return match.group(1) if match else ""


def username_from_url(value: str) -> str:
    match = USERNAME_RE.search((value or "").strip())
    return match.group(1) if match else ""


def video_id_from_url(value: str) -> str:
    raw = (value or "").strip()
    if VIDEO_ID_RE.fullmatch(raw):
        return raw
    try:
        parsed = urllib.parse.urlparse(raw)
        host = parsed.netloc.lower().removeprefix("www.")
        if host == "youtu.be":
            candidate = parsed.path.strip("/").split("/")[0]
        elif host.endswith("youtube.com"):
            if parsed.path == "/watch":
                candidate = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
            else:
                pieces = [piece for piece in parsed.path.split("/") if piece]
                candidate = pieces[1] if len(pieces) >= 2 and pieces[0] in {"shorts", "embed", "live"} else ""
        else:
            candidate = ""
    except ValueError:
        candidate = ""
    return candidate if VIDEO_ID_RE.fullmatch(candidate) else ""


def canonical_channel_url(channel_id: str) -> str:
    return f"https://www.youtube.com/channel/{channel_id}" if channel_id else ""


def best_thumbnail(snippet: dict) -> str:
    thumbs = snippet.get("thumbnails") if isinstance(snippet, dict) else {}
    if not isinstance(thumbs, dict):
        return ""
    # Channel icon is small. high first avoids rare oversized/failing maxres URLs.
    for name in ("high", "medium", "default", "standard", "maxres"):
        item = thumbs.get(name)
        if isinstance(item, dict) and isinstance(item.get("url"), str):
            return item["url"].strip()
    return ""


class YoutubeApi:
    """YouTube Data API wrapper that never prints URLs containing the API key."""

    def __init__(self, api_key: str, retries: int = 3):
        self.api_key = api_key
        self.retries = retries
        self.errors: Counter[str] = Counter()

    def get(self, endpoint: str, params: dict[str, str]) -> dict | None:
        query = urllib.parse.urlencode({**params, "key": self.api_key})
        request = urllib.request.Request(
            f"{endpoint}?{query}",
            headers={"Accept": "application/json", "User-Agent": "MarchinZ/1.0"},
        )
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
                return payload if isinstance(payload, dict) else None
            except urllib.error.HTTPError as exc:
                code = exc.code
                error_key = f"http_{code}"
                retry = code in RETRYABLE_CODES and attempt + 1 < self.retries
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                error_key = "network_or_json"
                retry = attempt + 1 < self.retries
            if retry:
                time.sleep(1 + attempt)
                continue
            self.errors[error_key] += 1
            return None
        return None

    def channels_by_ids(self, channel_ids: list[str]) -> dict[str, dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        for batch in chunks(channel_ids):
            payload = self.get(CHANNELS_ENDPOINT, {"part": "snippet", "id": ",".join(batch)})
            if not payload:
                continue
            for item in payload.get("items", []):
                channel_id = str(item.get("id") or "").strip()
                snippet = item.get("snippet") or {}
                if channel_id:
                    found[channel_id] = {
                        "logo": best_thumbnail(snippet),
                        "title": str(snippet.get("title") or "").strip(),
                    }
        return found

    def channel_by_param(self, key: str, value: str) -> str:
        payload = self.get(CHANNELS_ENDPOINT, {"part": "snippet", key: value})
        if not payload:
            return ""
        items = payload.get("items", [])
        return str(items[0].get("id") or "").strip() if items else ""

    def channel_ids_from_videos(self, video_ids: list[str]) -> dict[str, dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        for batch in chunks(video_ids):
            payload = self.get(VIDEOS_ENDPOINT, {"part": "snippet", "id": ",".join(batch)})
            if not payload:
                continue
            for item in payload.get("items", []):
                video_id = str(item.get("id") or "").strip()
                snippet = item.get("snippet") or {}
                channel_id = str(snippet.get("channelId") or "").strip()
                if video_id and channel_id:
                    found[video_id] = {
                        "channel_id": channel_id,
                        "title": str(snippet.get("channelTitle") or "").strip(),
                    }
        return found


class PublicYoutube:
    """Small public-page fallback for environments without a Data API key.

    This only reads YouTube's public channel/video HTML and writes the public
    `og:image` URL to the local CSV. It deliberately never scrapes video media.
    Data API remains the preferred bulk path because it can resolve every URL
    form in batches; this fallback keeps the daily catalog usable if a secret
    is temporarily unavailable.
    """

    def __init__(self, retries: int = 3) -> None:
        self.retries = retries
        self.errors: Counter[str] = Counter()

    def get_text(self, url: str) -> str:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.8",
                "User-Agent": "Mozilla/5.0 (compatible; MarchinZCatalog/1.0)",
            },
        )
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    return response.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as exc:
                error_key = f"http_{exc.code}"
                retry = exc.code in RETRYABLE_CODES and attempt + 1 < self.retries
            except (urllib.error.URLError, TimeoutError):
                error_key = "network"
                retry = attempt + 1 < self.retries
            if retry:
                time.sleep(1 + attempt)
                continue
            self.errors[error_key] += 1
            return ""
        return ""

    def channel_id_from_video(self, video_id: str) -> str:
        html = self.get_text(PUBLIC_VIDEO_ENDPOINT.format(urllib.parse.quote(video_id)))
        match = PUBLIC_CHANNEL_ID_RE.search(html)
        return match.group(1) if match else ""

    def channel_data_by_ids(self, channel_ids: list[str]) -> dict[str, dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        for index, channel_id in enumerate(channel_ids):
            html = self.get_text(PUBLIC_CHANNEL_ENDPOINT.format(urllib.parse.quote(channel_id)))
            if not html:
                continue
            parser = OgImageParser()
            parser.feed(html)
            if parser.image_url:
                found[channel_id] = {"logo": parser.image_url, "title": ""}
            if (index + 1) % 25 == 0 or index + 1 == len(channel_ids):
                print(
                    f"公開ロゴ取得 {index + 1}/{len(channel_ids)}（取得 {len(found)}件）",
                    file=sys.stderr,
                    flush=True,
                )
            # A light pace avoids making a large one-off backfill look like a
            # burst while keeping the first 824-channel fill practical.
            if index + 1 < len(channel_ids):
                time.sleep(0.06)
        return found


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]], bool]:
    raw = path.read_bytes()
    has_bom = raw.startswith(b"\xef\xbb\xbf")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = [dict(row) for row in reader]
    if LOGO_FIELD not in fieldnames:
        fieldnames.append(LOGO_FIELD)
    return fieldnames, rows, has_bom


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]], has_bom: bool) -> None:
    encoding = "utf-8-sig" if has_bom else "utf-8"
    with tempfile.NamedTemporaryFile(
        mode="w", encoding=encoding, newline="", dir=path.parent,
        prefix=f".{path.name}.", suffix=".tmp", delete=False,
    ) as handle:
        temp_path = Path(handle.name)
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temp_path, path)


def needs_resolution(row: dict[str, str], refresh: bool) -> bool:
    return refresh or not (row.get(LOGO_FIELD) or "").strip() or not channel_id_from_url(row.get(CHANNEL_URL_FIELD, ""))


def resolve_row_channel_ids(rows: list[dict[str, str]], api: YoutubeApi, refresh: bool) -> tuple[dict[int, str], dict[int, str], Counter[str]]:
    """Resolve every eligible row to a canonical channel ID without changing data yet."""
    resolved: dict[int, str] = {}
    titles: dict[int, str] = {}
    stats: Counter[str] = Counter()
    handle_rows: dict[str, list[int]] = {}
    username_rows: dict[str, list[int]] = {}
    video_rows: dict[str, list[int]] = {}

    for index, row in enumerate(rows):
        if not needs_resolution(row, refresh):
            continue
        url = row.get(CHANNEL_URL_FIELD, "")
        channel_id = channel_id_from_url(url)
        if channel_id:
            resolved[index] = channel_id
            stats["canonical_url"] += 1
            continue
        handle = handle_from_url(url)
        username = username_from_url(url)
        video_id = video_id_from_url(row.get(VIDEO_URL_FIELD, ""))
        if handle:
            handle_rows.setdefault(handle, []).append(index)
        elif username:
            username_rows.setdefault(username, []).append(index)
        elif video_id:
            # Empty /c/ / other legacy URLs are safely resolved from the exact video.
            video_rows.setdefault(video_id, []).append(index)
        else:
            stats["unresolved_no_video_id"] += 1

    for handle, indexes in handle_rows.items():
        channel_id = api.channel_by_param("forHandle", handle)
        if channel_id:
            for index in indexes:
                resolved[index] = channel_id
            stats["handle_url"] += len(indexes)
        else:
            stats["unresolved_handle"] += len(indexes)

    for username, indexes in username_rows.items():
        channel_id = api.channel_by_param("forUsername", username)
        if channel_id:
            for index in indexes:
                resolved[index] = channel_id
            stats["username_url"] += len(indexes)
        else:
            stats["unresolved_username"] += len(indexes)

    video_data = api.channel_ids_from_videos(sorted(video_rows))
    for video_id, indexes in video_rows.items():
        item = video_data.get(video_id)
        if not item:
            stats["unresolved_video"] += len(indexes)
            continue
        for index in indexes:
            resolved[index] = item["channel_id"]
            titles[index] = item["title"]
        stats["video_url"] += len(indexes)
    return resolved, titles, stats


def resolve_row_channel_ids_public(
    rows: list[dict[str, str]], public: PublicYoutube, refresh: bool,
) -> tuple[dict[int, str], dict[int, str], Counter[str]]:
    """Resolve canonical channel URLs and the small video-only remainder.

    The public fallback intentionally limits itself to stable `/channel/UC…`
    URLs plus exact video pages. Handle/user URLs remain Data API work so this
    path cannot guess a channel from a display name.
    """
    resolved: dict[int, str] = {}
    titles: dict[int, str] = {}
    stats: Counter[str] = Counter()
    video_rows: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        if not needs_resolution(row, refresh):
            continue
        channel_id = channel_id_from_url(row.get(CHANNEL_URL_FIELD, ""))
        if channel_id:
            resolved[index] = channel_id
            stats["canonical_url"] += 1
            continue
        video_id = video_id_from_url(row.get(VIDEO_URL_FIELD, ""))
        if video_id:
            video_rows.setdefault(video_id, []).append(index)
        else:
            stats["unresolved_no_video_id"] += 1
    for video_id, indexes in video_rows.items():
        channel_id = public.channel_id_from_video(video_id)
        if not channel_id:
            stats["unresolved_video"] += len(indexes)
            continue
        for index in indexes:
            resolved[index] = channel_id
        stats["video_url"] += len(indexes)
    return resolved, titles, stats


def apply_resolved_data(
    rows: list[dict[str, str]], resolved: dict[int, str], video_titles: dict[int, str], channel_data: dict[str, dict[str, str]], refresh: bool,
) -> Counter[str]:
    changed: Counter[str] = Counter()
    for index, channel_id in resolved.items():
        row = rows[index]
        canonical_url = canonical_channel_url(channel_id)
        if canonical_url and row.get(CHANNEL_URL_FIELD, "").strip() != canonical_url:
            row[CHANNEL_URL_FIELD] = canonical_url
            changed["channel_url"] += 1
        info = channel_data.get(channel_id, {})
        logo = info.get("logo", "")
        if logo and (refresh or not row.get(LOGO_FIELD, "").strip()) and row.get(LOGO_FIELD, "") != logo:
            row[LOGO_FIELD] = logo
            changed["logo"] += 1
        # Existing source name is human-curated; only fill a blank from API metadata.
        if not row.get(CHANNEL_NAME_FIELD, "").strip():
            title = (info.get("title") or video_titles.get(index) or "").strip()
            if title:
                row[CHANNEL_NAME_FIELD] = title
                changed["channel_name"] += 1
    return changed


def enrich(path: Path, api_key: str, refresh: bool = False) -> tuple[Counter[str], Counter[str], Counter[str]]:
    fieldnames, rows, has_bom = read_csv(path)
    api_errors: Counter[str] = Counter()
    if api_key:
        api = YoutubeApi(api_key)
        resolved, video_titles, resolve_stats = resolve_row_channel_ids(rows, api, refresh)
        channel_data = api.channels_by_ids(sorted(set(resolved.values())))
        api_errors.update(api.errors)
    else:
        public = PublicYoutube()
        resolved, video_titles, resolve_stats = resolve_row_channel_ids_public(rows, public, refresh)
        channel_data = public.channel_data_by_ids(sorted(set(resolved.values())))
        api_errors.update({f"public_{key}": value for key, value in public.errors.items()})
    changed = apply_resolved_data(rows, resolved, video_titles, channel_data, refresh)
    unresolved = Counter(resolve_stats)
    unresolved["resolved_channel_rows"] = len(resolved)
    unresolved["resolved_channel_details"] = len(channel_data)
    for key, count in api_errors.items():
        unresolved[key] += count
    if changed:
        write_csv(path, fieldnames, rows, has_bom)
    return changed, resolve_stats, unresolved


def self_test() -> int:
    assert channel_id_from_url("https://www.youtube.com/channel/UC25aJNCCJTGNlN6KO8VJloQ") == "UC25aJNCCJTGNlN6KO8VJloQ"
    assert handle_from_url("https://www.youtube.com/@allisonroush316") == "allisonroush316"
    assert username_from_url("https://www.youtube.com/user/example") == "example"
    assert video_id_from_url("https://youtu.be/FCV46NoVgJc?si=test") == "FCV46NoVgJc"
    assert video_id_from_url("https://www.youtube.com/shorts/FCV46NoVgJc") == "FCV46NoVgJc"
    assert best_thumbnail({"thumbnails": {"default": {"url": "small"}, "high": {"url": "large"}}}) == "large"
    parser = OgImageParser()
    parser.feed('<meta content="https://img.example/avatar.jpg" property="og:image">')
    assert parser.image_url == "https://img.example/avatar.jpg"
    rows = [{CHANNEL_URL_FIELD: "", CHANNEL_NAME_FIELD: "Allison Roush", LOGO_FIELD: ""}]
    changed = apply_resolved_data(rows, {0: "UC25aJNCCJTGNlN6KO8VJloQ"}, {}, {"UC25aJNCCJTGNlN6KO8VJloQ": {"logo": "https://img.example/a.jpg", "title": "Other"}}, False)
    assert rows[0][CHANNEL_URL_FIELD].endswith("UC25aJNCCJTGNlN6KO8VJloQ")
    assert rows[0][LOGO_FIELD] == "https://img.example/a.jpg"
    assert rows[0][CHANNEL_NAME_FIELD] == "Allison Roush"
    assert changed == Counter({"channel_url": 1, "logo": 1})

    class FakeApi:
        def channel_by_param(self, key: str, value: str) -> str:
            return "UC_HANDLE" if (key, value) == ("forHandle", "future_handle") else ""

        def channel_ids_from_videos(self, video_ids: list[str]) -> dict[str, dict[str, str]]:
            assert video_ids == ["FCV46NoVgJc"]
            return {"FCV46NoVgJc": {"channel_id": "UC_VIDEO", "title": "Video channel"}}

    # Empty channel URLs must resolve from the exact video; handles remain
    # supported so a future non-UC URL cannot silently regress to an initial.
    resolved, titles, stats = resolve_row_channel_ids(
        [
            {CHANNEL_URL_FIELD: "", VIDEO_URL_FIELD: "https://youtu.be/FCV46NoVgJc", LOGO_FIELD: ""},
            {CHANNEL_URL_FIELD: "https://www.youtube.com/@future_handle", VIDEO_URL_FIELD: "", LOGO_FIELD: ""},
        ],
        FakeApi(),  # type: ignore[arg-type]
        False,
    )
    assert resolved == {0: "UC_VIDEO", 1: "UC_HANDLE"}
    assert titles == {0: "Video channel"}
    assert stats["video_url"] == 1 and stats["handle_url"] == 1
    print("OK: enrich_video_source_logos self-test")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", action="append", type=Path, help="対象CSV（複数指定可）")
    parser.add_argument("--refresh", action="store_true", help="既存URLも再取得する")
    parser.add_argument("--strict", action="store_true", help="APIキー未設定時も失敗終了する（手動確認用）")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        if args.strict:
            print("ERROR: YOUTUBE_API_KEY が未設定です", file=sys.stderr)
            return 2
        print(
            "WARNING: YOUTUBE_API_KEY が未設定のため、公開チャンネルページの og:image で補完します",
            file=sys.stderr,
        )

    paths = args.csv or [DEFAULT_CSV]
    total_changed: Counter[str] = Counter()
    for raw_path in paths:
        path = raw_path if raw_path.is_absolute() else ROOT / raw_path
        if not path.is_file():
            print(f"WARNING: CSVがありません: {path}", file=sys.stderr)
            continue
        changed, resolve_stats, stats = enrich(path, api_key, args.refresh)
        total_changed.update(changed)
        print(
            f"{path.name}: logo {changed['logo']}行 / URL正規化 {changed['channel_url']}行 / "
            f"動画から復元 {resolve_stats['video_url']}行 / handle {resolve_stats['handle_url']}行 / "
            f"未解決 {sum(v for k, v in resolve_stats.items() if k.startswith('unresolved_'))}行",
            file=sys.stderr,
        )
        api_errors = {k: v for k, v in stats.items() if k.startswith('api_')}
        if api_errors:
            print(f"WARNING: API一部失敗 {api_errors}（成功分は保存済み）", file=sys.stderr)
    print(f"OK: 配信元ロゴURLを合計 {total_changed['logo']} 行更新")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
