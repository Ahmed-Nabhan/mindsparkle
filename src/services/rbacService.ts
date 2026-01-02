/**
 * RBAC Service - Role-Based Access Control Helper Functions
 * 
 * This service provides helper functions for checking permissions
 * and validating role-based access across the MindSparkle app.
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                    RBAC Service Architecture                            │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │                                                                          │
 * │  ┌─────────────────┐     ┌──────────────────────────────────────────┐   │
 * │  │  UI Components  │────>│  rbacService.checkPermission()          │   │
 * │  │  (Button, etc.) │     │  - Client-side permission checks        │   │
 * │  └─────────────────┘     │  - Role-based UI rendering              │   │
 * │                          └──────────────────────────────────────────┘   │
 * │                                         │                               │
 * │                                         ▼                               │
 * │  ┌─────────────────────────────────────────────────────────────────┐   │
 * │  │                    Supabase RLS Policies                         │   │
 * │  │  - Server-side enforcement (cannot be bypassed)                  │   │
 * │  │  - Uses get_user_role(), is_admin(), can_access_document()       │   │
 * │  └─────────────────────────────────────────────────────────────────┘   │
 * │                                                                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * SECURITY NOTE:
 * - Client-side checks are for UX only (hiding/showing UI elements)
 * - Server-side RLS policies are the actual security enforcement
 * - Always assume client-side checks can be bypassed
 * 
 * @module services/rbacService
 */

import { supabase } from './supabase';
import { UserRole, VendorPermission } from '../types/user';

// ============================================
// HELPERS
// ============================================

/**
 * Validate if a string is a valid UUID v4
 * Used to prevent "invalid input syntax for type uuid" errors
 */
function isValidUUID(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ============================================
// TYPES
// ============================================

/**
 * Permission types for granular access control
 */
export type Permission = 
  | 'view_all_documents'
  | 'share_documents'
  | 'manage_users'
  | 'view_analytics'
  | 'delete_any_document'
  | 'upload_documents'
  | 'view_own_documents'
  | 'manage_vendors'
  | 'view_audit_logs';

/**
 * Result of a permission check
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiredRole?: UserRole;
}

// ============================================
// PERMISSION MATRIX
// ============================================

/**
 * Permission matrix mapping permissions to allowed roles
 * 
 * RBAC LOGIC:
 * - Each permission lists which roles can access it
 * - Admin has implicit access to everything
 * - Vendor has limited sharing/analytics permissions
 * - User has basic self-service permissions
 */
const PERMISSION_MATRIX: Record<Permission, UserRole[]> = {
  // Document access
  'view_all_documents': ['admin'],
  'view_own_documents': ['user', 'admin', 'vendor'],
  'upload_documents': ['user', 'admin', 'vendor'],
  'delete_any_document': ['admin'],
  
  // Sharing
  'share_documents': ['admin', 'vendor'],
  
  // User management
  'manage_users': ['admin'],
  'manage_vendors': ['admin'],
  
  // Analytics & Audit
  'view_analytics': ['admin', 'vendor'],
  'view_audit_logs': ['admin'],
};

// ============================================
// PERMISSION CHECK FUNCTIONS
// ============================================

/**
 * Check if a role has a specific permission
 * 
 * CLIENT-SIDE CHECK:
 * Use this for UI decisions (show/hide elements)
 * Server-side RLS provides actual enforcement
 * 
 * @param role - The user's role
 * @param permission - The permission to check
 * @returns PermissionCheckResult with allowed status and reason
 */
export function checkPermission(
  role: UserRole,
  permission: Permission
): PermissionCheckResult {
  const allowedRoles = PERMISSION_MATRIX[permission];
  
  if (!allowedRoles) {
    return {
      allowed: false,
      reason: `Unknown permission: ${permission}`,
    };
  }
  
  const allowed = allowedRoles.includes(role);
  
  return {
    allowed,
    reason: allowed 
      ? undefined 
      : `Role '${role}' does not have permission '${permission}'`,
    requiredRole: allowed ? undefined : allowedRoles[0],
  };
}

/**
 * Check multiple permissions at once
 * Returns true only if ALL permissions are granted
 * 
 * @param role - The user's role
 * @param permissions - Array of permissions to check
 * @returns boolean - true if all permissions are granted
 */
export function checkAllPermissions(
  role: UserRole,
  permissions: Permission[]
): boolean {
  return permissions.every(p => checkPermission(role, p).allowed);
}

/**
 * Check if user has ANY of the specified permissions
 * Returns true if at least one permission is granted
 * 
 * @param role - The user's role
 * @param permissions - Array of permissions to check
 * @returns boolean - true if any permission is granted
 */
export function checkAnyPermission(
  role: UserRole,
  permissions: Permission[]
): boolean {
  return permissions.some(p => checkPermission(role, p).allowed);
}

// ============================================
// SUPABASE RBAC FUNCTIONS
// ============================================

/**
 * Fetch user's role from Supabase
 * Uses the get_user_role() database function
 * 
 * @param userId - Optional user ID (defaults to current user)
 * @returns The user's role
 */
export async function fetchUserRole(userId?: string): Promise<UserRole> {
  try {
    const { data, error } = await supabase
      .rpc('get_user_role', userId ? { check_user_id: userId } : {});
    
    if (error) {
      console.error('[RBAC] Failed to fetch role:', error);
      return 'user'; // Default to 'user' on error
    }
    
    return data as UserRole;
  } catch (error) {
    console.error('[RBAC] Error fetching role:', error);
    return 'user';
  }
}

/**
 * Check if current user is admin via Supabase
 * Uses the is_admin() database function
 * 
 * SERVER-SIDE VERIFICATION:
 * This calls the database function which is also used in RLS
 * Ensures consistency between client check and server enforcement
 * 
 * @returns boolean - true if current user is admin
 */
export async function verifyIsAdmin(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_admin');
    
    if (error) {
      console.error('[RBAC] Failed to verify admin status:', error);
      return false;
    }
    
    return data === true;
  } catch (error) {
    console.error('[RBAC] Error verifying admin status:', error);
    return false;
  }
}

/**
 * Check if current user is vendor via Supabase
 * Uses the is_vendor() database function
 * 
 * @returns boolean - true if current user is vendor
 */
export async function verifyIsVendor(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_vendor');
    
    if (error) {
      console.error('[RBAC] Failed to verify vendor status:', error);
      return false;
    }
    
    return data === true;
  } catch (error) {
    console.error('[RBAC] Error verifying vendor status:', error);
    return false;
  }
}

/**
 * Check if current user can access a specific document
 * Uses the can_access_document() database function
 * 
 * RBAC LOGIC (Server-side):
 * 1. User owns document → allowed
 * 2. User is admin → allowed
 * 3. Document shared via vendor_permissions → allowed
 * 4. Otherwise → denied
 * 
 * @param documentId - The document ID to check access for
 * @returns boolean - true if access is allowed
 */
export async function canAccessDocument(documentId: string): Promise<boolean> {
  try {
    // Validate UUID format to prevent database errors
    if (!isValidUUID(documentId)) {
      console.warn('[RBAC] Invalid document ID format (not UUID):', documentId);
      // For local documents (non-UUID IDs), allow access if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();
      return !!user; // Allow authenticated users to access local documents
    }
    
    const { data, error } = await supabase
      .rpc('can_access_document', { doc_id: documentId });
    
    if (error) {
      console.error('[RBAC] Failed to check document access:', error);
      return false;
    }
    
    return data === true;
  } catch (error) {
    console.error('[RBAC] Error checking document access:', error);
    return false;
  }
}

// ============================================
// VENDOR PERMISSION FUNCTIONS
// ============================================

/**
 * Share a document with a specific user (Vendor only)
 * Creates a vendor_permissions record
 * 
 * RBAC: Only vendors and admins can share documents
 * 
 * @param documentId - The document to share
 * @param targetUserId - The user to share with (null for all users)
 * @param permissionLevel - 'read', 'write', or 'admin'
 * @param expiresAt - Optional expiration date
 * @returns boolean - true if sharing succeeded
 */
export async function shareDocument(
  documentId: string,
  targetUserId: string | null,
  permissionLevel: 'read' | 'write' | 'admin' = 'read',
  expiresAt?: Date
): Promise<boolean> {
  try {
    // Get current user for vendor_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('[RBAC] No authenticated user');
      return false;
    }
    
    const { error } = await supabase
      .from('vendor_permissions')
      .upsert({
        vendor_id: user.id,
        document_id: documentId,
        shared_with_user_id: targetUserId,
        shared_with_all: targetUserId === null,
        permission_level: permissionLevel,
        expires_at: expiresAt?.toISOString(),
      }, {
        onConflict: 'vendor_id,document_id,shared_with_user_id',
      });
    
    if (error) {
      console.error('[RBAC] Failed to share document:', error);
      return false;
    }
    
    console.log('[RBAC] Document shared successfully:', documentId);
    return true;
  } catch (error) {
    console.error('[RBAC] Error sharing document:', error);
    return false;
  }
}

/**
 * Revoke document sharing
 * Deletes the vendor_permissions record
 * 
 * @param documentId - The document to unshare
 * @param targetUserId - The user to revoke access from (null for all)
 * @returns boolean - true if revocation succeeded
 */
export async function revokeDocumentShare(
  documentId: string,
  targetUserId: string | null
): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    
    let query = supabase
      .from('vendor_permissions')
      .delete()
      .eq('vendor_id', user.id)
      .eq('document_id', documentId);
    
    if (targetUserId) {
      query = query.eq('shared_with_user_id', targetUserId);
    } else {
      query = query.eq('shared_with_all', true);
    }
    
    const { error } = await query;
    
    if (error) {
      console.error('[RBAC] Failed to revoke share:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('[RBAC] Error revoking share:', error);
    return false;
  }
}

/**
 * Get all documents shared with the current user
 * Fetches from vendor_permissions where user is recipient
 * 
 * @returns Array of shared document IDs with permission details
 */
export async function getSharedDocuments(): Promise<VendorPermission[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    
    const { data, error } = await supabase
      .from('vendor_permissions')
      .select('*')
      .or(`shared_with_user_id.eq.${user.id},shared_with_all.eq.true`)
      .gt('expires_at', new Date().toISOString())
      .or('expires_at.is.null');
    
    if (error) {
      console.error('[RBAC] Failed to fetch shared documents:', error);
      return [];
    }
    
    return (data || []).map(p => ({
      id: p.id,
      vendorId: p.vendor_id,
      documentId: p.document_id,
      sharedWithUserId: p.shared_with_user_id,
      sharedWithAll: p.shared_with_all,
      permissionLevel: p.permission_level,
      expiresAt: p.expires_at ? new Date(p.expires_at) : undefined,
    }));
  } catch (error) {
    console.error('[RBAC] Error fetching shared documents:', error);
    return [];
  }
}

/**
 * Get documents shared by the current vendor
 * Used in vendor analytics/management screen
 * 
 * @returns Array of sharing permissions created by this vendor
 */
export async function getVendorSharedDocuments(): Promise<VendorPermission[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    
    const { data, error } = await supabase
      .from('vendor_permissions')
      .select('*')
      .eq('vendor_id', user.id);
    
    if (error) {
      console.error('[RBAC] Failed to fetch vendor shares:', error);
      return [];
    }
    
    return (data || []).map(p => ({
      id: p.id,
      vendorId: p.vendor_id,
      documentId: p.document_id,
      sharedWithUserId: p.shared_with_user_id,
      sharedWithAll: p.shared_with_all,
      permissionLevel: p.permission_level,
      expiresAt: p.expires_at ? new Date(p.expires_at) : undefined,
    }));
  } catch (error) {
    console.error('[RBAC] Error fetching vendor shares:', error);
    return [];
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  checkPermission,
  checkAllPermissions,
  checkAnyPermission,
  fetchUserRole,
  verifyIsAdmin,
  verifyIsVendor,
  canAccessDocument,
  shareDocument,
  revokeDocumentShare,
  getSharedDocuments,
  getVendorSharedDocuments,
  PERMISSION_MATRIX,
};
