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
PROFILE_CREATE_FIXED = "            mllProfileCreateValuesOk(uid)"
PROFILE_CREATE_TOO_COMPLEX = "            mllProfileValuesOk(uid)"


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


def write_case(name, path, expectation, data, auth, exists_before=True):
    """create の request.resource を使い、実データを書かずに書込Rulesを評価する。"""
    uid = auth["uid"]
    profile_path = f"/databases/(default)/documents/mll_profiles/{uid}"
    privileged_path = f"/databases/(default)/documents/mll_privileged_uids/{uid}"
    target_uid = path.split("/mll_profiles/", 1)[1].split("/", 1)[0] if "/mll_profiles/" in path else uid
    event_id = path.rsplit("/", 1)[-1]
    attendance_path = f"/databases/(default)/documents/mll_calendar_events/{event_id}/attendees/{target_uid}"
    request = {
        "path": path,
        "method": "create",
        "auth": auth,
        "resource": {"data": data},
    }
    return {
        "_name": name,
        "expectation": expectation,
        "request": request,
        "functionMocks": [
            {
                "function": "exists",
                "args": [{"exactValue": privileged_path}],
                "result": {"value": False},
            },
            {
                "function": "exists",
                "args": [{"exactValue": profile_path}],
                "result": {"value": exists_before},
            },
            {
                "function": "exists",
                "args": [{"exactValue": attendance_path}],
                "result": {"value": True},
            },
            {
                "function": "get",
                "args": [{"exactValue": profile_path}],
                "result": {
                    "value": {
                        "data": {"withdrawn": False, "banned": False}
                    }
                },
            },
            {
                "function": "get",
                "args": [{"exactValue": attendance_path}],
                "result": {"value": {"data": {"style": "出演"}}},
            },
            {"function": "exists", "args": [{"anyValue": {}}], "result": {"value": False}},
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
PROFILE = "/databases/(default)/documents/mll_profiles/u1"
LOG = "/databases/(default)/documents/mll_logs/log1"

PROFILE_PAYLOAD = {
    "id": "u1",
    "display_name": "新規ユーザー",
    "avatar_url": "https://example.com/avatar.png",
    "marchinz_public_id": "101",
    # Rules REST API は RFC3339 文字列を protobuf Timestamp へ自動変換する。
    # 実アプリは Firestore SDK から文字列として保存するため、末尾 # で REST
    # テスト上も string を明示し、Rules の文字列型条件を正しく評価する。
    "created_at": "2026-08-09T00:00:00.000Z#",
    "updated_at": "2026-08-09T00:00:00.000Z#",
    "legal_policy_accepted_version": "2026-08-07-v2",
    # REST API側で Timestamp として評価されるRFC3339値（実アプリのserverTimestamp相当）。
    "legal_policy_accepted_at": "2026-08-09T00:00:00.000Z",
    "b_test_opt_in": True,
    "b_test_opt_in_at": "2026-08-09T00:00:00.000Z#",
    "b_test_consent_version": "2026-08-07-v1",
    "b_test_prompt_dismissed_at": "",
}
LOG_PAYLOAD = {
    "user_id": "u1",
    "visibility": "public",
    "section_vis_mll": "public",
}
DIARY_PAYLOAD = {
    "body": "本番の記録",
    "visibility": "public",
    "photo_urls": [],
    "note_title": "本番の記録",
    "event_title": "大会",
    "event_date": "2026-08-09",
    "participation_style": "出演",
    "created_at": "2026-08-09T00:00:00.000Z#",
    "updated_at": "2026-08-09T00:00:00.000Z#",
}
MOMENT_PAYLOAD = {
    "body": "マーチングの雑談",
    "visibility": "public",
    "photo_urls": [],
    "created_at": "2026-08-09T00:00:00.000Z#",
    "updated_at": "2026-08-09T00:00:00.000Z#",
}

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
    # --- 主要4保存経路（request.resourceで評価。本番データは書かない） ---
    write_case("新規プロフィールは本人が作成できる", PROFILE, "ALLOW", PROFILE_PAYLOAD, OWNER, exists_before=False),
    write_case("他人の新規プロフィールは作成できない", PROFILE, "DENY", PROFILE_PAYLOAD, OTHER, exists_before=False),
    write_case("Logは本人が作成できる", LOG, "ALLOW", LOG_PAYLOAD, OWNER),
    write_case("他人名義のLogは作成できない", LOG, "DENY", LOG_PAYLOAD, OTHER),
    write_case("参加済みイベントのNoteは本人が作成できる", DIARY, "ALLOW", DIARY_PAYLOAD, OWNER),
    write_case("他人のNoteは作成できない", DIARY, "DENY", DIARY_PAYLOAD, OTHER),
    write_case("公開Momentは本人が作成できる", MOMENT, "ALLOW", MOMENT_PAYLOAD, OWNER),
    write_case("他人名義のMomentは作成できない", MOMENT, "DENY", MOMENT_PAYLOAD, OTHER),
]

# 変異テストで FAILURE に転じることを要求するケース（★印＝F2 が守っている境界）
MUTATION_MUST_FAIL = [i for i, c in enumerate(CASES) if c["_name"].startswith("★F2") and c["expectation"] == "DENY"]
PROFILE_CREATE_CASE = next(i for i, c in enumerate(CASES) if c["_name"] == "新規プロフィールは本人が作成できる")


def run(source, token):
    body = {
        "source": {"files": [{"name": "firestore.rules", "content": source}]},
        "testSuite": {"testCases": [
            {
                **{k: v for k, v in c.items() if k != "_name"},
                **({"expressionReportLevel": "FULL"} if os.environ.get("MZ_RULES_DEBUG") == "1" else {}),
            }
            for c in CASES
        ]},
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
    results = out.get("testResults", [])
    return errors, [t.get("state", "?") for t in results], results


def report(states, results):
    def walk_reports(nodes):
        for node in nodes or []:
            yield node
            yield from walk_reports(node.get("children", []))

    ok = True
    for i, c in enumerate(CASES):
        state = states[i] if i < len(states) else "MISSING"
        mark = "✅" if state == "SUCCESS" else "❌"
        print(f"  {mark} {state:8s} {c['_name']}")
        if state != "SUCCESS" and i < len(results):
            detail = results[i]
            for message in detail.get("debugMessages", [])[:3]:
                print(f"      debug: {message}")
            if detail.get("errorPosition"):
                print(f"      at: {detail['errorPosition']}")
            if os.environ.get("MZ_RULES_DEBUG") == "1":
                nearby = []
                for node in walk_reports(detail.get("expressionReports", [])):
                    pos = node.get("sourcePosition", {})
                    line = pos.get("line", 0)
                    if 430 <= line <= 690 or 1338 <= line <= 1420 or 1770 <= line <= 1910:
                        nearby.append((line, pos.get("column"), node.get("value", "<none>")))
                print("      nearby:", nearby[-120:])
        ok = ok and state == "SUCCESS"
    return ok


def main():
    token = access_token()
    source = RULES.read_text()

    print(f"=== {RULES.name} コンパイル + 挙動テスト ({len(CASES)}件) ===")
    errors, states, results = run(source, token)
    if errors:
        for e in errors[:10]:
            print("  ERROR", e.get("sourcePosition", {}).get("line"), e.get("description"))
        sys.exit(2)
    complete = len(results) == len(CASES) and len(states) == len(CASES)
    if not complete:
        print(f"  ❌ Rules APIの結果件数が不足: expected={len(CASES)} results={len(results)} states={len(states)}")
    passed = complete and report(states, results)

    print("\n=== 変異テスト: F2 の修正を戻したルールで落ちるか ===")
    if FIXED not in source:
        print("  ⚠️  修正済みパターンが見つからない。ルールが書き換わった可能性あり")
        sys.exit(2)
    mutated_errors, mutated_states, mutated_results = run(source.replace(FIXED, FAIL_OPEN), token)
    mutation_complete = not mutated_errors and len(mutated_results) == len(CASES) and len(mutated_states) == len(CASES)
    if not mutation_complete:
        print(
            f"  ❌ 変異結果が不完全: errors={len(mutated_errors)} "
            f"expected={len(CASES)} results={len(mutated_results)} states={len(mutated_states)}"
        )
    detected = mutation_complete
    for i in MUTATION_MUST_FAIL:
        state = mutated_states[i] if i < len(mutated_states) else "?"
        mark = "✅" if state == "FAILURE" else "❌"
        print(f"  {mark} 戻すと {state:8s} {CASES[i]['_name']}")
        detected = detected and state == "FAILURE"
    if not detected:
        print("  ⚠️  修正を戻してもテストが緑のまま＝このテストは穴を検知できていない")

    print("\n=== 変異テスト: 新規登録を旧バリデータへ戻すと式上限を検知するか ===")
    if PROFILE_CREATE_FIXED not in source:
        print("  ⚠️  新規登録専用バリデータの呼び出しが見つからない")
        sys.exit(2)
    profile_mutated_errors, profile_mutated_states, profile_mutated_results = run(
        source.replace(PROFILE_CREATE_FIXED, PROFILE_CREATE_TOO_COMPLEX, 1), token
    )
    profile_mutation_complete = (
        not profile_mutated_errors
        and len(profile_mutated_results) == len(CASES)
        and len(profile_mutated_states) == len(CASES)
    )
    profile_mutated_state = (
        profile_mutated_states[PROFILE_CREATE_CASE]
        if PROFILE_CREATE_CASE < len(profile_mutated_states)
        else "MISSING"
    )
    profile_mutation_detected = profile_mutation_complete and profile_mutated_state == "FAILURE"
    print(
        "  " + ("✅" if profile_mutation_detected else "❌")
        + f" 旧式へ戻すと {profile_mutated_state:8s} 新規プロフィールは本人が作成できる"
    )

    print()
    all_ok = passed and detected and profile_mutation_detected
    print("結果:", "全合格" if all_ok else "失敗あり")
    sys.exit(0 if all_ok else 2)


if __name__ == "__main__":
    main()
