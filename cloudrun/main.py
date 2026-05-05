#!/usr/bin/env python3
from __future__ import annotations

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
    if not token or got != token:
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
