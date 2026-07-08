#!/usr/bin/env python3
"""週間ダイジェスト生成(Gemini API)。

直近7日間の新着(YouTube最新動画+大会動画)を集め、Gemini APIで
トップページ「今週のマーチング」の紹介文を生成して digest.inline.js に書き出す。

- 必要環境変数: GEMINI_API_KEY(無い場合はスキップして正常終了)
- 失敗時: 既存の digest.inline.js を変更せず exit 0(サイト側は非表示のまま)
- 依存: 標準ライブラリのみ
"""

from __future__ import annotations

import csv
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_PATH = ROOT / "digest.inline.js"
YT_CSV = ROOT / "youtube-list" / "YouTubeリスト.csv"
DATA_JSON = ROOT / "data.json"

JST = timezone(timedelta(hours=9))
WINDOW_DAYS = 7
MAX_ITEMS = 30

GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"]
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

PROMPT_TEMPLATE = """あなたは日本のマーチング/カラーガードコミュニティサイト「MarchinZ(マーチンズ)」の編集者です。
以下は直近7日間に公開・更新された動画の一覧です。

{items}

この一覧をもとに、トップページに載せる「今週のマーチング」紹介文を日本語で書いてください。

条件:
- 2〜3文、全体で140字以内
- 一覧にある事実(チャンネル名・動画タイトル・団体名)だけに言及し、推測や誇張はしない
- コミュニティの読者がワクワクして動画を見たくなる、温かく元気なトーン
- 絵文字・ハッシュタグ・箇条書きは使わない
- 紹介文の本文だけを出力する(前置きや説明は不要)
"""


def parse_date(s: str):
    s = (s or "").strip().replace("/", "-")
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=JST)
    except ValueError:
        return None


def collect_recent_items() -> list[str]:
    cutoff = datetime.now(JST) - timedelta(days=WINDOW_DAYS)
    items: list[str] = []

    if YT_CSV.exists():
        with YT_CSV.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                d = parse_date(row.get("最新動画配信日", ""))
                if d and d >= cutoff:
                    items.append(
                        f"- [YouTube] {row.get('チャンネル名', '').strip()} / "
                        f"「{row.get('最新動画タイトル', '').strip()}」({d.strftime('%m/%d')})"
                    )

    if DATA_JSON.exists():
        data = json.loads(DATA_JSON.read_text(encoding="utf-8"))
        rows = data.get("rows", data) if isinstance(data, dict) else data
        seen = set()
        for row in rows:
            d = parse_date(row.get("配信日", ""))
            if not (d and d >= cutoff):
                continue
            key = (row.get("大会名", ""), row.get("配信日", ""))
            if key in seen:
                continue
            seen.add(key)
            items.append(
                f"- [大会動画] {row.get('団体/チーム名', '').strip()} / "
                f"「{row.get('大会名', '').strip()}」({d.strftime('%m/%d')})"
            )

    return items[:MAX_ITEMS]


def call_gemini(api_key: str, prompt: str) -> str:
    last_err: Exception | None = None
    for model in GEMINI_MODELS:
        try:
            req = urllib.request.Request(
                GEMINI_URL.format(model=model, key=api_key),
                data=json.dumps(
                    {
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 512},
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=60) as res:
                body = json.loads(res.read().decode("utf-8"))
            text = body["candidates"][0]["content"]["parts"][0]["text"].strip()
            if text:
                return text
        except Exception as err:  # noqa: BLE001 - どのモデルでも失敗したら上位でスキップ
            last_err = err
            print(f"[digest] {model} failed: {err}", file=sys.stderr)
    raise RuntimeError(f"all Gemini models failed: {last_err}")


def main() -> int:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("[digest] GEMINI_API_KEY 未設定のためスキップ")
        return 0

    items = collect_recent_items()
    if not items:
        print("[digest] 直近7日間の新着なし。既存ダイジェストを維持")
        return 0

    try:
        text = call_gemini(api_key, PROMPT_TEMPLATE.format(items="\n".join(items)))
    except Exception as err:  # noqa: BLE001
        print(f"[digest] 生成失敗のためスキップ: {err}", file=sys.stderr)
        return 0

    payload = {
        "text": text,
        "generated_at": datetime.now(JST).strftime("%Y-%m-%d %H:%M"),
        "item_count": len(items),
    }
    OUT_PATH.write_text(
        "window.__MARCHINZ_DIGEST = " + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"[digest] 生成OK ({len(items)}件 / {len(text)}字)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
