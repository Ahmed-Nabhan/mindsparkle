#!/bin/bash

# Deploy OCR Service to Cloud Run
#
# Usage:
#   ./deploy.sh [project-id]
#
# Optional env vars:
#   REGION=us-central1
#   SERVICE_NAME=mindsparkle-ocr
#   DOCUMENT_AI_PROCESSOR_ID=...
#   SERVICE_ACCOUNT=...@...gserviceaccount.com

set -euo pipefail

PROJECT_ID="${1:-mindsparkle}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-mindsparkle-ocr}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🚀 Deploying OCR Service"
echo "   Project: ${PROJECT_ID}"
echo "   Region:  ${REGION}"
echo "   Service: ${SERVICE_NAME}"
echo ""

if ! command -v gcloud >/dev/null 2>&1; then
  echo "❌ gcloud CLI not found. Install Google Cloud SDK first."
  exit 1
fi

(gcloud auth print-access-token >/dev/null 2>&1) || {
  echo "❌ Not authenticated. Run: gcloud auth login"
  exit 1
}

gcloud config set project "${PROJECT_ID}" >/dev/null

echo "📦 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com run.googleapis.com documentai.googleapis.com drive.googleapis.com --quiet

echo "🔨 Building container image..."
gcloud builds submit --tag "${IMAGE_NAME}" --timeout=20m .

echo "☁️ Deploying to Cloud Run..."
DEPLOY_ARGS=(
  run deploy "${SERVICE_NAME}"
  --image "${IMAGE_NAME}"
  --platform managed
  --region "${REGION}"
  --memory 2Gi
  --cpu 2
  --timeout 600
  --concurrency 4
  --min-instances 0
  --max-instances 3
  --allow-unauthenticated
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"
)

if [[ -n "${DOCUMENT_AI_PROCESSOR_ID:-}" ]]; then
  DEPLOY_ARGS+=(--set-env-vars "DOCUMENT_AI_PROCESSOR_ID=${DOCUMENT_AI_PROCESSOR_ID}")
fi

if [[ -n "${SERVICE_ACCOUNT:-}" ]]; then
  DEPLOY_ARGS+=(--service-account "${SERVICE_ACCOUNT}")
fi

gcloud "${DEPLOY_ARGS[@]}" --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --platform managed \
  --region "${REGION}" \
  --format 'value(status.url)')

echo ""
echo "✅ OCR deployment complete!"
echo "🌐 Service URL: ${SERVICE_URL}"
echo "📝 Health check:"
echo "   curl ${SERVICE_URL}/"
