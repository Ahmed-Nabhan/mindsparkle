-- ============================================
-- Fix RBAC Infinite Recursion
-- MindSparkle - Hotfix
-- ============================================
-- 
-- PROBLEM: The user_roles RLS policies check user_roles table,
-- causing infinite recursion when querying user_roles.
--
-- SOLUTION: Use SECURITY DEFINER functions that bypass RLS
-- instead of inline EXISTS queries in policies.

-- ============================================
-- STEP 1: Drop problematic policies
-- ============================================
DROP POLICY IF EXISTS "Admins can view all roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON user_roles;

-- Also drop problematic policies on vendor_permissions
DROP POLICY IF EXISTS "Admins can view all permissions" ON vendor_permissions;

-- ============================================
-- STEP 2: Create helper function that bypasses RLS
-- ============================================
-- This function checks admin status WITHOUT triggering RLS
CREATE OR REPLACE FUNCTION check_is_admin_bypass_rls(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_id = check_user_id 
        AND role = 'admin'
        AND (expires_at IS NULL OR expires_at > NOW())
    );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION check_is_admin_bypass_rls TO authenticated;

-- ============================================
-- STEP 3: Recreate user_roles policies (no recursion)
-- ============================================

-- Users can view their own role (simple, no recursion)
CREATE POLICY "Users can view own role" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all roles (uses bypass function)
CREATE POLICY "Admins can view all roles" ON user_roles
    FOR SELECT USING (check_is_admin_bypass_rls(auth.uid()));

-- Admins can insert roles
CREATE POLICY "Admins can insert roles" ON user_roles
    FOR INSERT WITH CHECK (check_is_admin_bypass_rls(auth.uid()));

-- Admins can update roles
CREATE POLICY "Admins can update roles" ON user_roles
    FOR UPDATE USING (check_is_admin_bypass_rls(auth.uid()));

-- Admins can delete roles  
CREATE POLICY "Admins can delete roles" ON user_roles
    FOR DELETE USING (check_is_admin_bypass_rls(auth.uid()));

-- ============================================
-- STEP 4: Recreate vendor_permissions admin policy
-- ============================================
CREATE POLICY "Admins can view all permissions" ON vendor_permissions
    FOR SELECT USING (check_is_admin_bypass_rls(auth.uid()));

-- ============================================
-- STEP 5: Update is_admin() to use bypass function
-- ============================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT check_is_admin_bypass_rls(auth.uid());
$$;

-- ============================================
-- STEP 6: Fix can_access_document to handle NULL
-- ============================================
CREATE OR REPLACE FUNCTION can_access_document(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    doc_owner UUID;
    current_user_id UUID;
BEGIN
    -- Handle NULL document ID
    IF doc_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    current_user_id := auth.uid();
    
    -- Not authenticated
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if admin (using bypass function)
    IF check_is_admin_bypass_rls(current_user_id) THEN
        RETURN TRUE;
    END IF;
    
    -- Check if user owns the document
    SELECT user_id INTO doc_owner 
    FROM documents 
    WHERE id = doc_id;
    
    IF doc_owner = current_user_id THEN
        RETURN TRUE;
    END IF;
    
    -- Check vendor permissions (shared with user or shared with all)
    IF EXISTS (
        SELECT 1 FROM vendor_permissions vp
        WHERE vp.document_id = doc_id
        AND (vp.shared_with_user_id = current_user_id OR vp.shared_with_all = TRUE)
        AND (vp.expires_at IS NULL OR vp.expires_at > NOW())
    ) THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$;

-- ============================================
-- VERIFICATION
-- ============================================
COMMENT ON FUNCTION check_is_admin_bypass_rls IS 
'Checks if user is admin without triggering RLS on user_roles table. 
Used to prevent infinite recursion in RLS policies.';

COMMENT ON FUNCTION is_admin IS 
'Safe wrapper around check_is_admin_bypass_rls for use in RLS policies.';

COMMENT ON FUNCTION can_access_document IS 
'Checks if current user can access a document. Handles NULL IDs gracefully.';
