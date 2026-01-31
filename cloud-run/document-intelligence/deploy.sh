#!/bin/bash

# Deploy Document Intelligence Service to Cloud Run
# Usage: ./deploy.sh [project-id]

set -e

PROJECT_ID="${1:-mindsparkle-app}"
REGION="us-central1"
SERVICE_NAME="mindsparkle-document-intelligence"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🚀 Deploying Document Intelligence Service"
echo "   Project: ${PROJECT_ID}"
echo "   Region: ${REGION}"
echo "   Service: ${SERVICE_NAME}"
echo ""

# Ensure we're authenticated
gcloud auth print-access-token > /dev/null 2>&1 || {
    echo "❌ Not authenticated. Please run: gcloud auth login"
    exit 1
}

# Set the project
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo "📦 Enabling required APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    documentai.googleapis.com \
    vision.googleapis.com \
    aiplatform.googleapis.com \
    --quiet

# Build the container
echo "🔨 Building container image..."
gcloud builds submit \
    --tag ${IMAGE_NAME} \
    --timeout=20m \
    .

# Deploy to Cloud Run
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --platform managed \
    --region ${REGION} \
    --memory 2Gi \
    --cpu 2 \
    --timeout 300 \
    --concurrency 10 \
    --min-instances 0 \
    --max-instances 10 \
    --allow-unauthenticated \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
    --set-env-vars "VERTEX_LOCATION=${REGION}" \
    --set-env-vars "VERTEX_GEMINI_OCR_ENABLED=true" \
    --set-env-vars "VERTEX_GEMINI_MODEL=gemini-1.5-pro" \
    --quiet

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
    --platform managed \
    --region ${REGION} \
    --format 'value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Service URL: ${SERVICE_URL}"
echo ""
echo "📝 Test commands:"
echo "   # Health check"
echo "   curl ${SERVICE_URL}/health"
echo ""
echo "   # Extract document"
echo "   curl -X POST ${SERVICE_URL}/extract \\"
echo "     -F 'file=@document.pdf'"
echo ""
echo "   # Full process (extract + understand)"
echo "   curl -X POST ${SERVICE_URL}/process \\"
echo "     -F 'file=@document.pdf' \\"
echo "     -F 'task=summarize'"
echo ""

# Update the app config with new URL
CONFIG_FILE="../../../src/constants/config.ts"
if [ -f "$CONFIG_FILE" ] && [ -t 0 ]; then
    echo "📝 Would you like to update the app config with the new URL? (y/n)"
    read -r response
    if [ "$response" = "y" ]; then
        # This is a placeholder - actual sed command would depend on config format
        echo "   Update DOCUMENT_INTELLIGENCE_URL in ${CONFIG_FILE}"
        echo "   to: ${SERVICE_URL}"
    fi
fi
