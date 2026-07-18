#!/usr/bin/env python3
"""スポンサー提供用 統計レポート書き出し(Firestore 読み取り専用)

目的:
    楽器台帳(base_instruments)と練習ログ(base_practice_logs)から、
    「特定の個人を識別できない統計」(プライバシーポリシー第4項)に加工した
    レポートを作る。提携パートナー(楽器メーカー等)へ渡せる形にするのがゴール。

設計方針:
    - Firestore へ一切書き込まない。firestore.rules の変更も firebase deploy も不要。
    - 生データはこの端末から出さない。書き出すのは集計済みの数値のみ。
    - k-匿名性: 人数が K 未満のマス目は伏せる(既定 K=5)。クロス集計は 2 軸まで。
    - メーカー/種類は自由記述入力のため、集計時に表記ゆれを正規化する。
      辞書は --audit で実データを見ながら育てる(読み取り専用なので何度でも再実行できる)。

事前準備:
    Firebase コンソール → プロジェクトの設定 → サービスアカウント
    → 「新しい秘密鍵の生成」で JSON を取得し、パスを渡す。
        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
    もしくは scripts/.local-env に同名で記載、または --credentials= で直接指定。

実行:
    .venv/bin/python export_sponsor_stats.py --self-test   # 認証不要・集計ロジックの検証
    .venv/bin/python export_sponsor_stats.py --audit       # 表記ゆれの確認(社外秘・辞書調整用)
    .venv/bin/python export_sponsor_stats.py               # 集計サマリーを表示
    .venv/bin/python export_sponsor_stats.py --report      # JSON も書き出す
    .venv/bin/python export_sponsor_stats.py --k=10        # k-匿名性の閾値を上げる
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import warnings
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# google-cloud-firestore が Python 3.9 EOL の FutureWarning を大量に出すため抑制
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*OpenSSL.*")

ROOT = Path(__file__).resolve().parent
DEFAULT_PROJECT_ID = "marchinz-app"
DEFAULT_K = 5
PREVIEW_LINES = 20
# scripts/reports/ は .gitignore 済み。レポートは既定でここへ置く
DEFAULT_REPORT_DIR = ROOT / "scripts" / "reports"


# ───────────────────────────────────────────────────────────────
# 表記ゆれの正規化辞書
# キーが正式表記、値がそこへ寄せる別名。小文字化・記号/空白除去して照合する。
# --audit の「辞書に未登録」出力を見て、拾えていない表記をここへ足していく。
# ───────────────────────────────────────────────────────────────
MAKER_ALIASES = {
    "YAMAHA": ["yamaha", "ヤマハ", "やまは", "ヤマハ株式会社", "yamahacorporation"],
    "Bach": ["bach", "バック", "ヴィンセントバック", "ビンセントバック", "vincentbach"],
    "Pearl": ["pearl", "パール", "pearldrums", "パールドラム"],
    "Jupiter": ["jupiter", "ジュピター"],
    "XO": ["xo", "エックスオー"],
    "Selmer": ["selmer", "セルマー", "henriselmer", "アンリセルマー"],
    "Buffet Crampon": ["buffetcrampon", "buffet", "クランポン", "ビュッフェクランポン"],
    "Yanagisawa": ["yanagisawa", "ヤナギサワ", "柳沢", "柳澤"],
    "Getzen": ["getzen", "ゲッツェン"],
    "Conn": ["conn", "コーン", "connselmer", "コーンセルマー"],
    "King": ["king", "キング"],
    "Besson": ["besson", "ベッソン"],
    "Courtois": ["courtois", "クルトワ", "antoinecourtois"],
    "Schilke": ["schilke", "シルキー"],
    "Stomvi": ["stomvi", "ストンビ"],
    "Miraphone": ["miraphone", "ミラフォン"],
    "Willson": ["willson", "ウィルソン"],
    "Adams": ["adams", "アダムス"],
    "Eastman": ["eastman", "イーストマン"],
    "Ludwig": ["ludwig", "ラディック", "ラディッグ"],
    "Tama": ["tama", "タマ", "星野楽器"],
    "Mapex": ["mapex", "メイペックス", "マペックス"],
    "Zildjian": ["zildjian", "ジルジャン"],
    "Sabian": ["sabian", "セイビアン", "サビアン"],
    "Vic Firth": ["vicfirth", "ビックファース", "ヴィックファース"],
    "Dynasty": ["dynasty", "ダイナスティ"],
    "System Blue": ["systemblue", "システムブルー"],
    "Majestic": ["majestic", "マジェスティック"],
    "Musser": ["musser", "マッサー"],
    "Bergerault": ["bergerault", "ベルジェロー"],
}

# 楽器の「種類」自由記述 → 大分類
TYPE_ALIASES = {
    "金管": [
        "金管", "金管楽器", "brass", "ブラス", "トランペット", "trumpet", "トロンボーン",
        "trombone", "ホルン", "horn", "ユーフォニアム", "euphonium", "チューバ", "tuba",
        "バリトン", "baritone", "メロフォン", "mellophone", "スーザフォン", "sousaphone",
        "コルネット", "cornet",
    ],
    "木管": [
        "木管", "木管楽器", "woodwind", "フルート", "flute", "クラリネット", "clarinet",
        "サックス", "sax", "saxophone", "サクソフォン", "オーボエ", "oboe", "ファゴット",
        "bassoon", "ピッコロ", "piccolo",
    ],
    "打楽器": [
        "打楽器", "パーカッション", "percussion", "ドラム", "drum", "drums", "スネア",
        "snare", "バスドラム", "bassdrum", "テナー", "tenor", "シンバル", "cymbal",
        "マリンバ", "marimba", "ビブラフォン", "vibraphone", "ティンパニ", "timpani",
        "ピット", "pit", "バッテリー", "battery",
    ],
    "カラーガード": [
        "カラーガード", "colorguard", "colourguard", "ガード", "フラッグ", "flag",
        "ライフル", "rifle", "セイバー", "sabre", "saber",
    ],
}

_STRIP_RE = re.compile(r"[\s　.,\-_/()（）「」『』・･\"'`]")


def norm_key(s) -> str:
    """照合キー: 小文字化 + 空白/記号/中黒 を除去"""
    return _STRIP_RE.sub("", str(s or "").strip().lower())


def build_lookup(dictionary):
    """別名 → 正式表記 の対応表を作る(挿入順を保つ)"""
    lookup = {}
    for canonical, aliases in dictionary.items():
        lookup.setdefault(norm_key(canonical), canonical)
        for alias in aliases:
            lookup.setdefault(norm_key(alias), canonical)
    return lookup


MAKER_LOOKUP = build_lookup(MAKER_ALIASES)
TYPE_LOOKUP = build_lookup(TYPE_ALIASES)


def canonicalize(raw, lookup) -> str:
    """完全一致 → 部分一致(型番付きの表記に対応)の順で正式表記へ寄せる。

    例: 「Bach 180ML」→ Bach、「トランペット(金管)」→ 金管
    2文字以下の別名(XO 等)は誤爆を避けるため部分一致に使わない。
    """
    key = norm_key(raw)
    if not key:
        return ""
    exact = lookup.get(key)
    if exact:
        return exact
    for alias, canonical in lookup.items():
        if len(alias) >= 3 and alias in key:
            return canonical
    return ""


# ───────────────────────────────────────────────────────────────
# 集計(Firestore に依存しない純粋関数。--self-test で検証する)
# ───────────────────────────────────────────────────────────────


def anonymize_breakdown(users_by_key, count_by_key, k):
    """人数が k 未満のマス目を伏せた内訳を返す"""
    kept = []
    suppressed_users = set()
    suppressed_count = 0
    suppressed_cells = 0

    for label, users in users_by_key.items():
        count = count_by_key.get(label, 0)
        if len(users) >= k:
            kept.append({"label": label, "users": len(users), "count": count})
        else:
            suppressed_cells += 1
            suppressed_count += count
            suppressed_users |= users

    kept.sort(key=lambda x: (-x["users"], -x["count"], x["label"]))
    suppressed = None
    if suppressed_cells:
        suppressed = {
            "cells": suppressed_cells,
            "users": len(suppressed_users),
            "count": suppressed_count,
            "note": f"人数 {k} 未満のため個別表示を伏せた項目",
        }
    return {"items": kept, "suppressed": suppressed}


def bucketize(values, edges, label_for):
    """数値の並び → 区間ごとの度数"""
    result = {label_for(e): 0 for e in edges}
    for v in values:
        chosen = edges[-1]
        for i, e in enumerate(edges):
            nxt = edges[i + 1] if i + 1 < len(edges) else None
            if nxt is None or v < nxt:
                chosen = e
                break
        result[label_for(chosen)] += 1
    return result


MIN_EDGES = [0, 60, 180, 360, 600, 1200]
INST_EDGES = [1, 2, 3, 5]


def _minutes_label(e):
    i = MIN_EDGES.index(e)
    nxt = MIN_EDGES[i + 1] if i + 1 < len(MIN_EDGES) else None
    return f"{e}分以上" if nxt is None else f"{e}〜{nxt - 1}分"


def _inst_label(e):
    i = INST_EDGES.index(e)
    nxt = INST_EDGES[i + 1] if i + 1 < len(INST_EDGES) else None
    if nxt is None:
        return f"{e}本以上"
    return f"{e}本" if nxt - 1 == e else f"{e}〜{nxt - 1}本"


def build_report(instruments, practices, k, project_id=DEFAULT_PROJECT_ID):
    """(uid, data) の並び → k-匿名化済みレポート辞書

    instruments / practices はいずれも [(uid, dict), ...] の形。
    """
    instrument_users = {uid for uid, _ in instruments}
    practice_users = {uid for uid, _ in practices}
    all_users = instrument_users | practice_users

    maker_users, maker_count = defaultdict(set), defaultdict(int)
    type_users, type_count = defaultdict(set), defaultdict(int)
    cross_users, cross_count = defaultdict(set), defaultdict(int)
    maint_users, maint_count = defaultdict(set), defaultdict(int)
    inst_per_user = defaultdict(int)

    maker_unknown = 0
    type_unknown = 0

    for uid, data in instruments:
        inst_per_user[uid] += 1

        raw_maker = str(data.get("maker") or "").strip()
        raw_type = str(data.get("type") or "").strip()
        maker = canonicalize(raw_maker, MAKER_LOOKUP)
        type_ = canonicalize(raw_type, TYPE_LOOKUP)
        if raw_maker and not maker:
            maker_unknown += 1
        if raw_type and not type_:
            type_unknown += 1

        if maker:
            maker_users[maker].add(uid)
            maker_count[maker] += 1
        if type_:
            type_users[type_].add(uid)
            type_count[type_] += 1
        if maker and type_:
            key = f"{type_} × {maker}"
            cross_users[key].add(uid)
            cross_count[key] += 1

        log = data.get("maintenance_log")
        if isinstance(log, list):
            for entry in log:
                if not isinstance(entry, dict):
                    continue
                kind = str(entry.get("kind") or "").strip()
                if kind:
                    maint_users[kind].add(uid)
                    maint_count[kind] += 1

    tag_users, tag_count = defaultdict(set), defaultdict(int)
    cond_users, cond_count = defaultdict(set), defaultdict(int)
    minutes_by_user_month = defaultdict(int)

    for uid, data in practices:
        tags = data.get("tags")
        if isinstance(tags, list):
            for t in tags:
                tag = str(t or "").strip()
                if tag:
                    tag_users[tag].add(uid)
                    tag_count[tag] += 1

        cond = str(data.get("condition") or "").strip()
        if cond:
            cond_users[cond].add(uid)
            cond_count[cond] += 1

        minutes = data.get("minutes")
        minutes = int(minutes) if isinstance(minutes, (int, float)) else 0
        month = str(data.get("date") or "")[:7]
        if len(month) == 7:
            minutes_by_user_month[f"{uid}__{month}"] += minutes

    report = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "project_id": project_id,
            "k_anonymity": k,
            "policy": (
                "個人が特定される状態での提供は行わない。"
                "人数が k 未満のマス目は伏せ、クロス集計は 2 軸までに限定している。"
            ),
            "basis": "MarchinZ 利用者のうち、楽器台帳または練習ログを登録した方の集計",
        },
        "summary": {
            "users_total": len(all_users),
            "users_with_instruments": len(instrument_users),
            "users_with_practice_logs": len(practice_users),
            "instruments_total": len(instruments),
            "practice_logs_total": len(practices),
        },
        "instruments": {
            "by_maker": anonymize_breakdown(maker_users, maker_count, k),
            "by_type": anonymize_breakdown(type_users, type_count, k),
            "by_type_and_maker": anonymize_breakdown(cross_users, cross_count, k),
            "per_user_distribution": bucketize(
                list(inst_per_user.values()), INST_EDGES, _inst_label
            ),
            "unclassified": {
                "maker_entries": maker_unknown,
                "type_entries": type_unknown,
                "note": "辞書に無い表記。--audit で確認し辞書へ追加できる",
            },
        },
        "maintenance": {"by_kind": anonymize_breakdown(maint_users, maint_count, k)},
        "practice": {
            "by_tag": anonymize_breakdown(tag_users, tag_count, k),
            "by_condition": anonymize_breakdown(cond_users, cond_count, k),
            "monthly_minutes_distribution": bucketize(
                list(minutes_by_user_month.values()), MIN_EDGES, _minutes_label
            ),
            "note": "monthly_minutes_distribution は「1人の1ヶ月あたり合計練習分数」の分布(人月単位)",
        },
    }

    # 全体人数が k 未満なら、そもそも統計として外部提供できない
    if len(all_users) < k:
        report["_meta"]["withheld"] = "対象者数が k 未満のため、提供不可"

    return report


# ───────────────────────────────────────────────────────────────
# Firestore 読み取り
# ───────────────────────────────────────────────────────────────


def load_local_env():
    """scripts/.local-env(gitignore 済み)から環境変数を読む"""
    p = ROOT / "scripts" / ".local-env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.strip())
        if not m:
            continue
        val = m.group(2).strip().strip('"').strip("'")
        os.environ.setdefault(m.group(1), val)


def resolve_credentials(explicit=""):
    """サービスアカウント JSON のパスを決める。無ければ None"""
    for cand in (
        explicit,
        os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", ""),
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", ""),
    ):
        if cand and Path(cand).expanduser().exists():
            return str(Path(cand).expanduser())
    return None


def fetch_groups(project_id, credentials_path):
    """collection group で全ユーザー分を読む。uid は親ドキュメント ID"""
    from google.cloud import firestore

    if credentials_path:
        client = firestore.Client.from_service_account_json(
            credentials_path, project=project_id
        )
    else:
        client = firestore.Client(project=project_id)

    def load(name):
        rows = []
        for doc in client.collection_group(name).stream():
            parent = doc.reference.parent.parent
            if parent is None:
                continue
            rows.append((parent.id, doc.to_dict() or {}))
        return rows

    return load("base_instruments"), load("base_practice_logs")


# ───────────────────────────────────────────────────────────────
# 出力
# ───────────────────────────────────────────────────────────────


def pct(n, total):
    return round(n / total * 1000) / 10 if total else 0.0


def print_section(title, breakdown, total):
    print(f"\n── {title} ──")
    if not breakdown["items"]:
        print("  (k-匿名性の閾値を満たす項目なし)")
    for it in breakdown["items"][:PREVIEW_LINES]:
        label = it["label"].ljust(22)
        print(f"  {label} {it['users']:>5}人  {pct(it['users'], total):>5}%")
    if len(breakdown["items"]) > PREVIEW_LINES:
        print(f"  ... 他 {len(breakdown['items']) - PREVIEW_LINES} 項目")
    if breakdown["suppressed"]:
        s = breakdown["suppressed"]
        print(f"  [伏せた項目 {s['cells']}件 / 実人数 {s['users']}人 — k 未満のため]")


def print_summary(report):
    s = report["summary"]
    print("\n── 概況 ──")
    print(f"  対象者                 {s['users_total']}人")
    print(f"  楽器を登録した人       {s['users_with_instruments']}人 / 台数 {s['instruments_total']}")
    print(f"  練習ログを付けた人     {s['users_with_practice_logs']}人 / 件数 {s['practice_logs_total']}")

    inst_total = s["users_with_instruments"]
    prac_total = s["users_with_practice_logs"]
    print_section("楽器メーカー別(人数)", report["instruments"]["by_maker"], inst_total)
    print_section("楽器の種類別(人数)", report["instruments"]["by_type"], inst_total)
    print_section("種類×メーカー(人数)", report["instruments"]["by_type_and_maker"], inst_total)
    print_section("メンテナンス種別(人数)", report["maintenance"]["by_kind"], inst_total)
    print_section("練習タグ別(人数)", report["practice"]["by_tag"], prac_total)

    print("\n── 1人あたりの月間練習量の分布(人月) ──")
    for label, n in report["practice"]["monthly_minutes_distribution"].items():
        print(f"  {label.ljust(22)} {n:>5}")

    unclassified = report["instruments"]["unclassified"]
    if unclassified["maker_entries"] or unclassified["type_entries"]:
        print(
            f"\n[stats] 辞書未登録: メーカー {unclassified['maker_entries']}件 / "
            f"種類 {unclassified['type_entries']}件 → --audit で確認できます"
        )
    if report["_meta"].get("withheld"):
        print(f"\n[stats] ⚠ {report['_meta']['withheld']}")


def run_audit(instruments, report_path):
    """表記ゆれ監査(社外秘・辞書調整用)"""
    raw_makers, raw_types = defaultdict(int), defaultdict(int)
    unmatched_makers, unmatched_types = defaultdict(int), defaultdict(int)

    for _uid, data in instruments:
        maker = str(data.get("maker") or "").strip()
        type_ = str(data.get("type") or "").strip()
        if maker:
            raw_makers[maker] += 1
            if not canonicalize(maker, MAKER_LOOKUP):
                unmatched_makers[maker] += 1
        if type_:
            raw_types[type_] += 1
            if not canonicalize(type_, TYPE_LOOKUP):
                unmatched_types[type_] += 1

    def dump(counter, title):
        rows = sorted(counter.items(), key=lambda kv: -kv[1])
        print(f"\n── {title} ({len(rows)}種) ──")
        for name, n in rows[:60]:
            print(f"  {n:>4}  {name}")
        if len(rows) > 60:
            print(f"  ... 他 {len(rows) - 60} 種")
        return rows

    dump(raw_makers, "メーカー 生の表記")
    um = dump(unmatched_makers, "★辞書に未登録のメーカー表記(要追加)")
    dump(raw_types, "種類 生の表記")
    ut = dump(unmatched_types, "★辞書に未登録の種類表記(要追加)")

    if report_path:
        payload = {
            "_warning": "社外秘。生の入力表記を含むため、パートナーへは渡さないこと。辞書調整専用。",
            "at": datetime.now(timezone.utc).isoformat(),
            "unmatched_makers": dict(um),
            "unmatched_types": dict(ut),
        }
        Path(report_path).parent.mkdir(parents=True, exist_ok=True)
        Path(report_path).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"\n[stats] 監査ファイル: {report_path}(社外秘)")

    print("\n[stats] 監査モード完了。MAKER_ALIASES / TYPE_ALIASES に未登録表記を足して再実行してください。")


# ───────────────────────────────────────────────────────────────
# 自己検証(認証不要)
# ───────────────────────────────────────────────────────────────


def self_test():
    """合成データで集計ロジックを検証する。Firestore へは接続しない。"""
    # 正規化
    assert canonicalize("ヤマハ", MAKER_LOOKUP) == "YAMAHA"
    assert canonicalize("YAMAHA", MAKER_LOOKUP) == "YAMAHA"
    assert canonicalize("yamaha ", MAKER_LOOKUP) == "YAMAHA"
    assert canonicalize("Yamaha YEP-201", MAKER_LOOKUP) == "YAMAHA", "型番付きも寄せる"
    assert canonicalize("Bach 180ML", MAKER_LOOKUP) == "Bach"
    assert canonicalize("パール", MAKER_LOOKUP) == "Pearl"
    assert canonicalize("聞いたことない楽器店", MAKER_LOOKUP) == "", "未知は空"
    assert canonicalize("", MAKER_LOOKUP) == ""
    assert canonicalize("トランペット", TYPE_LOOKUP) == "金管"
    assert canonicalize("Trumpet", TYPE_LOOKUP) == "金管"
    assert canonicalize("カラーガード", TYPE_LOOKUP) == "カラーガード"
    assert canonicalize("スネア", TYPE_LOOKUP) == "打楽器"

    # 区間分け
    b = bucketize([0, 59, 60, 179, 180, 1199, 1200, 5000], MIN_EDGES, _minutes_label)
    assert b["0〜59分"] == 2, b
    assert b["60〜179分"] == 2, b
    assert b["180〜359分"] == 1, b
    assert b["600〜1199分"] == 1, b
    assert b["1200分以上"] == 2, b
    i = bucketize([1, 1, 2, 3, 4, 5, 9], INST_EDGES, _inst_label)
    assert i["1本"] == 2 and i["2本"] == 1 and i["3〜4本"] == 2 and i["5本以上"] == 2, i

    # k-匿名性: 5人のマス目は残り、4人のマス目は伏せられる
    users = {"多数派": {f"u{n}" for n in range(5)}, "少数派": {"x1", "x2", "x3", "x4"}}
    counts = {"多数派": 12, "少数派": 4}
    out = anonymize_breakdown(users, counts, 5)
    assert [it["label"] for it in out["items"]] == ["多数派"], out
    assert out["suppressed"]["cells"] == 1 and out["suppressed"]["users"] == 4, out

    out_k1 = anonymize_breakdown(users, counts, 1)
    assert len(out_k1["items"]) == 2 and out_k1["suppressed"] is None

    # レポート全体
    instruments = []
    for n in range(6):  # YAMAHA の金管を 6 人
        instruments.append((f"u{n}", {"maker": "ヤマハ", "type": "トランペット",
                                      "maintenance_log": [{"date": "2026-07-01", "kind": "オイル差し"}]}))
    for n in range(2):  # Bach は 2 人だけ → 伏せられるはず
        instruments.append((f"b{n}", {"maker": "Bach 180ML", "type": "trumpet", "maintenance_log": []}))
    instruments.append(("u0", {"maker": "Pearl", "type": "スネア", "maintenance_log": []}))  # 2本目

    practices = []
    for n in range(6):
        practices.append((f"u{n}", {"date": "2026-07-01", "tags": ["基礎", "曲"], "minutes": 90,
                                    "condition": "good"}))
        practices.append((f"u{n}", {"date": "2026-07-02", "tags": ["基礎"], "minutes": 120,
                                    "condition": "good"}))

    rep = build_report(instruments, practices, k=5, project_id="test")

    assert rep["summary"]["users_total"] == 8, rep["summary"]
    assert rep["summary"]["users_with_instruments"] == 8
    assert rep["summary"]["instruments_total"] == 9
    assert rep["summary"]["practice_logs_total"] == 12

    makers = {it["label"]: it for it in rep["instruments"]["by_maker"]["items"]}
    assert "YAMAHA" in makers and makers["YAMAHA"]["users"] == 6, makers
    assert "Bach" not in makers, "2人しかいない Bach は伏せられるべき"
    assert "Pearl" not in makers, "1人しかいない Pearl は伏せられるべき"
    assert rep["instruments"]["by_maker"]["suppressed"]["cells"] == 2

    # 種類は金管が 8人(YAMAHA 6 + Bach 2)なので残る
    types = {it["label"]: it for it in rep["instruments"]["by_type"]["items"]}
    assert types["金管"]["users"] == 8, types

    # クロス集計: 金管×YAMAHA は 6人で残る
    cross = {it["label"]: it for it in rep["instruments"]["by_type_and_maker"]["items"]}
    assert cross["金管 × YAMAHA"]["users"] == 6, cross

    # メンテ: オイル差しが 6人
    maint = {it["label"]: it for it in rep["maintenance"]["by_kind"]["items"]}
    assert maint["オイル差し"]["users"] == 6, maint

    # 練習: 1人1ヶ月あたり 210分 が 6人月 → 180〜359分 に 6
    assert rep["practice"]["monthly_minutes_distribution"]["180〜359分"] == 6, rep["practice"]

    # 保有台数: u0 が 2本、他 7人が 1本
    assert rep["instruments"]["per_user_distribution"]["1本"] == 7
    assert rep["instruments"]["per_user_distribution"]["2本"] == 1

    # 未分類の計上
    dirty = [("z1", {"maker": "謎メーカー", "type": "謎ジャンル", "maintenance_log": []})]
    rep2 = build_report(dirty, [], k=5)
    assert rep2["instruments"]["unclassified"]["maker_entries"] == 1
    assert rep2["instruments"]["unclassified"]["type_entries"] == 1
    assert rep2["_meta"]["withheld"], "対象者 1人なら提供不可の印が付く"

    print("[self-test] 全 assertion 通過。集計・正規化・k-匿名化のロジックは期待どおりです。")


# ───────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="スポンサー提供用 統計レポート(Firestore 読み取り専用)"
    )
    parser.add_argument("--self-test", action="store_true", help="認証不要。集計ロジックを検証する")
    parser.add_argument("--audit", action="store_true", help="表記ゆれを確認する(社外秘・辞書調整用)")
    parser.add_argument("--k", type=int, default=DEFAULT_K, help=f"k-匿名性の閾値(既定 {DEFAULT_K})")
    parser.add_argument("--report", nargs="?", const="__default__", default="",
                        help="JSON を書き出す。パス省略時は scripts/reports/ へ")
    parser.add_argument("--credentials", default="", help="サービスアカウント JSON のパス")
    parser.add_argument("--project", default="", help=f"Firebase プロジェクト ID(既定 {DEFAULT_PROJECT_ID})")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return

    load_local_env()
    project_id = args.project or os.environ.get("FIREBASE_PROJECT_ID") or DEFAULT_PROJECT_ID
    credentials_path = resolve_credentials(args.credentials)

    if not credentials_path:
        print(
            "[stats] サービスアカウント JSON が見つかりません。\n"
            "        Firebase コンソール → プロジェクトの設定 → サービスアカウント\n"
            "        → 「新しい秘密鍵の生成」で JSON を取得し、次のいずれかで渡してください:\n"
            "          --credentials=/path/to/serviceAccount.json\n"
            "          export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json\n"
            "          scripts/.local-env に GOOGLE_APPLICATION_CREDENTIALS を記載\n"
            "\n"
            "        認証なしで集計ロジックだけ確認するには --self-test をどうぞ。",
            file=sys.stderr,
        )
        sys.exit(1)

    # レポートの出力先
    report_path = ""
    if args.report:
        if args.report == "__default__":
            stamp = datetime.now().strftime("%Y-%m-%d")
            name = f"sponsor-stats-audit-{stamp}.json" if args.audit else f"sponsor-stats-{stamp}.json"
            report_path = str(DEFAULT_REPORT_DIR / name)
        else:
            report_path = args.report

    print(f"[stats] project={project_id} k={args.k}(このスクリプトは読み取り専用です)")
    instruments, practices = fetch_groups(project_id, credentials_path)
    print(f"[stats] base_instruments={len(instruments)} base_practice_logs={len(practices)}")

    if args.audit:
        run_audit(instruments, report_path)
        return

    report = build_report(instruments, practices, args.k, project_id)
    print_summary(report)

    if report_path:
        Path(report_path).parent.mkdir(parents=True, exist_ok=True)
        Path(report_path).write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"\n[stats] レポート: {report_path}")

    print("\n[export_sponsor_stats] done.")


if __name__ == "__main__":
    main()
