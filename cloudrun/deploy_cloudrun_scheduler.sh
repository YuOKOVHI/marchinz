#!/usr/bin/env bash
set -euo pipefail

# Cloud Run + Cloud Scheduler で Netlify Build Hook を毎日叩く設定を作る。
#
# 使い方:
#   export PROJECT_ID="MLL-YOUTUBE-API の GCP プロジェクトID"
#   export REGION="asia-northeast1"
#   export SERVICE_NAME="mll-youtube-trigger"
#   export SCHEDULER_NAME="mll-youtube-daily"
#   export NETLIFY_BUILD_HOOK_URL="https://api.netlify.com/build_hooks/xxxx"
#   export TRIGGER_TOKEN="$(openssl rand -hex 16)"
#   bash ./cloudrun/deploy_cloudrun_scheduler.sh

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:=asia-northeast1}"
: "${SERVICE_NAME:=mll-youtube-trigger}"
: "${SCHEDULER_NAME:=mll-youtube-daily}"
: "${NETLIFY_BUILD_HOOK_URL:?NETLIFY_BUILD_HOOK_URL is required}"
: "${TRIGGER_TOKEN:?TRIGGER_TOKEN is required}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com

gcloud run deploy "$SERVICE_NAME" \
  --source "$ROOT_DIR" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "NETLIFY_BUILD_HOOK_URL=$NETLIFY_BUILD_HOOK_URL,TRIGGER_TOKEN=$TRIGGER_TOKEN"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

# 既存ジョブがあれば更新、なければ作成
if gcloud scheduler jobs describe "$SCHEDULER_NAME" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHEDULER_NAME" \
    --location "$REGION" \
    --schedule "0 6 * * *" \
    --time-zone "Asia/Tokyo" \
    --uri "$SERVICE_URL/trigger" \
    --http-method POST \
    --headers "X-Trigger-Token=$TRIGGER_TOKEN"
else
  gcloud scheduler jobs create http "$SCHEDULER_NAME" \
    --location "$REGION" \
    --schedule "0 6 * * *" \
    --time-zone "Asia/Tokyo" \
    --uri "$SERVICE_URL/trigger" \
    --http-method POST \
    --headers "X-Trigger-Token=$TRIGGER_TOKEN"
fi

echo "DONE"
echo "Cloud Run URL: $SERVICE_URL"
echo "Scheduler Job : $SCHEDULER_NAME"
echo "Test manual run:"
echo "  curl -X POST \"$SERVICE_URL/trigger\" -H \"X-Trigger-Token: $TRIGGER_TOKEN\""
