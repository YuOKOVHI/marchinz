#!/bin/bash
cd "$(dirname "$0")"
PORT="${1:-8899}"
python3 -m http.server "$PORT" &
sleep 1
open "http://127.0.0.1:${PORT}/"
wait
