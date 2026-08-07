#!/bin/zsh
# QAランナー配信(2026-08-07)。Drive配下はTCCで配信不可 → /private/tmp へ rsync。
#   tools/qa/serve.sh        … 同期して :8931 で配信(既に居れば同期だけ)
#   tools/qa/serve.sh stop   … 停止
# URL:  http://127.0.0.1:8931/tools/qa/runner.html          (標準セット)
#       http://127.0.0.1:8931/tools/qa/runner.html?full=1   (全件)
set -e
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DST="/private/tmp/mzqa"
PORT=8931
PIDFILE="$DST/.server.pid"

if [[ "$1" == "stop" ]]; then
  [[ -f "$PIDFILE" ]] && kill "$(cat "$PIDFILE")" 2>/dev/null && rm -f "$PIDFILE" \
    && echo "stopped" || echo "not running"
  exit 0
fi

mkdir -p "$DST"
rsync -a --delete \
  --exclude '.git' --exclude 'backups' --exclude '_snapshots' --exclude '.venv' \
  --exclude 'node_modules' --exclude 'CLAUDE-SECURITY-*' --exclude '.server.pid' \
  "$SRC/" "$DST/"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "synced (server already on :$PORT)"
else
  ( cd "$DST" && python3 -m http.server $PORT >/dev/null 2>&1 & echo $! > "$PIDFILE" )
  sleep 0.5
  echo "serving on http://127.0.0.1:$PORT/tools/qa/runner.html"
fi
