-- ============================================
-- MINDSPARKLE PRODUCTION-READY SCHEMA
-- Migration: 20260102100000_production_ready_schema.sql
-- 
-- This migration:
-- 1. Fixes RBAC infinite recursion (42P17)
-- 2. Adds soft delete support (deleted_at)
-- 3. Creates proper RLS policies
-- 4. Adds processing queue for AI jobs
-- 5. Adds audit logging
-- ============================================

-- ============================================
-- STEP 1: DROP PROBLEMATIC POLICIES
-- ============================================

-- Drop existing policies that cause infinite recursion
DROP POLICY IF EXISTS "user_roles_select_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_insert_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_update_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_delete_policy" ON user_roles;
DROP POLICY IF EXISTS "users_view_own_documents" ON documents;
DROP POLICY IF EXISTS "admins_view_all" ON documents;
DROP POLICY IF EXISTS "users_soft_delete_own" ON documents;

-- ============================================
-- STEP 2: CREATE SECURITY DEFINER FUNCTIONS
-- These bypass RLS to prevent infinite recursion
-- ============================================

-- Function to check if user is admin (SECURITY DEFINER - bypasses RLS)
CREATE OR REPLACE FUNCTION check_is_admin_safe(check_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  user_role TEXT;
BEGIN
  -- Use provided user_id or current auth user
  target_user_id := COALESCE(check_user_id, auth.uid());
  
  IF target_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Direct query bypassing RLS
  SELECT role INTO user_role
  FROM user_roles
  WHERE user_id = target_user_id
  LIMIT 1;
  
  RETURN COALESCE(user_role = 'admin', FALSE);
END;
$$;

-- Function to get user role (SECURITY DEFINER - bypasses RLS)
CREATE OR REPLACE FUNCTION get_user_role_safe(check_user_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  user_role TEXT;
BEGIN
  target_user_id := COALESCE(check_user_id, auth.uid());
  
  IF target_user_id IS NULL THEN
    RETURN 'user';
  END IF;
  
  SELECT role INTO user_role
  FROM user_roles
  WHERE user_id = target_user_id
  LIMIT 1;
  
  RETURN COALESCE(user_role, 'user');
END;
$$;

-- Function to check document access (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION can_access_document_safe(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  doc_owner_id UUID;
  is_admin BOOLEAN;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Check if admin
  is_admin := check_is_admin_safe(current_user_id);
  IF is_admin THEN
    RETURN TRUE;
  END IF;
  
  -- Check document ownership
  SELECT user_id INTO doc_owner_id
  FROM documents
  WHERE id = doc_id AND deleted_at IS NULL
  LIMIT 1;
  
  RETURN doc_owner_id = current_user_id;
END;
$$;

-- ============================================
-- STEP 3: ALTER DOCUMENTS TABLE
-- Add missing columns for production
-- ============================================

-- Add soft delete column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE documents ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;

-- Add extraction_status if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'extraction_status'
  ) THEN
    ALTER TABLE documents ADD COLUMN extraction_status TEXT DEFAULT 'pending';
  END IF;
END $$;

-- Add has_text flag if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'has_text'
  ) THEN
    ALTER TABLE documents ADD COLUMN has_text BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add text_length if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'text_length'
  ) THEN
    ALTER TABLE documents ADD COLUMN text_length INT DEFAULT 0;
  END IF;
END $$;

-- Add upload_id for deduplication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'upload_id'
  ) THEN
    ALTER TABLE documents ADD COLUMN upload_id UUID DEFAULT NULL;
  END IF;
END $$;

-- ============================================
-- STEP 4: CREATE INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_documents_extraction_status ON documents(extraction_status);
CREATE INDEX IF NOT EXISTS idx_documents_upload_id ON documents(upload_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

-- ============================================
-- STEP 5: CREATE AUDIT LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================
-- STEP 6: CREATE PROCESSING QUEUE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  priority INT DEFAULT 5,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  last_error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(document_id, task_type, status)
);

CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_processing_queue_document ON processing_queue(document_id);

-- ============================================
-- STEP 7: CREATE DOCUMENT AI OUTPUTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS document_ai_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  output_type TEXT NOT NULL CHECK (output_type IN ('summary', 'quiz', 'flashcards', 'interview', 'labs', 'video', 'audio')),
  content JSONB NOT NULL,
  model_used TEXT,
  tokens_used INT,
  processing_time_ms INT,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_id, output_type, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_outputs_document ON document_ai_outputs(document_id);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_type ON document_ai_outputs(output_type);

-- ============================================
-- STEP 8: RLS POLICIES FOR USER_ROLES
-- Using SECURITY DEFINER functions to avoid recursion
-- ============================================

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role
CREATE POLICY "users_read_own_role" ON user_roles
  FOR SELECT
  USING (user_id = auth.uid());

-- Admins can read all roles (using safe function)
CREATE POLICY "admins_read_all_roles" ON user_roles
  FOR SELECT
  USING (check_is_admin_safe());

-- Only admins can insert roles
CREATE POLICY "admins_insert_roles" ON user_roles
  FOR INSERT
  WITH CHECK (check_is_admin_safe());

-- Only admins can update roles
CREATE POLICY "admins_update_roles" ON user_roles
  FOR UPDATE
  USING (check_is_admin_safe())
  WITH CHECK (check_is_admin_safe());

-- Only admins can delete roles
CREATE POLICY "admins_delete_roles" ON user_roles
  FOR DELETE
  USING (check_is_admin_safe());

-- ============================================
-- STEP 9: RLS POLICIES FOR DOCUMENTS
-- ============================================

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Users can see their own non-deleted documents
CREATE POLICY "users_select_own_documents" ON documents
  FOR SELECT
  USING (
    (user_id = auth.uid() AND deleted_at IS NULL)
    OR check_is_admin_safe()
  );

-- Users can insert their own documents
CREATE POLICY "users_insert_own_documents" ON documents
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own documents (including soft delete)
CREATE POLICY "users_update_own_documents" ON documents
  FOR UPDATE
  USING (user_id = auth.uid() OR check_is_admin_safe())
  WITH CHECK (user_id = auth.uid() OR check_is_admin_safe());

-- Only admins can hard delete
CREATE POLICY "admins_delete_documents" ON documents
  FOR DELETE
  USING (check_is_admin_safe());

-- ============================================
-- STEP 10: RLS POLICIES FOR AI OUTPUTS
-- ============================================

ALTER TABLE document_ai_outputs ENABLE ROW LEVEL SECURITY;

-- Users can see AI outputs for their documents
CREATE POLICY "users_select_ai_outputs" ON document_ai_outputs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM documents d 
      WHERE d.id = document_id 
      AND (d.user_id = auth.uid() OR check_is_admin_safe())
      AND d.deleted_at IS NULL
    )
  );

-- Service role inserts (via Edge Functions)
CREATE POLICY "service_insert_ai_outputs" ON document_ai_outputs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents d 
      WHERE d.id = document_id 
      AND (d.user_id = auth.uid() OR check_is_admin_safe())
    )
  );

-- ============================================
-- STEP 11: RLS POLICIES FOR AUDIT LOGS
-- ============================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "admins_view_audit_logs" ON audit_logs
  FOR SELECT
  USING (check_is_admin_safe());

-- Anyone authenticated can insert audit logs
CREATE POLICY "users_insert_audit_logs" ON audit_logs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- STEP 12: RLS POLICIES FOR PROCESSING QUEUE
-- ============================================

ALTER TABLE processing_queue ENABLE ROW LEVEL SECURITY;

-- Users can see processing status for their documents
CREATE POLICY "users_select_queue" ON processing_queue
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM documents d 
      WHERE d.id = document_id 
      AND (d.user_id = auth.uid() OR check_is_admin_safe())
    )
  );

-- ============================================
-- STEP 13: HELPER FUNCTIONS
-- ============================================

-- Function to soft delete a document
CREATE OR REPLACE FUNCTION soft_delete_document(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  doc_owner_id UUID;
  is_admin BOOLEAN;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check if admin
  is_admin := check_is_admin_safe(current_user_id);
  
  -- Get document owner
  SELECT user_id INTO doc_owner_id
  FROM documents
  WHERE id = doc_id AND deleted_at IS NULL;
  
  IF doc_owner_id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  
  -- Check permission
  IF NOT is_admin AND doc_owner_id != current_user_id THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Soft delete
  UPDATE documents
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = doc_id;
  
  -- Log the action
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (current_user_id, 'soft_delete', 'document', doc_id, jsonb_build_object('deleted_by', current_user_id));
  
  RETURN TRUE;
END;
$$;

-- Function to check if upload is duplicate
CREATE OR REPLACE FUNCTION is_duplicate_upload(p_upload_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM documents
    WHERE upload_id = p_upload_id
    AND deleted_at IS NULL
  );
END;
$$;

-- Function to validate UUID
CREATE OR REPLACE FUNCTION is_valid_uuid(text_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN text_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

-- ============================================
-- STEP 14: GRANT PERMISSIONS
-- ============================================

-- Grant execute on functions to authenticated users
GRANT EXECUTE ON FUNCTION check_is_admin_safe TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_role_safe TO authenticated;
GRANT EXECUTE ON FUNCTION can_access_document_safe TO authenticated;
GRANT EXECUTE ON FUNCTION soft_delete_document TO authenticated;
GRANT EXECUTE ON FUNCTION is_duplicate_upload TO authenticated;
GRANT EXECUTE ON FUNCTION is_valid_uuid TO authenticated;

-- Grant service_role full access (for Edge Functions)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ============================================
-- STEP 15: CREATE OWNER ADMIN ENTRY
-- ============================================

-- Ensure owner has admin role
INSERT INTO user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'ahmedadel737374@icloud.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

COMMENT ON TABLE documents IS 'Main documents table with soft delete support';
COMMENT ON TABLE user_roles IS 'User roles for RBAC (admin, vendor, user)';
COMMENT ON TABLE audit_logs IS 'Audit trail for security-sensitive operations';
COMMENT ON TABLE processing_queue IS 'Queue for AI processing tasks';
COMMENT ON TABLE document_ai_outputs IS 'Cached AI-generated content';
