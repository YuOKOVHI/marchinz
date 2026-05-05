#!/usr/bin/env python3
"""このフォルダで HTTP サーバーを立て、ブラウザで index を開く。"""
from __future__ import annotations

import http.server
import os
import socketserver
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8899


def main() -> None:
    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler

    class QuietHandler(handler):
        def log_message(self, format: str, *args) -> None:
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), QuietHandler)
    url = f"http://127.0.0.1:{PORT}/"

    def browse() -> None:
        webbrowser.open(url)

    threading.Timer(0.35, browse).start()
    print(f"開いています: {url}")
    print("終了するには Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")


if __name__ == "__main__":
    main()
