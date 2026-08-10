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
    軸2 雪だるま  1本でも当たったチャンネルは全件列挙(個人chは小さいので安い)
    軸3 再訪      CSV に載っているチャンネルは毎回全件列挙(新着に追随)

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
import subprocess
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
POV_CSV = ROOT / "大会動画リスト_POV.csv"
LEDGER = ROOT / "pov_ledger.json"
CACHE = Path.home() / "Movies" / ".cache" / "marchinz-pov-scout"

MIN_SEC = 300  # 5分

# yt-dlp は venv 側にしか無い環境があるので順に探す
YTDLP_CANDIDATES = [
    Path.home() / "Movies/venvs/MarchShot/bin/yt-dlp",
    Path.home() / "Movies/venvs/CutStudy/bin/yt-dlp",
    Path("/usr/local/bin/yt-dlp"),
    Path("/opt/homebrew/bin/yt-dlp"),
]

# ── 語彙 ───────────────────────────────────────────────
# 明確に奏者視点を示す語
STRONG_POV = re.compile(
    r"(\bpov\b|head\s*cam|headcam|helmet\s*cam|chest\s*cam|"
    r"go\s?pro|body\s*cam|player\s*cam|member\s*cam|"
    r"ヘッドカム|ヘルメットカム|奏者視点|プレイヤー視点|一人称)", re.I)

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

# 奏者視点ではない固定/編集カメラ(強い除外)
NOT_POV = re.compile(
    r"(catwalk|overhead|high\s*cam|press\s*box|crowd\s*cam|stands\s*cam|"
    r"multi[\s\-_]?cam|multicam|wide[\s\-]?angle|split[\s\-]?cam|"
    r"retreat\s*cam|side\s*line\s*cam|drone|"
    r"react(ion)?|反応|解説|review|podcast|interview|"
    r"trailer|teaser|announce|recap\b|highlight\s*reel|"
    r"glide\s*cam|slider|jib|"
    r"full\s*show\b(?!.*cam))", re.I)

# 検索に使う団体(DCI World/Open + 国内の主要団体)
CORPS_EN = [
    "Blue Devils", "Bluecoats", "Boston Crusaders", "Carolina Crown",
    "Santa Clara Vanguard", "The Cavaliers", "Phantom Regiment",
    "Madison Scouts", "Mandarins", "Blue Knights", "Crossmen", "Colts",
    "Blue Stars", "Spirit of Atlanta", "Troopers", "Pacific Crest",
    "Genesis", "Seattle Cascades", "The Academy", "Jersey Surf",
    "Music City", "Cadets", "River City Rhythm", "Gold drum corps",
]
CORPS_JP = [
    "YOKOHAMA ROBINS", "IPU Marching Band", "SATSUKI DREAMERS",
    "MARCHING BAND COURAGE", "Aimachi", "THE YOKOHAMA SCOUTS",
    "つつじが丘ジュニアマーチングバンド", "龍桜高校",
]
CAM_TERMS = ["headcam", "head cam", "POV", "cam victory run", "gopro"]
JP_QUERIES = [
    "マーチング ヘッドカム", "マーチング 奏者視点", "マーチングバンド POV",
    "マーチング GoPro 視点", "ドラムライン 視点カメラ", "カラーガード 視点",
    "ドラムメジャー 視点 カメラ", "マーチング 一人称 カメラ",
    "吹奏楽 マーチング ヘッドカム", "全国大会 マーチング GoPro",
]


# ── 下ごしらえ ─────────────────────────────────────────
def ytdlp_bin() -> str:
    for p in YTDLP_CANDIDATES:
        if p.exists():
            return str(p)
    raise SystemExit("yt-dlp が見つかりません(~/Movies/venvs/*/bin/yt-dlp を確認)")


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


def flat_list(target: str, timeout: int = 300) -> list[dict]:
    """チャンネル/検索結果を軽く列挙(概要欄は付かない)。"""
    fmt = "%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(channel_url)s"
    out = run_ytdlp(["--flat-playlist", "--print", fmt, target], timeout)
    rows = []
    for ln in out.strip().splitlines():
        f = ln.split("\t")
        if len(f) < 5 or len(f[0]) != 11:
            continue
        try:
            dur = int(float(f[2]))
        except (ValueError, TypeError):
            dur = None
        rows.append({"id": f[0], "title": f[1], "dur": dur,
                     "channel": f[3], "channel_url": f[4]})
    return rows


def fetch_meta(vid: str) -> dict | None:
    """概要欄つきの本メタ。ディスクにキャッシュする。"""
    CACHE.mkdir(parents=True, exist_ok=True)
    cf = CACHE / f"{vid}.json"
    if cf.exists():
        try:
            return json.loads(cf.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cf.unlink(missing_ok=True)
    fmt = "%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(channel_url)s\t%(upload_date)s\t%(description)s"
    out = run_ytdlp([
        "--skip-download", "--no-warnings",
        # SABR 由来の一時失敗を避けるため複数クライアントを指定
        "--extractor-args", "youtube:player_client=android,web_safari",
        "--print", fmt, f"https://www.youtube.com/watch?v={vid}",
    ], timeout=90)
    f = out.replace("\n", " ").split("\t")
    if len(f) < 7 or len(f[0]) != 11:
        return None
    try:
        dur = int(float(f[2]))
    except (ValueError, TypeError):
        dur = None
    meta = {"id": f[0], "title": f[1], "dur": dur, "channel": f[3],
            "channel_url": f[4], "upload_date": f[5], "desc": f[6][:1500]}
    cf.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


# ── 判定 ───────────────────────────────────────────────
def loose_hit(title: str) -> bool:
    """本メタを取りに行く価値があるか(タイトルだけの粗い門)。"""
    if NOT_POV.search(title):
        return False
    return bool(STRONG_POV.search(title) or CAM.search(title))


def judge(meta: dict) -> tuple[bool, str]:
    """タイトル＋概要欄で採否を決める。戻り: (候補にするか, 理由)"""
    title, desc = meta["title"], meta.get("desc", "")
    both = f"{title}\n{desc}"

    if meta["dur"] is not None and meta["dur"] < MIN_SEC:
        return False, f"尺 {meta['dur']}s < {MIN_SEC}s"

    # 除外語はタイトルにあるときだけ効かせる
    # (概要欄には他の動画の宣伝で multi cam 等が混ざるため)
    if NOT_POV.search(title):
        return False, "固定/編集カメラの語"

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
    """CSV収録動画のチャンネルURL(キャッシュ済みメタから引ける分)。"""
    out = set()
    for v in csv_ids():
        m = fetch_meta(v)
        if m and m.get("channel_url"):
            out.add(m["channel_url"])
    return out


# ── 本体 ───────────────────────────────────────────────
def scout(quick: bool, workers: int) -> list[dict]:
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
            if not loose_hit(r["title"]):
                continue
            r["src"] = src
            pool[r["id"]] = r
            n += 1
        return n

    # ── 軸3: CSV収録チャンネルの再訪(新着追随) ──
    print("[軸3] 収録済みチャンネルを再訪", file=sys.stderr)
    for cu in sorted(csv_channels()):
        channels_done.add(cu)
        n = absorb(flat_list(cu.rstrip("/") + "/videos"), f"revisit:{cu}")
        if n:
            print(f"  +{n:>3} {cu}", file=sys.stderr)

    # ── 軸1: 横断検索 ──
    if not quick:
        queries = ([f"{c} {t}" for c in CORPS_EN for t in CAM_TERMS]
                   + [f"{c} {t}" for c in CORPS_JP for t in ("POV", "ヘッドカム", "視点")]
                   + JP_QUERIES)
        print(f"[軸1] 横断検索 {len(queries)}本", file=sys.stderr)
        for i, q in enumerate(queries, 1):
            n = absorb(flat_list(f"ytsearch20:{q}", timeout=150), f"search:{q}")
            if n:
                print(f"  +{n:>3} {q}", file=sys.stderr)
            if i % 25 == 0:
                print(f"  ..{i}/{len(queries)} (母集団 {len(pool)})", file=sys.stderr)

    # ── 軸2: 雪だるま(当たったチャンネルを全件) ──
    print("[軸2] 雪だるま列挙", file=sys.stderr)
    targets = {r["channel_url"] for r in pool.values()
               if r.get("channel_url")} - channels_done
    print(f"  対象 {len(targets)}チャンネル", file=sys.stderr)
    for cu in sorted(targets):
        channels_done.add(cu)
        n = absorb(flat_list(cu.rstrip("/") + "/videos", timeout=180), f"snowball:{cu}")
        if n:
            print(f"  +{n:>3} {cu}", file=sys.stderr)

    # ── 概要欄つきで本判定 ──
    print(f"[判定] 概要欄を取得 {len(pool)}本 (並列{workers})", file=sys.stderr)
    ids = list(pool)
    metas = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for i, m in enumerate(ex.map(fetch_meta, ids), 1):
            if m:
                metas.append(m)
            if i % 50 == 0:
                print(f"  ..{i}/{len(ids)}", file=sys.stderr)

    cands = []
    for m in metas:
        ok, why = judge(m)
        if ok:
            m["why"] = why
            m["src"] = pool[m["id"]].get("src", "")
            cands.append(m)
    cands.sort(key=lambda x: (x.get("upload_date") or "", x["channel"]), reverse=True)
    print(f"\n=== 未判定の候補 {len(cands)}本 / 母集団 {len(pool)}本", file=sys.stderr)
    return cands


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
    return ""


def apply_accepted() -> int:
    """台帳の accepted のうち CSV に無いものを追記する。

    大会名は 【POV｜YYYY】団体【役割】 の形に自動で組むが、あくまで下書き。
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
    fields = list(rows[0].keys())
    before = len(rows)
    known_id = {r["団体/チーム名"]: r["団体ID"] for r in rows if r["団体ID"]}

    added, skipped = [], []
    for v in sorted(todo):
        m = fetch_meta(v)
        if not m:
            skipped.append((v, "メタを取得できない"))
            continue
        text = f"{m['title']}\n{m.get('desc', '')}"
        team = guess_team(text)
        if not team:
            skipped.append((v, f"団体を当てられない: {m['title'][:60]}"))
            continue
        year = ""
        ym = re.search(r"\b(19|20)\d{2}\b", m["title"])
        if ym:
            year = ym.group(0)
        elif m.get("upload_date"):
            year = m["upload_date"][:4]
        part = PART.search(m["title"])
        part_s = part.group(0) if part else "POV"
        up = m.get("upload_date") or ""
        row = {
            "種別": "動画", "分類": "POV",
            "動画での表示名": team, "団体/チーム名": team,
            "団体ID": known_id.get(team) or stable_org_id_for_team_name(team),
            "配信日": f"{up[:4]}-{up[4:6]}-{up[6:8]}" if len(up) == 8 else "",
            "大会名": f"【POV｜{year}】{team}【{part_s}】",
            "URL": f"https://www.youtube.com/watch?v={v}",
            "動画配信元": "POV", "動画配信元URL": "", "動画配信元ロゴURL": "",
        }
        rows.append(row)
        added.append(row)

    if added:
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
        POV_CSV.write_text(("﻿" if bom else "") + buf.getvalue(), encoding="utf-8")
        check = list(csv.DictReader(io.StringIO(POV_CSV.read_text(encoding="utf-8"))))
        assert len(check) == before + len(added), f"行数不一致 {len(check)}"
        print(f"追記 {len(added)}件 ({before} → {len(check)} 行)")
        for r in added:
            print(f"  + {r['大会名']}  {r['URL']}")
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
    ap.add_argument("--out", type=Path, default=ROOT / "pov_candidates.tsv")
    ap.add_argument("--accept", nargs="*", metavar="ID", help="台帳で採用にする")
    ap.add_argument("--reject", nargs="*", metavar="ID", help="台帳で却下にする")
    ap.add_argument("--apply", action="store_true", help="採用ぶんをCSVへ追記")
    args = ap.parse_args()

    if args.apply:
        return apply_accepted()

    if args.accept or args.reject:
        led = load_ledger()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for v in args.accept or []:
            led.setdefault(v, {})["status"] = "accepted"
            led[v]["decided"] = now
        for v in args.reject or []:
            led.setdefault(v, {})["status"] = "rejected"
            led[v]["decided"] = now
        save_ledger(led)
        print(f"台帳を更新: 採用{len(args.accept or [])} / 却下{len(args.reject or [])}")
        return 0

    cands = scout(args.quick, args.workers)
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
