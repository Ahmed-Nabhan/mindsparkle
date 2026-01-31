#!/bin/bash

# Deploy AI Presentation Generator to Cloud Run

set -e

PROJECT_ID="mindsparkle"
SERVICE_NAME="mindsparkle-presentation-ai"
REGION="us-central1"

echo "🎨 Deploying AI Presentation Generator..."

if ! command -v gcloud >/dev/null 2>&1; then
  echo "❌ gcloud CLI not found. Install Google Cloud SDK first."
  exit 1
fi

# Prefer Secret Manager to avoid leaking keys via shell history/CLI logs.
if ! gcloud secrets describe OPENAI_API_KEY --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "❌ Missing Secret Manager secret: OPENAI_API_KEY (project: $PROJECT_ID)"
  echo "   Create it safely (do NOT paste secrets into chat):"
  echo "   1) gcloud config set project $PROJECT_ID"
  echo "   2) printf '%s' \"YOUR_OPENAI_KEY\" | gcloud secrets create OPENAI_API_KEY --replication-policy=automatic --data-file=-"
  echo "      (or: gcloud secrets versions add OPENAI_API_KEY --data-file=-)"
  exit 1
fi

# Build and deploy
gcloud run deploy $SERVICE_NAME \
  --source . \
  --project $PROJECT_ID \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 5 \
  --set-secrets "OPENAI_API_KEY=OPENAI_API_KEY:latest" \
  --set-env-vars "CANVA_API_KEY=${CANVA_API_KEY:-}" \
  --set-env-vars "MIDJOURNEY_API_KEY=${MIDJOURNEY_API_KEY:-}"

echo "✅ Deployed successfully!"
echo ""
echo "Service URL: https://$SERVICE_NAME-900398462112.$REGION.run.app"
