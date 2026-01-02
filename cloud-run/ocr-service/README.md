# MindSparkle OCR Service - Cloud Run

A high-memory OCR service for processing large PDFs using Google Docs OCR.

## Features

- **Handles files up to 500MB** (vs 25MB limit on Edge Functions)
- **2GB-8GB RAM** configurable (vs 150MB Edge Function limit)
- **Google Docs OCR** - Best quality for PDFs with custom fonts
- **Auto-cleanup** - Temporary files deleted after processing

## Quick Deploy

### Prerequisites

1. **Install Google Cloud SDK:**
   ```bash
   # macOS
   brew install google-cloud-sdk
   
   # Or download from: https://cloud.google.com/sdk/docs/install
   ```

2. **Login and set project:**
   ```bash
   gcloud auth login
   gcloud config set project mindsparkle
   ```

3. **Enable required APIs:**
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable drive.googleapis.com
   ```

### Deploy

```bash
cd cloud-run/ocr-service
chmod +x deploy.sh
./deploy.sh
```

This will:
1. Build the Docker image
2. Deploy to Cloud Run
3. Output the service URL

### After Deployment

1. **Copy the service URL** from the output (e.g., `https://mindsparkle-ocr-xxxxx-uc.a.run.app`)

2. **Set the secret in Supabase:**
   ```bash
   cd ../..
   npx supabase secrets set OCR_SERVICE_URL="https://mindsparkle-ocr-xxxxx-uc.a.run.app"
   ```

3. **Redeploy the Edge Function:**
   ```bash
   npx supabase functions deploy extract-text --no-verify-jwt
   ```

4. **Test the service:**
   ```bash
   curl https://mindsparkle-ocr-xxxxx-uc.a.run.app/health
   ```

## API Endpoints

### Health Check
```bash
GET /health
```

### OCR via Signed URL (recommended for large files)
```bash
POST /ocr
Content-Type: application/json

{
  "signedUrl": "https://...",
  "fileSize": 38982157,
  "documentId": "optional-uuid"
}
```

### OCR via Direct Upload (for smaller files)
```bash
POST /ocr/upload
Content-Type: application/pdf

<binary PDF data>
```

## Configuration

Modify `deploy.sh` to adjust:

| Variable | Default | Description |
|----------|---------|-------------|
| MEMORY | 2Gi | RAM allocation (max 32Gi) |
| CPU | 2 | vCPU count (max 8) |
| TIMEOUT | 300 | Request timeout in seconds |
| MAX_INSTANCES | 10 | Max concurrent instances |

## Cost Estimate

- **Free tier:** 2 million requests/month, 360,000 GB-seconds
- **Pay-as-you-go:** ~$0.001 per request for 2GB/2CPU instance

For a typical 37MB PDF:
- Processing time: ~30-60 seconds
- Cost: ~$0.002 per file

## Troubleshooting

### "Permission denied" for Google Drive
- Ensure the service account has Drive API access
- The service account email must have permissions to create files

### "Out of memory"
- Increase MEMORY in deploy.sh (try 4Gi or 8Gi)

### "Timeout"
- Increase TIMEOUT in deploy.sh (up to 3600 for 1 hour)

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Mobile    │────>│  Edge Function   │────>│  Cloud Run  │
│     App     │     │  (extract-text)  │     │ OCR Service │
└─────────────┘     └──────────────────┘     └─────────────┘
                             │                      │
                             │                      v
                             │               ┌─────────────┐
                             │               │ Google Drive│
                             │               │  (OCR via   │
                             │               │ Google Docs)│
                             │               └─────────────┘
                             │                      │
                             v                      v
                    ┌──────────────────────────────────┐
                    │        Supabase Storage          │
                    │     (PDF files + extracted text) │
                    └──────────────────────────────────┘
```
