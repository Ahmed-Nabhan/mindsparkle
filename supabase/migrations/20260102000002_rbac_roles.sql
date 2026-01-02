-- ============================================
-- Role-Based Access Control (RBAC) Migration
-- MindSparkle - Step 7
-- ============================================
-- 
-- OVERVIEW:
-- This migration implements a role-based access control system with three roles:
--   1. 'user'   - Standard user, can only access own documents
--   2. 'admin'  - Administrator, can access ALL documents and users
--   3. 'vendor' - Content vendor, can share documents with specific users
--
-- ARCHITECTURE:
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │                      RBAC Architecture                                  │
-- ├─────────────────────────────────────────────────────────────────────────┤
-- │                                                                          │
-- │  ┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐    │
-- │  │   Profiles  │     │ user_roles       │     │ vendor_permissions │    │
-- │  │  (user_id)  │<────│ (user_id, role)  │     │ (vendor_id,        │    │
-- │  └─────────────┘     └──────────────────┘     │  document_id,      │    │
-- │        │                     │                │  shared_user_id)   │    │
-- │        │                     │                └────────────────────┘    │
-- │        │                     │                          │               │
-- │        └─────────────────────┴──────────────────────────┘               │
-- │                              │                                          │
-- │                              ▼                                          │
-- │                    ┌──────────────────┐                                 │
-- │                    │    RLS Policies   │                                │
-- │                    │  - User sees own  │                                │
-- │                    │  - Admin sees all │                                │
-- │                    │  - Vendor shares  │                                │
-- │                    └──────────────────┘                                 │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- RLS POLICY LOGIC:
-- 1. User role: auth.uid() = user_id (standard - only own data)
-- 2. Admin role: Check user_roles table, if role='admin' allow all
-- 3. Vendor role: Check vendor_permissions for shared access
--

-- ============================================
-- STEP 1: Create Role Type Enum
-- ============================================
-- Using an ENUM for type safety and validation
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin', 'vendor');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- STEP 2: Create User Roles Table
-- ============================================
-- Stores role assignments for each user
-- A user can have one role (default: 'user')
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'user',
    granted_by UUID REFERENCES auth.users(id), -- Who granted this role (for audit)
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Optional role expiration
    notes TEXT, -- Admin notes about role grant
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Each user can only have one role
    CONSTRAINT unique_user_role UNIQUE (user_id)
);

-- Enable RLS on user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_roles table
-- Users can only view their own role
CREATE POLICY "Users can view own role" ON user_roles
    FOR SELECT USING (auth.uid() = user_id);

-- Only admins can modify roles (checked via function)
CREATE POLICY "Admins can view all roles" ON user_roles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            WHERE ur.user_id = auth.uid() 
            AND ur.role = 'admin'
        )
    );

CREATE POLICY "Admins can manage roles" ON user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            WHERE ur.user_id = auth.uid() 
            AND ur.role = 'admin'
        )
    );

-- Index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- ============================================
-- STEP 3: Create Vendor Permissions Table
-- ============================================
-- Tracks which documents vendors have shared with which users
CREATE TABLE IF NOT EXISTS vendor_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    shared_with_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    shared_with_all BOOLEAN DEFAULT FALSE, -- If true, shared with all users
    permission_level TEXT DEFAULT 'read', -- 'read', 'write', 'admin'
    expires_at TIMESTAMPTZ, -- Optional permission expiration
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint for vendor-document-user combination
    CONSTRAINT unique_vendor_permission UNIQUE (vendor_id, document_id, shared_with_user_id)
);

-- Enable RLS on vendor_permissions
ALTER TABLE vendor_permissions ENABLE ROW LEVEL SECURITY;

-- Vendors can manage their own permissions
CREATE POLICY "Vendors can view own permissions" ON vendor_permissions
    FOR SELECT USING (auth.uid() = vendor_id);

CREATE POLICY "Vendors can manage own permissions" ON vendor_permissions
    FOR ALL USING (auth.uid() = vendor_id);

-- Users can see permissions shared with them
CREATE POLICY "Users can view permissions shared with them" ON vendor_permissions
    FOR SELECT USING (auth.uid() = shared_with_user_id OR shared_with_all = TRUE);

-- Admins can see all permissions
CREATE POLICY "Admins can view all permissions" ON vendor_permissions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            WHERE ur.user_id = auth.uid() 
            AND ur.role = 'admin'
        )
    );

-- Indexes for fast permission lookups
CREATE INDEX IF NOT EXISTS idx_vendor_permissions_vendor_id ON vendor_permissions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_permissions_document_id ON vendor_permissions(document_id);
CREATE INDEX IF NOT EXISTS idx_vendor_permissions_shared_user ON vendor_permissions(shared_with_user_id);

-- ============================================
-- STEP 4: Helper Functions for RBAC
-- ============================================

-- Function to get current user's role
-- Returns 'user' if no explicit role is set
CREATE OR REPLACE FUNCTION get_user_role(check_user_id UUID DEFAULT NULL)
RETURNS user_role
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_user UUID;
    found_role user_role;
BEGIN
    -- Use provided user_id or current auth user
    target_user := COALESCE(check_user_id, auth.uid());
    
    -- Look up role from user_roles table
    SELECT role INTO found_role
    FROM user_roles
    WHERE user_id = target_user
    AND (expires_at IS NULL OR expires_at > NOW());
    
    -- Return 'user' as default if no role found
    RETURN COALESCE(found_role, 'user');
END;
$$;

-- Function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN get_user_role(auth.uid()) = 'admin';
END;
$$;

-- Function to check if current user is vendor
CREATE OR REPLACE FUNCTION is_vendor()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN get_user_role(auth.uid()) = 'vendor';
END;
$$;

-- Function to check if user can access a specific document
-- RBAC Logic:
-- 1. User owns the document → allowed
-- 2. User is admin → allowed
-- 3. Document is shared with user via vendor_permissions → allowed
-- 4. Otherwise → denied
CREATE OR REPLACE FUNCTION can_access_document(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    doc_owner UUID;
    user_role_val user_role;
BEGIN
    -- Get the document owner
    SELECT user_id INTO doc_owner FROM documents WHERE id = doc_id;
    
    -- If document doesn't exist, deny access
    IF doc_owner IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check 1: User owns the document
    IF doc_owner = auth.uid() THEN
        RETURN TRUE;
    END IF;
    
    -- Check 2: User is admin
    user_role_val := get_user_role(auth.uid());
    IF user_role_val = 'admin' THEN
        RETURN TRUE;
    END IF;
    
    -- Check 3: Document shared via vendor permissions
    IF EXISTS (
        SELECT 1 FROM vendor_permissions vp
        WHERE vp.document_id = doc_id
        AND (
            vp.shared_with_user_id = auth.uid()
            OR vp.shared_with_all = TRUE
        )
        AND (vp.expires_at IS NULL OR vp.expires_at > NOW())
    ) THEN
        RETURN TRUE;
    END IF;
    
    -- Default: deny access
    RETURN FALSE;
END;
$$;

-- ============================================
-- STEP 5: Update Documents RLS Policies
-- ============================================
-- Drop existing policies and recreate with RBAC support

-- Drop old policies
DROP POLICY IF EXISTS "Users can view own documents" ON documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON documents;
DROP POLICY IF EXISTS "Users can update own documents" ON documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON documents;

-- New RBAC-aware policies for documents

-- SELECT: Users see own + admin sees all + vendor-shared
CREATE POLICY "rbac_documents_select" ON documents
    FOR SELECT USING (
        -- User owns document
        auth.uid() = user_id
        -- OR user is admin (sees all)
        OR is_admin()
        -- OR document is shared via vendor permissions
        OR EXISTS (
            SELECT 1 FROM vendor_permissions vp
            WHERE vp.document_id = id
            AND (
                vp.shared_with_user_id = auth.uid()
                OR vp.shared_with_all = TRUE
            )
            AND (vp.expires_at IS NULL OR vp.expires_at > NOW())
        )
    );

-- INSERT: Users can only create documents for themselves
-- Admins cannot create documents for other users (data integrity)
CREATE POLICY "rbac_documents_insert" ON documents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users update own + admin updates all + vendors update shared
CREATE POLICY "rbac_documents_update" ON documents
    FOR UPDATE USING (
        -- User owns document
        auth.uid() = user_id
        -- OR user is admin
        OR is_admin()
        -- OR vendor shared with write permission
        OR EXISTS (
            SELECT 1 FROM vendor_permissions vp
            WHERE vp.document_id = id
            AND vp.vendor_id = auth.uid()
            AND vp.permission_level IN ('write', 'admin')
        )
    );

-- DELETE: Users delete own + admin deletes all
-- Vendors cannot delete shared documents
CREATE POLICY "rbac_documents_delete" ON documents
    FOR DELETE USING (
        -- User owns document
        auth.uid() = user_id
        -- OR user is admin
        OR is_admin()
    );

-- ============================================
-- STEP 6: Update Document Analysis RLS Policies
-- ============================================
DROP POLICY IF EXISTS "Users can view own analysis" ON document_analysis;
DROP POLICY IF EXISTS "Users can insert own analysis" ON document_analysis;
DROP POLICY IF EXISTS "Users can update own analysis" ON document_analysis;

-- RBAC-aware policies for document_analysis
CREATE POLICY "rbac_analysis_select" ON document_analysis
    FOR SELECT USING (
        auth.uid() = user_id
        OR is_admin()
        OR can_access_document(document_id)
    );

CREATE POLICY "rbac_analysis_insert" ON document_analysis
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "rbac_analysis_update" ON document_analysis
    FOR UPDATE USING (
        auth.uid() = user_id
        OR is_admin()
    );

-- ============================================
-- STEP 7: Update AI Summaries RLS Policies
-- ============================================
DROP POLICY IF EXISTS "Users can view own summaries" ON ai_summaries;
DROP POLICY IF EXISTS "Users can insert own summaries" ON ai_summaries;
DROP POLICY IF EXISTS "Users can update own summaries" ON ai_summaries;

-- RBAC-aware policies for ai_summaries
CREATE POLICY "rbac_summaries_select" ON ai_summaries
    FOR SELECT USING (
        auth.uid() = user_id
        OR is_admin()
        OR can_access_document(document_id)
    );

CREATE POLICY "rbac_summaries_insert" ON ai_summaries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "rbac_summaries_update" ON ai_summaries
    FOR UPDATE USING (
        auth.uid() = user_id
        OR is_admin()
    );

-- ============================================
-- STEP 8: Update Knowledge Graphs RLS Policies
-- ============================================
DROP POLICY IF EXISTS "Users can view own graphs" ON knowledge_graphs;
DROP POLICY IF EXISTS "Users can insert own graphs" ON knowledge_graphs;
DROP POLICY IF EXISTS "Users can update own graphs" ON knowledge_graphs;

-- RBAC-aware policies for knowledge_graphs
CREATE POLICY "rbac_graphs_select" ON knowledge_graphs
    FOR SELECT USING (
        auth.uid() = user_id
        OR is_admin()
        OR can_access_document(document_id)
    );

CREATE POLICY "rbac_graphs_insert" ON knowledge_graphs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "rbac_graphs_update" ON knowledge_graphs
    FOR UPDATE USING (
        auth.uid() = user_id
        OR is_admin()
    );

-- ============================================
-- STEP 9: Update Profiles RLS for Admin Access
-- ============================================
-- Admins need to view all profiles for user management

-- Add admin policy for profiles
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (is_admin());

CREATE POLICY "Admins can update all profiles" ON profiles
    FOR UPDATE USING (is_admin());

-- ============================================
-- STEP 10: Add Role Column to Profiles (Denormalized)
-- ============================================
-- For quick role checks without joining tables
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'user';

-- Function to sync role to profiles table when user_roles changes
CREATE OR REPLACE FUNCTION sync_role_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Update the denormalized role column in profiles
    UPDATE profiles 
    SET role = NEW.role, updated_at = NOW()
    WHERE id = NEW.user_id;
    
    RETURN NEW;
END;
$$;

-- Trigger to sync roles
DROP TRIGGER IF EXISTS sync_role_trigger ON user_roles;
CREATE TRIGGER sync_role_trigger
    AFTER INSERT OR UPDATE ON user_roles
    FOR EACH ROW
    EXECUTE FUNCTION sync_role_to_profile();

-- ============================================
-- STEP 11: Create Default Admin User (First User)
-- ============================================
-- This function creates an admin role for the first user who signs up
-- Useful for initial setup
CREATE OR REPLACE FUNCTION setup_first_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_count INTEGER;
BEGIN
    -- Count existing users (excluding this one)
    SELECT COUNT(*) INTO user_count FROM auth.users WHERE id != NEW.id;
    
    -- If this is the first user, make them admin
    IF user_count = 0 THEN
        INSERT INTO user_roles (user_id, role, notes)
        VALUES (NEW.id, 'admin', 'Auto-assigned as first user (app owner)');
        
        -- Also update profile
        UPDATE profiles SET role = 'admin' WHERE id = NEW.id;
    ELSE
        -- Otherwise assign default 'user' role
        INSERT INTO user_roles (user_id, role)
        VALUES (NEW.id, 'user')
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Note: To use this trigger, uncomment after initial setup:
-- CREATE TRIGGER setup_first_admin_trigger
--     AFTER INSERT ON profiles
--     FOR EACH ROW
--     EXECUTE FUNCTION setup_first_admin();

-- ============================================
-- STEP 12: Audit Log for Role Changes
-- ============================================
CREATE TABLE IF NOT EXISTS role_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    old_role user_role,
    new_role user_role,
    changed_by UUID NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE role_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs" ON role_audit_log
    FOR SELECT USING (is_admin());

-- Trigger to log role changes
CREATE OR REPLACE FUNCTION log_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO role_audit_log (user_id, old_role, new_role, changed_by, reason)
    VALUES (
        NEW.user_id,
        OLD.role,
        NEW.role,
        auth.uid(),
        NEW.notes
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_role_change_trigger ON user_roles;
CREATE TRIGGER log_role_change_trigger
    AFTER UPDATE ON user_roles
    FOR EACH ROW
    WHEN (OLD.role IS DISTINCT FROM NEW.role)
    EXECUTE FUNCTION log_role_change();

-- ============================================
-- GRANT PERMISSIONS
-- ============================================
-- Grant necessary permissions to authenticated users
GRANT SELECT ON user_roles TO authenticated;
GRANT SELECT ON vendor_permissions TO authenticated;
GRANT SELECT ON role_audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_role TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin TO authenticated;
GRANT EXECUTE ON FUNCTION is_vendor TO authenticated;
GRANT EXECUTE ON FUNCTION can_access_document TO authenticated;

-- ============================================
-- SUMMARY
-- ============================================
-- This migration adds:
-- 1. user_role ENUM type (user, admin, vendor)
-- 2. user_roles table for role assignments
-- 3. vendor_permissions table for document sharing
-- 4. Helper functions: get_user_role(), is_admin(), is_vendor(), can_access_document()
-- 5. Updated RLS policies for documents, analysis, summaries, graphs
-- 6. Role sync trigger to profiles table
-- 7. Audit logging for role changes
--
-- USAGE IN APP:
-- - Call get_user_role() to get current user's role
-- - Use is_admin() in queries for admin-only features
-- - RLS automatically enforces access based on role
