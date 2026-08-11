#!/usr/bin/env python3
"""POV日次見張りの探索期間と変更範囲を見張る。ネットワークには触らない。"""
from __future__ import annotations

import csv
import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load():
    spec = importlib.util.spec_from_file_location("checker", ROOT / "check_pov_updates.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    c = load()
    failures: list[str] = []

    # main()の実行経路で --since が scout 子プロセスへ届くことを確認する。
    old_csv, old_out, old_run, old_argv = c.POV_CSV, c.OUT_TSV, c.subprocess.run, sys.argv[:]
    try:
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            c.POV_CSV = tmp / "大会動画リスト_POV.csv"
            c.POV_CSV.write_text(
                "種別,分類,動画での表示名,団体/チーム名,団体ID,配信日,大会名,元動画タイトル,URL,動画配信元,動画配信元URL,動画配信元ロゴURL\n",
                encoding="utf-8",
            )
            c.OUT_TSV = tmp / "pov_candidates.tsv"
            seen: list[list[str]] = []

            def fake_run(cmd, **_kwargs):
                seen.append(cmd)
                with c.OUT_TSV.open("w", encoding="utf-8", newline="") as f:
                    csv.writer(f, delimiter="\t").writerow(
                        ["video_id", "公開日", "尺秒", "チャンネル", "題名", "判定理由", "URL"]
                    )
                return subprocess.CompletedProcess(cmd, 0, "", "")

            c.subprocess.run = fake_run
            sys.argv = ["check_pov_updates.py", "--since", "2026-08-08"]
            if c.main() != 0:
                failures.append("--since 指定時のチェック本体が成功しない")
            if not seen or seen[0][-2:] != ["--since", "2026-08-08"]:
                failures.append("--since が scout 実行へ渡らない")
    finally:
        c.POV_CSV, c.OUT_TSV, c.subprocess.run, sys.argv = old_csv, old_out, old_run, old_argv

    workflow = (ROOT / ".github/workflows/videos-daily-update.yml").read_text(encoding="utf-8")
    must_have = [
        'cron: "0 15 * * *"',
        '大会動画リスト_POV.csv',
        'git add \'大会動画リスト_POV.csv\' data.json data.inline.js pov_ledger.json',
        'python3 check_pov_updates.py --since "${{ steps.pick.outputs.since }}"',
        'runs-on: ubuntu-latest',
    ]
    for text in must_have:
        if text not in workflow:
            failures.append(f"workflow の必須設定が無い: {text}")
    if ("大会動画リスト_*.csv" in workflow
            or "import_flomarching_dci_full_shows.py" in workflow
            or "macos-latest" in workflow):
        failures.append("workflow がPOV以外の大会動画CSVを変更し得る")

    if failures:
        print(f"FAIL {len(failures)}件")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("PASS 6件（探索期間の受け渡し / JST 00:00 / POV変更範囲）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
