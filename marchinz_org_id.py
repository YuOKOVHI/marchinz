"""ブラウザの `marchinzStableOrgIdForName` と同じ規則で団体 ID（`o` + base36）を生成する。

JavaScript は UTF-16 コード単位で FNV-1a するため、本実装も UTF-16 LE バイト列を 16bit ずつ処理する。
"""
from __future__ import annotations

_FNV_OFFSET = 2166136261
_FNV_PRIME = 16777619
_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def hash_string_fnv1a32_js(s: str) -> int:
    """`app.js` の `hashStringFnv1a32` と同じ結果（符号なし 32bit）。"""
    b = s.encode("utf-16-le")
    h = _FNV_OFFSET & 0xFFFFFFFF
    for i in range(0, len(b), 2):
        unit = b[i] | (b[i + 1] << 8)
        h ^= unit
        h = (h * _FNV_PRIME) & 0xFFFFFFFF
    return h


def to_base36_lower(n: int) -> str:
    n &= 0xFFFFFFFF
    if n == 0:
        return "0"
    out: list[str] = []
    while n:
        n, r = divmod(n, 36)
        out.append(_BASE36[r])
    return "".join(reversed(out))


def stable_org_id_for_team_name(name: str) -> str:
    """空でない団体/チーム名から `o` + base36（FNV-1a(`mzorg|name`)）。"""
    n = (name or "").strip()
    if not n:
        return ""
    return "o" + to_base36_lower(hash_string_fnv1a32_js(f"mzorg|{n}"))
