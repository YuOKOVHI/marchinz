#!/usr/bin/env python3
"""push前チェック(必要最低限・機械化版) — 2026-08-07 優さん指示

deploy-guard の手順 ①②(積まれたコミット・Drive巻き戻り検証)と、
版番整合・QAの段の判定を1コマンドにまとめたもの。ブラウザ不要・数秒で終わる。

    python3 push_check.py

見るもの:
  ① 積まれたコミット(origin/main..HEAD)と作業ツリーの汚れ
  ② Drive巻き戻り検証: 積んだ全ファイルについて HEAD blob と実ファイルの一致
  ③ 版番整合: data-mz-version >= 各ツールの ?v= 最大 / 変更JSの ?v= バンプ漏れ
  ④ QAの段: エンジンを触っていたら「?full=1 必須」、それ以外は「標準でOK」

これが全部通っても push はしない。push は優さんの確認1回=1実行(deploy-guard §0)。
"""
import hashlib
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
# QAの段の判定: これらに触れたら実コーデック群(?full=1)まで回す
ENGINE = re.compile(
    r"^tools/shared/|^tools/switcher/js/(exporter|visual|sync|media|demux|muxer)")

ok = True


def sh(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True,
                          text=True, check=True).stdout


def shb(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True,
                          check=True).stdout


def fail(msg):
    global ok
    ok = False
    print(f"  ✗ {msg}")


def good(msg):
    print(f"  ○ {msg}")


# ---------- ① 積まれたコミット ----------
print("① 積まれたコミット(origin/main..HEAD)")
log = sh("log", "--oneline", "origin/main..HEAD").strip()
if not log:
    print("  (積まれたコミットなし — pushするものが無い)")
else:
    for line in log.splitlines():
        print(f"  {line}")
dirty = [l for l in sh("status", "--porcelain").splitlines()
         if not l.startswith("??")]
if dirty:
    fail(f"作業ツリーが汚れている({len(dirty)}件) — コミット漏れかDrive撹乱: "
         + ", ".join(l.split()[-1] for l in dirty[:5]))
else:
    good("作業ツリーはクリーン(未追跡を除く)")

# ---------- ② Drive巻き戻り検証(HEAD blob = 実ファイル) ----------
print("② Drive巻き戻り検証(HEAD blob と実ファイルの一致)")
changed = [f for f in sh("diff", "--name-only", "origin/main...HEAD").splitlines() if f]
mismatch = 0
for f in changed:
    p = os.path.join(ROOT, f)
    try:
        blob = shb("show", f"HEAD:{f}")
    except subprocess.CalledProcessError:      # HEADで削除されたファイル
        if os.path.exists(p):
            fail(f"{f}: HEADでは削除済みなのに実ファイルが居る(巻き戻りの疑い)")
            mismatch += 1
        continue
    if not os.path.exists(p):
        fail(f"{f}: HEADに居るのに実ファイルが無い(同期中の疑い)")
        mismatch += 1
        continue
    with open(p, "rb") as fh:
        disk = fh.read()
    if hashlib.md5(blob).digest() != hashlib.md5(disk).digest():
        fail(f"{f}: HEAD blob と実ファイルが不一致(Drive巻き戻り!)")
        mismatch += 1
if not mismatch:
    good(f"積んだ {len(changed)} ファイル全部、HEAD blob = 実ファイル")

# ---------- ③ 版番整合 ----------
print("③ 版番整合")
VER = re.compile(r"(\d+)\.(\d+)\.(\d+)")


def as_tuple(v):
    m = VER.search(v or "")
    return tuple(int(x) for x in m.groups()) if m else None


with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
    site_ver = as_tuple(re.search(r'data-mz-version="([^"]+)"', fh.read()).group(1))
tool_max, tool_max_at = None, ""
for tool in ("switcher", "privacy", "reangle", "vlog"):
    idx = os.path.join(ROOT, "tools", tool, "index.html")
    if not os.path.exists(idx):
        continue
    with open(idx, encoding="utf-8") as fh:
        for v in re.findall(r"\?v=(\d+\.\d+\.\d+)", fh.read()):
            t = as_tuple(v)
            if tool_max is None or t > tool_max:
                tool_max, tool_max_at = t, tool
if site_ver and tool_max and site_ver < tool_max:
    fail(f"サイト版番 {'.'.join(map(str, site_ver))} < ツール最大 "
         f"{'.'.join(map(str, tool_max))}({tool_max_at}) — index.html の "
         "data-mz-version を上げること")
else:
    good(f"サイト {'.'.join(map(str, site_ver))} ≧ ツール最大 "
         f"{'.'.join(map(str, tool_max))}({tool_max_at})")

# 変更した JS の ?v= がバンプされているか(参照側で新旧の版が変わったか)
# ★ tools/ に絞ってはいけない(2026-08-07)。site-nav.js・auth.js 等の**直下のJS**も
#   index.html から ?v= 付きで読まれる。絞っていたせいで site-nav.js の変更が
#   「JSの変更なし」と報告され、バンプ漏れを1件も捕まえられなかった
js_changed = [f for f in changed if f.endswith(".js")]
stale = []
for f in js_changed:
    base = re.escape(os.path.basename(f))
    pat = re.compile(base.encode() + rb"\?v=([0-9.]+)")
    old_vers, new_vers = set(), set()
    for ref in sh("grep", "-l", os.path.basename(f) + "?v=", "HEAD").splitlines():
        ref = ref.split(":", 1)[1]
        new_vers |= set(pat.findall(shb("show", f"HEAD:{ref}")))
        try:
            old_vers |= set(pat.findall(shb("show", f"origin/main:{ref}")))
        except subprocess.CalledProcessError:
            pass
    if old_vers and new_vers and old_vers == new_vers:
        stale.append(f)
if stale:
    for f in stale:
        fail(f"{f}: 中身を変えたのに ?v= が据え置き(キャッシュに旧版が居座る)")
elif js_changed:
    good(f"変更したJS {len(js_changed)} 本、?v= バンプ済み")
else:
    good("JSの変更なし(?v= チェック対象なし)")

# ---------- ④ QAの段 ----------
print("④ QAの段(標準 or ?full=1)")
engine_hits = sorted(f for f in changed if ENGINE.match(f))
if engine_hits:
    print("  ▶ エンジンに触れている → QAは ?full=1 で全件:")
    for f in engine_hits[:8]:
        print(f"      {f}")
else:
    print("  ▶ エンジンには触れていない → QAは標準セットでよい")

print()
if ok:
    print("== push_check: 全チェック通過。QAを上記の段で回し、"
          "優さんの確認を取ってから push ==")
else:
    print("== push_check: FAILあり。push してはいけない ==")
    sys.exit(1)
