#!/usr/bin/env python3
"""check_production.py の結果を、毎朝通知用の短い Markdown にする。"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re


JST = timezone(timedelta(hours=9))
MAX_DETAIL_CHARS = 12000


def _tail(text: str, line_limit: int = 80) -> str:
    lines = text.strip().splitlines()
    return "\n".join(lines[-line_limit:]).strip()


def _problem_detail(output: str) -> str:
    """検査出力の「NG:」以降だけを返す。予期外の形なら末尾を返す。"""
    match = re.search(r"(?m)^NG: .+$", output)
    detail = output[match.start():].strip() if match else _tail(output)
    if not detail:
        return "(検査出力がありません)"
    if len(detail) > MAX_DETAIL_CHARS:
        detail = "…(前略)…\n" + detail[-MAX_DETAIL_CHARS:]
    return detail


def build_notification(exit_code: int, output: str, checked_at: str, run_url: str) -> str:
    if exit_code == 0:
        status = "問題なし"
        detail = ""
    elif exit_code == 1:
        status = "差分あり"
        detail = _problem_detail(output)
    else:
        status = "チェック不能"
        detail = _tail(output) or "(検査自体の出力がありません)"

    parts = [f"## {checked_at}", "", f"**{status}**"]
    if detail:
        parts.extend(["", "```text", detail, "```"])
    if run_url:
        parts.extend(["", f"[Actions の実行結果]({run_url})"])
    return "\n".join(parts).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exit-code", required=True, type=int, choices=(0, 1, 2))
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--checked-at", default="")
    parser.add_argument("--run-url", default="")
    args = parser.parse_args()

    checked_at = args.checked_at or datetime.now(JST).strftime("%Y-%m-%d %H:%M JST")
    raw = args.input.read_text(encoding="utf-8") if args.input.is_file() else ""
    body = build_notification(args.exit_code, raw, checked_at, args.run_url)
    args.output.write_text(body, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
