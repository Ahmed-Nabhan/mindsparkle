# MindSparkle Document Intelligence Service

Production-grade document extraction with deterministic pipelines.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Document Intelligence                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │   Upload    │ -> │  Extraction  │ -> │ Canonical Model │   │
│  │  (PDF/PPT)  │    │ Deterministic│    │   (Structured)  │   │
│  └─────────────┘    └──────────────┘    └────────┬────────┘   │
│                                                   │            │
│                                                   v            │
│                                          ┌───────────────┐    │
│                                          │ Understanding │    │
│                                          │  (Gemini Pro) │    │
│                                          └───────────────┘    │
│                                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Key Principle

**"Vision OCR ≠ LLM Vision"**

- **Extraction**: Deterministic only (Document AI, pdf-parse, Vision OCR)
- **Understanding**: LLM only for interpretation, not extraction

## Extraction Pipelines

### PDF Pipeline
1. **Google Document AI** - Best for structured PDFs (tables, forms)
2. **pdf-parse** - Fast local fallback for simple text
3. **Vision OCR** - For scanned/image-based PDFs

### PPTX Pipeline
1. **ZIP Parser** - Extract slides as Office Open XML
2. **XML Extraction** - Parse slide content, tables, notes
3. **Image OCR** - Deterministic OCR for embedded images

### DOCX Pipeline
1. **Mammoth** - Clean text extraction
2. **ZIP Parser** - Structured XML extraction
3. **Image OCR** - For embedded images

### Image Pipeline
1. **Vision Document Detection** - For dense text
2. **Vision Text Detection** - Simple fallback
3. **Sharp preprocessing** - Optimize for OCR

## Canonical Model

All documents are normalized to a canonical structure:

```json
{
  "id": "uuid",
  "filename": "document.pdf",
  "file_type": "pdf",
  "extraction": {
    "method": "document_ai",
    "confidence": 0.95,
    "fallbacks_used": []
  },
  "structure": {
    "page_count": 10,
    "sections": ["Chapter 1", "Chapter 2"],
    "tables": [...],
    "images": [...]
  },
  "content": {
    "text_blocks": [...],
    "full_text": "...",
    "structured_sections": [...]
  },
  "stats": {
    "word_count": 5000,
    "table_count": 3,
    "image_count": 5
  }
}
```

## API Endpoints

### `GET /` - Service Info
Returns service information and available endpoints.

### `GET /health` - Health Check
Returns service health status.

### `POST /extract` - Extract Only
Deterministic extraction to canonical model.

```bash
curl -X POST https://SERVICE_URL/extract \
  -F 'file=@document.pdf'
```

### `POST /understand` - Understanding Only
LLM understanding of canonical model.

```bash
curl -X POST https://SERVICE_URL/understand \
  -H 'Content-Type: application/json' \
  -d '{
    "canonical": {...},
    "task": "summarize",
    "vendor": "cisco"
  }'
```

### `POST /process` - Full Pipeline
Extract + Understand in one call.

```bash
curl -X POST https://SERVICE_URL/process \
  -F 'file=@document.pdf' \
  -F 'task=summarize' \
  -F 'vendor=cisco'
```

## Tasks

- `summarize` - Comprehensive study summary (2000+ words)
- `quiz` - Generate exam questions (15-20)
- `flashcards` - Create flashcard sets (20-30)
- `study_guide` - Structured study guide
- `chat` - Answer questions about document

## Vendor Expertise

Specialized understanding for:
- Cisco (CCNA, CCNP, CCIE)
- AWS (Solutions Architect, Developer)
- Azure (AZ certifications)
- GCP (Associate, Professional)
- CompTIA (A+, Network+, Security+)
- Penetration Testing (OSCP, CEH)
- Offensive Security (OSCP, OSWE)
- Linux (RHCSA, RHCE, LPIC)
- Kubernetes (CKA, CKAD, CKS)
- PMP (Project Management)
- CISSP (Security Management)

## Deployment

```bash
# Deploy to Cloud Run
./deploy.sh mindsparkle-app
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLOUD_PROJECT` | GCP Project ID | mindsparkle-app |
| `VERTEX_LOCATION` | Vertex AI region | us-central1 |
| `DOCUMENT_AI_PROCESSOR` | Document AI processor ID | (optional) |
| `OPENAI_API_KEY` | OpenAI fallback key | (optional) |
| `PORT` | Service port | 8080 |

## Cost Optimization

- Min instances: 0 (scale to zero)
- Document AI: ~$1.50/1000 pages
- Vision OCR: ~$1.50/1000 images
- Gemini Pro: ~$0.00025/1K input tokens

## Error Handling

All errors include:
- `requestId` - For tracing
- `stage` - Where error occurred
- `message` - Human-readable error
- `fallbacks_used` - What was tried
