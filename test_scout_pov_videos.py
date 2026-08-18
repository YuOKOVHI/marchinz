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
import re
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
    # 2026-08-11に優さんから提示。判定は元々通っていたが、**探索が届いていなかった**。
    # 検索語が "cam victory run" の語順固定で、「VICTORY RUN が先・CAM が後」の
    # この題名に引っかからなかった(check_cam_terms_word_order で見張る)。
    ("mKAwGCOez6I", "BLUECOATS 2026 VICTORY RUN SNARE CAM - COLE READ", 950),
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
    ("POV譜面・採譜", "Bluecoats 2026 Gravity and Grace Trombone Soloist Lead Bari Transcription", 830,
     "Source POV: https://www.youtube.com/watch?v=UMq7NeSgg34"),
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
    # 2026-08-13 優さん指示: 実際にPOV CSVへ混入していたYOKOHAMA ROBINSの編集映像。
    # 団体名・楽器・尺を満たしていても、Multi Camなら必ず落とす。
    ("YOKOHAMA ROBINS Multi Cam（混入実例）",
     "YOKOHAMA ROBINS 2025 Trumpet Multi Cam", 900, ""),
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
    # 2026-08-12、優さん提示の実在の取りこぼし2本。旧上限1200sでは
    # 自動採用から漏れていた(そのため人力でのみ拾えた)。P4で1500sへ拡張。
    ("実際に自動採用から漏れていた本物1(1218s)",
     "Bluecoats 2026 Lead Baritone Headcam - James Baxter", 1218, list(KNOWN)[0]),
    ("実際に自動採用から漏れていた本物2(1207s)",
     "Bluecoats 2026 Victory Run Snare Cam - AJ Manila", 1207, list(KNOWN)[0]),
    # 通常帯の新しい境界(25分ちょうど)。段語が無くても通常帯なら採る。
    ("通常帯の境界(1500s・段語なし)",
     "Bluecoats 2026 Snare Cam", 1500, list(KNOWN)[0]),
    # 拡張帯(25〜40分)は段語があれば採る。
    ("拡張帯(1800s・victory run)",
     "Bluecoats 2026 Snare Cam Victory Run", 1800, list(KNOWN)[0]),
    ("拡張帯の境界(2400sちょうど・finals)",
     "Bluecoats 2026 Snare Cam Finals", 2400, list(KNOWN)[0]),
]

AUTO_NG = [
    ("未知のチャンネル(混入18件はすべてこれ)",
     "Bluecoats 2026 Lead Mellophone Headcam", 846, UNKNOWN),
    # 2026-08-12、拡張帯を足したときに18件再発防止の歯が消えていないかの変異試験。
    # 拡張帯の条件を全部満たしていても、未知チャンネルなら通ってはいけない。
    ("未知チャンネル+拡張帯の条件は全部満たす(18件再発防止)",
     "Bluecoats 2026 Snare Cam Victory Run", 1800, UNKNOWN),
    ("尺が5分未満", "Bluecoats 2026 Snare Cam", 240, list(KNOWN)[0]),
    # 拡張帯だが段語が題名に無い(2026-08-12、AUTO_MAX_SEC 1200→1500に伴い
    # 境界値を更新。段語が無ければ拡張帯には入れない)。
    ("拡張帯だが大会の段語が題名に無い(1800s)",
     "Bluecoats 2026 Snare Cam", 1800, list(KNOWN)[0]),
    ("拡張帯上限超(2401s)",
     "Bluecoats 2026 Snare Cam Victory Run", 2401, list(KNOWN)[0]),
    # 拡張帯で段語はあっても楽器が無い(概要欄頼みではなく題名の楽器チェックは
    # 尺の帯に関わらず必須であることの確認)。
    ("拡張帯+段語はあるが楽器が無い",
     "Bluecoats 2026 Victory Run Headcam", 1800, list(KNOWN)[0]),
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


def check_part_guess(fails):
    """楽器・パートは団体名の部分文字列に釣られないこと。

    2026-08-11、優さんの指摘で発覚。"Santa Clara Vanguard" は団体名自体に
    "guard" を含むため、本当の楽器(Baritone等)より先にタイトル中の
    団体名の "guard" を拾ってしまい、SCVの44件で【guard】に上書きされていた。
    """
    title = '2026 Santa Clara Vanguard "With Reckless Abandon" Baritone Head Cam'
    part = S.guess_part(title, "Santa Clara Vanguard")
    if part.lower() != "baritone":
        fails.append(f"団体名中の'guard'に釣られて誤楽器になった: {part!r}(正しくはBaritone)")

    # 本物のguard(カラーガード)動画は引き続きguardと当てられること。
    title2 = "Santa Clara Vanguard 2022 guard cam"
    part2 = S.guess_part(title2, "Santa Clara Vanguard")
    if part2.lower() != "guard":
        fails.append(f"本物のguard動画がguardと当たらなくなった: {part2!r}")
    return 2


def check_net_fetch_priority(fails):
    """ネット取得(cap=600)で先に落ちるのが弱い候補であること。

    2026-08-12、優さん提示の5本のうち4本(下記)が既知チャンネルの新着なのに
    候補から漏れていた。真因は meta_from_flat() の即採用ショートカットが
    flat_list(--flat-playlist は尺を返さない)相手には実質発動しないこと。
    結果、既知チャンネルの新着も横断検索のヒットも同じ「ネット取得待ち」の
    列に無差別に並び、母集団が万単位だと cap の外へ弾かれていた。
    title_strong_signal() はこの列の並び順(強い手掛かりを先に)を決めるための
    関数。ここでは実際に取りこぼした4本の題名すべてで True になることを見張る。
    """
    real_missed_titles = [
        'Bluecoats 2026 "Gravity & Grace" Color Guard Cam - Victory Run',
        "Bluecoats 2026 Victory Run Snare Cam - AJ Manila",
        "Bluecoats 2026 Trombone Soloist/Bass Trombone/ Lead Baritone Victory Run Headcam",
        "Carolina Crown 2026 Mellophone Headcam - Mason Buenzow #1",
    ]
    for t in real_missed_titles:
        if not S.title_strong_signal(t):
            fails.append(f"実際に取りこぼした題名が強い手掛かり扱いにならない: {t}")
    # 手掛かりが薄い(POV語も楽器×cam揃いも無い)ものは弱い扱いのままでよい
    weak = "Bluecoats 2026 - Gravity and Grace - Lead Mello Transcription"
    if S.title_strong_signal(weak):
        fails.append(f"手掛かりが薄い題名まで強い扱いになった(門がゆるすぎる): {weak}")
    return len(real_missed_titles) + 1


def check_channel_cursor(fails):
    """再訪はカーソルより新しい行だけを返し、カーソル自体は含まないこと。

    2026-08-12(P0)。flat_list は公開日を返さないため、既知チャンネルの
    「前回どこまで見たか」を video_id で覚えて新着だけに絞る。
    [new1, new2, CURSOR, older...] を渡したら new1/new2 だけが返ること、
    新カーソルが先頭行(new1)になることを見る。
    """
    def fake_flat_list(target, timeout=300, playlist_end=None):
        all_rows = [
            {"id": "new1", "title": "t1", "dur": None, "channel": "c",
             "channel_url": "u", "upload_date": "NA"},
            {"id": "new2", "title": "t2", "dur": None, "channel": "c",
             "channel_url": "u", "upload_date": "NA"},
            {"id": "CURSOR", "title": "t3", "dur": None, "channel": "c",
             "channel_url": "u", "upload_date": "NA"},
            {"id": "older1", "title": "t4", "dur": None, "channel": "c",
             "channel_url": "u", "upload_date": "NA"},
        ]
        return all_rows[:playlist_end] if playlist_end else all_rows

    orig = S.flat_list
    S.flat_list = fake_flat_list
    try:
        cu = "https://example.com/channel/X"
        rows, newest = S.revisit_channel(cu, {cu: {"newest_seen_id": "CURSOR"}})
        got = [r["id"] for r in rows]
        if got != ["new1", "new2"]:
            fails.append(f"カーソルより新しい行だけにならない: {got}")
        if newest != "new1":
            fails.append(f"新カーソルが先頭行にならない: {newest!r}")

        # カーソルが無い(初回)ときは絞らず全部返す
        rows2, newest2 = S.revisit_channel(cu, {})
        if [r["id"] for r in rows2] != ["new1", "new2", "CURSOR", "older1"]:
            fails.append("カーソル無し(初回)なのに全件返っていない")
        if newest2 != "new1":
            fails.append(f"初回のカーソル確定が先頭行にならない: {newest2!r}")

        # カーソルに一致する行が無い(見逃しの恐れ) → 安全側に全件返す
        rows3, _ = S.revisit_channel(cu, {cu: {"newest_seen_id": "NOT_IN_LIST"}})
        if [r["id"] for r in rows3] != ["new1", "new2", "CURSOR", "older1"]:
            fails.append("カーソルに当たらないとき全件返す安全側の動作になっていない")
    finally:
        S.flat_list = orig
    return 3


def check_judge_lane_separation(fails):
    """既知チャンネルの再訪(枠0)は横断検索(枠1)と別capであること。

    2026-08-12(P0)。既知チャンネルの新着なのに、横断検索と同じ判定列・
    同じcap=600に無差別に並べられ、母集団が万単位だと弾かれていた
    (優さん提示の7件中4件がこれで漏れていた)。
    scout() のソースを見て、再訪由来(revisit_ids)は cap=None(上限なし)、
    それ以外(横断検索)は cap=600 で judge_ids を呼んでいることを確かめる。
    """
    import inspect
    src = inspect.getsource(S.scout)
    if 'judge_ids(revisit_ids' not in src or "cap=None" not in src:
        fails.append("再訪(枠0)がcap無しでjudge_idsを呼んでいない")
    if "judge_ids(other_ids" not in src or "cap=600" not in src:
        fails.append("横断検索(枠1)がcap=600でjudge_idsを呼んでいない")
    return 2


def check_cam_terms_word_order(fails):
    """大会の段(victory run 等)は「段+cam」「cam+段」の両方向で検索すること。

    2026-08-11、"BLUECOATS 2026 VICTORY RUN SNARE CAM" を取りこぼした。
    判定(judge)は通っていたのに、検索語が "cam victory run" の語順固定で
    「VICTORY RUN が先・CAM が後」の題名に届かなかった。
    YouTube検索は語順の影響を受けるため、両方向を必ず持つ。
    """
    n = 0
    for stage in ("victory run", "finals week", "semifinals", "prelims", "full run"):
        n += 1
        has_cam_first = any(t.lower() == f"cam {stage}" for t in S.CAM_TERMS)
        has_stage_first = any(t.lower() == f"{stage} cam" for t in S.CAM_TERMS)
        if not (has_cam_first and has_stage_first):
            missing = "cam+段" if not has_cam_first else "段+cam"
            fails.append(f"CAM_TERMSに{stage!r}の{missing}の向きが無い(語順違いを取りこぼす)")
    # 年指定で掘るときの語にも両方向を持たせる(過去の年ほど新着順で拾えない)
    n += 1
    yl = [t.lower() for t in S.YEAR_CAM_TERMS]
    if "cam victory run" not in yl or "victory run cam" not in yl:
        fails.append("YEAR_CAM_TERMSにvictory runの両方向が無い")
    return n


def check_ytdlp_lookup_finds_path(fails):
    """yt-dlp はPATHからも見つけられること(Linuxランナーで死なないため)。

    2026-08-12、日次ワークフロー(POV動画の自動更新)が13秒で全滅した。
    ランナーが macOS から ubuntu-latest へ変わったのに、探索先が
    ~/Movies/venvs/... と /opt/homebrew/... という **Mac固有のパスだけ**で、
    ubuntu の `pip install yt-dlp` が置く
    /opt/hostedtoolcache/Python/3.11.x/x64/bin/yt-dlp を見ていなかった。
    scout が SystemExit → check_pov_updates が die() → ジョブが赤くなる。
    """
    import os
    import shutil
    import stat
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        fake = Path(d) / "yt-dlp"
        fake.write_text("#!/bin/sh\nexit 0\n")
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)

        orig_candidates = S.YTDLP_CANDIDATES
        orig_path = os.environ.get("PATH", "")
        try:
            # Mac固有の候補が1つも無い状況(=Linuxランナー)を作る
            S.YTDLP_CANDIDATES = [Path(d) / "絶対に無いパス"]
            os.environ["PATH"] = d + os.pathsep + orig_path
            try:
                got = S.ytdlp_bin()
            except SystemExit as exc:
                fails.append(f"PATH上のyt-dlpを見つけられずSystemExit: {exc}")
                return 1
            if shutil.which("yt-dlp") != got:
                fails.append(f"PATH上のyt-dlpを返さなかった: {got!r}")
        finally:
            S.YTDLP_CANDIDATES = orig_candidates
            os.environ["PATH"] = orig_path
    return 1


def check_workflow_stages_everything_pipeline_writes(fails):
    """日次ワークフローは、パイプラインが書く追跡ファイルを1つも載せ残さないこと。

    同じ欠陥で2夜続けて日次CIが死んだ:
      2026-08-12 pov_channel_cursors.json の載せ忘れ(P0で新設したファイル)
      2026-08-13 app.js の載せ忘れ
                 (sync_csv_to_json.py はキャッシュキーを index.html と
                  app.js の2箇所へ書くのに、git add は index.html だけだった)
    どちらも経路は同じ:
      載せ残しが未ステージで残る
        → git pull --rebase が "cannot pull with rebase: You have unstaged
          changes." で拒否
        → 3回リトライとも失敗しジョブが赤くなる(探索は成功しているのに)

    列挙方式(allowlist)は「書くファイルが増えたら追記し忘れる」ので、
    除外方式(denylist: git add -u + 他3分類CSVだけ除外)に変えた。
    この試験は、パイプラインの書き込み先を実際に読み取って、
    除外リストに落ちていないことを機械的に確かめる。

    ★この試験自身が一度「通るだけの試験」だった(2026-08-13 三者レビュー)。
      直した2点を消さないこと:
      1. `git ls-files` は非ASCIIパスを8進クォートして返す。素で集合に
         入れると、いちばん大事な 大会動画リスト_POV.csv が
         「追跡外」と誤判定され、黙って検査対象から外れていた。-z で読む。
      2. YAML全文に対する部分文字列検索では、コメントに書いてある文字列や
         「変わったかを見る」段の除外に当たってしまい、**実際に効く
         git add 段を壊す変異を素通しした**。段ごとに run: を切り出して、
         その段の中だけを見る。
    """
    import subprocess

    wf = ROOT / ".github" / "workflows" / "videos-daily-update.yml"
    if not wf.is_file():
        fails.append("日次ワークフローが見つからない")
        return 1
    text = wf.read_text(encoding="utf-8")
    n = 0

    def step_run(step_name: str) -> str:
        """指定した段の run: ブロックだけを、コメント行を除いて返す。

        全文検索だと、コメントや別の段の同じ文字列に当たって歯が抜ける。
        """
        m = re.search(
            rf"- name: {re.escape(step_name)}\n(.*?)(?=\n      - name: |\Z)",
            text, re.S)
        if not m:
            return ""
        body = m.group(1)
        run = re.search(r"run: \|\n(.*)", body, re.S)
        if not run:
            return ""
        return "\n".join(
            l for l in run.group(1).splitlines() if not l.lstrip().startswith("#"))

    def command(run_text: str, head: str) -> str:
        """run: の中から、指定コマンド1本だけを行継続込みで取り出す。

        段の中には git add 以外にも除外つきのコマンド(未追跡チェック)が
        あるので、段全体から除外を拾うと別コマンドのぶんまで混ざる。
        """
        lines = run_text.splitlines()
        for i, l in enumerate(lines):
            if l.lstrip().startswith(head):
                out = [l]
                while out[-1].rstrip().endswith("\\") and i + len(out) < len(lines):
                    out.append(lines[i + len(out)])
                return "\n".join(out)
        return ""

    commit_run = step_run("コミットして反映する")
    diff_run = step_run("変わったかを見る")
    n += 1
    if not commit_run or not diff_run:
        fails.append("ワークフローの『コミットして反映する』/『変わったかを見る』段を切り出せない")
        return n

    # 1) 実コマンドが除外方式であること(コメントではなく run: の中身を見る)
    n += 1
    add_lines = [l for l in commit_run.splitlines() if l.lstrip().startswith("git add")]
    if not any("git add -u" in l for l in add_lines):
        fails.append("git add が除外方式(git add -u)でない"
                     "(列挙方式へ戻すと、書くファイルが増えたとき載せ残す)")

    # 2) 載せ残し・未追跡・削除の3つを名指しで落とす番人があること
    for label, needle in (
        ("載せ残し", "触らないはずのファイルが変更されています"),
        ("未追跡の生成物", "追跡されていない生成物があります"),
        ("削除の混入", "ファイルの削除が載っています"),
    ):
        n += 1
        if needle not in commit_run:
            fails.append(f"コミット前に『{label}』を名指しで落とす番人が無い")

    # 3) パイプラインが書く追跡ファイルが、git add 段の除外に落ちていないこと
    #    ★除外は「その段の、そのコマンドから」だけ拾う。段全体から拾うと
    #      未追跡チェック(git ls-files --others)の除外まで混ざる。
    excluded_add = set(re.findall(r"':!([^']+)'", command(commit_run, "git add")))
    excluded_diff = set(re.findall(r"':!([^']+)'", command(diff_run, "if git diff")))
    n += 1
    if not excluded_add:
        fails.append("git add 段の除外リスト(':!...')が読み取れない")
        return n
    n += 1
    if excluded_add != excluded_diff:
        fails.append(
            "『変わったかを見る』と『コミットして反映する』の除外リストが食い違う "
            f"(diff段のみ={sorted(excluded_diff - excluded_add)} / "
            f"add段のみ={sorted(excluded_add - excluded_diff)})")

    import sync_csv_to_json as SY
    writes = [
        SY.OUT_JSON, SY.OUT_INLINE, SY.INDEX_HTML, SY.APP_JS, SY.META_FILE,
        S.POV_CSV, S.LEDGER, S.CURSOR_FILE,
    ]
    # ★-z で読む。素の ls-files は日本語名を "\345\244\247..." とクォートするため、
    #   POV CSV が「追跡外」と誤判定されて検査から静かに漏れていた。
    tracked = set(subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-z"],
        capture_output=True, check=True).stdout.decode().split("\0")) - {""}

    for p in writes:
        # ★basename比較はやめる。このリポジトリには app.js が5つある
        #   (tools/{vlog,reangle,switcher,privacy}/js/app.js とルート)。
        rel = Path(p).resolve().relative_to(ROOT).as_posix()
        n += 1
        if rel not in tracked:
            # 黙って飛ばさない。追跡外なら「なぜ追跡外か」を人が見て決める
            fails.append(f"{rel} はパイプラインが書くのに git 追跡外"
                         "(コミットされないので、意図的か確認すること)")
            continue
        if rel in excluded_add:
            fails.append(
                f"{rel} はパイプラインが書くのに、git add 段の除外リストに居る"
                "(未ステージで残って git pull --rebase が必ず失敗する)")

    # 4) 逆に、他3分類のCSVは必ず除外されていること(このワークフローの正本外)
    for other in ("大会動画リスト_マーチング祭.csv",
                  "大会動画リスト_DrumcorpsfunTV.csv",
                  "大会動画リスト_FloMarching_DCI.csv"):
        n += 1
        if other not in excluded_add:
            fails.append(f"{other} が git add 段で除外されていない"
                         "(別スクリプトが正本なので載せてはいけない)")

    return n


def check_youtube_workflow_stages_cache_keys(fails):
    """YouTube日次(youtube-api-daily.yml)も、キャッシュキーを載せ残さないこと。

    2026-08-13 三者レビューで発覚。このワークフローは
    run_youtube_api_refresh.sh 経由で sync_csv_to_json.py を呼ぶので、
    data.inline.js が変われば index.html と app.js の ?v= も書き換わる。
    ところが git add の列挙にその2つが無かった。

    さらに悪いことに、このワークフローは git pull --rebase を使わず
    push 一発なので、**未ステージが残っても push は成功しジョブは緑のまま**。
    「新しい data.inline.js + 古い ?v=」が本番へ出る
    (sync_csv_to_json.py 自身が『この経路を通ると旧データを掴む』と
     警告している不具合の再発形)。POV側と違い赤で気づけないぶん危険。
    """
    wf = ROOT / ".github" / "workflows" / "youtube-api-daily.yml"
    if not wf.is_file():
        fails.append("youtube-api-daily.yml が見つからない")
        return 1
    text = wf.read_text(encoding="utf-8")
    run = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
    n = 0

    n += 1
    if "git add -u" not in run:
        fails.append("youtube-api-daily.yml の git add が除外方式でない"
                     "(index.html / app.js の ?v= を載せ残し、緑のまま本番が旧データを掴む)")

    n += 1
    if "触らないはずのファイルが変更されています" not in run:
        fails.append("youtube-api-daily.yml に載せ残しの番人が無い"
                     "(pull --rebase が無いので、残っても緑のまま push される)")

    # POVの正本・台帳はこのワークフローの担当外。必ず除外されていること
    excluded = set(re.findall(r"':!([^']+)'", run))
    for pov_owned in ("大会動画リスト_POV.csv", "pov_ledger.json",
                      "pov_channel_cursors.json"):
        n += 1
        if pov_owned not in excluded:
            fails.append(f"youtube-api-daily.yml が {pov_owned} を除外していない"
                         "(POV側の担当ファイルを巻き込む)")
    return n


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

    # 視聴制限のある動画は、POVの内容が正しくても掲載しない。
    restricted_base = meta("Bluecoats 2026 GoPro Snare Cam", 900, "")
    ok, why = S.judge(dict(restricted_base, age_limit=18))
    if ok or "年齢制限" not in why:
        fails.append(f"18歳以上の年齢制限動画を通してしまった [{why}]")
    if not S.judge(dict(restricted_base, age_limit=17))[0]:
        fails.append("17歳以下の動画まで年齢制限で除外した")
    for availability in ("members_only", "subscriber_only", "needs_auth"):
        ok, why = S.judge(dict(restricted_base, availability=availability))
        if ok or "認証" not in why:
            fails.append(f"視聴制限 {availability} を通してしまった [{why}]")
    if not S.judge(restricted_base)[0]:
        fails.append("制限メタデータ欠損の通常公開候補を除外した")

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
    n_auto = (check_auto(fails) + check_generated_title(fails) + check_team_guess(fails)
              + check_part_guess(fails) + check_cam_terms_word_order(fails)
              + check_ytdlp_lookup_finds_path(fails) + check_net_fetch_priority(fails)
              + check_channel_cursor(fails) + check_judge_lane_separation(fails)
              + check_workflow_stages_everything_pipeline_writes(fails)
              + check_youtube_workflow_stages_cache_keys(fails))

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
