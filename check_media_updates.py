#!/usr/bin/env python3
"""メディアページの紙もの2誌に新刊が出ていないかを調べる(2026-08-04 優さん指示)。

    Laundry Day!!         週1回  https://www.marching-matsuri.com/laundryday
    マーチングエクスプレス21  月1回  Amazon の検索結果

**このスクリプトはサイトを書き換えない。** 見つけたことを報告するだけで、
掲載は優さんが表紙画像を用意してから手で行う(表紙だけは自動で取れないため)。
書き換えないので Netlify のビルドクレジットも消費しない。

「いま載っている最新号」の正本は index.html のカードそのもの。
別ファイルに号数を持たせると二重管理になり、必ずどちらかが古くなる。

依存はシステム Python 3 の標準ライブラリのみ(Mac に Homebrew 無し方針)。

使い方:
    python3 check_media_updates.py                     # 両方調べて人が読む形で出す
    python3 check_media_updates.py --target laundry    # Laundry Day!! だけ
    python3 check_media_updates.py --json              # 機械可読
    python3 check_media_updates.py --github-output     # Actions 用(+ Issue 本文を書き出す)

終了コード:
    0  調べられた(新刊の有無は出力を見る)
    2  取得に失敗して判断できなかった ← Actions ではここで赤くして気づけるようにする
"""

import argparse
import gzip
import html
import http.client
import io
import json
import os
import re
import sys
import time
import urllib.parse
import zlib

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_PATH = os.path.join(SCRIPT_DIR, "index.html")
ISSUE_BODY_PATH = os.path.join(SCRIPT_DIR, "media-update-issue.md")

LAUNDRY_OFFICIAL = "https://www.marching-matsuri.com/laundryday"
EXPRESS_SEARCH = (
    "https://www.amazon.co.jp/s?k=%E3%83%9E%E3%83%BC%E3%83%81%E3%83%B3%E3%82%B0"
    "%E3%82%A8%E3%82%AF%E3%82%B9%E3%83%97%E3%83%AC%E3%82%B921&i=stripbooks"
)

# ★ urllib.request は使えない。Request のヘッダは内部で .capitalize() され、
#   実際には "User-agent" "Accept-language" という綴りで送られる。これが bot の印で、
#   Amazon はこれだけを理由に 503 を返す(2026-08-04 実測。curl は同じ内容で 200)。
#   http.client なら大文字小文字をそのまま送れるので、標準ライブラリのまま解決できる。
BROWSER_HEADERS = [
    ("User-Agent", (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )),
    ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    ("Accept-Language", "ja,en-US;q=0.9,en;q=0.8"),
    ("Accept-Encoding", "gzip, deflate"),
]


def _get_once(url, timeout):
    u = urllib.parse.urlsplit(url)
    conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(u.netloc, timeout=timeout)
    try:
        path = u.path or "/"
        if u.query:
            path += "?" + u.query
        # skip_* を切って、ヘッダは綴りも順番もこちらで決める
        conn.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        conn.putheader("Host", u.netloc)
        for k, v in BROWSER_HEADERS:
            conn.putheader(k, v)
        conn.endheaders()
        res = conn.getresponse()
        status = res.status
        location = res.getheader("Location")
        enc = (res.getheader("Content-Encoding") or "").lower()
        raw = res.read()
    finally:
        conn.close()

    if status in (301, 302, 303, 307, 308) and location:
        return None, urllib.parse.urljoin(url, location)
    if status != 200:
        raise RuntimeError("HTTP {}".format(status))
    if "gzip" in enc:
        raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    elif "deflate" in enc:
        raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    return raw.decode("utf-8", errors="replace"), None


def fetch(url, tries=3, timeout=25):
    """ページを文字列で取る。gzip/deflate と転送は自前で扱う(標準ライブラリだけで完結させる)。"""
    last = None
    for i in range(tries):
        try:
            target = url
            for _ in range(5):  # 転送は5回まで追う
                body, redirect = _get_once(target, timeout)
                if body is not None:
                    return body
                target = redirect
            raise RuntimeError("転送が多すぎる")
        except Exception as e:  # noqa: BLE001 - ネット失敗はまとめて握って再試行
            last = e
            if i < tries - 1:
                time.sleep(2 * (i + 1))
    raise RuntimeError("{} の取得に失敗: {}".format(url, last))


def strip_tags(s):
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s))


def read_index():
    with open(INDEX_PATH, encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- いま載っている号

def current_laundry_vol(index_html):
    """index.html の #laundry-grid が持つ最大の vol 番号。"""
    vols = [int(v) for v in re.findall(r"Laundry Day!! vol\.(\d+)", index_html)]
    return max(vols) if vols else None


def current_express_vol(index_html):
    """index.html の #books-grid が持つ最大の vol 番号。"""
    vols = [int(v) for v in re.findall(r"マーチングエクスプレス21 vol\.(\d+)", index_html)]
    return max(vols) if vols else None


# ---------------------------------------------------------------- 公式が出している号

def latest_laundry(page_html):
    """公式ページから最新号を読む。

    2種類の手掛かりを併用して、片方の表記が変わっても倒れないようにする:
        本文       「vol.10｜2025 / 9」
        webマガジン  https://masakiworks.com/laundryday/Vol10/
    """
    text = strip_tags(page_html)
    found = {}
    for m in re.finditer(r"vol\.\s*(\d+)\s*[｜|]\s*(\d{4})\s*/\s*(\d{1,2})", text, re.I):
        found[int(m.group(1))] = "{} / {}".format(m.group(2), m.group(3))
    for m in re.finditer(r"masakiworks\.com/laundryday/Vol0*(\d+)", page_html, re.I):
        found.setdefault(int(m.group(1)), "")
    if not found:
        raise RuntimeError("公式ページから vol 番号を読めなかった(ページ構造が変わった可能性)")
    vol = max(found)
    return {
        "vol": vol,
        "issued": found[vol],
        "url": "https://masakiworks.com/laundryday/Vol{:02d}/".format(vol),
    }


def latest_express(page_html):
    """Amazon の検索結果から最新の vol 番号を読む。

    商品名の表記が揺れる(「vol.27」「vol．26」「Vol.11【雑誌】」「マーチングエクスプレス 21」)ので
    全角ピリオド・空白・大小文字をまとめて許す。
    """
    text = strip_tags(page_html)
    if re.search(r"Enter the characters|自動化されたアクセス", text, re.I):
        raise RuntimeError("Amazon にロボット判定された(CAPTCHA)")
    vols = [
        int(m.group(1))
        for m in re.finditer(r"マーチングエクスプレス\s*21\s*vol[.．]?\s*(\d{1,3})", text, re.I)
    ]
    if not vols:
        raise RuntimeError("Amazon の検索結果から vol 番号を読めなかった")
    return {"vol": max(vols), "url": EXPRESS_SEARCH}


# ---------------------------------------------------------------- 本体

CHECKS = {
    "laundry": {
        "name": "Laundry Day!!",
        "source": LAUNDRY_OFFICIAL,
        "current": current_laundry_vol,
        "latest": latest_laundry,
        "cadence": "週1回",
        "note": "公式ページに「発行予定｜年2回［3月 / 9月］」とある",
    },
    "express": {
        "name": "マーチングエクスプレス21",
        "source": EXPRESS_SEARCH,
        "current": current_express_vol,
        "latest": latest_express,
        "cadence": "月1回",
        "note": "Amazon はデータセンターIPを弾くことがある。失敗したらこの実行は赤くなる",
    },
}


def run_check(key, index_html):
    conf = CHECKS[key]
    current = conf["current"](index_html)
    if current is None:
        return {"key": key, "name": conf["name"], "ok": False,
                "error": "index.html から現在の掲載号を読めなかった"}
    page = fetch(conf["source"])
    latest = conf["latest"](page)
    return {
        "key": key,
        "name": conf["name"],
        "ok": True,
        "current": current,
        "latest": latest["vol"],
        "issued": latest.get("issued", ""),
        "url": latest.get("url", conf["source"]),
        "source": conf["source"],
        "found": latest["vol"] > current,
    }


def issue_body(news):
    lines = ["メディアページに載っていない号を見つけました。", ""]
    for r in news:
        lines.append("## {} vol.{}".format(r["name"], r["latest"]))
        lines.append("")
        lines.append("| | |")
        lines.append("|---|---|")
        lines.append("| いま載っている | vol.{} |".format(r["current"]))
        lines.append("| 見つかった号 | **vol.{}**{} |".format(
            r["latest"], "（{}）".format(r["issued"]) if r["issued"] else ""))
        lines.append("| 号のページ | {} |".format(r["url"]))
        lines.append("| 調べた先 | {} |".format(r["source"]))
        lines.append("")
    lines += [
        "---",
        "",
        "## 載せるには",
        "",
        "表紙画像だけは自動で取れないので、手で足してください。",
        "",
        "1. 表紙画像を `images/webmagazine/volXX.jpg`（雑誌は `images/books/book-volXX.jpg`）に置く",
        "2. `index.html` の `#laundry-grid` / `#books-grid` の先頭にカードを1枚足す",
        "3. push（本番デプロイ）",
        "",
        "TOPの「新着メディア」は `#laundry-grid` の先頭2枚を読んでいるので、",
        "カードを足せばTOPにも自動で出ます。",
        "",
        "_このIssueは `.github/workflows/media-update-check.yml` が自動で立てました。_",
    ]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["all", "laundry", "express"], default="all")
    ap.add_argument("--json", action="store_true", help="機械可読で出す")
    ap.add_argument("--github-output", action="store_true",
                    help="$GITHUB_OUTPUT に found/issue_title を書き、Issue本文も生成する")
    args = ap.parse_args()

    keys = list(CHECKS) if args.target == "all" else [args.target]
    index_html = read_index()

    results = []
    for key in keys:
        try:
            results.append(run_check(key, index_html))
        except Exception as e:  # noqa: BLE001 - 取得/解析の失敗はまとめて結果に載せる
            results.append({"key": key, "name": CHECKS[key]["name"], "ok": False, "error": str(e)})

    news = [r for r in results if r.get("found")]
    failed = [r for r in results if not r.get("ok")]

    if args.json:
        print(json.dumps({"results": results, "found": bool(news)}, ensure_ascii=False, indent=2))
    else:
        for r in results:
            if not r.get("ok"):
                print("[{}] 調べられなかった: {}".format(r["name"], r["error"]), file=sys.stderr)
            elif r["found"]:
                print("[{}] ★新刊 vol.{}（いま載っているのは vol.{}） {}".format(
                    r["name"], r["latest"], r["current"], r["url"]))
            else:
                print("[{}] 変わりなし（vol.{}）".format(r["name"], r["current"]))

    if args.github_output:
        title = ""
        if news:
            title = "メディア更新: " + " / ".join(
                "{} vol.{}".format(r["name"], r["latest"]) for r in news)
            with open(ISSUE_BODY_PATH, "w", encoding="utf-8") as f:
                f.write(issue_body(news))
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a", encoding="utf-8") as f:
                f.write("found={}\n".format("true" if news else "false"))
                f.write("issue_title={}\n".format(title))

    # 1つでも調べられなかったら赤くする(黙って「変わりなし」に見えるのが一番まずい)
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
