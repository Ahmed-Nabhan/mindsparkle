/**
 * AuthContext - Central authentication state management
 * 
 * DATA FLOW:
 * 1. App loads → AuthProvider initializes → checks for existing session
 * 2. User action (sign in/up) → Supabase auth → JWT stored securely
 * 3. Auth state change → onAuthStateChange listener → updates context
 * 4. Context updates → re-renders consumer components
 * 
 * SECURITY:
 * - JWT tokens stored in expo-secure-store (device secure enclave)
 * - Auto-refresh tokens before expiry
 * - Session persists across app restarts
 * 
 * RBAC (Role-Based Access Control):
 * - Roles: 'user', 'admin', 'vendor'
 * - Role fetched from user_roles table on auth
 * - Helper functions: isAdmin(), isVendor(), hasPermission()
 * - Supabase RLS enforces server-side access control
 * 
 * SUPPORTED AUTH METHODS:
 * - Email/Password (sign in & sign up)
 * - Apple Sign In (OAuth via native iOS)
 * - Google Sign In (OAuth - requires setup)
 * - Magic Link (passwordless email)
 */

import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import { User, AuthState, UserRole, UserAuthProvider } from '../types/user';
import { 
  getCurrentUser, 
  signIn as supabaseSignIn, 
  signOut as supabaseSignOut, 
  signUp as supabaseSignUp,
  signInWithApple as supabaseSignInWithApple,
  resetPassword as supabaseResetPassword,
  refreshSession as supabaseRefreshSession,
  onAuthStateChange,
  getOrCreateProfile,
  supabase 
} from '../services/supabase';
import { cloudSyncService } from '../services/cloudSyncService';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Authentication error with additional context
 */
export interface AuthError {
  code: string;
  message: string;
  details?: string;
}

/**
 * Extended auth context with all authentication methods
 * Includes RBAC (Role-Based Access Control) helpers
 */
interface AuthContextType extends AuthState {
  // Core auth methods
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, metadata?: { name?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  
  // OAuth providers
  signInWithApple: (identityToken: string, nonce: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  
  // Passwordless auth
  signInWithMagicLink: (email: string) => Promise<void>;
  
  // Password management
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  
  // Session management
  refreshAuth: () => Promise<void>;
  
  // RBAC (Role-Based Access Control) helpers
  // These functions check the user's role for conditional UI/logic
  isAdmin: () => boolean;
  isVendor: () => boolean;
  hasPermission: (permission: string) => boolean;
  getUserRole: () => UserRole;
  
  // Admin-only methods
  updateUserRole: (userId: string, newRole: UserRole) => Promise<boolean>;
  getAllUsers: () => Promise<User[]>;
  
  // Error state
  authError: AuthError | null;
  clearError: () => void;
}

// Create context with undefined default (forces provider usage)
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================
// AUTH PROVIDER COMPONENT
// ============================================

/**
 * AuthProvider - Wraps app with authentication state
 * 
 * Usage:
 * ```tsx
 * <AuthProvider>
 *   <App />
 * </AuthProvider>
 * ```
 */
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // ============================================
  // STATE
  // ============================================
  
  // Core auth state
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Error state for UI feedback
  const [authError, setAuthError] = useState<AuthError | null>(null);

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  /**
   * Clear any existing auth error
   * Call this before new auth attempts
   */
  const clearError = useCallback(() => {
    setAuthError(null);
  }, []);

  /**
   * Set error with standardized format
   */
  const handleAuthError = useCallback((error: any, context: string) => {
    console.error(`[Auth] ${context}:`, error);
    setAuthError({
      code: error.code || 'AUTH_ERROR',
      message: error.message || 'An authentication error occurred',
      details: context,
    });
  }, []);

  /**
   * Transform Supabase user to app User type
   * Also fetches/creates user profile from database
   * 
   * DATA FLOW:
   * Supabase auth user → fetch profile → fetch role → merge data → App User object
   * 
   * RBAC INTEGRATION:
   * Role is fetched from user_roles table via Supabase RPC function
   * Default role is 'user' if no explicit role is assigned
   */
  const updateUserFromSession = useCallback(async (supabaseUser: any) => {
    if (supabaseUser) {
      try {
        // Fetch or create user profile from database
        const { data: profile } = await getOrCreateProfile(supabaseUser.id, supabaseUser.email);
        
        // Detect auth provider from Supabase user identities
        // Apple users get automatic Pro access!
        let authProvider: UserAuthProvider = 'unknown';
        const identities = supabaseUser.identities || supabaseUser.app_metadata?.providers || [];
        if (Array.isArray(identities)) {
          const providerNames = identities.map((i: any) => i.provider || i).filter(Boolean);
          if (providerNames.includes('apple')) {
            authProvider = 'apple';
          } else if (providerNames.includes('google')) {
            authProvider = 'google';
          } else if (providerNames.includes('email')) {
            authProvider = 'email';
          }
        }
        // Fallback: check app_metadata provider
        if (authProvider === 'unknown' && supabaseUser.app_metadata?.provider) {
          const provider = supabaseUser.app_metadata.provider;
          if (provider === 'apple') authProvider = 'apple';
          else if (provider === 'google') authProvider = 'google';
          else if (provider === 'email') authProvider = 'email';
        }
        
        console.log('[Auth] Detected auth provider:', authProvider);
        
        // Fetch user role from user_roles table
        // Uses the get_user_role() Supabase function for RBAC
        let userRole: UserRole = 'user'; // Default role
        let roleExpiresAt: Date | undefined;
        
        try {
          // Call Supabase RPC to get user's role
          // This function handles the role lookup with expiration checking
          const { data: roleData, error: roleError } = await supabase
            .rpc('get_user_role', { check_user_id: supabaseUser.id });
          
          if (!roleError && roleData) {
            userRole = roleData as UserRole;
            console.log('[Auth] User role fetched:', userRole);
          }
          
          // Also fetch role expiration if applicable
          const { data: roleRecord } = await supabase
            .from('user_roles')
            .select('expires_at')
            .eq('user_id', supabaseUser.id)
            .single();
          
          if (roleRecord?.expires_at) {
            roleExpiresAt = new Date(roleRecord.expires_at);
          }
        } catch (roleErr) {
          // Role fetch failed - use default 'user' role
          // This is non-fatal, RLS will still enforce server-side
          console.warn('[Auth] Role fetch failed, using default:', roleErr);
        }
        
        // Owner email gets automatic premium status!
        // Only the app owner (ahmedadel737374@icloud.com) gets free Pro
        const OWNER_EMAIL = 'ahmedadel737374@icloud.com';
        const isOwner = supabaseUser.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
        const isPremiumUser = isOwner || profile?.is_premium || false;
        
        if (isOwner) {
          console.log('[Auth] 👑 Owner account detected - granting Pro access!');
        }
        
        // Construct app User object from auth + profile + role data
        const appUser: User = {
          id: supabaseUser.id,
          email: supabaseUser.email || '',
          name: profile?.full_name || supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name,
          avatarUrl: profile?.avatar_url || supabaseUser.user_metadata?.avatar_url,
          isPremium: isPremiumUser,
          createdAt: new Date(supabaseUser.created_at),
          lastLoginAt: new Date(),
          // RBAC fields
          role: userRole,
          roleExpiresAt,
          // Auth provider tracking
          authProvider,
        };
        
        setUser(appUser);
        setIsAuthenticated(true);
        
        // Initialize cloud sync for this user
        cloudSyncService.initialize(supabaseUser.id);
        
        console.log('[Auth] User session updated:', appUser.id, 'Role:', appUser.role, 'Provider:', authProvider, 'Premium:', isPremiumUser);
      } catch (error) {
        // Profile fetch failed, use basic user data with default role
        console.warn('[Auth] Profile fetch failed, using basic data:', error);
        setUser({
          id: supabaseUser.id,
          email: supabaseUser.email || '',
          isPremium: false,
          createdAt: new Date(supabaseUser.created_at),
          role: 'user', // Default role on error
        });
        setIsAuthenticated(true);
        cloudSyncService.initialize(supabaseUser.id);
      }
    } else {
      // No user - clear state
      setUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  // ============================================
  // AUTH STATE LISTENER
  // ============================================

  /**
   * Set up auth state listener on mount
   * 
   * EVENTS HANDLED:
   * - INITIAL_SESSION: App load with existing session
   * - SIGNED_IN: User just signed in
   * - SIGNED_OUT: User signed out
   * - TOKEN_REFRESHED: JWT was auto-refreshed
   * - USER_UPDATED: Profile was updated
   * - PASSWORD_RECOVERY: User clicked password reset link
   */
  useEffect(() => {
    // Check for existing session on mount
    checkUser();
    
    // Subscribe to auth state changes
    // This handles OAuth callbacks, token refresh, etc.
    const { data: { subscription } } = onAuthStateChange(async (event, session) => {
      console.log('[Auth] State changed:', event, session?.user?.id);
      
      switch (event) {
        case 'SIGNED_IN':
        case 'TOKEN_REFRESHED':
          // User signed in or token refreshed - update state
          if (session?.user) {
            await updateUserFromSession(session.user);
            setIsLoading(false);
          }
          break;
          
        case 'SIGNED_OUT':
          // User signed out - clear state
          setUser(null);
          setIsAuthenticated(false);
          break;
          
        case 'INITIAL_SESSION':
          // App loaded with existing session
          if (session?.user) {
            await updateUserFromSession(session.user);
          }
          setIsLoading(false);
          break;
          
        case 'USER_UPDATED':
          // User profile updated - refresh data
          if (session?.user) {
            await updateUserFromSession(session.user);
          }
          break;
          
        case 'PASSWORD_RECOVERY':
          // User clicked password reset link
          // Navigate to password reset screen if needed
          console.log('[Auth] Password recovery initiated');
          break;
      }
    });
    
    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, [updateUserFromSession]);

  /**
   * Check for existing user session
   * Called on app startup
   */
  const checkUser = async () => {
    try {
      // First check for existing session in secure storage
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        await updateUserFromSession(sessionData.session.user);
        setIsLoading(false);
        return;
      }
      
      // Fallback to getUser API
      const { data, error } = await getCurrentUser();
      if (data?.user) {
        await updateUserFromSession(data.user);
      }
    } catch (error) {
      console.error('[Auth] Error checking user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================
  // AUTH METHODS
  // ============================================

  /**
   * Manually refresh auth state
   * Use when you need to ensure latest user data
   */
  const refreshAuth = useCallback(async () => {
    try {
      // Refresh the session token
      const { data, error } = await supabaseRefreshSession();
      if (error) throw error;
      
      if (data?.session?.user) {
        await updateUserFromSession(data.session.user);
      }
    } catch (error) {
      handleAuthError(error, 'refreshAuth');
    }
  }, [updateUserFromSession, handleAuthError]);

  /**
   * Sign in with email and password
   * 
   * FLOW:
   * 1. Validate credentials
   * 2. Call Supabase signInWithPassword
   * 3. JWT stored automatically in secure storage
   * 4. onAuthStateChange fires → updates context
   */
  const signIn = async (email: string, password: string) => {
    try {
      clearError();
      const { data, error } = await supabaseSignIn(email, password);
      if (error) throw error;
      
      if (data?.user) {
        await updateUserFromSession(data.user);
        
        // Trigger background sync (don't await - let it happen in background)
        cloudSyncService.downloadDocuments().catch(console.error);
        cloudSyncService.downloadFolders().catch(console.error);
      }
    } catch (error: any) {
      handleAuthError(error, 'signIn');
      throw error;
    }
  };

  /**
   * Sign up with email and password
   * 
   * FLOW:
   * 1. Create account in Supabase Auth
   * 2. Send verification email (if enabled)
   * 3. Create user profile in database
   * 4. User must verify email before full access
   */
  const signUp = async (email: string, password: string, metadata?: { name?: string }) => {
    try {
      clearError();
      const { data, error } = await supabaseSignUp(email, password, metadata);
      if (error) throw error;
      
      if (data?.user) {
        await updateUserFromSession(data.user);
        cloudSyncService.initialize(data.user.id);
      }
    } catch (error: any) {
      handleAuthError(error, 'signUp');
      throw error;
    }
  };

  /**
   * Sign in with Apple (iOS native)
   * 
   * FLOW:
   * 1. User taps Apple Sign In button
   * 2. Native Apple auth sheet appears (Face ID/Touch ID)
   * 3. Apple returns identity token
   * 4. Token sent to Supabase for verification
   * 5. Session created, JWT stored
   */
  const signInWithApple = async (identityToken: string, nonce: string) => {
    try {
      clearError();
      const { data, error } = await supabaseSignInWithApple(identityToken, nonce);
      
      if (error) {
        // Handle database trigger errors gracefully
        if (error.message?.includes('Database error') || 
            error.message?.includes('duplicate key')) {
          // Auth may have succeeded even if profile creation failed
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData?.session?.user) {
            await updateUserFromSession(sessionData.session.user);
            return;
          }
        }
        throw error;
      }
      
      if (data?.user) {
        await updateUserFromSession(data.user);
      }
    } catch (error: any) {
      handleAuthError(error, 'signInWithApple');
      throw error;
    }
  };

  /**
   * Sign in with Google OAuth
   * Note: Requires additional setup in Supabase dashboard
   */
  const signInWithGoogle = async () => {
    try {
      clearError();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'mindsparkle://auth/callback',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      
      if (error) throw error;
      // OAuth flow continues in browser, returns via deep link
    } catch (error: any) {
      handleAuthError(error, 'signInWithGoogle');
      throw error;
    }
  };

  /**
   * Sign in with Magic Link (passwordless)
   * 
   * FLOW:
   * 1. User enters email
   * 2. Supabase sends email with login link
   * 3. User clicks link → opens app via deep link
   * 4. Session created automatically
   */
  const signInWithMagicLink = async (email: string) => {
    try {
      clearError();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: 'mindsparkle://auth/callback',
        },
      });
      
      if (error) throw error;
      console.log('[Auth] Magic link sent to:', email);
    } catch (error: any) {
      handleAuthError(error, 'signInWithMagicLink');
      throw error;
    }
  };

  /**
   * Send password reset email
   */
  const resetPassword = async (email: string) => {
    try {
      clearError();
      const { error } = await supabaseResetPassword(email);
      if (error) throw error;
      console.log('[Auth] Password reset email sent to:', email);
    } catch (error: any) {
      handleAuthError(error, 'resetPassword');
      throw error;
    }
  };

  /**
   * Update user's password (when logged in)
   */
  const updatePassword = async (newPassword: string) => {
    try {
      clearError();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      console.log('[Auth] Password updated successfully');
    } catch (error: any) {
      handleAuthError(error, 'updatePassword');
      throw error;
    }
  };

  /**
   * Sign out user
   * Clears session, JWT tokens, and local state
   */
  const signOut = async () => {
    try {
      clearError();
      await supabaseSignOut();
      setUser(null);
      setIsAuthenticated(false);
      console.log('[Auth] User signed out');
    } catch (error: any) {
      handleAuthError(error, 'signOut');
      throw error;
    }
  };

  // ============================================
  // RBAC (ROLE-BASED ACCESS CONTROL) METHODS
  // ============================================

  /**
   * Get the current user's role
   * Returns 'user' as default if no user or role not set
   * 
   * RBAC LOGIC:
   * - Reads role from user object (fetched on auth)
   * - Falls back to 'user' role for safety
   * - Used by UI to conditionally render features
   * 
   * @returns UserRole - 'user', 'admin', or 'vendor'
   */
  const getUserRole = useCallback((): UserRole => {
    return user?.role || 'user';
  }, [user?.role]);

  /**
   * Check if current user is an admin
   * 
   * ADMIN PERMISSIONS:
   * - View ALL documents (not just own)
   * - Manage user roles
   * - Access analytics dashboard
   * - Delete any document
   * 
   * @returns boolean - true if user is admin
   */
  const isAdmin = useCallback((): boolean => {
    // Check if role exists and is 'admin'
    // Also verify role hasn't expired
    if (!user?.role) return false;
    
    if (user.roleExpiresAt && new Date() > user.roleExpiresAt) {
      console.log('[Auth] Admin role has expired');
      return false;
    }
    
    return user.role === 'admin';
  }, [user?.role, user?.roleExpiresAt]);

  /**
   * Check if current user is a vendor
   * 
   * VENDOR PERMISSIONS:
   * - Share documents with specific users
   * - View shared document analytics
   * - Cannot manage other users
   * 
   * @returns boolean - true if user is vendor
   */
  const isVendor = useCallback((): boolean => {
    if (!user?.role) return false;
    
    if (user.roleExpiresAt && new Date() > user.roleExpiresAt) {
      console.log('[Auth] Vendor role has expired');
      return false;
    }
    
    return user.role === 'vendor';
  }, [user?.role, user?.roleExpiresAt]);

  /**
   * Check if user has a specific permission
   * 
   * PERMISSION MAPPING:
   * - 'view_all_documents' → admin only
   * - 'share_documents' → admin or vendor
   * - 'manage_users' → admin only
   * - 'view_analytics' → admin or vendor
   * - 'delete_any_document' → admin only
   * 
   * @param permission - The permission to check
   * @returns boolean - true if user has permission
   */
  const hasPermission = useCallback((permission: string): boolean => {
    const role = getUserRole();
    
    // Define permission mappings based on role
    // RBAC: Admin has all permissions, vendor has limited permissions
    const permissionMap: Record<string, UserRole[]> = {
      'view_all_documents': ['admin'],
      'share_documents': ['admin', 'vendor'],
      'manage_users': ['admin'],
      'view_analytics': ['admin', 'vendor'],
      'delete_any_document': ['admin'],
      'upload_documents': ['user', 'admin', 'vendor'], // All roles can upload
      'view_own_documents': ['user', 'admin', 'vendor'], // All roles can view own
    };
    
    const allowedRoles = permissionMap[permission];
    if (!allowedRoles) {
      console.warn(`[Auth] Unknown permission: ${permission}`);
      return false;
    }
    
    return allowedRoles.includes(role);
  }, [getUserRole]);

  /**
   * Update another user's role (Admin only)
   * 
   * SECURITY:
   * - Only admins can call this function
   * - Role change is logged in role_audit_log table
   * - Cannot demote yourself from admin
   * 
   * @param userId - The user ID to update
   * @param newRole - The new role to assign
   * @returns boolean - true if update succeeded
   */
  const updateUserRole = useCallback(async (userId: string, newRole: UserRole): Promise<boolean> => {
    // RBAC check: Only admins can update roles
    if (!isAdmin()) {
      console.error('[Auth] Permission denied: Only admins can update roles');
      return false;
    }
    
    // Prevent admin from demoting themselves
    if (userId === user?.id && newRole !== 'admin') {
      console.error('[Auth] Cannot demote yourself from admin');
      return false;
    }
    
    try {
      // Update or insert role in user_roles table
      const { error } = await supabase
        .from('user_roles')
        .upsert({
          user_id: userId,
          role: newRole,
          granted_by: user?.id,
          granted_at: new Date().toISOString(),
          notes: `Role changed to ${newRole} by admin`,
        }, {
          onConflict: 'user_id',
        });
      
      if (error) {
        console.error('[Auth] Failed to update role:', error);
        return false;
      }
      
      console.log(`[Auth] User ${userId} role updated to ${newRole}`);
      return true;
    } catch (error) {
      console.error('[Auth] Error updating role:', error);
      return false;
    }
  }, [isAdmin, user?.id]);

  /**
   * Get all users (Admin only)
   * 
   * SECURITY:
   * - Only admins can call this function
   * - Returns users with their roles
   * - Used for admin user management screen
   * 
   * @returns User[] - Array of all users
   */
  const getAllUsers = useCallback(async (): Promise<User[]> => {
    // RBAC check: Only admins can view all users
    if (!isAdmin()) {
      console.error('[Auth] Permission denied: Only admins can view all users');
      return [];
    }
    
    try {
      // Fetch all profiles with their roles
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          avatar_url,
          is_premium,
          role,
          created_at
        `)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('[Auth] Failed to fetch users:', error);
        return [];
      }
      
      // Map to User objects
      return (data || []).map(profile => ({
        id: profile.id,
        email: profile.email || '',
        name: profile.full_name,
        avatarUrl: profile.avatar_url,
        isPremium: profile.is_premium || false,
        createdAt: new Date(profile.created_at),
        role: profile.role || 'user',
      }));
    } catch (error) {
      console.error('[Auth] Error fetching users:', error);
      return [];
    }
  }, [isAdmin]);

  // ============================================
  // CONTEXT PROVIDER
  // ============================================

  return (
    <AuthContext.Provider
      value={{
        // State
        user,
        isLoading,
        isAuthenticated,
        authError,
        
        // Core auth methods
        signIn,
        signUp,
        signOut,
        
        // OAuth providers
        signInWithApple,
        signInWithGoogle,
        
        // Passwordless auth
        signInWithMagicLink,
        
        // Password management
        resetPassword,
        updatePassword,
        
        // Session management
        refreshAuth,
        
        // RBAC methods
        isAdmin,
        isVendor,
        hasPermission,
        getUserRole,
        updateUserRole,
        getAllUsers,
        
        // Error handling
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ============================================
// HOOK
// ============================================

/**
 * useAuth hook - Access auth context
 * 
 * Usage:
 * ```tsx
 * const { user, signIn, signOut, isAuthenticated } = useAuth();
 * ```
 * 
 * @throws Error if used outside AuthProvider
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
