#!/usr/bin/env bash
set -euo pipefail

# YouTube API で YouTubeリストを再生成し、サイト反映データ整合まで実行する。
# 前提:
#   export YOUTUBE_API_KEY="..."
# 使い方:
#   ./run_youtube_api_refresh.sh
#   ./run_youtube_api_refresh.sh --max-channels 5 --max-items 80 --dry-run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "${YOUTUBE_API_KEY:-}" ]]; then
  # launchd 実行向け: ホーム直下のキー保存ファイルを自動読込
  # 形式: 1行で API キー文字列のみ（前後空白なし）
  KEY_FILE="${HOME}/.mll_youtube_api_key"
  if [[ -f "$KEY_FILE" ]]; then
    YOUTUBE_API_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
    export YOUTUBE_API_KEY
  fi
fi

if [[ -z "${YOUTUBE_API_KEY:-}" ]]; then
  echo "ERROR: YOUTUBE_API_KEY が未設定です。" >&2
  echo "例1: export YOUTUBE_API_KEY=\"YOUR_API_KEY\"" >&2
  echo "例2: echo \"YOUR_API_KEY\" > ~/.mll_youtube_api_key && chmod 600 ~/.mll_youtube_api_key" >&2
  exit 2
fi

python3 "$SCRIPT_DIR/export_youtube_list_via_api.py" "$@"

if [[ "${1:-}" == "--dry-run" || "${*: -1}" == "--dry-run" ]]; then
  exit 0
fi

python3 "$SCRIPT_DIR/sync_csv_to_json.py"
python3 "$SCRIPT_DIR/check_data.py"
python3 "$SCRIPT_DIR/verify_youtube_list_csv_inline.py"

echo "DONE: API取得 -> YouTubeリスト生成 -> data同期 -> 整合チェック 完了"
