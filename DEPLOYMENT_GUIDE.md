# MindSparkle Production Deployment Guide

## Overview

This guide covers deploying the production-ready MindSparkle application with:
- Fixed RBAC/RLS policies (no more 42P17 recursion errors)
- Soft delete pattern
- Single entry point architecture
- Proper logging and error handling

## Prerequisites

- Supabase CLI installed: `npm install -g supabase`
- Supabase project created and linked
- EAS CLI for Expo: `npm install -g eas-cli`
- Environment variables configured

## Step 1: Deploy Database Migration

The migration file `20260102100000_production_ready_schema.sql` contains:
- SECURITY DEFINER functions to fix RBAC recursion
- Soft delete columns and functions
- Audit logging tables
- Processing queue tables
- Fixed RLS policies

```bash
# Navigate to project
cd /Users/ahmednabhan/Desktop/mindsparkle-main

# Link to your Supabase project (if not already linked)
npx supabase link --project-ref YOUR_PROJECT_REF

# Push migrations to production
npx supabase db push

# Verify migration applied
npx supabase db diff
```

### Verify RBAC Functions

After migration, verify the security functions exist:

```sql
-- In Supabase SQL Editor
SELECT proname FROM pg_proc WHERE proname IN (
  'check_is_admin_safe',
  'get_user_role_safe', 
  'can_access_document_safe',
  'soft_delete_document',
  'is_duplicate_upload'
);
```

## Step 2: Deploy Edge Functions

### Extract Text Function (v2)

```bash
# Deploy the new extract-text function
npx supabase functions deploy extract-text-v2 --no-verify-jwt

# Or update the existing one
npx supabase functions deploy extract-text --no-verify-jwt
```

### OpenAI Proxy Function

```bash
npx supabase functions deploy openai-proxy --no-verify-jwt
```

### Set Environment Variables

```bash
# Set secrets for Edge Functions
npx supabase secrets set OPENAI_API_KEY=your_openai_key
npx supabase secrets set GOOGLE_AI_API_KEY=your_google_key  # For Gemini
npx supabase secrets set ANTHROPIC_API_KEY=your_anthropic_key  # For Claude
```

### Configure Supabase Auth Redirect URLs (Required for password reset)

If your password reset emails are sending users to `http://localhost:3000`, your Supabase Auth URL settings are still in local-dev mode.

- Supabase Dashboard → Authentication → URL Configuration
- Set **Site URL** to your production site (or a non-local URL)
- Add these to **Redirect URLs**:
  - `mindsparkle://auth/callback`

Note: The app sends password reset emails with `redirectTo: mindsparkle://auth/callback`. If that redirect URL isn’t allow-listed, Supabase will fall back to your Site URL (often `localhost`).

## Step 3: Update App Code

### Replace Old Service with New

1. **Update imports in components:**

```typescript
// Old
import { uploadDocument } from '../services/documentIntelligenceService';

// New
import documentService from '../services/documentService';
// or
import { uploadDocument, deleteDocument, getDocuments } from '../services/documentService';
```

2. **Replace useDocument hook:**

```bash
# Backup old hook
mv src/hooks/useDocument.ts src/hooks/useDocument.old.ts

# Use new hook
mv src/hooks/useDocumentNew.ts src/hooks/useDocument.ts
```

3. **Update screen imports if needed:**

Check screens that use document operations:
- `HomeScreen.tsx`
- `UploadScreen.tsx`
- `FoldersScreen.tsx`
- `DocumentActionsScreen.tsx`

## Step 4: Configure Environment

### App Environment Variables

Create/update `.env` file:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
EXPO_PUBLIC_API_URL=https://your-project.supabase.co/functions/v1
```

### EAS Build Secrets

```bash
eas secret:create --name SUPABASE_URL --value https://your-project.supabase.co
eas secret:create --name SUPABASE_ANON_KEY --value your_anon_key
```

## Step 5: Build and Deploy

### Development Build

```bash
# Install dependencies
npm install

# Run locally
npx expo start

# Test on device
npx expo run:ios
# or
npx expo run:android
```

### Production Build

```bash
# Build for iOS
eas build --platform ios --profile production

# Build for Android
eas build --platform android --profile production

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

## Step 6: Verify Deployment

### Test Document Upload

1. Open app and sign in
2. Upload a PDF document
3. Verify in Supabase:
   - Document appears in `documents` table
   - `extraction_status` changes from `pending` → `processing` → `completed`
   - `audit_logs` has upload entry

### Test Document Delete

1. Select a document
2. Delete it
3. Verify in Supabase:
   - `deleted_at` column is set (soft delete)
   - Document no longer appears in app
   - `audit_logs` has delete entry

### Test RBAC

1. Sign in as admin
2. Verify admin can see all documents
3. Sign in as regular user
4. Verify user only sees own documents

### SQL Verification Queries

```sql
-- Check for deleted documents
SELECT id, title, deleted_at FROM documents WHERE deleted_at IS NOT NULL;

-- Check audit logs
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;

-- Check processing queue
SELECT * FROM processing_queue WHERE status != 'completed';

-- Verify admin role
SELECT * FROM user_roles WHERE role = 'admin';

-- Test RBAC function (should not error)
SELECT get_user_role_safe('some-user-id');
```

## Troubleshooting

### 42P17 Infinite Recursion Error

If you still see this error:
1. Verify migration was applied: `npx supabase db diff`
2. Check that SECURITY DEFINER functions exist
3. Drop old policies and recreate:

```sql
-- Drop old policies
DROP POLICY IF EXISTS "Users can view own role" ON user_roles;

-- Policies should use the _safe functions
CREATE POLICY "Users can view own role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id OR check_is_admin_safe(auth.uid()));
```

### 22P02 Invalid UUID Error

This happens when trying to query with invalid document IDs:
1. Ensure client code validates UUIDs before queries
2. Use `isValidUUID()` from validators
3. Local documents use different ID format - skip cloud operations for them

### Text Extraction Fails

1. Check Edge Function logs: `npx supabase functions logs extract-text-v2`
2. Verify storage bucket permissions
3. Check file was uploaded to storage: `npx supabase storage ls documents`

### Upload Stuck at Processing

1. Check `processing_queue` table for stuck jobs
2. Manually trigger extraction:

```sql
UPDATE documents 
SET extraction_status = 'pending' 
WHERE id = 'document-id' AND extraction_status = 'processing';
```

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                     Mobile App (Expo)                        │
├─────────────────────────────────────────────────────────────┤
│  UI Components → Hooks → documentService → Supabase         │
│                                                              │
│  DocumentUploader → useDocument → documentService.upload()  │
│  FoldersScreen   → useDocument → documentService.delete()   │
│  HomeScreen      → useDocument → documentService.get()      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Backend                          │
├─────────────────────────────────────────────────────────────┤
│  Auth (JWT) │ Storage (Documents) │ Database (PostgreSQL)   │
│             │                      │                         │
│  RLS Policies (SECURITY DEFINER functions)                  │
│  - check_is_admin_safe()                                    │
│  - get_user_role_safe()                                     │
│  - can_access_document_safe()                               │
│  - soft_delete_document()                                   │
├─────────────────────────────────────────────────────────────┤
│                    Edge Functions                            │
│  extract-text-v2: PDF/DOCX/PPTX extraction                  │
│  openai-proxy: AI model routing (GPT/Gemini/Claude)         │
└─────────────────────────────────────────────────────────────┘
```

## Files Changed

### New Files
- `supabase/migrations/20260102100000_production_ready_schema.sql`
- `src/services/documentService.ts` (new single entry point)
- `src/services/loggingService.ts`
- `src/hooks/useDocumentNew.ts`
- `supabase/functions/extract-text-v2/index.ts`

### Modified Files
- `src/utils/validators.ts` (added UUID validation)

### To Replace
- `src/hooks/useDocument.ts` → use `useDocumentNew.ts`
- `src/services/documentIntelligenceService.ts` → use `documentService.ts`

## Support

For issues:
1. Check Supabase logs: Dashboard → Logs
2. Check Edge Function logs: `npx supabase functions logs`
3. Enable debug logging in app: Set `__DEV__` to true

Pro Version: All users have full access
