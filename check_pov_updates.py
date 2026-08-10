#!/usr/bin/env python3
"""POV(奏者視点)動画の新着を毎日見張る。

`scout_pov_videos.py --quick` を回し、**まだ CSV にも台帳にも無い候補**が出たら
その一覧を Markdown にして返す。GitHub Actions から呼ばれ、見つかった日だけ
Issue が立つ。

★ サイトのファイルは一切書き換えない。
   だから Netlify のビルドは走らず、クレジットも減らない。
   採否の判断と CSV への追記は、人(または指示を受けたAI)が後から行う。

使い方:
    python3 check_pov_updates.py                 # 人が手で見るとき
    python3 check_pov_updates.py --github-output # Actions から

終了コード:
    0  正常に調べ終えた(新着の有無は問わない)
    2  調べ方が壊れている(yt-dlpが無い/CSVが読めない 等)
       → ここだけ赤くする。ネットに弾かれただけの日は 0 のまま。
         毎日走るので、弾かれた日まで赤くすると失敗通知に埋もれて誰も見なくなる。
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCOUT = ROOT / "scout_pov_videos.py"
POV_CSV = ROOT / "大会動画リスト_POV.csv"
OUT_TSV = ROOT / "pov_candidates.tsv"
ISSUE_BODY = ROOT / "pov-update-issue.md"

# 1回のIssueに並べる上限。多すぎると読む気が失せるので頭だけ出す。
SHOW_LIMIT = 40


def die(msg: str) -> int:
    print(f"[壊れている] {msg}", file=sys.stderr)
    return 2


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--github-output", action="store_true",
                    help="GITHUB_OUTPUT へ found / issue_title を書く")
    ap.add_argument("--timeout", type=int, default=3000, help="探索の制限秒(既定50分)")
    args = ap.parse_args()

    if not SCOUT.exists():
        return die(f"{SCOUT.name} が無い")
    if not POV_CSV.exists():
        return die(f"{POV_CSV.name} が無い")

    before = len(list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8")))))
    print(f"収録済み {before}件 から始めます", file=sys.stderr)

    # --quick = 収録済み/見張りチャンネルの再訪 + 雪だるま。
    # 横断検索(重い)は毎日は回さない。新着は投稿者のチャンネルに必ず出るため。
    cmd = [sys.executable, str(SCOUT), "--quick", "--out", str(OUT_TSV)]
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                           timeout=args.timeout)
    except subprocess.TimeoutExpired:
        print(f"[弾かれた] {args.timeout}秒で終わらなかった。今日は見送ります",
              file=sys.stderr)
        return 0
    except FileNotFoundError as e:
        return die(f"実行できない: {e}")

    log_tail = "\n".join((p.stderr or "").strip().splitlines()[-12:])
    print(log_tail, file=sys.stderr)

    if p.returncode != 0:
        # yt-dlp がそもそも無い等は「壊れている」。それ以外は「弾かれた」。
        if "yt-dlp が見つかりません" in (p.stderr or ""):
            return die("yt-dlp が無い")
        print(f"[弾かれた] scout が {p.returncode} で終了。今日は見送ります",
              file=sys.stderr)
        return 0

    if not OUT_TSV.exists():
        return die("候補ファイルが作られなかった")

    rows = list(csv.DictReader(OUT_TSV.open(encoding="utf-8"), delimiter="\t"))
    found = len(rows)
    today = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    print(f"未判定の候補: {found}件", file=sys.stderr)

    if found:
        shown = rows[:SHOW_LIMIT]
        lines = [
            f"`scout_pov_videos.py --quick` が、まだ収録も却下もしていない候補を "
            f"**{found}件** 見つけました（{today}）。",
            "",
            "この Issue は**知らせるだけ**です。サイトのファイルは何も変わっていません。",
            "",
            "## 候補",
            "",
            "| 公開日 | 尺 | チャンネル | 題名 |",
            "|---|---|---|---|",
        ]
        for r in shown:
            d = r.get("公開日", "")
            d = f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else d
            try:
                mm, ss = divmod(int(r.get("尺秒") or 0), 60)
                dur = f"{mm}:{ss:02d}"
            except ValueError:
                dur = "?"
            title = (r.get("題名", "") or "").replace("|", "\\|")
            url = r.get("URL", "")
            lines.append(f"| {d} | {dur} | {r.get('チャンネル','')} | [{title}]({url}) |")
        if found > SHOW_LIMIT:
            lines.append("")
            lines.append(f"ほか {found - SHOW_LIMIT}件。全部は `pov_candidates.tsv` にあります。")
        lines += [
            "",
            "## 次にすること",
            "",
            "採否を決めて台帳へ入れ、採るものだけ CSV へ足します。",
            # 相対リンクはIssue本文では解決されないので、絶対URLで書く
            "**やり方は必ず "
            "[docs/POV_LIST_GUIDE.md]"
            "(https://github.com/YuOKOVHI/marchinz/blob/main/docs/POV_LIST_GUIDE.md) "
            "を読んでから。**",
            "",
            "```bash",
            "python3 scout_pov_videos.py --reject ID1 ID2   # 奏者視点でないもの",
            "python3 scout_pov_videos.py --accept ID3 ID4   # 採るもの",
            "python3 scout_pov_videos.py --apply           # CSVへ追記(大会名は下書き)",
            "python3 sync_csv_to_json.py && python3 check_data.py",
            "```",
            "",
            "採らないものも **必ず `--reject` で台帳へ**入れてください。",
            "入れないと毎日この Issue が出ます。",
        ]
        ISSUE_BODY.write_text("\n".join(lines) + "\n", encoding="utf-8")
        title = f"POV新着 {found}件（{today}）"
    else:
        title = ""
        print("新着なし。Issueは立てません", file=sys.stderr)

    if args.github_output and (gh := os.environ.get("GITHUB_OUTPUT")):
        with open(gh, "a", encoding="utf-8") as f:
            f.write(f"found={'true' if found else 'false'}\n")
            f.write(f"count={found}\n")
            f.write(f"issue_title={title}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
