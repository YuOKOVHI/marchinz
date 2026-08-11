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
    # 2026-08-11、優さんの指摘で発覚: "headcam" の a 抜け誤記 "hedcam" が
    # 実在の投稿タイトルに使われており、旧STRONG_POVでは拾えなかった。
    ("hedcam表記(aの抜けた誤記)", "Bluecoats 2026 Mellophone Hedcam", 800, ""),
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



# ── 自動採用の門(無人で本番へ入るので、いちばん厳しく見張る) ──────
# 2026-08-10 に混入した18件は全て「CSVに1本も無いチャンネル」から来た。
# だから known_channels に居ることを必須にしている。ここを緩める変更は
# 本番へ直接ゴミを入れるので、必ずこの試験を通すこと。
KNOWN = {"https://www.youtube.com/channel/KNOWN"}
UNKNOWN = "https://www.youtube.com/channel/OTHER"


def am(title, dur, ch):
    return {"title": title, "dur": dur, "channel_url": ch, "desc": ""}


AUTO_OK = [
    ("既知ch・題名にPOV語と楽器と団体",
     "Bluecoats 2026 Lead Mellophone Headcam", 846, list(KNOWN)[0]),
    ("既知ch・楽器×cam",
     "Boston Crusaders 2025 Snare Cam", 700, list(KNOWN)[0]),
]

AUTO_NG = [
    ("未知のチャンネル(混入18件はすべてこれ)",
     "Bluecoats 2026 Lead Mellophone Headcam", 846, UNKNOWN),
    ("尺が5分未満", "Bluecoats 2026 Snare Cam", 240, list(KNOWN)[0]),
    ("尺が20分超", "Bluecoats 2026 Snare Cam", 1500, list(KNOWN)[0]),
    ("尺が不明", "Bluecoats 2026 Snare Cam", None, list(KNOWN)[0]),
    ("概要欄だけが手掛かり(自動では採らない)",
     "Victory Run 2026", 900, list(KNOWN)[0]),
    # ★楽器も団体もあるが「カメラ語」が無い。ただの演奏動画かもしれない。
    #   この一件だけが「題名だけではPOVと読めない」の門を実際に踏む。
    #   これを外すと、門を消しても試験が通ってしまう(2026-08-11 に変異試験で発覚)
    ("楽器と団体はあるがカメラ語が無い",
     "Bluecoats 2026 Snare Line", 700, list(KNOWN)[0]),
    ("団体が読めない", "Some Random Snare Cam", 700, list(KNOWN)[0]),
    ("楽器が無い", "Bluecoats 2026 Headcam", 700, list(KNOWN)[0]),
    ("除外語(Multi Cam)",
     "Multi Cam: Bluecoats 2026 Snare Line", 700, list(KNOWN)[0]),
    ("別ジャンル(ロングトレイル)",
     "Pacific Crest Trail Snare Cam hiking", 700, list(KNOWN)[0]),
]


def check_team_guess(fails):
    """団体名はタイトルを優先すること(概要欄の自己紹介文に釣られない)。

    2026-08-11、Blue Devils の動画「Blue Devils 2017 | Metamorph | ...」が、
    概要欄の「Everett Kim started his drum corps career in 2015 with
    Pacific Crest」という自己紹介文に反応して Pacific Crest 扱いで
    CSVへ入ってしまった(guess_team がタイトル+概要欄を無差別に検索していたため)。
    """
    title = "Blue Devils 2017 | Metamorph | Encore / Rehearsal Run | Everett Kim"
    desc = ("Headcam by Everett Kim of the Blue Devils Trumpet section. "
            "Everett Kim started his drum corps career in 2015 with Pacific Crest.")
    team = S.guess_team_title_first(title, desc)
    if team != "Blue Devils":
        fails.append(f"概要欄の経歴紹介に釣られて誤団体になった: {team!r}(正しくはBlue Devils)")

    # 2026-08-11 その2: 概要欄がSEOタグの羅列で埋まっている動画で同種の誤爆。
    title2 = "UP ROCK!"
    desc2 = ('Blue Devils 2025 "Variations on a Gathering" Mello Cam\n\n\n\n'
             '#dci #dci2025 #bluedevil #bluedevils\n\n\n'
             'drum corps international,\n'
             'drum corps international 2024 boston crusaders,\n'
             'boston crusaders drum and bugle corps,\n')
    team2 = S.guess_team_title_first(title2, desc2)
    if team2 != "Blue Devils":
        fails.append(f"SEOタグの羅列に釣られて誤団体になった: {team2!r}(正しくはBlue Devils)")
    return 1


def check_generated_title(fails):
    """--apply が組む大会名が 【POV/YYYY】 の形であること。

    2026-08-11、CSV側だけ 【POV/YYYY】 へ統一したのに、apply_accepted() は
    【POV｜YYYY】(全角縦棒)を作り続けていた。毎日の自動反映が動き出すと、
    統一した表記が日々崩れるところだった。生成側も見張る。
    """
    import inspect
    src = inspect.getsource(S.apply_accepted)
    if "【POV｜" in src:
        fails.append("apply_accepted が全角縦棒【POV｜】を作っている")
    if "【POV/" not in src:
        fails.append("apply_accepted が【POV/YYYY】を作っていない")
    return 2


def check_auto(fails):
    for name, title, dur, ch in AUTO_OK:
        ok, why = S.auto_safe(am(title, dur, ch), KNOWN)
        if not ok:
            fails.append(f"自動採用すべきが落ちた [{name}] {title} [{why}]")
    for name, title, dur, ch in AUTO_NG:
        ok, why = S.auto_safe(am(title, dur, ch), KNOWN)
        if ok:
            fails.append(f"自動採用してはいけないのに通った [{name}] {title}")
    return len(AUTO_OK) + len(AUTO_NG)


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
    n_auto = check_auto(fails) + check_generated_title(fails) + check_team_guess(fails)

    total = len(REGRESSION_MISSED) + len(SHOULD_KEEP) + len(SHOULD_DROP) + 4 + n_auto
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
