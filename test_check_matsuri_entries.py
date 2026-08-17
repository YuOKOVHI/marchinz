#!/usr/bin/env python3

import json
import unittest
from unittest.mock import patch

from check_matsuri_entries import (
    SECTION_NAMES,
    SOURCE_URL,
    compare_states,
    format_report,
    parse_slide_text,
    read_entry_slides,
)


SHONAN_TEXT = """2026 マーチング祭 湘南藤沢OPEN｜ 2026/9/26 土
マーチングバンド部門
THE FOCUS｜静岡
Jr.マーチングバンド部門
湘南ドルフィンズ マーチングバンド｜神奈川
エキシビジョン
DEARS Color Guard Team｜宮城 Revolt colorguard｜神奈川
"""


def make_state(focus_name="THE FOCUS｜静岡"):
    event = parse_slide_text(SHONAN_TEXT.replace("THE FOCUS｜静岡", focus_name), "湘南藤沢OPEN", "2026 マーチング祭 湘南藤沢OPEN")
    events = {
        "湘南藤沢OPEN": event,
        "東海OPEN": {"title": "2026 マーチング祭 東海OPEN｜ 2026/11/23月祝", "sections": {name: [] for name in SECTION_NAMES}},
        "横浜FINAL": {"title": "2026 横浜FINAL｜ 2027/1/9-11", "sections": {name: [] for name in SECTION_NAMES}},
    }
    events["東海OPEN"]["sections"]["マーチングバンド部門"] = ["THE FOCUS｜静岡"]
    events["横浜FINAL"]["sections"]["マーチングバンド部門"] = ["MARCHING BAND COURAGE｜茨城"]
    return {"version": 1, "checked_at": "2026-08-18T05:10:00+09:00", "source": "https://example.test", "events": events}


class ParseTests(unittest.TestCase):
    def test_parse_combined_teams_in_one_rendered_line(self):
        event = parse_slide_text(SHONAN_TEXT, "湘南藤沢OPEN", "2026 マーチング祭 湘南藤沢OPEN")
        self.assertEqual(
            event["sections"]["エキシビジョン"],
            ["DEARS Color Guard Team｜宮城", "Revolt colorguard｜神奈川"],
        )

    def test_unknown_line_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "解析できない行"):
            parse_slide_text(SHONAN_TEXT.replace("THE FOCUS｜静岡", "県名なしの団体"), "湘南藤沢OPEN", "2026 マーチング祭 湘南藤沢OPEN")

    def test_read_entry_slides_uses_embedded_wix_payload_without_corrupting_registry(self):
        def slide_html(title, team):
            return (
                f"<div><p>{title}</p><p>マーチングバンド部門</p><p>{team}｜静岡</p>"
                "<p>Jr.マーチングバンド部門</p><p>ジュニアバンド｜神奈川</p>"
                "<p>エキシビジョン</p><p>カラーガード｜愛知</p></div>"
            )

        data_url = (
            "https://siteassets.parastorage.com/pages/pages/thunderbolt?x=1"
            "&registryLibrariesTopology=abc"
        )
        page_html = data_url.replace("&registry", "&amp;registry")
        payload = {
            "slides": [
                slide_html("2026 マーチング祭 湘南藤沢OPEN｜ 2026/9/26 土", "湘南バンド"),
                slide_html("2026 マーチング祭 東海OPEN｜ 2026/11/23月祝", "東海バンド"),
                slide_html("2026 横浜FINAL｜ 2027/1/9-11", "横浜バンド"),
            ]
        }

        def fake_fetch(url):
            if url == SOURCE_URL:
                return f'<link href="{page_html}">'
            self.assertEqual(url, data_url)
            self.assertNotIn("®", url)
            return json.dumps(payload, ensure_ascii=False)

        with patch("check_matsuri_entries.fetch_text", side_effect=fake_fetch):
            events = read_entry_slides()

        self.assertEqual(set(events), {"湘南藤沢OPEN", "東海OPEN", "横浜FINAL"})
        self.assertEqual(events["横浜FINAL"]["sections"]["マーチングバンド部門"], ["横浜バンド｜静岡"])


class DiffAndReportTests(unittest.TestCase):
    def test_added_and_removed_entries_are_reported(self):
        previous = make_state()
        current = make_state("BlueWings｜静岡")
        comparison = compare_states(previous, current)
        report = format_report(current, comparison)
        self.assertTrue(comparison["updated"])
        self.assertIn("追加［マーチングバンド部門］：BlueWings｜静岡", report)
        self.assertIn("削除［マーチングバンド部門］：THE FOCUS｜静岡", report)
        self.assertIn("【現在のリスト】", report)

    def test_unchanged_report_has_required_headers_and_full_list(self):
        state = make_state()
        report = format_report(state, compare_states(state, state))
        self.assertTrue(report.startswith("【更新】"))
        self.assertIn("■ 湘南藤沢OPEN\n更新なし", report)
        self.assertIn("【現在のリスト】", report)
        self.assertIn("・DEARS Color Guard Team｜宮城", report)

    def test_initial_run_is_not_false_update(self):
        comparison = compare_states(None, make_state())
        self.assertEqual(comparison["status"], "initial")
        self.assertFalse(comparison["updated"])


if __name__ == "__main__":
    unittest.main()
