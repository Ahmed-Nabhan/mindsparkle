/**
 * User Role Types for RBAC (Role-Based Access Control)
 * 
 * ROLE DEFINITIONS:
 * - 'user'   : Standard user, can only access own documents
 * - 'admin'  : Administrator, can access ALL documents and manage users
 * - 'vendor' : Content vendor, can share documents with specific users
 * 
 * PERMISSION MATRIX:
 * ┌────────────────┬─────────┬─────────┬─────────┐
 * │ Action         │  User   │ Vendor  │  Admin  │
 * ├────────────────┼─────────┼─────────┼─────────┤
 * │ View own docs  │   ✓     │    ✓    │    ✓    │
 * │ View all docs  │   ✗     │    ✗    │    ✓    │
 * │ Share docs     │   ✗     │    ✓    │    ✓    │
 * │ Manage users   │   ✗     │    ✗    │    ✓    │
 * │ View analytics │   ✗     │    ✓    │    ✓    │
 * └────────────────┴─────────┴─────────┴─────────┘
 */
export type UserRole = 'user' | 'admin' | 'vendor';

/**
 * Authentication Provider Types
 * Tracks how the user authenticated (email, Apple, Google, etc.)
 */
export type UserAuthProvider = 'email' | 'apple' | 'google' | 'magic_link' | 'unknown';

/**
 * User object representing authenticated user
 * Extended with role for RBAC
 */
export interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  isPremium: boolean;
  createdAt: Date;
  lastLoginAt?: Date;
  
  // RBAC fields
  role: UserRole;
  roleExpiresAt?: Date; // Optional role expiration
  
  // Auth provider tracking (for Apple Pro access)
  authProvider?: UserAuthProvider;
}

/**
 * Authentication state interface
 */
export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Signup credentials with optional metadata
 */
export interface SignupCredentials extends LoginCredentials {
  name?: string;
}

/**
 * Role permission check result
 * Used by RBAC helper functions
 */
export interface RolePermission {
  allowed: boolean;
  reason?: string;
  role: UserRole;
}

/**
 * Vendor permission for shared documents
 */
export interface VendorPermission {
  id: string;
  vendorId: string;
  documentId: string;
  sharedWithUserId?: string;
  sharedWithAll: boolean;
  permissionLevel: 'read' | 'write' | 'admin';
  expiresAt?: Date;
}
