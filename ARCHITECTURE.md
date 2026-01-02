# MindSparkle Architecture

## 🏗️ System Overview

MindSparkle is an AI-powered study companion that transforms documents into interactive learning experiences. The architecture follows a clean separation between the mobile frontend and backend services, with all AI processing handled server-side.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MINDSPARKLE ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐    │
│  │   iOS App    │     │  Android App │     │    Web App (Future)      │    │
│  │  (Expo Go)   │     │   (Expo Go)  │     │     (React/Next.js)      │    │
│  └──────┬───────┘     └──────┬───────┘     └────────────┬─────────────┘    │
│         │                    │                          │                   │
│         └────────────────────┼──────────────────────────┘                   │
│                              │                                              │
│                              ▼                                              │
│         ┌────────────────────────────────────────────┐                     │
│         │         Supabase API Gateway               │                     │
│         │    (Auth, REST, Realtime, Storage)         │                     │
│         └────────────────────┬───────────────────────┘                     │
│                              │                                              │
│         ┌────────────────────┼───────────────────────┐                     │
│         │                    │                       │                     │
│         ▼                    ▼                       ▼                     │
│  ┌─────────────┐    ┌───────────────┐    ┌─────────────────────┐          │
│  │  PostgreSQL │    │ Edge Functions│    │   Supabase Storage  │          │
│  │  Database   │    │  (Deno/TS)    │    │   (S3 Compatible)   │          │
│  │  + RLS      │    │               │    │                     │          │
│  └─────────────┘    └───────┬───────┘    └─────────────────────┘          │
│                             │                                              │
│                             ▼                                              │
│         ┌────────────────────────────────────────────┐                     │
│         │           AI Processing Layer              │                     │
│         │                                            │                     │
│         │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │                     │
│         │  │  OpenAI  │ │  Gemini  │ │  Claude  │   │                     │
│         │  │ GPT-4o   │ │  2.0     │ │  3.5     │   │                     │
│         │  └──────────┘ └──────────┘ └──────────┘   │                     │
│         └────────────────────────────────────────────┘                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📱 Mobile App Layer

### Technology Stack
- **Framework**: React Native with Expo SDK 53
- **Language**: TypeScript
- **State Management**: React Context + Hooks
- **Navigation**: React Navigation v6
- **UI Components**: Custom components with React Native Paper

### Core Principle: UI Only
```
┌──────────────────────────────────────────────────────────────────┐
│                        MOBILE APP RULES                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ ALLOWED:                                                     │
│     • Render UI components                                       │
│     • Handle user interactions                                   │
│     • Call documentIntelligenceService methods                   │
│     • Subscribe to Realtime updates                              │
│     • Display progress/status                                    │
│                                                                  │
│  ❌ NOT ALLOWED:                                                 │
│     • Direct database queries                                    │
│     • Direct AI API calls                                        │
│     • File system manipulation (except temp)                     │
│     • Business logic                                             │
│     • Data transformation                                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### App Structure
```
src/
├── components/          # Reusable UI components
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── DocumentUploader.tsx    # File picker only
│   ├── Header.tsx
│   └── LoadingSpinner.tsx
│
├── screens/            # Screen components (UI only)
│   ├── HomeScreen.tsx
│   ├── UploadScreen.tsx
│   ├── StudyScreen.tsx
│   ├── QuizScreen.tsx
│   ├── FlashcardScreen.tsx
│   ├── InterviewScreen.tsx
│   ├── LabsScreen.tsx
│   ├── VideoScreen.tsx
│   └── SettingsScreen.tsx
│
├── context/            # React contexts
│   ├── AuthContext.tsx         # User session
│   ├── DocumentContext.tsx     # Document state + Realtime
│   ├── PremiumContext.tsx      # Subscription state
│   └── ThemeContext.tsx        # UI theme
│
├── hooks/              # Custom hooks
│   ├── useDocument.ts          # Calls documentIntelligenceService
│   ├── usePremium.ts
│   └── usePerformance.ts
│
├── navigation/         # Navigation setup
│   ├── AppNavigator.tsx
│   └── types.ts
│
└── services/           # Service layer (single entry points)
    └── documentIntelligenceService.ts  # THE entry point
```

---

## 🔌 Service Layer (Single Entry Point)

### documentIntelligenceService.ts

This is the **ONLY** entry point for all document operations. No screen or component should bypass this.

```typescript
// src/services/documentIntelligenceService.ts

/**
 * SINGLE ENTRY POINT for all document operations
 * 
 * Mobile App → documentIntelligenceService → Supabase/Edge Functions
 */

export interface DocumentService {
  // Upload & Processing
  uploadDocument(file: File, userId: string): Promise<UploadResult>;
  
  // Delete (soft delete)
  deleteDocument(documentId: string, userId: string): Promise<DeleteResult>;
  
  // Read
  getDocument(documentId: string): Promise<Document>;
  getDocuments(userId: string): Promise<Document[]>;
  
  // AI Processing
  generateSummary(documentId: string): Promise<Summary>;
  generateQuiz(documentId: string, options: QuizOptions): Promise<Quiz>;
  generateFlashcards(documentId: string): Promise<Flashcard[]>;
  generateInterview(documentId: string): Promise<Interview>;
  generateLabs(documentId: string): Promise<Lab[]>;
  generateVideo(documentId: string): Promise<VideoScript>;
  
  // Status
  getProcessingStatus(documentId: string): Promise<ProcessingStatus>;
  subscribeToStatus(documentId: string, callback: StatusCallback): Unsubscribe;
}
```

### Flow Diagram
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DOCUMENT UPLOAD FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User selects file                                                          │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────┐                                                   │
│  │  DocumentUploader   │  UI Component (file picker only)                  │
│  │  (Component)        │                                                   │
│  └──────────┬──────────┘                                                   │
│             │                                                               │
│             │ onFileSelected(file)                                          │
│             ▼                                                               │
│  ┌─────────────────────┐                                                   │
│  │    useDocument      │  Hook (state management)                          │
│  │    (Hook)           │                                                   │
│  └──────────┬──────────┘                                                   │
│             │                                                               │
│             │ uploadDocument()                                              │
│             ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              documentIntelligenceService.uploadDocument()            │   │
│  │                                                                      │   │
│  │   1. Validate file                                                   │   │
│  │   2. Upload to Supabase Storage                                      │   │
│  │   3. Create document record (status: 'uploading')                    │   │
│  │   4. Trigger Edge Function for extraction                            │   │
│  │   5. Return documentId for tracking                                  │   │
│  │                                                                      │   │
│  └──────────┬──────────────────────────────────────────────────────────┘   │
│             │                                                               │
│             │ Supabase call                                                 │
│             ▼                                                               │
│  ┌─────────────────────┐                                                   │
│  │  Supabase Storage   │  File stored                                      │
│  └──────────┬──────────┘                                                   │
│             │                                                               │
│             ▼                                                               │
│  ┌─────────────────────┐                                                   │
│  │   Edge Function:    │  Text extraction                                  │
│  │   extract-text      │  (service_role - bypasses RLS)                    │
│  └──────────┬──────────┘                                                   │
│             │                                                               │
│             │ Updates document.extraction_status                            │
│             ▼                                                               │
│  ┌─────────────────────┐                                                   │
│  │  Realtime Update    │  Client receives status change                    │
│  │  → Mobile App       │                                                   │
│  └─────────────────────┘                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Layer (Supabase PostgreSQL)

### Schema Design
```sql
-- Core Tables

-- 1. Documents (main table)
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- File info
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  storage_path TEXT,
  
  -- Extraction status
  extraction_status TEXT DEFAULT 'pending' 
    CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed')),
  has_text BOOLEAN DEFAULT FALSE,
  extracted_text TEXT,
  text_length INT DEFAULT 0,
  
  -- Vendor detection
  vendor_id TEXT,
  vendor_name TEXT,
  vendor_confidence DECIMAL(3,2),
  certification_detected TEXT,
  
  -- Soft delete
  deleted_at TIMESTAMPTZ,  -- NULL = not deleted
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Document Chunks (for large documents)
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  token_count INT,
  embedding VECTOR(1536),  -- For semantic search
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AI Outputs (generated content)
CREATE TABLE document_ai_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  output_type TEXT NOT NULL 
    CHECK (output_type IN ('summary', 'quiz', 'flashcards', 'interview', 'labs', 'video')),
  content JSONB NOT NULL,
  model_used TEXT,
  tokens_used INT,
  processing_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. User Roles (RBAC)
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'user' 
    CHECK (role IN ('user', 'admin', 'vendor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 5. Processing Queue
CREATE TABLE processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  priority INT DEFAULT 5,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

### Row Level Security (RLS)
```sql
-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Users can only see their own non-deleted documents
CREATE POLICY "users_view_own_documents" ON documents
  FOR SELECT
  USING (
    auth.uid() = user_id 
    AND deleted_at IS NULL
  );

-- Admins can see all documents
CREATE POLICY "admins_view_all" ON documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Users can only soft-delete their own documents
CREATE POLICY "users_soft_delete_own" ON documents
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    -- Only allow updating deleted_at
    auth.uid() = user_id
  );
```

---

## ⚡ Edge Functions (Backend Processing)

### Function: extract-text
```typescript
// supabase/functions/extract-text/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // Uses service_role key - bypasses RLS
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { documentId } = await req.json()
  
  // 1. Get document from storage
  const { data: doc } = await supabase
    .from('documents')
    .select('storage_path, file_type')
    .eq('id', documentId)
    .single()
  
  // 2. Download file
  const { data: file } = await supabase.storage
    .from('documents')
    .download(doc.storage_path)
  
  // 3. Extract text based on file type
  let extractedText = ''
  
  if (doc.file_type === 'application/pdf') {
    extractedText = await extractPdfText(file)
    
    // If extraction fails, try OCR
    if (!extractedText || extractedText.length < 100) {
      extractedText = await performOCR(file)
    }
  } else if (doc.file_type.includes('word')) {
    extractedText = await extractDocxText(file)
  } else if (doc.file_type.includes('powerpoint')) {
    extractedText = await extractPptxText(file)
  }
  
  // 4. Update document with extracted text
  await supabase
    .from('documents')
    .update({
      extracted_text: extractedText,
      has_text: extractedText.length > 0,
      text_length: extractedText.length,
      extraction_status: 'completed',
      updated_at: new Date().toISOString()
    })
    .eq('id', documentId)
  
  // 5. Queue AI processing
  await supabase
    .from('processing_queue')
    .insert({
      document_id: documentId,
      task_type: 'ai_analysis',
      priority: 5
    })
  
  return new Response(JSON.stringify({ success: true }))
})
```

### Function: openai-proxy
```typescript
// supabase/functions/openai-proxy/index.ts

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { documentId, mode, options } = await req.json()
  
  // 1. Get document content
  const { data: doc } = await supabase
    .from('documents')
    .select('extracted_text, vendor_id')
    .eq('id', documentId)
    .single()
  
  // 2. Route to appropriate AI model
  const model = selectModel(doc.vendor_id, mode, doc.extracted_text.length)
  
  // 3. Build prompt
  const prompt = buildPrompt(mode, doc.vendor_id, options)
  
  // 4. Call AI API
  const result = await callAI(model, prompt, doc.extracted_text)
  
  // 5. Store output
  await supabase
    .from('document_ai_outputs')
    .insert({
      document_id: documentId,
      output_type: mode,
      content: result,
      model_used: model,
      tokens_used: result.usage?.total_tokens
    })
  
  return new Response(JSON.stringify(result))
})
```

---

## 🤖 AI Processing Pipeline

### Model Selection (modelRouter)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AI MODEL ROUTER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Input: { content, vendor, mode, contentLength }                            │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      ROUTING RULES                                   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  TECHNICAL CONTENT (Cisco, AWS, Azure, CompTIA)                      │   │
│  │  └─► GPT-4o (best for technical accuracy)                            │   │
│  │                                                                      │   │
│  │  LABS MODE (any vendor)                                              │   │
│  │  └─► GPT-4o (needs precise CLI/config generation)                    │   │
│  │                                                                      │   │
│  │  QUIZ MODE (any vendor)                                              │   │
│  │  └─► GPT-4o-mini (cost-effective for Q&A)                            │   │
│  │                                                                      │   │
│  │  SUMMARY MODE (generic content)                                      │   │
│  │  └─► Gemini 2.0 Flash (fast, cheap)                                  │   │
│  │                                                                      │   │
│  │  VIDEO MODE (any)                                                    │   │
│  │  └─► GPT-4o (creative + structured output)                           │   │
│  │                                                                      │   │
│  │  LONG CONTENT (>50k tokens)                                          │   │
│  │  └─► Gemini 2.0 Flash (1M context window)                            │   │
│  │                                                                      │   │
│  │  INTERVIEW MODE                                                      │   │
│  │  └─► Claude 3.5 Sonnet (natural conversation)                        │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Output: { model, maxTokens, temperature, estimatedCost }                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### AI Models Used

| Model | Provider | Use Case | Context | Cost |
|-------|----------|----------|---------|------|
| **GPT-4o** | OpenAI | Technical content, Labs, Video | 128K | $5/$15 per 1M |
| **GPT-4o-mini** | OpenAI | Quizzes, Flashcards | 128K | $0.15/$0.60 per 1M |
| **Gemini 2.0 Flash** | Google | Summaries, Long docs | 1M | Free tier / $0.075 |
| **Claude 3.5 Sonnet** | Anthropic | Interview mode | 200K | $3/$15 per 1M |
| **GPT-4 Vision** | OpenAI | OCR for scanned PDFs | 128K | $10/$30 per 1M |

### Multi-Pass Processing
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       4-PASS PROCESSING PIPELINE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PASS 1: EXTRACTION                                                         │
│  ├── Extract key concepts, terms, definitions                               │
│  ├── Identify CLI commands and config blocks                                │
│  ├── Tag content by topic/section                                           │
│  └── Output: StructuredContent                                              │
│                                                                             │
│  PASS 2: GENERATION                                                         │
│  ├── Generate mode-specific output (summary, quiz, etc.)                    │
│  ├── Use vendor-aware prompts                                               │
│  ├── Apply appropriate formatting                                           │
│  └── Output: RawOutput                                                      │
│                                                                             │
│  PASS 3: VALIDATION                                                         │
│  ├── Check for hallucinations                                               │
│  ├── Verify facts against source                                            │
│  ├── Validate CLI syntax and config accuracy                                │
│  └── Output: ValidationReport                                               │
│                                                                             │
│  PASS 4: REFINEMENT                                                         │
│  ├── Apply corrections from validation                                      │
│  ├── Polish output formatting                                               │
│  ├── Optimize for readability                                               │
│  └── Output: FinalOutput                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Vendor Detection
```typescript
// Supported vendors and their detection patterns

const VENDORS = {
  cisco: {
    patterns: [
      /CCNA|CCNP|CCIE/i,
      /Router\s*[\(#>]/,
      /Switch\s*[\(#>]/,
      /show\s+(ip\s+)?route/i,
      /interface\s+\w+\d+\/\d+/i
    ],
    certifications: ['CCNA', 'CCNP', 'CCIE', 'DevNet']
  },
  
  aws: {
    patterns: [
      /AWS|Amazon Web Services/i,
      /EC2|S3|Lambda|DynamoDB/i,
      /aws\s+\w+/i,
      /CloudFormation|CloudWatch/i
    ],
    certifications: ['SAA-C03', 'SAP-C02', 'DVA-C02', 'SOA-C02']
  },
  
  azure: {
    patterns: [
      /Azure|Microsoft Azure/i,
      /AZ-\d{3}/i,
      /az\s+\w+/i,
      /Azure Active Directory/i
    ],
    certifications: ['AZ-104', 'AZ-305', 'AZ-400', 'AZ-900']
  },
  
  comptia: {
    patterns: [
      /CompTIA/i,
      /A\+|Network\+|Security\+/i,
      /220-\d{4}/i
    ],
    certifications: ['A+', 'Network+', 'Security+', 'CySA+']
  },
  
  // ... more vendors
}
```

---

## 🔐 Security & RBAC

### Authentication Flow
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User signs in (Email/Google/Apple)                                      │
│     └─► Supabase Auth creates session                                       │
│                                                                             │
│  2. JWT issued with user claims                                             │
│     └─► { sub: userId, email, role, ... }                                   │
│                                                                             │
│  3. Mobile app stores JWT                                                   │
│     └─► Secure storage (Keychain/Keystore)                                  │
│                                                                             │
│  4. All API calls include JWT                                               │
│     └─► Authorization: Bearer <jwt>                                         │
│                                                                             │
│  5. Supabase validates JWT                                                  │
│     └─► RLS policies use auth.uid()                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Role-Based Access Control
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RBAC MATRIX                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Permission              │ User │ Vendor │ Admin │                          │
│  ────────────────────────┼──────┼────────┼───────┤                          │
│  View own documents      │  ✅  │   ✅   │  ✅   │                          │
│  View all documents      │  ❌  │   ❌   │  ✅   │                          │
│  Upload documents        │  ✅  │   ✅   │  ✅   │                          │
│  Delete own documents    │  ✅  │   ✅   │  ✅   │                          │
│  Delete any document     │  ❌  │   ❌   │  ✅   │                          │
│  Share documents         │  ❌  │   ✅   │  ✅   │                          │
│  View analytics          │  ❌  │   ✅   │  ✅   │                          │
│  Manage users            │  ❌  │   ❌   │  ✅   │                          │
│  View audit logs         │  ❌  │   ❌   │  ✅   │                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service Role (Backend Only)
```
Edge Functions use service_role key:
- Bypasses all RLS policies
- Used for:
  - Text extraction (after user uploads)
  - AI processing (background jobs)
  - Admin operations
  
⚠️ NEVER expose service_role key to frontend
```

---

## 📡 Realtime Updates

### Subscription Setup
```typescript
// DocumentContext.tsx

useEffect(() => {
  const channel = supabase
    .channel('document-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'documents',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          addDocument(payload.new)
        } else if (payload.eventType === 'UPDATE') {
          updateDocument(payload.new)
        } else if (payload.eventType === 'DELETE') {
          removeDocument(payload.old.id)
        }
      }
    )
    .subscribe()
    
  return () => {
    supabase.removeChannel(channel)
  }
}, [userId])
```

### Status Updates Flow
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Edge Function│────►│  PostgreSQL  │────►│  Realtime    │
│ updates doc  │     │  triggers    │     │  broadcasts  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │  Mobile App  │
                                          │  UI updates  │
                                          └──────────────┘
```

---

## 🚀 Deployment

### Environments
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ENVIRONMENTS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DEVELOPMENT                                                                │
│  ├── Expo Go (no native builds needed)                                      │
│  ├── Supabase local or staging project                                      │
│  └── .env.development                                                       │
│                                                                             │
│  STAGING                                                                    │
│  ├── EAS Development build                                                  │
│  ├── Supabase staging project                                               │
│  └── TestFlight / Internal Testing                                          │
│                                                                             │
│  PRODUCTION                                                                 │
│  ├── EAS Production build                                                   │
│  ├── Supabase production project                                            │
│  ├── App Store / Play Store                                                 │
│  └── RevenueCat for subscriptions                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Infrastructure
```yaml
# Production Stack

Mobile App:
  - iOS: App Store
  - Android: Play Store
  - Built with: EAS Build

Backend:
  - Platform: Supabase (managed)
  - Database: PostgreSQL 15
  - Storage: S3-compatible
  - Functions: Deno Edge Runtime
  - Region: US East (or closest to users)

AI APIs:
  - OpenAI: GPT-4o, GPT-4o-mini, Vision
  - Google: Gemini 2.0 Flash
  - Anthropic: Claude 3.5 Sonnet (optional)

Payments:
  - RevenueCat (subscription management)
  - Apple App Store / Google Play billing

Monitoring:
  - Sentry (error tracking)
  - Supabase Dashboard (logs, metrics)
```

---

## 📊 Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE DATA FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. UPLOAD                                                                  │
│     User → App → documentIntelligenceService.uploadDocument()               │
│           → Supabase Storage → Edge Function (extract-text)                 │
│           → PostgreSQL (documents table)                                    │
│           → Realtime → App (status: uploaded)                               │
│                                                                             │
│  2. EXTRACTION                                                              │
│     Edge Function → PDF/DOCX parser → OCR fallback if needed                │
│           → PostgreSQL (extracted_text, has_text = true)                    │
│           → Realtime → App (status: extracted)                              │
│                                                                             │
│  3. AI PROCESSING                                                           │
│     User requests summary/quiz/etc                                          │
│           → App → documentIntelligenceService.generateX()                   │
│           → Edge Function (openai-proxy)                                    │
│           → Model Router → Selected AI API                                  │
│           → 4-pass processing                                               │
│           → PostgreSQL (document_ai_outputs)                                │
│           → Realtime → App (content displayed)                              │
│                                                                             │
│  4. DELETE                                                                  │
│     User → App → documentIntelligenceService.deleteDocument()               │
│           → PostgreSQL (deleted_at = NOW())                                 │
│           → Realtime → App (document hidden)                                │
│                                                                             │
│  5. SYNC                                                                    │
│     On app open → documentIntelligenceService.getDocuments()                │
│           → PostgreSQL (RLS filters by user_id, deleted_at IS NULL)         │
│           → App displays documents                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuration Files

### Environment Variables
```bash
# .env

# Supabase
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# AI APIs (server-side only - in Supabase secrets)
# OPENAI_API_KEY=sk-...
# GOOGLE_AI_KEY=...
# ANTHROPIC_API_KEY=...

# RevenueCat
EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_...
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_...

# Feature flags
EXPO_PUBLIC_ENABLE_VIDEO=true
EXPO_PUBLIC_ENABLE_LABS=true
```

### Supabase Secrets (Edge Functions)
```bash
# Set via Supabase CLI
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set GOOGLE_AI_KEY=...
supabase secrets set ANTHROPIC_API_KEY=...
```

---

## 📱 Feature Modes

| Mode | Description | AI Model | Output |
|------|-------------|----------|--------|
| **Summary** | Condensed overview | Gemini 2.0 Flash | Markdown text |
| **Study** | Detailed study guide | GPT-4o | Sections + key points |
| **Quiz** | Multiple choice questions | GPT-4o-mini | JSON quiz data |
| **Flashcards** | Q&A cards for memorization | GPT-4o-mini | Array of cards |
| **Interview** | Mock interview questions | Claude 3.5 Sonnet | Conversational Q&A |
| **Labs** | Hands-on exercises | GPT-4o | CLI commands + configs |
| **Video** | Video script generation | GPT-4o | Scenes + narration |
| **Audio** | Text-to-speech summary | OpenAI TTS | MP3 audio file |

---

*Last updated: January 2, 2026*
