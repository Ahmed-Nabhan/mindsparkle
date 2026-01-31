#!/bin/bash

# Deploy Extraction Worker to Cloud Run
#
# Prereqs:
# - gcloud authenticated
# - Secret Manager secret exists: SUPABASE_SERVICE_ROLE_KEY (in the target project)
#
# Usage:
#   ./deploy.sh [project-id]

set -euo pipefail

PROJECT_ID="${1:-mindsparkle}"
REGION="us-central1"
SERVICE_NAME="mindsparkle-extraction-worker"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

SUPABASE_PROJECT_REF="cszorvgzihzamgezlfjj"
SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"

echo "🚀 Deploying Extraction Worker"
echo "   Project: ${PROJECT_ID}"
echo "   Region:  ${REGION}"
echo "   Service: ${SERVICE_NAME}"
echo ""

if ! command -v gcloud >/dev/null 2>&1; then
  echo "❌ gcloud CLI not found. Install Google Cloud SDK first."
  exit 1
fi

# Ensure we're authenticated
(gcloud auth print-access-token >/dev/null 2>&1) || {
  echo "❌ Not authenticated. Run: gcloud auth login"
  exit 1
}

gcloud config set project "${PROJECT_ID}" >/dev/null

# Ensure required APIs
echo "📦 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com run.googleapis.com --quiet

# Verify secret exists (do not print values)
if ! gcloud secrets describe SUPABASE_SERVICE_ROLE_KEY --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "❌ Missing Secret Manager secret: SUPABASE_SERVICE_ROLE_KEY (project: ${PROJECT_ID})"
  echo "   Create it from your Supabase Dashboard service_role key."
  exit 1
fi

if ! gcloud secrets describe OPENAI_API_KEY --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "❌ Missing Secret Manager secret: OPENAI_API_KEY (project: ${PROJECT_ID})"
  echo "   Required for deep_explain generation. Create it in Secret Manager."
  exit 1
fi

# Build the container image
echo "🔨 Building container image..."
gcloud builds submit --tag "${IMAGE_NAME}" --timeout=20m .

# Deploy to Cloud Run
# OCR_SERVICE_URL is optional; set it if you have an OCR service endpoint.
# Example:
#   export OCR_SERVICE_URL="https://mindsparkle-ocr-....run.app"

echo "☁️ Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}" \
  --platform managed \
  --region "${REGION}" \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 1 \
  --min-instances 1 \
  --max-instances 2 \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest" \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY:latest" \
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL}" \
  --set-env-vars "SUPABASE_STORAGE_BUCKET=documents" \
  --set-env-vars "DOCUMENT_INTELLIGENCE_URL=https://mindsparkle-document-intelligence-900398462112.us-central1.run.app" \
  --set-env-vars "LEASE_SECONDS=60" \
  --set-env-vars "POLL_INTERVAL_MS=2000" \
  --set-env-vars "EXTRACT_BATCH_SIZE=5" \
  --set-env-vars "SIGNED_URL_SECONDS=1800" \
  --set-env-vars "ENABLE_DEEP_EXPLAIN_RAG=1" \
  --set-env-vars "DEEP_EXPLAIN_MAX_SECTIONS=7" \
  --set-env-vars "DEEP_EXPLAIN_MAX_CHUNKS_PER_SECTION=3" \
  --set-env-vars "DEEP_EXPLAIN_CHUNK_EXCERPT_CHARS=1200" \
  --set-env-vars "DEEP_EXPLAIN_MAX_CHUNKS_FOR_RAG=40" \
  --set-env-vars "ENABLE_DEEP_EXPLAIN_EMBEDDINGS=1" \
  --set-env-vars "DEEP_EXPLAIN_EMBEDDING_MODEL=text-embedding-3-small" \
  --set-env-vars "DEEP_EXPLAIN_EMBED_MAX_CHUNKS_PER_DOC=80" \
  --set-env-vars "DEEP_EXPLAIN_EMBED_MAX_CHARS=2000" \
  --set-env-vars "ENABLE_DEEP_EXPLAIN_CACHE=1" \
  --set-env-vars "ENABLE_DEEP_EXPLAIN_MODEL_ROUTING=1" \
  --set-env-vars "DEEP_EXPLAIN_OUTLINE_MODEL=gpt-4o-mini" \
  --set-env-vars "DEEP_EXPLAIN_SECTION_MODEL=gpt-4o" \
  --set-env-vars "OCR_SERVICE_URL=${OCR_SERVICE_URL:-}" \
  --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --platform managed \
  --region "${REGION}" \
  --format 'value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Service URL: ${SERVICE_URL}"
echo ""
echo "📝 Test commands:"
echo "   curl ${SERVICE_URL}/health"
