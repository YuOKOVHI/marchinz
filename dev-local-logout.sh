#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:5173/#top}"
TARGET="${BASE_URL%#*}?dev_logout=1#${BASE_URL#*#}"
open "$TARGET"
echo "Opened: $TARGET"
