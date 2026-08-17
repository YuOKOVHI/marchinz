#!/usr/bin/env python3

import unittest

from send_matsuri_report_email import build_message, parse_recipients


class EmailTests(unittest.TestCase):
    def test_multiple_recipients(self):
        self.assertEqual(parse_recipients("a@example.com, b@example.com"), ["a@example.com", "b@example.com"])

    def test_message_contains_japanese_report(self):
        message = build_message("更新なし", "【更新】\n更新なし\n", "sender@example.com", ["to@example.com"])
        self.assertEqual(message["Subject"], "更新なし")
        self.assertIn("【更新】", message.get_content())
        self.assertIn("to@example.com", message["To"])

    def test_subject_header_injection_is_rejected(self):
        with self.assertRaises(ValueError):
            build_message("正常\nBcc: x@example.com", "本文", "sender@example.com", ["to@example.com"])


if __name__ == "__main__":
    unittest.main()
