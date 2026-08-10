#!/usr/bin/env python3
"""scout_pov_videos.py の判定に歯があるかを見張る。

    python3 test_scout_pov_videos.py

★この試験の由来
  2026-08-10、Bluecoats 2026 Victory Run のヘッドカムが 3つの別々の個人チャンネルから
  上がっていたのに、POV CSV には1本しか入っていなかった。
  「回帰1」はその実際に取りこぼした3本。**この3本を落とす変更は入れてはいけない。**

  判定をゆるめる/きつくする変更をしたら、必ずこの試験を通してから CSV を触ること。
  試験が落ちたときに試験の方を書き換えると、通るだけの試験になる(骨抜き)。
"""
from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load():
    sys.argv = ["scout_pov_videos.py"]
    spec = importlib.util.spec_from_file_location("scout", ROOT / "scout_pov_videos.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


S = load()

# ── 回帰1: 実際に取りこぼした3本(必ず拾えること) ──────────────
# 題名は実物のまま。ネットワークに触らず判定だけを測る。
REGRESSION_MISSED = [
    ("0_eeiZoTLYY", "Bluecoats 2026 - Victory Run - Lead Mellophone Cam", 846),
    ("FQfM-hTy3uA", "Bluecoats 2026 “Gravity & Grace” Lead Trumpet Cam - Victory Run", 932),
    ("7y2sDQ-Lmg4", "Bluecoats 2026 Trumpet Screamer Cam - Victory Run - Jack Zirkelbach", 955),
    # 2026-08-10に優さんから提示。個人投稿者 Chase Thomas の動画は横断探索時点で
    # 新着だったため未収録だった。Soloist Cam は楽器×cam と団体文脈で拾う。
    ("BLHa1LK_ib8", "Blue Devils 2026 | Zei | Euphonium Soloist Cam | Chase Thomas", 807),
]

# ── 拾うべき(概要欄にしか手掛かりが無い個人投稿を含む) ──────────
SHOULD_KEEP = [
    ("題名にPOV語", "Bluecoats 2024 GoPro Victory Run", 900, ""),
    ("題名に楽器×cam", "Boston Crusaders 2025 Snare Cam", 700, ""),
    ("Soloist Cam", "Blue Devils 2026 Zei Euphonium Soloist Cam", 800, ""),
    ("Lead Trumpet Cam", "Bluecoats 2026 Lead Trumpet Cam Victory Run", 900, ""),
    ("Academy Drumset", "In The Center of the Ring (The Academy) - Drumset Headcam", 693, ""),
    ("Jersey Surf Quads", "Jersey Surf Quad 24' Headcam", 982, ""),
    ("概要欄だけにPOV語", "Victory Run 2026", 900,
     "Bluecoats 2026 victory run. Filmed with a GoPro mounted on my helmet."),
    ("概要欄だけに楽器", "2026 run - my cam", 900, "I marched mellophone this season."),
    ("日本語のヘッドカム", "【全国大会】ヘッドカム", 620, "トランペットを吹きながら撮りました"),
    ("楽器視点", "全国大会 メロフォン 楽器視点", 600, "本番全曲の記録です"),
]

# ── 落とすべき ────────────────────────────────────────
# ★重要: ここの文面には **必ず楽器語を入れる**。
#   楽器語が無いと「POVの手掛かりなし」で先に落ちてしまい、
#   除外規則(NOT_POV)を一度も踏まないまま PASS する骨抜き試験になる。
#   実際 2026-08-10 の初版はそれで、multicam の除外を消しても試験が通ってしまった。
SHOULD_DROP = [
    ("固定カメラ Multi Cam", "Multi Cam: Boston Crusaders 2025 Snare Line at DCI Semifinals", 1015, ""),
    ("Catwalk Cam", "2013 Alamodome Catwalk Cam - Cavaliers Snare Line", 900, ""),
    ("High Cam", "Oarai High School 2025 | Trumpet Feature [HIGH CAM]", 700, ""),
    ("Wide-angle", "2015 Bluecoats Snare Cam @ TOC | WIDE-ANGLE CAM [4K]", 800, ""),
    ("Overhead", "Overhead Cam: 2005 Madison Scouts Tuba Line", 900, ""),
    ("Drone", "Drone Cam: Blue Devils 2024 Mellophone Block", 900, ""),
    ("リアクション", "We react to our OWN headcams! | Part 3", 900, ""),
    ("尺が5分未満", "Bluecoats 2026 Snare Cam", 240, ""),
    ("楽器と無関係", "Iron Cobra 600 -featuring DUO GLIDE CAM!", 600, ""),
    ("手掛かり皆無", "2026 DCI Finals Results", 900, "The results are in."),
    ("車載POV", "2026 SUV POV test drive", 900, "Filmed with a GoPro on my chest."),
    ("ゲームPOV", "Troopers ESEA Match POV", 900, "Counter-Strike gameplay."),
    ("CS配信がTroopersに化ける", "Can Troopers Bounce Back?! | @TrottahCS POV", 2700, ""),
    ("広角パレード", "京都橘高校 トランペット 広角カメラ ヘッドカム", 1100, ""),
]


def meta(title: str, dur: int, desc: str) -> dict:
    return {"id": "x" * 11, "title": title, "dur": dur, "desc": desc,
            "channel": "test", "channel_url": ""}


def flat(title: str, dur: int, upload_date: str) -> dict:
    return {"id": "x" * 11, "title": title, "dur": dur,
            "upload_date": upload_date, "channel": "test", "channel_url": ""}


def main() -> int:
    fails: list[str] = []

    for vid, title, dur in REGRESSION_MISSED:
        m = meta(title, dur, "")
        if not S.loose_hit(title):
            fails.append(f"回帰1 粗門で落ちた {vid}: {title}")
            continue
        ok, why = S.judge(m)
        if not ok:
            fails.append(f"回帰1 判定で落ちた {vid}: {title} [{why}]")

    for name, title, dur, desc in SHOULD_KEEP:
        ok, why = S.judge(meta(title, dur, desc))
        if not ok:
            fails.append(f"拾うべきが落ちた [{name}] {title} [{why}]")

    for name, title, dur, desc in SHOULD_DROP:
        ok, why = S.judge(meta(title, dur, desc))
        if ok:
            fails.append(f"落とすべきが残った [{name}] {title} [{why}]")

    # 題名にカメラ語がなくても、検索結果から概要欄を読むところまで進める。
    # これを title 判定に戻すと「概要欄だけに GoPro」と書いた個人投稿を落とす。
    since = date(2025, 8, 10)
    if not S.eligible_flat(flat("Victory Run 2026", 900, "20260810"), since):
        fails.append("概要欄待ちの素っ気ない題名を候補門で落とした")
    if S.eligible_flat(flat("Bluecoats 2024 GoPro", 900, "20240810"), since):
        fails.append("対象期間より前の動画が候補門に残った")
    if S.eligible_flat(flat("Bluecoats 2026 Snare Cam", 240, "20260810"), since):
        fails.append("5分未満が候補門に残った")
    if S.CHANNEL_SCAN_LIMIT < 30:
        fails.append("個人チャンネルの直近確認上限が小さすぎる")
    if S.SNOWBALL_CHANNEL_SCAN_LIMIT < 10:
        fails.append("雪だるま探索の個人チャンネル確認上限が小さすぎる")
    if "https://www.youtube.com/@chasethomasmusic" not in S.watch_channels():
        fails.append("個人投稿者Chase Thomasが見張り台帳から抜けた")

    # 直近365日・尺・個人チャンネル再訪の3つの候補門に加え、見張り台帳の保持も数える。
    total = len(REGRESSION_MISSED) + len(SHOULD_KEEP) + len(SHOULD_DROP) + 4
    if fails:
        print(f"FAIL {len(fails)}/{total}")
        for f in fails:
            print("  -", f)
        return 1
    print(f"PASS {total}件"
          f"(回帰{len(REGRESSION_MISSED)} / 拾う{len(SHOULD_KEEP)} / 落とす{len(SHOULD_DROP)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
