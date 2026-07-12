#!/usr/bin/env bash
set -euo pipefail

# Netlify ビルド前にデータ更新を実施する。
# ・note 新着フィード: API キー不要なので常に更新(失敗してもビルドは継続)
# ・YouTube: YOUTUBE_API_KEY が未設定の場合はスキップして通常デプロイを継続。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# note の新着フィード(marchinz-notes.inline.js)を更新。ネット取得に失敗しても
# 既存のコミット済みファイルを温存し、ビルドは止めない。
echo "[netlify_prebuild_refresh] note feed refresh start"
python3 "$SCRIPT_DIR/export_notes_feed.py" || echo "[netlify_prebuild_refresh] note feed refresh skipped (fetch failed)"
echo "[netlify_prebuild_refresh] note feed refresh done"

if [[ -z "${YOUTUBE_API_KEY:-}" ]]; then
  echo "[netlify_prebuild_refresh] YOUTUBE_API_KEY 未設定のため API 更新をスキップします。"
  exit 0
fi

echo "[netlify_prebuild_refresh] YouTube API refresh start"
bash "$SCRIPT_DIR/run_youtube_api_refresh.sh"
echo "[netlify_prebuild_refresh] YouTube API refresh done"
