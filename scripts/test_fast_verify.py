#!/usr/bin/env python3
"""fast_verify の分類契約と変異検出を確認する。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile

import fast_verify


def expect(files: list[str], **wanted: object) -> None:
    actual = fast_verify.classify(files)
    for key, value in wanted.items():
        assert actual[key] == value, (files, key, actual[key], value)


def mutation_test() -> None:
    source_path = Path(fast_verify.__file__)
    source = source_path.read_text(encoding="utf-8")
    needle = '    "youtube-list/",\n'
    assert source.count(needle) >= 2, "変異対象が見つかりません"
    mutated = source.replace(needle, '    "youtube-disabled/",\n')
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "fast_verify_mutated.py"
        target.write_text(mutated, encoding="utf-8")
        spec = importlib.util.spec_from_file_location("fast_verify_mutated", target)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        target_file = "youtube-list/youtube-list.inline.js"
        assert module.classify([target_file])["data"] is False
        assert fast_verify.classify([target_file])["data"] is True


def main() -> None:
    expect(["marchinz-brushup.css"], data=False, pov=False, engine=False, product=True, qa="standard")
    expect(["大会動画リスト_POV.csv"], data=True, pov=True, engine=False, qa="none")
    expect(["youtube-list/YouTubeリスト.csv"], data=True, pov=False, engine=False, qa="standard")
    expect(["tools/switcher/js/exporter.js"], engine=True, product=True, qa="full")
    expect(["docs/OPS_GUIDE.md"], data=False, pov=False, product=False, qa="none")
    mutation_test()
    print("PASS: fast_verify 分類5件 + 変異1件")


if __name__ == "__main__":
    main()
