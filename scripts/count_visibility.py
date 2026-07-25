#!/usr/bin/env python3
"""visibility を持たないレガシー文書を数える（read-only。書き込みは一切しない）

`backfill-visibility.mjs --dry-run` の Python 版。このMacには node が無い
（CLAUDE.md: Homebrew無し・システムPython完結）ため、Firestore REST API を直叩きする。
認証は firebase CLI のログイン情報を流用する。切れていたら `firebase projects:list` で更新。

mjs 版が見ていたのは event_log_diaries / moments の2つだけだが、
firestore.rules のフェイルオープンは実測11箇所あり、対象コレクションは5つある:
  event_log_diaries / moments / video_lists / channel_lists / mll_logs

集計方法について:
  Firestore には「フィールドが存在しない」を直接引くクエリが無い。
  COUNT 集約 + `!=` の差分で出す手もあるが、collection group の `!=` は
  COLLECTION_GROUP_ASC インデックスを要求されるため、件数が少ないうちは全件走査が確実。
  （2026-07-25 実測: 5コレクション合計118件。全件走査で十分）

使い方:
    python3 scripts/count_visibility.py
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

PROJECT = "marchinz-app"
QUERY_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents:runQuery"
CONFIGSTORE = pathlib.Path.home() / ".config" / "configstore" / "firebase-tools.json"

# firestore.rules で visibility フェイルオープンが効いていたコレクション（collection group）
COLLECTIONS = ["event_log_diaries", "moments", "video_lists", "channel_lists", "mll_logs"]


def access_token():
    if not CONFIGSTORE.exists():
        sys.exit("firebase CLI にログインしていません: `firebase login`")
    return json.loads(CONFIGSTORE.read_text())["tokens"]["access_token"]


def scan(collection, token):
    body = {"structuredQuery": {"from": [{"collectionId": collection, "allDescendants": True}]}}
    req = urllib.request.Request(
        QUERY_URL,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        rows = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        if e.code in (401, 403):
            sys.exit(f"認証エラー({e.code})。`firebase projects:list` でトークンを更新してください。\n{detail}")
        sys.exit(f"HTTP {e.code}: {detail}")
    docs = [r["document"] for r in rows if "document" in r]
    values, missing = {}, []
    for d in docs:
        fields = d.get("fields", {})
        if "visibility" not in fields:
            missing.append(d["name"].split("/documents/")[-1])
        else:
            v = fields["visibility"].get("stringValue", "<非文字列>")
            values[v] = values.get(v, 0) + 1
    return len(docs), values, missing


def main():
    token = access_token()
    total_missing = 0
    for collection in COLLECTIONS:
        n, values, missing = scan(collection, token)
        total_missing += len(missing)
        breakdown = " / ".join(f"{k}={v}" for k, v in sorted(values.items())) or "（なし）"
        print(f"{collection:20s} total={n:5d}  {breakdown}  visibility欠損={len(missing)}")
        for path in missing[:20]:
            print(f"    欠損: {path}")
        if len(missing) > 20:
            print(f"    ...他 {len(missing) - 20} 件")

    print()
    if total_missing == 0:
        print("欠損 0 件 → バックフィル不要。ルールはフェイルクローズのままで安全。")
    else:
        print(f"欠損 {total_missing} 件 → ルールをフェイルクローズにすると本人以外から見えなくなる。")
        print("バックフィルするなら安全側の 'private' で埋めること（公開のつもりだった保証がない）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
