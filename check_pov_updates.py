#!/usr/bin/env python3
"""POV(奏者視点)動画の新着を毎日見張る。

`scout_pov_videos.py --quick` を回し、**まだ CSV にも台帳にも無い候補**が出たら
その一覧を Markdown にして返す。GitHub Actions から呼ばれ、見つかった日だけ
Issue が立つ。

★ 既定では何も書き換えない。`--auto-apply` を付けたときだけ、
   **題名だけで疑いようがないもの**を CSV へ入れる(門は scout の auto_safe)。
   それ以外は必ず人(または指示を受けたAI)が動画を見て決める。

   自動で入れる条件は「すでに収録実績のあるチャンネル × 題名にPOV語 ×
   楽器・パート名 × 団体名 × 5〜20分」。
   2026-08-10 に混入した18件(サーフィン・ゲーム・NBA等)は
   **全てCSVに1本も無いチャンネル**から来たので、そこを門にしている。

★ CSV とその派生だけを変えるかぎり Netlify のビルドは走らない
   (netlify.toml の ignore に入れてある)。だからクレジットは減らない。
   サイトの鮮度は marchinz-data-refresh.js が実行時にGitHubから取り直して担保する。

使い方:
    python3 check_pov_updates.py                 # 調べるだけ
    python3 check_pov_updates.py --auto-apply    # 確実な線だけ自動で入れる
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


def load_scout():
    """scout_pov_videos.py を読み込む(判定の門を借りるため)。"""
    import importlib.util
    argv = sys.argv[:]
    sys.argv = ["scout_pov_videos.py"]
    try:
        spec = importlib.util.spec_from_file_location("scout", SCOUT)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        sys.argv = argv


def known_channels_from_csv() -> set[str]:
    """収録実績のあるチャンネルURLを、CSVの列から直接読む。

    scout.csv_channels() は動画1本ずつメタを引くので、936件あるといつまでも
    終わらない(実測でタイムアウトした)。CSVの「動画配信元URL」列は
    2026-08-11 に全行埋めたので、ここから読めばネットに触らずに済む。
    """
    rows = list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8"))))
    return {r["動画配信元URL"].rstrip("/") for r in rows
            if (r.get("動画配信元URL") or "").startswith("http")}


def auto_apply(rows: list[dict]) -> tuple[list[str], list[dict]]:
    """確実な線だけをCSVへ入れる。戻り: (入れたID, 人が見るべき残り)"""
    S = load_scout()
    known = known_channels_from_csv()
    if not known:
        print("[見送り] 収録実績のあるチャンネルを1つも読めない", file=sys.stderr)
        return [], rows
    print(f"収録実績のあるチャンネル {len(known)}件", file=sys.stderr)
    auto, hold = [], []
    for r in rows:
        m = S.fetch_meta(r["video_id"], allow_network=False)
        if not m:
            hold.append(r)
            continue
        ok, why = S.auto_safe(m, known)
        (auto if ok else hold).append(r)
    if not auto:
        print("自動採用に該当なし", file=sys.stderr)
        return [], hold

    ids = [r["video_id"] for r in auto]
    print(f"自動採用 {len(ids)}件 / 人が見る {len(hold)}件", file=sys.stderr)
    for step in (["--accept", *ids], ["--apply"]):
        p = subprocess.run([sys.executable, str(SCOUT), *step],
                           cwd=ROOT, capture_output=True, text=True, timeout=900)
        print((p.stdout or "").strip()[-800:], file=sys.stderr)
        if p.returncode != 0:
            print(f"[弾かれた] {step[0]} が失敗。自動反映は見送ります", file=sys.stderr)
            return [], rows

    # 本当に入ったかをCSVで確かめる(ツールの成功出力を信じない)
    now = POV_CSV.read_text(encoding="utf-8")
    landed = [v for v in ids if v in now]
    if len(landed) != len(ids):
        print(f"[注意] 追記できたのは {len(landed)}/{len(ids)}件", file=sys.stderr)
    return landed, hold


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--github-output", action="store_true",
                    help="GITHUB_OUTPUT へ found / issue_title を書く")
    ap.add_argument("--auto-apply", action="store_true",
                    help="題名だけで疑いようがないものをCSVへ自動で入れる")
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
    today = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    print(f"未判定の候補: {len(rows)}件", file=sys.stderr)

    # ── 自動反映(--auto-apply) ──
    # 題名だけで疑いようがないものだけを、人を通さずCSVへ入れる。
    # 門は scout_pov_videos.auto_safe()。緩めると本番へ直接ゴミが入る。
    applied: list[str] = []
    if args.auto_apply and rows:
        applied, rows = auto_apply(rows)

    found = len(rows)

    if found:
        shown = rows[:SHOW_LIMIT]
        lines = [
            f"`scout_pov_videos.py --quick` が、まだ収録も却下もしていない候補を "
            f"**{found}件** 見つけました（{today}）。",
            "",
            (f"※ このほか **{len(applied)}件** は題名だけで確実だったので、"
             "すでに自動でリストへ入れました（大会名は自動生成の下書きなので、"
             "ショウ名や役割は手で整えてください）。"
             if applied else
             "この Issue に載っているぶんは、まだ何も変わっていません。"),
            "",
            "**ここに並んでいるものは、実際に動画を見て決めてください。**"
            "題名と概要欄だけでは「本当に奏者本人の視点か」は判断できません。",
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
        ISSUE_BODY.write_text(
            "\n".join(x for x in lines if x is not None) + "\n", encoding="utf-8")
        title = f"POV新着 {found}件（{today}）"
    else:
        title = ""
        print(f"人が見るべき候補なし（自動反映 {len(applied)}件）。Issueは立てません",
              file=sys.stderr)

    if args.github_output and (gh := os.environ.get("GITHUB_OUTPUT")):
        with open(gh, "a", encoding="utf-8") as f:
            f.write(f"found={'true' if found else 'false'}\n")
            f.write(f"count={found}\n")
            f.write(f"issue_title={title}\n")
            f.write(f"applied={len(applied)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
