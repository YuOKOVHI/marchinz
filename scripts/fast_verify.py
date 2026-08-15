#!/usr/bin/env python3
"""MarchinZ の変更内容から、必要な高速検証だけを選んで実行する。"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]

DATA_MARKERS = (
    "data.json",
    "data.inline.js",
    "sync_csv_to_json.py",
    "check_data.py",
    "verify_youtube_list_csv_inline.py",
    "大会動画リスト_",
    "youtube-list/",
)
POV_MARKERS = (
    "scout_pov_videos.py",
    "test_scout_pov_videos.py",
    "check_pov_updates.py",
    "pov_channel_cursors.json",
    "大会動画リスト_POV.csv",
)
ENGINE_MARKERS = (
    "tools/shared/",
    "tools/switcher/js/exporter.js",
    "tools/switcher/js/visual.js",
    "tools/switcher/js/sync.js",
    "tools/switcher/js/media.js",
)
PRODUCT_MARKERS = (
    "index.html",
    "app.js",
    "styles.css",
    "marchinz-brushup.css",
    "site-nav.js",
    "tools/",
    "youtube-list/",
)


def _git_lines(*args: str) -> list[str]:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, text=True, capture_output=True, check=False
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def changed_files(base: str | None) -> list[str]:
    files: set[str] = set()
    if base:
        files.update(_git_lines("diff", "--name-only", "--diff-filter=ACMRTUXB", f"{base}...HEAD"))
    files.update(_git_lines("diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD"))
    files.update(_git_lines("diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"))
    return sorted(files)


def _contains(path: str, markers: tuple[str, ...]) -> bool:
    return any(marker in path for marker in markers)


def classify(files: list[str]) -> dict[str, object]:
    paths = [p.replace("\\", "/") for p in files]
    data = any(_contains(p, DATA_MARKERS) or p.endswith(".csv") for p in paths)
    pov = any(_contains(p, POV_MARKERS) for p in paths)
    engine = any(_contains(p, ENGINE_MARKERS) for p in paths)
    product = any(_contains(p, PRODUCT_MARKERS) for p in paths)
    return {
        "data": data,
        "pov": pov,
        "engine": engine,
        "product": product,
        "python": [p for p in paths if p.endswith(".py")],
        "javascript": [p for p in paths if p.endswith(".js")],
        "qa": "full" if engine else ("standard" if product else "none"),
    }


def _run(name: str, command: list[str]) -> dict[str, object]:
    started = time.perf_counter()
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    return {
        "name": name,
        "command": command,
        "ok": result.returncode == 0,
        "seconds": round(time.perf_counter() - started, 3),
        "output": (result.stdout + result.stderr).strip(),
    }


def build_checks(files: list[str], base: str | None) -> tuple[list[tuple[str, list[str]]], list[str]]:
    plan = classify(files)
    checks: list[tuple[str, list[str]]] = []
    notes: list[str] = []
    checks.append(("diff-worktree", ["git", "diff", "--check"]))
    if base:
        checks.append(("diff-commits", ["git", "diff", "--check", f"{base}...HEAD"]))

    py_files = [str(ROOT / p) for p in plan["python"] if (ROOT / p).is_file()]
    if py_files:
        checks.append((
            "python-syntax",
            [
                sys.executable,
                "-c",
                (
                    "import ast,sys; "
                    "[ast.parse(open(p,encoding='utf-8').read(),filename=p) "
                    "for p in sys.argv[1:]]"
                ),
                *py_files,
            ],
        ))

    js_files = [str(ROOT / p) for p in plan["javascript"] if (ROOT / p).is_file()]
    node = shutil.which("node")
    if js_files and node:
        for path in js_files:
            checks.append((f"js:{Path(path).name}", [node, "--check", path]))
    elif js_files:
        notes.append("Node.jsが無いためJS構文確認はブラウザQAへ委ねます")

    if plan["data"]:
        checks.append(("data", [sys.executable, "check_data.py"]))
    if plan["pov"]:
        checks.append(("pov", [sys.executable, "test_scout_pov_videos.py"]))
    return checks, notes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="このコミット以降の変更も対象にする（例: origin/main）")
    parser.add_argument("--files", nargs="*", help="Git差分ではなく指定ファイルを分類する")
    parser.add_argument("--release", action="store_true", help="push_check.pyも実行し、本番前QA段を表示")
    parser.add_argument("--dry-run", action="store_true", help="選ばれた検証だけ表示する")
    parser.add_argument("--json", action="store_true", help="機械可読JSONで表示する")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base = args.base or ("origin/main" if args.release else None)
    files = sorted(set(args.files if args.files is not None else changed_files(base)))
    plan = classify(files)
    checks, notes = build_checks(files, base)

    if args.dry_run:
        payload = {"files": files, "plan": plan, "checks": [c for _, c in checks], "notes": notes}
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    started = time.perf_counter()
    results: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, max(1, len(checks)))) as pool:
        futures = [pool.submit(_run, name, command) for name, command in checks]
        for future in futures:
            results.append(future.result())

    if args.release:
        results.append(_run("push-check", [sys.executable, "push_check.py"]))

    ok = all(bool(r["ok"]) for r in results)
    payload = {
        "ok": ok,
        "seconds": round(time.perf_counter() - started, 3),
        "files": files,
        "plan": plan,
        "results": results,
        "notes": notes,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"対象 {len(files)}ファイル / {payload['seconds']:.3f}秒 / {'PASS' if ok else 'FAIL'}")
        for result in results:
            mark = "✓" if result["ok"] else "✗"
            print(f"  {mark} {result['name']} {result['seconds']:.3f}秒")
            if result["output"] and not result["ok"]:
                print(result["output"])
        for note in notes:
            print(f"  注: {note}")
        if not files:
            print("  変更ファイルなし")
        if args.release:
            qa = plan["qa"]
            if qa == "full":
                print("次: ブラウザQAを ?full=1 で1回だけ実行")
            elif qa == "standard":
                print("次: ブラウザQA標準セットを1回だけ実行")
            else:
                print("次: 製品コード変更なし。ブラウザQA追加不要")
        elif plan["qa"] != "none":
            print("編集中は関連画面だけ確認。本番前の全体QAはまだ不要です")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
