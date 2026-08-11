#!/usr/bin/env python3
"""POV(奏者視点)動画を漏らさず拾い上げる探索スクリプト。

■ なぜ要るのか
  他の3ソース(マーチング祭 / DrumcorpsfunTV / FloMarching)は「特定チャンネルを
  全件なめる」取り込みスクリプトがあり、母集団が定義されている。
  POV だけは母集団が「YouTube 全体」で、しかも **投稿者の多くが個人チャンネル**
  (奏者本人が自分のヘッドカムを1〜3本だけ上げる)。
  そのため「チャンネルを列挙する」方式が原理的に効かず、2026-08-10 に
  同じ Bluecoats 2026 Victory Run の別々の個人チャンネル3本のうち2本を取りこぼした。

■ 3つの軸で母集団をつくる
    軸1 検索      団体 × 年 × 役割/楽器 × カメラ語 を掛け合わせて横断検索
    軸2 雪だるま  本判定を通った投稿者の最新20本を列挙(個人chは小さいので安い)
    軸3 再訪      CSV に載っているチャンネルは毎回全件列挙(新着に追随)
    軸4 見張り    個人チャンネルの提示・発見元を watchlist で毎回再訪

■ 判定はタイトルと **概要欄** の両方を読む
  個人投稿はタイトルが素っ気ない("Victory Run 2026" だけ等)ことがあり、
  楽器やヘッドカムの情報が概要欄にしか無い場合がある。

■ 台帳(pov_ledger.json)
  採用/却下の判断を video_id で記録する。再実行しても既決は候補に出ない。
  「毎回同じ動画を人間が見直す」を防ぎ、判断が積み上がる。

使い方:
    python3 scout_pov_videos.py                 # 探索して未判定候補を出す
    python3 scout_pov_videos.py --quick         # 軸3(再訪)と軸2だけ。速い
    python3 scout_pov_videos.py --accept ID ..  # 台帳で採用にする
    python3 scout_pov_videos.py --reject ID ..  # 台帳で却下にする
    python3 scout_pov_videos.py --apply         # 採用ぶんを CSV へ追記

採用基準(docs/OPS_GUIDE.md):
  YouTube公開 / 5分以上 / 奏者本人の頭部・胸部・楽器付近からの視点
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
POV_CSV = ROOT / "大会動画リスト_POV.csv"
LEDGER = ROOT / "pov_ledger.json"
WATCHLIST = ROOT / "pov_channel_watchlist.txt"
CACHE = Path.home() / "Movies" / ".cache" / "marchinz-pov-scout"

MIN_SEC = 300  # 5分
DEFAULT_LOOKBACK_DAYS = 365

# 年ごとのカバー状況を読むときの目安
COVID_YEARS = {2020}      # DCIのシーズンが中止。少ないのが正しい
PREGOPRO_YEAR = 2012      # これ以前はヘッドカム自体がほとんど無い
THIN_THRESHOLD = 40       # これ未満なら「掘る価値あり」と見なす
DEFAULT_SEARCH_RESULTS = 20
# 個人チャンネルは通常数本だが、団体公式には数千本ある。
# /videos は公開日を返さないことがあるため、公式チャンネルを全件候補化しない。
CHANNEL_SCAN_LIMIT = 80
SNOWBALL_CHANNEL_SCAN_LIMIT = 20
# True のとき判定の本メタ取得をネットに投げない(キャッシュ+題名のみ)
_JUDGE_NO_NETWORK = False

# yt-dlp は venv 側にしか無い環境があるので順に探す。
# CutStudy 側を先に見る(MarchShot 同梱が古いと SABR で落ちることがある)。
YTDLP_CANDIDATES = [
    Path.home() / "Movies/venvs/CutStudy/bin/yt-dlp",
    Path.home() / "Movies/venvs/MarchShot/bin/yt-dlp",
    Path("/usr/local/bin/yt-dlp"),
    Path("/opt/homebrew/bin/yt-dlp"),
]

# ── 語彙 ───────────────────────────────────────────────
# 明確に奏者視点を示す語
STRONG_POV = re.compile(
    r"(\bpov\b|head\s*cam|headcam|hedcam|helmet\s*cam|chest\s*cam|"
    r"go\s?pro|body\s*cam|player\s*cam|member\s*cam|"
    r"ヘッドカム|ヘルメットカム|奏者視点|プレイヤー視点|一人称|楽器視点)", re.I)

# 楽器・役割(これ単体では弱い。cam 語と組んで初めて効く)
PART = re.compile(
    r"(snare|quad|tenor|bass\s*drum|cymbal|marimba|vibe|vibraphone|xylo|glock|"
    r"timpani|drum\s*set|drumset|pit|battery|front\s*ensemble|"
    r"trumpet|mello(phone)?|flugel|french\s*horn|tuba|contra|baritone|"
    r"euphonium|trombone|sop(rano)?|screamer|lead|soloist|"
    r"colou?r\s*guard|guard|rifle|sabre|saber|flag|drum\s*major|dm|"
    r"トランペット|メロフォン|チューバ|ユーフォ|バリトン|スネア|テナー|"
    r"シンバル|マリンバ|ドラムメジャー|カラーガード|ピット)", re.I)

CAM = re.compile(r"(\bcam\b|\bcamera\b|カメラ|視点)", re.I)

# 「POV」だけでは車載・ゲーム・警察映像などが大量に混ざる。タイトルと概要欄の
# どちらかにマーチングの文脈も必要とする。団体名だけでなく、題名が簡素な個人投稿を
# 救うための一般語(DCI / marching / drum corps / 楽器セクション)も含める。
MARCHING_CONTEXT = re.compile(
    r"(\bdci\b|drum\s*corps|marching|marched|drumline|hornline|"
    r"front\s*ensemble|battery|victory\s*run|finals\s*(week|day)|"
    r"semifinals|prelims|bluecoats|blue\s*devils|boston\s*crusaders|"
    r"carolina\s*crown|santa\s*clara|cavaliers|phantom\s*regiment|"
    r"madison\s*scouts|mandarins|blue\s*knights|crossmen|colts|blue\s*stars|"
    r"spirit\s*of\s*atlanta|troopers|pacific\s*crest|river\s*city\s*rhythm|"
    r"gold\s*(dbc|drum\s*corps)|yokohama\s*(robins|scouts)|ipu\s*marching|"
    r"satsuki\s*dreamers|aimachi|marching\s*band\s*courage|"
    r"\bcadets\b|jersey\s*surf|music\s*city|the\s*academy|seattle\s*cascades|"
    r"\bgenesis\b|"
    r"マーチング|ドラムコー|ドラムライン|ホーンライン|カラーガード|吹奏楽|全国大会|"
    r"ヘッドカム|奏者視点|プレイヤー視点)", re.I)

# 団体名の一部はゲーム等にも出るため、明確な別ジャンルは先に除く。
NOT_MARCHING = re.compile(
    r"(counter[\s-]*strike|\bcs2?\b|\besea\b|faceit|\belo\b|gameplay|mythic\+|"
    r"trottah|win[\s-]*streak|bounce\s*back|"
    r"test\s*drive|night\s*drive|road\s*trip|traffic\s*stop|police\s*chase|"
    r"suv|sedan|motorcycle|world\s*of\s*warcraft|pacific\s*crest\s*trail|"
    r"thru[\s-]*hiker|hiking|bleeding\s*mandarins|vaelgor)", re.I)

# 奏者視点ではない固定/編集カメラ(強い除外)
NOT_POV = re.compile(
    r"(catwalk|overhead|high\s*cam|press\s*box|crowd\s*cam|stands\s*cam|"
    r"multi[\s\-_]?cam|multicam|wide[\s\-]?angle|広角|split[\s\-]?cam|"
    r"retreat\s*cam|side\s*line\s*cam|drone|"
    r"react(ion)?|反応|解説|review|podcast|interview|"
    r"trailer|teaser|announce|recap\b|highlight\s*reel|sync(ed)?|archive|vlog|"
    r"glide\s*cam|slider|jib|"
    r"full\s*show\b(?!.*cam))", re.I)

# 検索に使う団体(DCI World/Open + 国内の主要団体)
CORPS_EN = [
    "Blue Devils", "Bluecoats", "Boston Crusaders", "Carolina Crown",
    "Santa Clara Vanguard", "The Cavaliers", "Phantom Regiment",
    "Madison Scouts", "Mandarins", "Blue Knights", "Crossmen", "Colts",
    "Blue Stars", "Spirit of Atlanta", "Troopers", "Pacific Crest",
    "Genesis", "Seattle Cascades", "The Academy", "Jersey Surf",
    "Music City", "Cadets2", "Cadets", "River City Rhythm", "Gold drum corps",
    "Oregon Crusaders",
]
CORPS_JP = [
    "YOKOHAMA ROBINS", "IPU Marching Band", "SATSUKI DREAMERS",
    "MARCHING BAND COURAGE", "Aimachi", "THE YOKOHAMA SCOUTS",
    "つつじが丘ジュニアマーチングバンド", "龍桜高校",
]
TEAM_ALIASES = {
    "Cavaliers": "The Cavaliers",
    "SCV": "Santa Clara Vanguard",
    "Cascades": "Seattle Cascades",
    "Cadets2": "Cadets2",
    "Oregon Crusaders": "Oregon Crusaders",
    "Gold DBC": "Gold",
    "Paris High School Marching Band": "Paris High School Marching Band",
    "UTA Maverick Marching Band": "UTA Maverick Marching Band",
    "Auburn Tigers Marching Band": "Auburn Tigers Marching Band",
    "The Academy": "The Academy",
    "Academy": "The Academy",
    "Jersey Surf": "Jersey Surf",
}
# カメラ語だけでなく **大会の段** も混ぜる。
# ヘッドカムは Victory Run(決勝後のアンコール)だけでなく
# Prelims / Semifinals / Finals Week でも撮られる。
# 「Victory Run しか探していない」と準決勝ぶんを丸ごと落とす。
CAM_TERMS = [
    "headcam", "head cam", "hedcam", "POV", "gopro",
    "soloist cam", "lead trumpet cam", "mellophone cam",
    "euphonium cam", "snare cam", "tenor cam", "battery cam",
    "player cam", "member cam", "helmet cam", "chest cam",
    "cam victory run", "cam finals week",
    "cam semifinals", "cam prelims", "cam full run",
    # ★語順を逆にした形も必ず入れる。
    # 2026-08-11、"BLUECOATS 2026 VICTORY RUN SNARE CAM" を取りこぼした。
    # "cam victory run" という語順固定の検索語では
    # 「VICTORY RUN が先、CAM が後」の題名に届かない。
    # 大会の段は「段+cam」と「cam+段」の両方向で引く。
    "victory run cam", "finals week cam",
    "semifinals cam", "prelims cam", "full run cam",
    "victory run headcam", "victory run gopro",
]
# 年を指定して掘るときの語。年が入るぶんクエリが増えるので数を絞る。
YEAR_CAM_TERMS = ["headcam", "head cam", "hedcam", "POV", "gopro",
                  "cam victory run", "victory run cam"]
JP_QUERIES = [
    "マーチング ヘッドカム", "マーチング 奏者視点", "マーチングバンド POV",
    "マーチング GoPro 視点", "ドラムライン 視点カメラ", "カラーガード 視点",
    "ドラムメジャー 視点 カメラ", "マーチング 一人称 カメラ",
    "吹奏楽 マーチング ヘッドカム", "全国大会 マーチング GoPro",
    "マーチング 楽器視点", "マーチング プレイヤー視点", "奏者視点 ヘッドカム",
]


# ── 下ごしらえ ─────────────────────────────────────────
def ytdlp_bin() -> str:
    for p in YTDLP_CANDIDATES:
        if p.exists():
            return str(p)
    # PATH も見る。GitHub Actions(ubuntu-latest)では
    # `pip install yt-dlp` が /opt/hostedtoolcache/Python/*/x64/bin/ へ置くため、
    # 上のMac固有の候補だけでは見つからない。
    # 2026-08-12、日次ワークフローがこれで13秒で全滅した
    # (scout が SystemExit → check_pov_updates が die() → ジョブが赤)。
    found = shutil.which("yt-dlp")
    if found:
        return found
    raise SystemExit(
        "yt-dlp が見つかりません"
        "(~/Movies/venvs/*/bin/yt-dlp か PATH 上を確認)")


def video_id(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else ""


def run_ytdlp(args: list[str], timeout: int = 300) -> str:
    try:
        p = subprocess.run([ytdlp_bin(), *args], capture_output=True,
                           text=True, timeout=timeout)
        return p.stdout
    except subprocess.TimeoutExpired:
        return ""


def flat_list(target: str, timeout: int = 300, playlist_end: int | None = None) -> list[dict]:
    """チャンネル/検索結果を軽く列挙(概要欄は付かない)。"""
    fmt = "%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(channel_url)s\t%(upload_date)s"
    args = ["--flat-playlist"]
    if playlist_end:
        args += ["--playlist-end", str(playlist_end)]
    out = run_ytdlp([*args, "--print", fmt, target], timeout)
    rows = []
    for ln in out.strip().splitlines():
        f = ln.split("\t")
        if len(f) < 6 or len(f[0]) != 11:
            continue
        try:
            dur = int(float(f[2]))
        except (ValueError, TypeError):
            dur = None
        rows.append({"id": f[0], "title": f[1], "dur": dur,
                     "channel": f[3], "channel_url": f[4], "upload_date": f[5]})
    return rows


def fetch_meta(vid: str, *, allow_network: bool = True) -> dict | None:
    """概要欄つきの本メタ。ディスクにキャッシュする。

    概要欄にタブや改行が混ざる動画があるため、TSVではなく JSON 1オブジェクトで取る。
    allow_network=False ならキャッシュ命中時だけ返す(一括判定で YouTube 待ちに溶かさない)。
    """
    if not vid or len(vid) != 11:
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    cf = CACHE / f"{vid}.json"
    if cf.exists():
        try:
            return json.loads(cf.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cf.unlink(missing_ok=True)
    if not allow_network:
        return None
    clients = [
        "youtube:player_client=android,web_safari",
        "youtube:player_client=ios,web",
    ]
    raw = None
    for client in clients:
        out = run_ytdlp([
            "--skip-download", "--no-warnings",
            "--extractor-args", client,
            "--print", "%(.{id,title,duration,channel,channel_url,upload_date,description})j",
            f"https://www.youtube.com/watch?v={vid}",
        ], timeout=35)
        line = (out or "").strip().splitlines()
        if not line:
            continue
        try:
            raw = json.loads(line[0])
            break
        except json.JSONDecodeError:
            continue
    if not raw:
        return None
    vid_id = str(raw.get("id") or "")
    if len(vid_id) != 11:
        return None
    try:
        dur = int(float(raw["duration"])) if raw.get("duration") is not None else None
    except (ValueError, TypeError):
        dur = None
    meta = {
        "id": vid_id,
        "title": str(raw.get("title") or ""),
        "dur": dur,
        "channel": str(raw.get("channel") or ""),
        "channel_url": str(raw.get("channel_url") or ""),
        "upload_date": str(raw.get("upload_date") or ""),
        "desc": str(raw.get("description") or "")[:1500],
    }
    cf.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def meta_from_flat(row: dict) -> dict | None:
    """本メタが取れないときの題名だけの仮メタ。強い手掛かりがある行だけ使う。"""
    title = row.get("title") or ""
    if not title or row.get("dur") is None:
        return None
    if NOT_POV.search(title):
        return None
    if not (STRONG_POV.search(title) or (PART.search(title) and CAM.search(title))):
        return None
    up = row.get("upload_date") or ""
    if up in ("NA", "None"):
        up = ""
    return {
        "id": row["id"],
        "title": title,
        "dur": row["dur"],
        "channel": row.get("channel") or "",
        "channel_url": row.get("channel_url") or "",
        "upload_date": up if re.fullmatch(r"\d{8}", up or "") else "",
        "desc": "",
    }


# ── 判定 ───────────────────────────────────────────────
def loose_hit(title: str) -> bool:
    """本メタを取りに行く価値があるか(タイトルだけの粗い門)。"""
    if NOT_POV.search(title):
        return False
    return bool(STRONG_POV.search(title) or CAM.search(title))


def parse_upload_date(raw: str) -> date | None:
    """yt-dlp の YYYYMMDD を日付へ。取れない動画は後段で実メタ確認する。"""
    try:
        return datetime.strptime(raw, "%Y%m%d").date()
    except (TypeError, ValueError):
        return None


def eligible_flat(row: dict, since: date) -> bool:
    """本メタ取得前の候補門。

    タイトルに POV 語がなくても、検索語との一致が概要欄にだけ出る個人投稿がある。
    ここで title の語彙判定をすると、概要欄を読む前に取りこぼすため使わない。
    """
    if row.get("dur") is not None and row["dur"] < MIN_SEC:
        return False
    if NOT_POV.search(row.get("title", "")):
        return False
    published = parse_upload_date(row.get("upload_date", ""))
    return published is None or published >= since


def judge(meta: dict) -> tuple[bool, str]:
    """タイトル＋概要欄で採否を決める。戻り: (候補にするか, 理由)"""
    title, desc = meta["title"], meta.get("desc", "")
    both = f"{title}\n{desc}"

    if meta["dur"] is None:
        return False, "尺を確認できない"
    if meta["dur"] < MIN_SEC:
        return False, f"尺 {meta['dur']}s < {MIN_SEC}s"

    # 除外語はタイトルにあるときだけ効かせる
    # (概要欄には他の動画の宣伝で multi cam 等が混ざるため)
    if NOT_POV.search(title):
        return False, "固定/編集カメラの語"

    if NOT_MARCHING.search(both):
        return False, "別ジャンルの語"

    if not MARCHING_CONTEXT.search(both):
        return False, "マーチング文脈なし"

    if STRONG_POV.search(both):
        where = "題名" if STRONG_POV.search(title) else "概要欄"
        return True, f"POV語({where})"

    # 楽器/役割 × cam の組み合わせ
    if PART.search(both) and CAM.search(both):
        where = "題名" if (PART.search(title) and CAM.search(title)) else "概要欄"
        return True, f"楽器×カメラ({where})"

    return False, "POVの手掛かりなし"


# ── 台帳 ───────────────────────────────────────────────
def load_ledger() -> dict:
    if LEDGER.exists():
        return json.loads(LEDGER.read_text(encoding="utf-8"))
    return {}


def save_ledger(d: dict) -> None:
    LEDGER.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True),
                      encoding="utf-8")


def csv_ids() -> set[str]:
    rows = list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8"))))
    return {video_id(r["URL"]) for r in rows} - {""}


def csv_channels() -> set[str]:
    """CSV収録のチャンネルURL。配信元URL列を優先し、無いときだけメタへ。"""
    raw = POV_CSV.read_text(encoding="utf-8")
    rows = list(csv.DictReader(io.StringIO(raw)))
    out = set()
    for r in rows:
        u = (r.get("動画配信元URL") or "").strip().rstrip("/")
        if u:
            out.add(u)
            continue
        m = fetch_meta(video_id(r.get("URL", "")))
        if m and m.get("channel_url"):
            out.add(m["channel_url"].rstrip("/"))
    return out


def watch_channels() -> set[str]:
    """人手で確認済みの個人投稿者を、CSV採用状況と無関係に毎回再訪する。

    個人チャンネルは投稿数が少なく、横断検索の順位変動で落ちやすい。ユーザーから
    提示された動画・調査で見つけた発信者は `pov_channel_watchlist.txt` に残し、
    次回以降の探索でも必ず母集団へ戻す。空行と # コメントは許容する。
    """
    if not WATCHLIST.exists():
        return set()
    return {
        line.strip().rstrip("/")
        for line in WATCHLIST.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


# ── 本体 ───────────────────────────────────────────────
def coverage() -> dict:
    """CSVが何年分をどれだけ持っているかを数える(ネットに触らない)。"""
    rows = list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8"))))
    per = {}
    unknown = 0
    for r in rows:
        m = re.match(r"^【POV/(\d{4})】", r["大会名"])
        if m:
            per[int(m.group(1))] = per.get(int(m.group(1)), 0) + 1
        else:
            unknown += 1
    return {"total": len(rows), "per_year": per, "unknown": unknown}


def print_coverage() -> int:
    """年ごとの収録数を棒で見せ、薄い年を名指しする。"""
    c = coverage()
    per = c["per_year"]
    if not per:
        print("年つきの行がありません")
        return 1
    lo, hi = min(per), max(per)
    print(f"収録 {c['total']}件 / {lo}〜{hi} の {hi - lo + 1}年分"
          + (f" / 年不明 {c['unknown']}件" if c["unknown"] else ""))
    print()
    print("年     件数  ")
    for y in range(hi, lo - 1, -1):
        n = per.get(y, 0)
        note = ""
        if y in COVID_YEARS and n <= 5:
            note = "  ← コロナでDCIシーズン中止。少なくて正しい"
        elif n == 0:
            note = "  ← 収録なし"
        elif y >= PREGOPRO_YEAR and n < THIN_THRESHOLD:
            note = "  ← 薄い。掘る価値あり"
        print(f"{y}  {n:>5}  {'█' * min(52, n // 3)}{note}")
    print()
    thin = [y for y in range(lo, hi + 1)
            if per.get(y, 0) < THIN_THRESHOLD
            and y not in COVID_YEARS and y >= PREGOPRO_YEAR]
    if thin:
        print(f"掘るとよい年({THIN_THRESHOLD}件未満): {', '.join(map(str, thin))}")
        print(f"  例: python3 scout_pov_videos.py --year-from {thin[0]} --year-to {thin[-1]}")
    else:
        print(f"{PREGOPRO_YEAR}年以降はどの年も{THIN_THRESHOLD}件以上あります")
    print(f"\n※ {PREGOPRO_YEAR}年より前はヘッドカム自体がほとんど存在しないため、"
          "少ないのが自然です")
    return 0


def scout(quick: bool, workers: int, since: date, search_results: int,
          year_from: int | None = None, year_to: int | None = None,
          skip_revisit: bool = False) -> list[dict]:
    known = csv_ids()
    ledger = load_ledger()
    decided = set(ledger) | known
    print(f"[台帳] 収録{len(known)}件 / 既決{len(ledger)}件", file=sys.stderr)

    pool: dict[str, dict] = {}      # id -> flat行
    channels_done: set[str] = set()

    def absorb(rows, src):
        n = 0
        for r in rows:
            if r["id"] in decided or r["id"] in pool:
                continue
            # ここは「題名がPOVっぽいか」では絞らない。概要欄だけに GoPro 等が
            # 書かれた個人投稿を、本判定(judge)まで必ず通すため。
            if not eligible_flat(r, since):
                continue
            r["src"] = src
            pool[r["id"]] = r
            n += 1
        return n

    # ── 軸3/4: 収録済み・見張りチャンネルの再訪(新着追随) ──
    # watchlist は「まだCSVに追加できない/初回の個人投稿者」も救う。
    # チャンネル数が多く(140件超)ここだけで20分以上かかるので、
    # 過去の年を掘るだけのときは --skip-revisit で飛ばせる。
    if skip_revisit:
        print("[軸3/4] 再訪を飛ばしました(--skip-revisit)", file=sys.stderr)
    else:
        revisit = csv_channels() | watch_channels()
        print(f"[軸3/4] 収録済み・見張りチャンネルを再訪 ({len(revisit)}件)", file=sys.stderr)
        for cu in sorted(revisit):
            channels_done.add(cu)
            n = absorb(flat_list(cu.rstrip("/") + "/videos", playlist_end=CHANNEL_SCAN_LIMIT),
                       f"revisit:{cu}")
            if n:
                print(f"  +{n:>3} {cu}", file=sys.stderr)

    # ── 軸1: 横断検索 ──
    if not quick:
        if year_from and year_to:
            # 年を指定したときは「団体 × 年 × カメラ語」で掘る。
            # 過去の年は新着順(ytsearchdate)だと拾えないので関連度順(ytsearch)にする。
            years = range(year_from, year_to + 1)
            queries = [f"{c} {y} {t}"
                       for y in years for c in CORPS_EN for t in YEAR_CAM_TERMS]
            queries += [f"{c} {y} ヘッドカム" for y in years for c in CORPS_JP]
            prefix = f"ytsearch{search_results}"
            print(f"[軸1] 年を指定した横断検索 {year_from}〜{year_to} / {len(queries)}本",
                  file=sys.stderr)
        else:
            queries = ([f"{c} {t}" for c in CORPS_EN for t in CAM_TERMS]
                       + [f"{c} {t}" for c in CORPS_JP for t in ("POV", "ヘッドカム", "視点")]
                       + JP_QUERIES)
            # YouTubeの関連度順では古い定番動画に押し出されるため、新着順で取得する。
            prefix = f"ytsearchdate{search_results}"
            print(f"[軸1] 横断検索 {len(queries)}本", file=sys.stderr)
        for i, q in enumerate(queries, 1):
            n = absorb(flat_list(f"{prefix}:{q}", timeout=150), f"search:{q}")
            if n:
                print(f"  +{n:>3} {q}", file=sys.stderr)
            if i % 25 == 0:
                print(f"  ..{i}/{len(queries)} (母集団 {len(pool)})", file=sys.stderr)

    def judge_ids(ids: list[str], label: str) -> list[dict]:
        """キャッシュ／題名で通し、足りない分だけ概要欄をネットワーク取得する。"""
        print(f"[判定:{label}] {len(ids)}本", file=sys.stderr)
        metas = []
        need_net = []
        for vid in ids:
            m = fetch_meta(vid, allow_network=False)
            if m:
                metas.append(m)
                continue
            flat = meta_from_flat(pool.get(vid) or {})
            if flat:
                # 題名だけで採れるものは概要欄待ちにせず通す
                ok, _ = judge(flat)
                if ok:
                    metas.append(flat)
                    continue
            need_net.append(vid)
        print(f"  キャッシュ/題名 {len(metas)} / ネット要 {len(need_net)}", file=sys.stderr)
        if need_net and _JUDGE_NO_NETWORK:
            print(f"  ネット取得スキップ ({len(need_net)}本)", file=sys.stderr)
        elif need_net:
            # 件数が多いときは上限を設け、残りは次回キャッシュが育ってから
            cap = 200
            todo = need_net[:cap]
            if len(need_net) > cap:
                print(f"  ネット取得は先頭{cap}本に制限 (残り{len(need_net)-cap}は次回)",
                      file=sys.stderr)
            with ThreadPoolExecutor(max_workers=min(workers, 4)) as ex:
                for i, m in enumerate(ex.map(fetch_meta, todo), 1):
                    if m:
                        metas.append(m)
                    if i % 50 == 0:
                        print(f"  ..net {i}/{len(todo)}", file=sys.stderr)
        accepted = []
        for m in metas:
            published = parse_upload_date(m.get("upload_date", ""))
            if published is None and since > date.min:
                continue
            if not eligible_flat(m, since):
                continue
            ok, why = judge(m)
            if ok:
                m["why"] = why
                m["src"] = pool[m["id"]].get("src", "") if m["id"] in pool else ""
                accepted.append(m)
        return accepted

    # まず検索・再訪の全結果を本判定する。題名に手掛かりがない動画もここまで届く。
    first_ids = list(pool)
    cands = judge_ids(first_ids, "一次")

    # ── 軸2: 雪だるま ──
    # タイトルではなく、概要欄まで読んで実際にPOV判定を通過した投稿者だけを深掘りする。
    # これにより個人チャンネルは漏らさず追いつつ、大型チャンネルを無差別に列挙しない。
    print("[軸2] 採用候補チャンネルを雪だるま列挙", file=sys.stderr)
    targets = {m["channel_url"] for m in cands if m.get("channel_url")} - channels_done
    print(f"  対象 {len(targets)}チャンネル", file=sys.stderr)
    for cu in sorted(targets):
        channels_done.add(cu)
        n = absorb(flat_list(cu.rstrip("/") + "/videos", timeout=180,
                             playlist_end=SNOWBALL_CHANNEL_SCAN_LIMIT), f"snowball:{cu}")
        if n:
            print(f"  +{n:>3} {cu}", file=sys.stderr)

    extra_ids = [v for v in pool if v not in set(first_ids)]
    if extra_ids:
        cands.extend(judge_ids(extra_ids, "雪だるま"))
    cands.sort(key=lambda x: (x.get("upload_date") or "", x["channel"]), reverse=True)
    print(f"\n=== 未判定の候補 {len(cands)}本 / 母集団 {len(pool)}本", file=sys.stderr)
    return cands


# ── 自動採用の門(毎日の無人反映で使う) ───────────────────
# 人が動画を見ずに採るので、**題名だけで疑いようがないもの**に限る。
# 2026-08-10 に混入した18件は全て「CSVに1本も無いチャンネル」から来た。
# だから「すでに収録実績のある投稿者」であることを必須にしている。
AUTO_MIN_SEC = 300      # 5分
AUTO_MAX_SEC = 1200     # 20分。これを超える通し映像は別物のことが多い


def auto_safe(meta: dict, known_channels: set[str]) -> tuple[bool, str]:
    """無人で採ってよいほど確実かを判定する。

    戻り: (採ってよいか, 理由)
    ここを緩めると本番へ直接ゴミが入る。緩めるときは必ず試験を足すこと。
    """
    title = meta.get("title", "")
    dur = meta.get("dur")
    ch = (meta.get("channel_url") or "").rstrip("/")

    if not ch or ch not in {c.rstrip("/") for c in known_channels}:
        return False, "収録実績のないチャンネル"
    if dur is None:
        return False, "尺が分からない"
    if not (AUTO_MIN_SEC <= dur <= AUTO_MAX_SEC):
        return False, f"尺 {dur}s が自動採用の範囲外"
    if NOT_POV.search(title) or NOT_MARCHING.search(title):
        return False, "除外語が題名にある"
    # 題名だけで、POV語 と 楽器語 の両方が読めること(概要欄頼みは自動では採らない)
    if not STRONG_POV.search(title) and not (PART.search(title) and CAM.search(title)):
        return False, "題名だけではPOVと読めない"
    if not PART.search(title):
        return False, "題名に楽器・パートが無い"
    if not guess_team(title):
        return False, "題名から団体を特定できない"
    return True, "確実な線"


def guess_team(text: str) -> str:
    """題名・概要欄から団体名を当てる。既にCSVにある団体名を優先。"""
    rows = list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8"))))
    names = {r["団体/チーム名"] for r in rows if r["団体/チーム名"]}
    # 長い名前から先に当てる(部分一致の取り違えを防ぐ)
    for n in sorted(names, key=len, reverse=True):
        if re.search(re.escape(n), text, re.I):
            return n
    for n in sorted(CORPS_EN + CORPS_JP, key=len, reverse=True):
        n = n.replace(" drum corps", "")
        if re.search(re.escape(n), text, re.I):
            return n
    for alias, team in TEAM_ALIASES.items():
        if re.search(re.escape(alias), text, re.I):
            return team
    return ""


def guess_team_title_first(title: str, desc: str = "") -> str:
    """団体名はタイトルを優先して当てる。概要欄はタイトルに手掛かりが無いときだけ。

    2026-08-11、Blue Devils の動画が概要欄の自己紹介文
    「2015年にPacific Crestで始めた」に反応して Pacific Crest 扱いになる
    誤爆が発覚した。概要欄は自伝的文章で過去に所属した別団体名が出ることが
    あるため、タイトルに手掛かりが無い場合の補助にとどめる。

    さらに同日、概要欄がSEO目的の無関係なタグの羅列(他団体名を含む)で
    埋まっている動画で同種の誤爆が発覚した(Blue Devils の動画が
    "boston crusaders" 等を含む大量のハッシュタグ群に反応して
    Boston Crusaders 扱いになった)。実際の説明文は概要欄の先頭に書かれ、
    タグの羅列は後半に付くのが通例のため、補助として使う概要欄は
    先頭2行だけに絞る。
    """
    team = guess_team(title)
    if team:
        return team
    desc_head = "\n".join(desc.splitlines()[:2])
    return guess_team(f"{title}\n{desc_head}")


def guess_part(title: str, team: str = "") -> str:
    """タイトルから楽器・パートを当てる。団体名の部分文字列に釣られない。

    2026-08-11、優さんの指摘で発覚。"Santa Clara Vanguard" というタイトルは
    団体名自体に "guard" を含むため、PART の正規表現がタイトル中の本当の
    楽器名(例: Baritone)より先に団体名の中の "guard" を拾ってしまい、
    SCVの44件で本当の楽器が【guard】に上書きされていた。
    役割を当てる前に、団体名の部分だけタイトルから取り除く。
    """
    title_wo_team = re.sub(re.escape(team), " ", title, flags=re.I) if team else title
    part = PART.search(title_wo_team)
    part_s = part.group(0) if part else "POV"
    if part_s == "POV":
        for label, pat in (
            ("Euphonium", r"\beuph\b"),
            ("Baritone", r"\bbari\b"),
            ("Mellophone", r"\bmello\b"),
            ("Rack", r"\brack\s*cam\b"),
            ("Drum Set", r"\bdrum\s*set\b|\bdrumset\b"),
        ):
            if re.search(pat, title_wo_team, re.I):
                part_s = label
                break
    return part_s


def guess_show(title: str) -> str:
    """既存POVの表示規則に合わせ、題名に明示されたショウ名だけを拾う。"""
    for pattern in (r"[“\"]([^”\"]{2,80})[”\"]", r"「([^」]{2,80})」"):
        m = re.search(pattern, title)
        if m:
            return m.group(1).strip()
    return ""


def write_pov_csv(rows: list[dict], bom: bool) -> None:
    if not rows:
        raise SystemExit("POV CSV が空です")
    fields = list(rows[0].keys())
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    POV_CSV.write_text(("﻿" if bom else "") + buf.getvalue(), encoding="utf-8")


def fix_publishers(workers: int = 6) -> int:
    """既存CSVで動画配信元が『POV』等の誤りの行を、実チャンネル名へ直す。"""
    raw = POV_CSV.read_text(encoding="utf-8")
    bom = raw.startswith("﻿")
    rows = list(csv.DictReader(io.StringIO(raw)))
    before = len(rows)
    need = []
    for i, r in enumerate(rows):
        src = (r.get("動画配信元") or "").strip()
        url = (r.get("動画配信元URL") or "").strip()
        if src in ("", "POV") or not url:
            need.append(i)
    if not need:
        print("配信元の修正は不要です")
        return 0

    print(f"配信元を直す対象: {len(need)} / {before} 行", file=sys.stderr)
    vids = [video_id(rows[i]["URL"]) for i in need]
    metas: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for i, m in enumerate(ex.map(fetch_meta, vids), 1):
            if i % 20 == 0 or i == len(vids):
                print(f"  meta {i}/{len(vids)}", file=sys.stderr)
            if m and m.get("id"):
                metas[m["id"]] = m

    fixed, failed = 0, []
    for i, vid in zip(need, vids):
        m = metas.get(vid)
        if not m or not (m.get("channel") or "").strip():
            failed.append(vid or rows[i].get("URL", ""))
            continue
        rows[i]["動画配信元"] = m["channel"].strip()
        rows[i]["動画配信元URL"] = (m.get("channel_url") or "").strip()
        # ロゴは YouTube名簿に無い個人chが多いので空のまま(既存方針)
        fixed += 1

    write_pov_csv(rows, bom)
    check = list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8"))))
    assert len(check) == before, f"行数が変わった {before}→{len(check)}"
    still = sum(1 for r in check if (r.get("動画配信元") or "").strip() in ("", "POV"))
    print(f"配信元を更新: {fixed}件 / 失敗 {len(failed)}件 / 残POV表記 {still}件")
    for v in failed[:20]:
        print(f"  - 失敗 {v}")
    return 0 if not failed else 1


def load_candidate_index() -> dict[str, dict]:
    """探索結果TSVから video_id → 行。メタ取得が死んでも追記できるようにする。"""
    out: dict[str, dict] = {}
    for path in sorted(ROOT.glob("pov_candidates*.tsv")):
        try:
            with path.open(encoding="utf-8", newline="") as f:
                for r in csv.DictReader(f, delimiter="\t"):
                    vid = (r.get("video_id") or "").strip()
                    if len(vid) == 11 and vid not in out:
                        out[vid] = r
        except OSError:
            continue
    return out


def meta_from_candidate(vid: str, cand: dict | None) -> dict | None:
    """候補TSVの1行を fetch_meta 互換の辞書へ。"""
    if not cand:
        return None
    title = (cand.get("題名") or "").strip()
    channel = (cand.get("チャンネル") or "").strip()
    if not title or not channel:
        return None
    up = (cand.get("公開日") or "").strip()
    if up.isdigit() and len(up) == 8:
        pass
    else:
        up = ""
    try:
        dur = int(float(cand.get("尺秒") or 0))
    except (TypeError, ValueError):
        dur = None
    return {
        "id": vid,
        "title": title,
        "desc": "",
        "duration": dur,
        "channel": channel,
        "channel_url": "",
        "upload_date": up,
        "_from_candidate": True,
    }


def apply_accepted() -> int:
    """台帳の accepted のうち CSV に無いものを追記する。

    大会名は 【POV/YYYY】団体【役割】 の形に自動で組むが、あくまで下書き。
    ★プレフィックスは半角スラッシュ。全角縦棒は使わない(2026-08-11 に全936件を統一済み)。
    団体を当てられない行は書かずに一覧で報せる(勝手に埋めない)。
    """
    from marchinz_org_id import stable_org_id_for_team_name

    ledger = load_ledger()
    have = csv_ids()
    todo = [v for v, d in ledger.items()
            if d.get("status") == "accepted" and v not in have]
    if not todo:
        print("追記するものはありません")
        return 0

    raw = POV_CSV.read_text(encoding="utf-8")
    bom = raw.startswith("﻿")
    rows = list(csv.DictReader(io.StringIO(raw)))
    before = len(rows)
    known_id = {r["団体/チーム名"]: r["団体ID"] for r in rows if r["団体ID"]}
    cand_idx = load_candidate_index()

    added, skipped = [], []
    for v in sorted(todo):
        m = fetch_meta(v)
        src = "meta"
        if not m:
            m = meta_from_candidate(v, cand_idx.get(v))
            src = "candidate"
        if not m:
            skipped.append((v, "メタを取得できない"))
            continue
        team = guess_team_title_first(m["title"], m.get("desc", ""))
        if not team:
            skipped.append((v, f"団体を当てられない: {m['title'][:60]}"))
            continue
        year = ""
        ym = re.search(r"\b(19|20)\d{2}\b", m["title"])
        if ym:
            year = ym.group(0)
        elif m.get("upload_date"):
            year = m["upload_date"][:4]
        part_s = guess_part(m["title"], team)
        up = m.get("upload_date") or ""
        show = guess_show(m["title"])
        display = f"【POV/{year}】{team}"
        if show:
            display += f"「{show}」"
        display += f"【{part_s}】"
        # 動画配信元は分類名「POV」ではなく実チャンネル名。
        # （カードの配信元表示・ロゴ照合が配信元名を見るため）
        ch_name = (m.get("channel") or "").strip()
        ch_url = (m.get("channel_url") or "").strip()
        if not ch_name:
            skipped.append((v, f"チャンネル名が取れない: {m['title'][:60]}"))
            continue
        row = {
            "種別": "動画", "分類": "POV",
            "動画での表示名": team, "団体/チーム名": team,
            "団体ID": known_id.get(team) or stable_org_id_for_team_name(team),
            "配信日": f"{up[:4]}-{up[4:6]}-{up[6:8]}" if len(up) == 8 else "",
            "大会名": display,
            "元動画タイトル": m["title"],
            "URL": f"https://www.youtube.com/watch?v={v}",
            "動画配信元": ch_name,
            "動画配信元URL": ch_url,
            "動画配信元ロゴURL": "",
        }
        rows.append(row)
        added.append(row)
        if src == "candidate":
            print(f"  (候補TSVから) {v}", file=sys.stderr)

    if added:
        write_pov_csv(rows, bom)
        check = list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8"))))
        assert len(check) == before + len(added), f"行数不一致 {len(check)}"
        print(f"追記 {len(added)}件 ({before} → {len(check)} 行)")
        for r in added:
            print(f"  + {r['大会名']}  {r['URL']}  [{r['動画配信元']}]")
        print("\n★ 大会名は自動で組んだ下書きです。ショウ名・役割を手で整えてください。")
        print("  そのあと: python3 sync_csv_to_json.py && python3 check_data.py")
    for v, why in skipped:
        print(f"  - 見送り {v}: {why}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true", help="横断検索を省く(再訪+雪だるまのみ)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--since", metavar="YYYY-MM-DD",
                    help="公開日の下限。省略時は直近365日")
    ap.add_argument("--all-time", action="store_true", help="公開日で絞らない(通常は使わない)")
    ap.add_argument("--search-results", type=int, default=DEFAULT_SEARCH_RESULTS,
                    help=f"検索語ごとの新着取得件数(既定{DEFAULT_SEARCH_RESULTS})")
    ap.add_argument("--out", type=Path, default=ROOT / "pov_candidates.tsv")
    ap.add_argument("--accept", nargs="*", metavar="ID", help="台帳で採用にする")
    ap.add_argument("--reject", nargs="*", metavar="ID", help="台帳で却下にする")
    ap.add_argument("--accept-file", type=Path, metavar="FILE",
                    help="採用するvideo_idを1行ずつ書いたファイル")
    ap.add_argument("--reject-file", type=Path, metavar="FILE",
                    help="却下するvideo_idを1行ずつ書いたファイル")
    ap.add_argument("--apply", action="store_true", help="採用ぶんをCSVへ追記")
    ap.add_argument("--fix-publishers", action="store_true",
                    help="既存CSVの動画配信元『POV』を実チャンネル名へ直す")
    ap.add_argument("--coverage", action="store_true",
                    help="何年分をどれだけ持っているかを表示して終わる(ネット無し)")
    ap.add_argument("--year-from", type=int, metavar="YYYY",
                    help="この年から掘る(--year-to と対で使う)")
    ap.add_argument("--year-to", type=int, metavar="YYYY", help="この年まで掘る")
    ap.add_argument("--skip-revisit", action="store_true",
                    help="収録済み・見張りチャンネルの再訪を飛ばす(過去の年を掘るときに速い)")
    ap.add_argument("--no-network-meta", action="store_true",
                    help="判定時に本メタをネット取得しない(キャッシュと題名のみ)")
    args = ap.parse_args()

    if args.coverage:
        return print_coverage()
    if args.fix_publishers:
        return fix_publishers(args.workers)
    if args.apply:
        return apply_accepted()
    if bool(args.year_from) != bool(args.year_to):
        ap.error("--year-from と --year-to は対で指定してください")
    if args.year_from and args.year_from > args.year_to:
        ap.error("--year-from が --year-to より後になっています")
    # scout() から読む
    global _JUDGE_NO_NETWORK
    _JUDGE_NO_NETWORK = bool(args.no_network_meta)

    def ids_from_file(path: Path | None) -> list[str]:
        if not path:
            return []
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as e:
            ap.error(f"IDファイルを読めません: {e}")
        ids = [x.strip() for x in lines if x.strip()]
        bad = [x for x in ids if not re.fullmatch(r"[A-Za-z0-9_-]{11}", x)]
        if bad:
            ap.error(f"IDファイルに不正なvideo_idがあります: {bad[0]}")
        return ids

    accept_ids = list(args.accept or []) + ids_from_file(args.accept_file)
    reject_ids = list(args.reject or []) + ids_from_file(args.reject_file)
    if accept_ids or reject_ids:
        led = load_ledger()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for v in accept_ids:
            led.setdefault(v, {})["status"] = "accepted"
            led[v]["decided"] = now
        for v in reject_ids:
            led.setdefault(v, {})["status"] = "rejected"
            led[v]["decided"] = now
        save_ledger(led)
        print(f"台帳を更新: 採用{len(accept_ids)} / 却下{len(reject_ids)}")
        return 0

    if args.since:
        try:
            since = datetime.strptime(args.since, "%Y-%m-%d").date()
        except ValueError:
            ap.error("--since は YYYY-MM-DD で指定してください")
    else:
        since = datetime.now(timezone.utc).date() - timedelta(days=DEFAULT_LOOKBACK_DAYS)
    if args.all_time:
        since = date.min
    if args.search_results < 1:
        ap.error("--search-results は1以上にしてください")

    # 年を掘るときは、公開日の下限が邪魔をする(2015年の動画は直近365日に無い)。
    # 明示の --since が無ければ、その年の1月1日まで自動でさかのぼる。
    if args.year_from and not args.since and not args.all_time:
        since = date(args.year_from, 1, 1)
        print(f"[年指定] --since を {since.isoformat()} へ自動で下げました", file=sys.stderr)

    print(f"[対象期間] {since.isoformat()} 以降", file=sys.stderr)
    cands = scout(args.quick, args.workers, since, args.search_results,
                  args.year_from, args.year_to, args.skip_revisit)
    with args.out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["video_id", "公開日", "尺秒", "チャンネル", "題名", "判定理由", "URL"])
        for c in cands:
            w.writerow([c["id"], c.get("upload_date", ""), c.get("dur", ""),
                        c["channel"], c["title"], c["why"],
                        f"https://www.youtube.com/watch?v={c['id']}"])
    print(f"→ {args.out}")
    print("中身を見て、採る/採らないを台帳へ:")
    print("  python3 scout_pov_videos.py --accept ID1 ID2 ...")
    print("  python3 scout_pov_videos.py --reject ID3 ID4 ...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
