#!/usr/bin/env python3
"""format_production_notification.py の回帰テスト。"""

from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest

import format_production_notification as target


class NotificationFormatTest(unittest.TestCase):
    def test_workflow_notifies_even_when_the_checker_fails(self) -> None:
        workflow = Path(__file__).parents[1] / ".github/workflows/check-production.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("issues: write", text)
        self.assertIn("id: check", text)
        self.assertIn("if: always()", text)
        self.assertIn('exit "$code"', text)
        self.assertIn('gh issue comment "$num"', text)
        self.assertIn("gh issue create --title", text)

    def test_success_is_short_problem_none_message(self) -> None:
        body = target.build_notification(
            0,
            "== ページの生存 ==\nOK: 本番は正常です\n",
            "2026-08-18 06:00 JST",
            "https://example.test/run/1",
        )
        self.assertIn("**問題なし**", body)
        self.assertNotIn("本番は正常です", body)
        self.assertIn("https://example.test/run/1", body)

    def test_difference_reports_only_ng_summary_and_problems(self) -> None:
        raw = """== ページの生存 ==
  OK TOP
== 版の一致 ==
  HEAD=2.41.0 / 本番=2.40.0

NG: 2 件の問題があります
  - 本番の版が古い
  - Privacy のページが見つかりません
"""
        body = target.build_notification(1, raw, "2026-08-18 06:00 JST", "")
        self.assertIn("**差分あり**", body)
        self.assertIn("NG: 2 件", body)
        self.assertIn("本番の版が古い", body)
        self.assertNotIn("HEAD=2.41.0", body)

    def test_unavailable_reports_command_output(self) -> None:
        body = target.build_notification(
            2,
            "ERROR: DNS を解決できません\n",
            "2026-08-18 06:00 JST",
            "",
        )
        self.assertIn("**チェック不能**", body)
        self.assertIn("DNS を解決できません", body)

    def test_cli_writes_the_notification_file(self) -> None:
        script = Path(__file__).with_name("format_production_notification.py")
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "check.txt"
            dst = Path(tmp) / "notice.md"
            src.write_text("OK: 本番は正常です\n", encoding="utf-8")
            subprocess.run(
                [
                    "python3",
                    str(script),
                    "--exit-code",
                    "0",
                    "--input",
                    str(src),
                    "--output",
                    str(dst),
                    "--checked-at",
                    "2026-08-18 06:00 JST",
                ],
                check=True,
            )
            self.assertEqual(
                dst.read_text(encoding="utf-8"),
                "## 2026-08-18 06:00 JST\n\n**問題なし**\n",
            )


if __name__ == "__main__":
    unittest.main()
