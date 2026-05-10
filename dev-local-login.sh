#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:5173/#top}"
DEV_NAME="${2:-PPP OKOCHI}"
DEV_UID="${3:-local-dev-user}"
DEV_AVATAR="${4:-}"

ENC_NAME=$(python3 - <<'PY' "$DEV_NAME"
import urllib.parse,sys
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)
ENC_UID=$(python3 - <<'PY' "$DEV_UID"
import urllib.parse,sys
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)
ENC_AVATAR=$(python3 - <<'PY' "$DEV_AVATAR"
import urllib.parse,sys
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)

TARGET="${BASE_URL%#*}?dev_login=1&dev_name=${ENC_NAME}&dev_uid=${ENC_UID}&dev_avatar=${ENC_AVATAR}#${BASE_URL#*#}"
open "$TARGET"
echo "Opened: $TARGET"
