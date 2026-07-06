#!/usr/bin/env bash
# attendees → mll_logs マイグレーション（dry-run → 本番）
# 事前: scripts/.local-env に GOOGLE_APPLICATION_CREDENTIALS を設定（.local-env.example 参照）

set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .local-env ]]; then
  # shellcheck disable=SC1091
  source .local-env
fi

if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  echo "ERROR: GOOGLE_APPLICATION_CREDENTIALS が未設定です。"
  echo "  cp .local-env.example .local-env"
  echo "  を編集してサービスアカウント JSON のパスを入れてから再実行してください。"
  exit 1
fi

if [[ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "ERROR: ファイルがありません: $GOOGLE_APPLICATION_CREDENTIALS"
  exit 1
fi

npm install --silent 2>/dev/null || npm install

USER_ARG=()
if [[ -n "${MIGRATE_USER_ID:-}" ]]; then
  USER_ARG=(--user-id="$MIGRATE_USER_ID")
  echo "==> dry-run（user-id=$MIGRATE_USER_ID）"
else
  echo "==> dry-run（全ユーザー）"
fi

node migrate-attendees-to-mll.mjs --dry-run "${USER_ARG[@]}" --report=./reports/migrate-dryrun.json

echo ""
read -r -p "dry-run の結果を確認しました。本番書き込みしますか？ [y/N] " ans
if [[ "${ans,,}" != "y" ]]; then
  echo "中止しました。"
  exit 0
fi

echo "==> 本番書き込み"
node migrate-attendees-to-mll.mjs "${USER_ARG[@]}" --report=./reports/migrate-prod.json
echo "完了。https://marchinz.netlify.app でマイページ MarchinZ Log を確認してください。"
