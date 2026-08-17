#!/usr/bin/env python3
"""マーチング祭の監視レポートをSMTPでメール送信する。"""

from __future__ import annotations

import argparse
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path


def parse_recipients(value: str) -> list[str]:
    recipients = [item.strip() for item in value.replace("\n", ",").split(",") if item.strip()]
    if not recipients or any("\r" in item or "\n" in item for item in recipients):
        raise ValueError("送信先メールアドレスが不正です")
    return recipients


def build_message(subject: str, body: str, sender: str, recipients: list[str]) -> EmailMessage:
    if "\r" in subject or "\n" in subject:
        raise ValueError("件名に改行は使えません")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(("マーチング祭 更新監視", sender))
    message["To"] = ", ".join(recipients)
    message.set_content(body)
    return message


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject-file", type=Path, required=True)
    parser.add_argument("--body-file", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    user = os.environ.get("MATSURI_SMTP_USER", "").strip()
    password = os.environ.get("MATSURI_SMTP_APP_PASSWORD", "").strip()
    target = os.environ.get("MATSURI_REPORT_EMAIL_TO", "").strip() or user
    sender = os.environ.get("MATSURI_REPORT_EMAIL_FROM", "").strip() or user
    if not user or not sender or not target:
        raise SystemExit("MATSURI_SMTP_USER / 送信先が設定されていません")
    if not password and not args.dry_run:
        raise SystemExit("MATSURI_SMTP_APP_PASSWORD が設定されていません")

    subject = args.subject_file.read_text(encoding="utf-8").strip()
    body = args.body_file.read_text(encoding="utf-8")
    recipients = parse_recipients(target)
    message = build_message(subject, body, sender, recipients)
    if args.dry_run:
        print(message)
        return 0

    host = os.environ.get("MATSURI_SMTP_HOST", "smtp.gmail.com").strip()
    port = int(os.environ.get("MATSURI_SMTP_PORT", "465"))
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as smtp:
        smtp.login(user, password)
        smtp.send_message(message)
    print("マーチング祭の更新レポートをメール送信しました")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
