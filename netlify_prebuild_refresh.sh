#!/usr/bin/env bash
set -euo pipefail

# Netlify ビルド前に YouTube データ更新を実施する。
# YOUTUBE_API_KEY が未設定の場合はスキップして通常デプロイを継続。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "${YOUTUBE_API_KEY:-}" ]]; then
  echo "[netlify_prebuild_refresh] YOUTUBE_API_KEY 未設定のため API 更新をスキップします。"
  exit 0
fi

echo "[netlify_prebuild_refresh] YouTube API refresh start"
bash "$SCRIPT_DIR/run_youtube_api_refresh.sh"
echo "[netlify_prebuild_refresh] YouTube API refresh done"
