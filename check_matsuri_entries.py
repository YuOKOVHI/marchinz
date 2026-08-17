#!/usr/bin/env python3
"""マーチング祭2026ページの3大会エントリー一覧を監視する。

Wixのスライドショーは最初の1枚だけをHTMLへ描画するため、ページ内に
埋め込まれたWix公式データURLを発見し、3枚分の本文を読む。
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo


SOURCE_URL = "https://www.marching-matsuri.com/2026mmcs"
SECTION_NAMES = ("マーチングバンド部門", "Jr.マーチングバンド部門", "エキシビジョン")
SLIDES = (
    ("湘南藤沢OPEN", "Slide  1", "2026 マーチング祭 湘南藤沢OPEN"),
    ("東海OPEN", "東海OP", "2026 マーチング祭 東海OPEN"),
    ("横浜FINAL", "横浜ファイナル", "2026 横浜FINAL"),
)
PREFECTURES = (
    "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬",
    "埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野",
    "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
    "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
)
ENTRY_RE = re.compile(r"(.+?｜(?:{}))(?=\s|$)".format("|".join(PREFECTURES)))


def _clean(value: str) -> str:
    value = html.unescape(value)
    value = unicodedata.normalize("NFC", value)
    value = value.replace("\u200b", "").replace("\ufeff", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", value).strip()


def parse_slide_text(text: str, event_name: str, expected_title: str) -> dict:
    """表示中スライドのテキストを大会名・部門別団体一覧へ変換する。"""
    lines = [_clean(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    title = next((line for line in lines if expected_title in line), None)
    if not title:
        raise ValueError(f"{event_name}: 大会見出しを読めませんでした")

    positions = {}
    for section in SECTION_NAMES:
        try:
            positions[section] = lines.index(section)
        except ValueError as exc:
            raise ValueError(f"{event_name}: {section}の見出しを読めませんでした") from exc
    if list(positions.values()) != sorted(positions.values()):
        raise ValueError(f"{event_name}: 部門の並びが想定外です")

    sections = {}
    for index, section in enumerate(SECTION_NAMES):
        start = positions[section] + 1
        end = positions[SECTION_NAMES[index + 1]] if index + 1 < len(SECTION_NAMES) else len(lines)
        entries = []
        for line in lines[start:end]:
            matches = [match.group(1).strip() for match in ENTRY_RE.finditer(line)]
            remainder = ENTRY_RE.sub("", line).strip()
            if remainder:
                raise ValueError(f"{event_name}/{section}: 団体名として解析できない行: {line}")
            entries.extend(matches)
        if len(entries) != len(set(entries)):
            raise ValueError(f"{event_name}/{section}: 同じ団体が重複しています")
        sections[section] = entries

    if not any(sections.values()):
        raise ValueError(f"{event_name}: 出場団体を1件も読めませんでした")
    return {"title": title, "sections": sections}


def validate_state(state: dict) -> None:
    if state.get("version") != 1 or not isinstance(state.get("events"), dict):
        raise ValueError("比較用状態ファイルの形式が不正です")
    if set(state["events"]) != {item[0] for item in SLIDES}:
        raise ValueError("比較用状態ファイルに3大会が揃っていません")


def compare_states(previous: dict | None, current: dict) -> dict:
    """前回との差分を大会・部門単位で返す。"""
    if previous is None:
        return {"status": "initial", "updated": False, "events": {}}
    validate_state(previous)
    event_changes = {}
    updated = False
    for event_name, current_event in current["events"].items():
        old_event = previous["events"][event_name]
        changes = []
        if old_event.get("title") != current_event["title"]:
            changes.append({
                "type": "title",
                "before": old_event.get("title", ""),
                "after": current_event["title"],
            })
        for section in SECTION_NAMES:
            before = old_event.get("sections", {}).get(section, [])
            after = current_event["sections"][section]
            added = [name for name in after if name not in before]
            removed = [name for name in before if name not in after]
            if added or removed:
                changes.append({"type": "entries", "section": section, "added": added, "removed": removed})
        if changes:
            event_changes[event_name] = changes
            updated = True
    return {"status": "updated" if updated else "unchanged", "updated": updated, "events": event_changes}


def format_report(current: dict, comparison: dict) -> str:
    lines = ["【更新】"]
    for event_name, _, _ in SLIDES:
        lines.append(f"■ {event_name}")
        if comparison["status"] == "initial":
            lines.append("初回記録（次回から差分を報告）")
            continue
        changes = comparison["events"].get(event_name, [])
        if not changes:
            lines.append("更新なし")
            continue
        for change in changes:
            if change["type"] == "title":
                lines.append(f"見出し変更：{change['before']} → {change['after']}")
                continue
            for name in change["added"]:
                lines.append(f"追加［{change['section']}］：{name}")
            for name in change["removed"]:
                lines.append(f"削除［{change['section']}］：{name}")

    lines.extend(["", "【現在のリスト】"])
    for event_name, _, _ in SLIDES:
        event = current["events"][event_name]
        lines.append(f"■ {event['title']}")
        for section in SECTION_NAMES:
            entries = event["sections"][section]
            lines.append(f"［{section}］{len(entries)}団体")
            lines.extend(f"・{name}" for name in entries)
            if not entries:
                lines.append("・なし")
        lines.append("")
    lines.append(f"確認先：{SOURCE_URL}")
    lines.append(f"確認日時：{current['checked_at']}")
    return "\n".join(lines).rstrip() + "\n"


THUNDERBOLT_URL_RE = re.compile(
    r'https://siteassets\.parastorage\.com/pages/pages/thunderbolt\?[^"\'<>\s]+'
)


class RichTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "br", "div"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("p", "div"):
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)

    def text(self) -> str:
        return "".join(self.parts)


def fetch_text(url: str) -> str:
    ascii_url = urllib.parse.quote(url, safe=":/?&=%.,_~-+")
    request = urllib.request.Request(ascii_url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    })
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read().decode("utf-8", errors="replace")


def _iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_strings(child)


def _html_to_text(value: str) -> str:
    parser = RichTextExtractor()
    parser.feed(value)
    return parser.text()


def read_entry_slides(url: str = SOURCE_URL) -> dict:
    page_html = fetch_text(url)
    data_urls = []
    for match in THUNDERBOLT_URL_RE.findall(page_html):
        # URL全体へhtml.unescapeをかけると「&registry...」の &reg まで
        # ®へ変換される。HTML属性で必要な &amp; だけを戻す。
        data_url = match.replace("&amp;", "&")
        if data_url not in data_urls:
            data_urls.append(data_url)
    if not data_urls:
        raise RuntimeError("WixのスライドデータURLを公式ページから読めませんでした")

    events = {}
    errors = []
    for data_url in data_urls:
        try:
            payload = json.loads(fetch_text(data_url))
        except Exception as exc:  # ほかのWixモジュールURLなら読み飛ばす
            errors.append(str(exc))
            continue
        for value in _iter_strings(payload):
            if "マーチングバンド部門" not in value or "エキシビジョン" not in value:
                continue
            for event_name, _, expected_title in SLIDES:
                if event_name in events or expected_title not in value:
                    continue
                events[event_name] = parse_slide_text(_html_to_text(value), event_name, expected_title)
        if len(events) == len(SLIDES):
            break
    missing = [event_name for event_name, _, _ in SLIDES if event_name not in events]
    if missing:
        detail = f"（取得エラー: {errors[-1]}）" if errors else ""
        raise RuntimeError("Wixデータから一覧を読めませんでした: " + ", ".join(missing) + detail)
    return {event_name: events[event_name] for event_name, _, _ in SLIDES}


def load_previous(path: Path) -> dict | None:
    if not path.exists():
        return None
    state = json.loads(path.read_text(encoding="utf-8"))
    validate_state(state)
    return state


def save_json_atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(path.name + ".tmp")
    temp_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, default=Path("matsuri-entry-state.json"))
    parser.add_argument("--report", type=Path, default=Path("matsuri-entry-report.txt"))
    parser.add_argument("--subject-file", type=Path, default=Path("matsuri-entry-subject.txt"))
    args = parser.parse_args()

    previous = load_previous(args.state)
    checked_at = datetime.now(ZoneInfo("Asia/Tokyo")).isoformat(timespec="seconds")
    current = {"version": 1, "checked_at": checked_at, "source": SOURCE_URL, "events": read_entry_slides()}
    comparison = compare_states(previous, current)
    report = format_report(current, comparison)
    today = checked_at[:10]
    status = "初回記録" if comparison["status"] == "initial" else ("更新あり" if comparison["updated"] else "更新なし")
    subject = f"[マーチング祭] エントリー{status}（{today}）"

    args.report.write_text(report, encoding="utf-8")
    args.subject_file.write_text(subject + "\n", encoding="utf-8")
    save_json_atomic(args.state, current)
    print(report, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
