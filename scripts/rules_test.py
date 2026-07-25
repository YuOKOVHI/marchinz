#!/usr/bin/env python3
"""firestore.rules のコンパイル検証＋挙動テスト（依存ゼロ・Python標準ライブラリのみ）

このMacには node が無い（CLAUDE.md: Homebrew無し）ため、公式の
@firebase/rules-unit-testing / エミュレータは使えない。代わりに
Firebase Rules API の `projects:test` を直叩きする。

  https://firebaserules.googleapis.com/v1/projects/{PROJ}:test

この API は **ルールセットを作らない・リリースもしない**。本番には一切触れない。
認証は firebase CLI のログイン情報を流用する（cloud-platform スコープを含む）。
アクセストークンが切れていたら `firebase projects:list` を一度叩けば更新される。

使い方:
    python3 scripts/rules_test.py

終了コード: 0=全合格 / 2=テスト失敗 / 1=実行不能（トークン切れ等）

変異テスト（mutation test）を必ず併走させる:
  「修正を戻したルール」で該当テストが FAILURE になることまで確認する。
  これが無いと、常に ALLOW を返すだけの無意味なテストでも緑になってしまう。
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

PROJECT = "marchinz-app"
RULES = pathlib.Path(__file__).resolve().parent.parent / "firebase" / "firestore.rules"
TEST_URL = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}:test"
CONFIGSTORE = pathlib.Path.home() / ".config" / "configstore" / "firebase-tools.json"

# F2 の修正内容。変異テストではこれを逆向きに置換して「穴の空いたルール」を作る。
FIXED = "(resource.data.keys().hasAny(['visibility']) && resource.data.visibility == 'public')"
FAIL_OPEN = "(!resource.data.keys().hasAny(['visibility']) || resource.data.visibility == 'public')"


def access_token():
    if not CONFIGSTORE.exists():
        sys.exit("firebase CLI にログインしていません: `firebase login`")
    return json.loads(CONFIGSTORE.read_text())["tokens"]["access_token"]


def case(name, path, expectation, data, auth=None):
    """1件のテストケース。data=None で『文書が存在しない』を表す。"""
    request = {"path": path, "method": "get"}
    if auth:
        request["auth"] = auth
    resource = {"__name__": path}
    if data is not None:
        resource["data"] = data
    return {
        "_name": name,
        "expectation": expectation,
        "request": request,
        "resource": resource,
        # get()/exists() は「退会も凍結もしていない普通のプロフィール」を返す。
        # ここを凍結ユーザーにすると別のルール（profileOwnerActiveForPublicContent）の
        # テストになってしまうので、F2 の検証としては健全側で固定する。
        "functionMocks": [
            {"function": "exists", "args": [{"anyValue": {}}], "result": {"value": True}},
            {
                "function": "get",
                "args": [{"anyValue": {}}],
                "result": {"value": {"data": {"withdrawn": False, "banned": False}}},
            },
        ],
    }


MOMENT = "/databases/(default)/documents/mll_profiles/u1/moments/m1"
DIARY = "/databases/(default)/documents/mll_profiles/u1/event_log_diaries/e1"
OWNER = {"uid": "u1"}
OTHER = {"uid": "u2"}

CASES = [
    # --- モーメント（collection group: 未ログインの第三者が一覧できる経路） ---
    case("公開モーメントは未ログインでも読める", MOMENT, "ALLOW", {"visibility": "public", "body": "x"}),
    case("非公開モーメントは未ログインでは読めない", MOMENT, "DENY", {"visibility": "private", "body": "x"}),
    case("★F2 visibility 無しのレガシーモーメントは読めない", MOMENT, "DENY", {"body": "x"}),
    case("非公開モーメントも本人は読める", MOMENT, "ALLOW", {"visibility": "private", "body": "x"}, OWNER),
    case("★F2 レガシーモーメントも本人は読める", MOMENT, "ALLOW", {"body": "x"}, OWNER),
    case("他人の非公開モーメントは読めない", MOMENT, "DENY", {"visibility": "private", "body": "x"}, OTHER),
    # --- Log日記 ---
    case("公開日記は未ログインでも読める", DIARY, "ALLOW", {"visibility": "public", "body": "x"}),
    case("非公開日記は未ログインでは読めない", DIARY, "DENY", {"visibility": "private", "body": "x"}),
    case("★F2 visibility 無しのレガシー日記は読めない", DIARY, "DENY", {"body": "x"}),
    case("★F2 レガシー日記も本人は読める", DIARY, "ALLOW", {"body": "x"}, OWNER),
]

# 変異テストで FAILURE に転じることを要求するケース（★印＝F2 が守っている境界）
MUTATION_MUST_FAIL = [i for i, c in enumerate(CASES) if c["_name"].startswith("★F2") and c["expectation"] == "DENY"]


def run(source, token):
    body = {
        "source": {"files": [{"name": "firestore.rules", "content": source}]},
        "testSuite": {"testCases": [{k: v for k, v in c.items() if k != "_name"} for c in CASES]},
    }
    req = urllib.request.Request(
        TEST_URL,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        out = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:500]
        if e.code in (401, 403):
            sys.exit(f"認証エラー({e.code})。`firebase projects:list` を一度実行してトークンを更新してください。\n{detail}")
        sys.exit(f"HTTP {e.code}: {detail}")
    errors = [i for i in out.get("issues", []) if i.get("severity") == "ERROR"]
    return errors, [t.get("state", "?") for t in out.get("testResults", [])]


def report(states):
    ok = True
    for c, state in zip(CASES, states):
        mark = "✅" if state == "SUCCESS" else "❌"
        print(f"  {mark} {state:8s} {c['_name']}")
        ok = ok and state == "SUCCESS"
    return ok


def main():
    token = access_token()
    source = RULES.read_text()

    print(f"=== {RULES.name} コンパイル + 挙動テスト ({len(CASES)}件) ===")
    errors, states = run(source, token)
    if errors:
        for e in errors[:10]:
            print("  ERROR", e.get("sourcePosition", {}).get("line"), e.get("description"))
        sys.exit(2)
    passed = report(states)

    print("\n=== 変異テスト: F2 の修正を戻したルールで落ちるか ===")
    if FIXED not in source:
        print("  ⚠️  修正済みパターンが見つからない。ルールが書き換わった可能性あり")
        sys.exit(2)
    _, mutated_states = run(source.replace(FIXED, FAIL_OPEN), token)
    detected = True
    for i in MUTATION_MUST_FAIL:
        state = mutated_states[i] if i < len(mutated_states) else "?"
        mark = "✅" if state == "FAILURE" else "❌"
        print(f"  {mark} 戻すと {state:8s} {CASES[i]['_name']}")
        detected = detected and state == "FAILURE"
    if not detected:
        print("  ⚠️  修正を戻してもテストが緑のまま＝このテストは穴を検知できていない")

    print()
    print("結果:", "全合格" if (passed and detected) else "失敗あり")
    sys.exit(0 if (passed and detected) else 2)


if __name__ == "__main__":
    main()
