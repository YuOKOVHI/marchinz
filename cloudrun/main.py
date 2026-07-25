#!/usr/bin/env python3
from __future__ import annotations

import hmac
import os
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True, "time": _utc_now()})


@app.post("/trigger")
def trigger():
    token = os.getenv("TRIGGER_TOKEN", "").strip()
    got = request.headers.get("X-Trigger-Token", "").strip()
    # 定数時間で比較する(2026-07-25 セキュリティレビュー F4)。
    # != は先頭から一致した分だけ早く返るため、応答時間からトークンを
    # 1バイトずつ絞り込める。通れば Netlify のビルドフックを任意に叩けて
    # ビルドクレジットを消費させられる。token 未設定なら 401 で閉じるのは従来どおり。
    if not token or not hmac.compare_digest(got, token):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    hook = os.getenv("NETLIFY_BUILD_HOOK_URL", "").strip()
    if not hook:
        return jsonify({"ok": False, "error": "NETLIFY_BUILD_HOOK_URL is not set"}), 500

    try:
        res = requests.post(hook, timeout=20)
    except Exception as ex:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(ex)}), 502

    return (
        jsonify(
            {
                "ok": res.ok,
                "status": res.status_code,
                "triggered_at": _utc_now(),
                "response_text": res.text[:800],
            }
        ),
        200 if res.ok else 502,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
