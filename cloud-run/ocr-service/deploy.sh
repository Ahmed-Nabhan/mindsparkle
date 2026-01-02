#!/bin/bash

# MindSparkle OCR Service - Cloud Run Deployment Script
# 
# Prerequisites:
# 1. Google Cloud SDK installed: https://cloud.google.com/sdk/docs/install
# 2. Logged in: gcloud auth login
# 3. Project set: gcloud config set project mindsparkle
# 4. Service account JSON file at: ../../google-service-account.json

set -e

# Configuration
PROJECT_ID="mindsparkle"
REGION="us-central1"
SERVICE_NAME="mindsparkle-ocr"
MEMORY="2Gi"  # 2GB RAM - increase if needed (max 32Gi)
CPU="2"       # 2 vCPUs
TIMEOUT="300" # 5 minutes timeout
MAX_INSTANCES="10"

echo "🚀 Deploying MindSparkle OCR Service to Cloud Run..."
echo "   Project: $PROJECT_ID"
echo "   Region: $REGION"
echo "   Memory: $MEMORY"
echo "   CPU: $CPU"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Google Cloud SDK not found. Please install it first:"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if logged in
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n 1 &> /dev/null; then
    echo "❌ Not logged in to Google Cloud. Please run:"
    echo "   gcloud auth login"
    exit 1
fi

# Set project
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "📡 Enabling required APIs..."
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable drive.googleapis.com

# Read service account JSON
SERVICE_ACCOUNT_FILE="../../google-service-account.json"
if [ ! -f "$SERVICE_ACCOUNT_FILE" ]; then
    echo "❌ Service account file not found at: $SERVICE_ACCOUNT_FILE"
    exit 1
fi

# Create a single-line JSON string for the secret
SERVICE_ACCOUNT_JSON=$(cat "$SERVICE_ACCOUNT_FILE" | tr -d '\n' | tr -s ' ')

echo "🔨 Building and deploying..."

# Deploy to Cloud Run with inline build
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --memory $MEMORY \
    --cpu $CPU \
    --timeout $TIMEOUT \
    --max-instances $MAX_INSTANCES \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars "GOOGLE_SERVICE_ACCOUNT_JSON=$SERVICE_ACCOUNT_JSON" \
    --set-env-vars "MEMORY_LIMIT=$MEMORY"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)")

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Service URL: $SERVICE_URL"
echo ""
echo "📝 Test the service:"
echo "   curl $SERVICE_URL/health"
echo ""
echo "🔧 Update your .env file with:"
echo "   EXPO_PUBLIC_OCR_SERVICE_URL=$SERVICE_URL"
echo ""
