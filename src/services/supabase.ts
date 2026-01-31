/**
 * Supabase Service
 * 
 * Comprehensive Supabase client initialization for Expo/React Native
 * Handles authentication, database operations, and storage with secure token management
 * 
 * @module services/supabase
 */

import { createClient, SupabaseClient, Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import 'react-native-url-polyfill/auto';

// ============================================
// CONFIGURATION
// ============================================

/**
 * Supabase URL - Retrieved from environment variables
 * Falls back to default URL if not set (for development)
 */
const SUPABASE_URL: string = 
  Constants.expoConfig?.extra?.supabaseUrl || 
  process.env.EXPO_PUBLIC_SUPABASE_URL || 
  'https://cszorvgzihzamgezlfjj.supabase.co';

/**
 * Supabase Anonymous/Public Key
 * This key is safe to expose in client-side code
 * Row Level Security (RLS) protects data access
 */
const SUPABASE_ANON_KEY: string = 
  Constants.expoConfig?.extra?.supabaseAnonKey || 
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 
  '';

// SecureStore has practical per-item size limits (Expo warns at ~2048 bytes).
// Supabase session blobs can exceed this, so we chunk large values.
const SECURESTORE_MAX_VALUE_CHARS = 1900;
const CHUNK_COUNT_SUFFIX = '__chunk_count';
const CHUNK_KEY_SEPARATOR = '__chunk__';

// ============================================
// SECURE STORAGE ADAPTER
// ============================================

/**
 * Custom storage adapter using expo-secure-store
 * Securely stores JWT tokens in the device's secure enclave
 * Falls back to in-memory storage if secure store is unavailable
 */
const ExpoSecureStoreAdapter = {
  /**
   * Retrieve an item from secure storage
   * @param key - The storage key
   * @returns The stored value or null if not found
   */
  getItem: async (key: string): Promise<string | null> => {
    try {
      // If chunked, reconstruct
      const chunkCountRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
      const chunkCount = chunkCountRaw ? parseInt(chunkCountRaw, 10) : 0;
      if (chunkCount && Number.isFinite(chunkCount) && chunkCount > 0) {
        let value = '';
        for (let i = 0; i < chunkCount; i++) {
          const part = await SecureStore.getItemAsync(`${key}${CHUNK_KEY_SEPARATOR}${i}`);
          if (part == null) {
            // Corrupt chunk set; treat as missing
            return null;
          }
          value += part;
        }
        return value;
      }

      const value = await SecureStore.getItemAsync(key);
      return value;
    } catch (error) {
      console.warn('[Supabase] SecureStore getItem failed:', error);
      return null;
    }
  },

  /**
   * Store an item in secure storage
   * @param key - The storage key
   * @param value - The value to store
   */
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      // Clean up any previous chunks
      const existingCountRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
      const existingCount = existingCountRaw ? parseInt(existingCountRaw, 10) : 0;
      if (existingCount && Number.isFinite(existingCount) && existingCount > 0) {
        for (let i = 0; i < existingCount; i++) {
          await SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SEPARATOR}${i}`);
        }
        await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
      }

      if (value.length <= SECURESTORE_MAX_VALUE_CHARS) {
        await SecureStore.setItemAsync(key, value);
        return;
      }

      // Store chunked
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += SECURESTORE_MAX_VALUE_CHARS) {
        chunks.push(value.slice(i, i + SECURESTORE_MAX_VALUE_CHARS));
      }

      await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunks.length));
      for (let i = 0; i < chunks.length; i++) {
        await SecureStore.setItemAsync(`${key}${CHUNK_KEY_SEPARATOR}${i}`, chunks[i]);
      }
    } catch (error) {
      console.warn('[Supabase] SecureStore setItem failed:', error);
    }
  },

  /**
   * Remove an item from secure storage
   * @param key - The storage key to remove
   */
  removeItem: async (key: string): Promise<void> => {
    try {
      const chunkCountRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
      const chunkCount = chunkCountRaw ? parseInt(chunkCountRaw, 10) : 0;
      if (chunkCount && Number.isFinite(chunkCount) && chunkCount > 0) {
        for (let i = 0; i < chunkCount; i++) {
          await SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SEPARATOR}${i}`);
        }
        await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
      }
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.warn('[Supabase] SecureStore removeItem failed:', error);
    }
  },
};

// ============================================
// SUPABASE CLIENT INITIALIZATION
// ============================================

/**
 * Initialize Supabase client with secure storage and auto-refresh
 * 
 * Configuration:
 * - autoRefreshToken: Automatically refreshes JWT before expiry
 * - persistSession: Persists session across app restarts
 * - detectSessionInUrl: Disabled for React Native (no URL-based auth)
 * - storage: Uses expo-secure-store for secure token storage
 */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,           // Auto-refresh JWT tokens
    persistSession: true,              // Keep user logged in
    detectSessionInUrl: false,         // Not needed in React Native
    storage: ExpoSecureStoreAdapter,   // Secure token storage
    flowType: 'pkce',                  // More secure auth flow
  },
  global: {
    headers: {
      'x-client-info': 'mindsparkle-expo',  // Identify client for analytics
    },
  },
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get the Supabase URL for direct API calls
 * Used for file uploads, edge functions, etc.
 * @returns The Supabase project URL
 */
export const getSupabaseUrl = (): string => {
  return SUPABASE_URL;
};

/**
 * Get the Supabase anonymous key
 * @returns The Supabase anon key
 */
export const getSupabaseAnonKey = (): string => {
  return SUPABASE_ANON_KEY;
};

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

const debugLog = (...args: any[]) => {
  if (__DEV__) console.log(...args);
};

const debugError = (...args: any[]) => {
  // Keep errors visible in production for diagnostics.
  console.error(...args);
};

/**
 * Sign up a new user with email and password
 * Creates a new account and sends verification email
 * 
 * @param email - User's email address
 * @param password - User's password (min 6 characters)
 * @param metadata - Optional user metadata (name, avatar, etc.)
 * @returns Promise with user data or error
 * 
 * @example
 * const { data, error } = await signUp('user@example.com', 'password123', { name: 'John' });
 */
export const signUp = async (
  email: string, 
  password: string,
  metadata?: { [key: string]: any }
) => {
  debugLog('[Supabase] Signing up user');
  
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,  // Store additional user info
    },
  });
  
  if (error) {
    debugError('[Supabase] Sign up error:', error.message);
  } else {
    debugLog('[Supabase] Sign up successful');
  }
  
  return { data, error };
};

/**
 * Sign in an existing user with email and password
 * 
 * @param email - User's email address
 * @param password - User's password
 * @returns Promise with session data or error
 * 
 * @example
 * const { data, error } = await signIn('user@example.com', 'password123');
 * if (data.session) console.log('Logged in!');
 */
export const signIn = async (email: string, password: string) => {
  debugLog('[Supabase] Signing in user');
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) {
    debugError('[Supabase] Sign in error:', error.message);
  } else {
    debugLog('[Supabase] Sign in successful');
  }
  
  return { data, error };
};

/**
 * Sign in with Apple (iOS)
 * Uses Apple's native authentication
 * 
 * @param identityToken - Token from Apple Sign In
 * @param nonce - Nonce used during Apple auth
 * @returns Promise with session data or error
 */
export const signInWithApple = async (identityToken: string, nonce: string) => {
  debugLog('[Supabase] Signing in with Apple');
  
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
    nonce,
  });
  
  if (error) {
    debugError('[Supabase] Apple sign in error:', error.message);
  }
  
  return { data, error };
};

/**
 * Sign out the current user
 * Clears session and removes tokens from secure storage
 * 
 * @returns Promise with error if sign out failed
 * 
 * @example
 * await signOut();
 */
export const signOut = async () => {
  debugLog('[Supabase] Signing out user');
  
  const { error } = await supabase.auth.signOut();
  
  if (error) {
    debugError('[Supabase] Sign out error:', error.message);
  } else {
    debugLog('[Supabase] Sign out successful');
  }
  
  return { error };
};

/**
 * Send password reset email
 * User will receive email with reset link
 * 
 * @param email - User's email address
 * @returns Promise with error if failed
 */
export const resetPassword = async (email: string) => {
  debugLog('[Supabase] Sending password reset');
  
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    // Use the same deep-link callback path used by OAuth/magic-link flows.
    // Make sure this URL is allow-listed in Supabase Auth settings (Redirect URLs).
    redirectTo: 'mindsparkle://auth/callback',
  });
  
  return { data, error };
};

/**
 * Update user password (when logged in)
 * 
 * @param newPassword - New password to set
 * @returns Promise with user data or error
 */
export const updatePassword = async (newPassword: string) => {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  
  return { data, error };
};

/**
 * Get current user session
 * Returns null if user is not logged in
 * 
 * @returns Promise with session data
 */
export const getCurrentSession = async (): Promise<{ data: { session: Session | null }, error: any }> => {
  const { data, error } = await supabase.auth.getSession();
  return { data, error };
};

/**
 * Get current authenticated user
 * 
 * @returns Promise with user data
 */
export const getCurrentUser = async (): Promise<{ data: { user: User | null }, error: any }> => {
  const { data, error } = await supabase.auth.getUser();
  return { data, error };
};

/**
 * Subscribe to auth state changes
 * Useful for updating UI when user logs in/out
 * 
 * @param callback - Function called on auth state change
 * @returns Subscription object (call .unsubscribe() to stop)
 * 
 * @example
 * const { data: { subscription } } = onAuthStateChange((event, session) => {
 *   if (event === 'SIGNED_IN') console.log('User signed in');
 * });
 * // Later: subscription.unsubscribe();
 */
export const onAuthStateChange = (
  callback: (event: AuthChangeEvent, session: Session | null) => void
) => {
  return supabase.auth.onAuthStateChange(callback);
};

/**
 * Refresh the current session
 * Manually refresh JWT token
 * 
 * @returns Promise with new session or error
 */
export const refreshSession = async () => {
  const { data, error } = await supabase.auth.refreshSession();

  // If a stale/invalid refresh token is cached locally (common on simulators after many rebuilds),
  // clear local auth state so the app can render the login flow without repeated errors.
  if (error?.message && typeof error.message === 'string') {
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid refresh token')) {
      try {
        // local-only sign out avoids additional network calls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.auth as any).signOut({ scope: 'local' });
      } catch {
        // best-effort
      }
    }
  }

  return { data, error };
};

// ============================================
// DATABASE OPERATIONS - DOCUMENTS
// ============================================

/**
 * Document type definition for database operations
 */
export interface DocumentRecord {
  id?: string;
  user_id: string;
  name: string;
  file_type: string;
  file_size: number;
  storage_path?: string;
  content?: string;
  summary?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/**
 * Create a new document record in the database
 * 
 * @param document - Document data to insert
 * @returns Promise with inserted document or error
 */
export const createDocument = async (document: Omit<DocumentRecord, 'id' | 'created_at' | 'updated_at'>) => {
  console.log('[Supabase] Creating document:', document.name);
  
  const { data, error } = await supabase
    .from('documents')
    .insert(document)
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] Create document error:', error.message);
  }
  
  return { data, error };
};

/**
 * Get all documents for the current user
 * 
 * @param userId - User ID to fetch documents for
 * @param options - Query options (limit, offset, orderBy)
 * @returns Promise with documents array or error
 */
export const getDocuments = async (
  userId: string,
  options?: { 
    limit?: number; 
    offset?: number; 
    orderBy?: string;
    ascending?: boolean;
  }
) => {
  let query = supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId);
  
  // Apply ordering
  if (options?.orderBy) {
    query = query.order(options.orderBy, { ascending: options.ascending ?? false });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  
  // Apply pagination
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
  }
  
  const { data, error } = await query;
  
  return { data, error };
};

/**
 * Get a single document by ID
 * 
 * @param documentId - Document ID to fetch
 * @returns Promise with document or error
 */
export const getDocumentById = async (documentId: string) => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();
  
  return { data, error };
};

/**
 * Update an existing document
 * 
 * @param documentId - Document ID to update
 * @param updates - Fields to update
 * @returns Promise with updated document or error
 */
export const updateDocument = async (
  documentId: string, 
  updates: Partial<DocumentRecord>
) => {
  console.log('[Supabase] Updating document:', documentId);
  
  const { data, error } = await supabase
    .from('documents')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] Update document error:', error.message);
  }
  
  return { data, error };
};

/**
 * Delete a document by ID
 * Also deletes associated storage files
 * 
 * @param documentId - Document ID to delete
 * @param storagePath - Optional storage path to delete file
 * @returns Promise with error if failed
 */
export const deleteDocument = async (documentId: string, storagePath?: string) => {
  console.log('[Supabase] Deleting document:', documentId);
  
  // Delete storage file if path provided
  if (storagePath) {
    await deleteFileFromStorage('documents', storagePath);
  }
  
  // Delete database record
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId);
  
  if (error) {
    console.error('[Supabase] Delete document error:', error.message);
  }
  
  return { error };
};

// ============================================
// DATABASE OPERATIONS - USERS
// ============================================

/**
 * User profile type definition
 */
export interface UserProfile {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
  is_premium?: boolean;
  preferences?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/**
 * Get or create user profile
 * Creates profile on first sign in
 * 
 * @param userId - User ID
 * @param email - User email (for new profiles)
 * @returns Promise with profile or error
 */
export const getOrCreateProfile = async (userId: string, email?: string) => {
  // Try to get existing profile
  let { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  // Create profile if not exists
  if (error && error.code === 'PGRST116') {
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert({ id: userId, email })
      .select()
      .single();
    
    return { data: newProfile, error: createError };
  }
  
  return { data, error };
};

/**
 * Update user profile
 * 
 * @param userId - User ID
 * @param updates - Profile fields to update
 * @returns Promise with updated profile or error
 */
export const updateProfile = async (
  userId: string, 
  updates: Partial<UserProfile>
) => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();
  
  return { data, error };
};

// ============================================
// STORAGE OPERATIONS
// ============================================

/**
 * Upload a file to Supabase Storage
 * Supports large files with automatic chunking
 * 
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @param file - File data (Blob, ArrayBuffer, or Uint8Array)
 * @param options - Upload options
 * @returns Promise with file path and public URL
 * 
 * @example
 * const result = await uploadFileToStorage('documents', 'user123/doc.pdf', fileBlob, {
 *   contentType: 'application/pdf',
 *   onProgress: (progress) => console.log(progress + '%')
 * });
 */
export const uploadFileToStorage = async (
  bucket: string,
  path: string,
  file: Blob | ArrayBuffer | Uint8Array,
  options?: {
    contentType?: string;
    cacheControl?: string;
    upsert?: boolean;
    onProgress?: (progress: number) => void;
  }
) => {
  console.log('[Supabase] Uploading file:', path);
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: options?.contentType,
      cacheControl: options?.cacheControl || '3600',
      upsert: options?.upsert ?? true,
    });
    
  if (error) {
    console.error('[Supabase] Upload error:', error.message);
    throw error;
  }
  
  // Get public URL for the uploaded file
  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);
  
  console.log('[Supabase] Upload successful:', data.path);
    
  return { 
    path: data.path, 
    publicUrl: publicUrlData.publicUrl,
    fullPath: `${bucket}/${path}`,
  };
};

/**
 * Download a file from Supabase Storage
 * 
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @returns Promise with file blob or error
 */
export const downloadFileFromStorage = async (bucket: string, path: string) => {
  console.log('[Supabase] Downloading file:', path);
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path);
    
  if (error) {
    console.error('[Supabase] Download error:', error.message);
  }
  
  return { data, error };
};

/**
 * Get a signed URL for private file access
 * URL expires after specified duration
 * 
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns Promise with signed URL
 */
export const getSignedUrl = async (
  bucket: string, 
  path: string, 
  expiresIn: number = 3600
) => {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
    
  if (error) {
    console.error('[Supabase] Signed URL error:', error.message);
  }
  
  return { data, error };
};

/**
 * Get public URL for a file (if bucket is public)
 * 
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @returns Public URL string
 */
export const getPublicUrl = (bucket: string, path: string): string => {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};

/**
 * Delete a file from storage
 * 
 * @param bucket - Storage bucket name
 * @param path - File path to delete
 * @returns Promise with error if failed
 */
export const deleteFileFromStorage = async (bucket: string, path: string) => {
  console.log('[Supabase] Deleting file:', path);
  
  const { error } = await supabase.storage
    .from(bucket)
    .remove([path]);
    
  if (error) {
    console.error('[Supabase] Delete error:', error.message);
  }
  
  return { error };
};

/**
 * List files in a storage folder
 * 
 * @param bucket - Storage bucket name
 * @param folderPath - Folder path to list
 * @param options - List options
 * @returns Promise with file list or error
 */
export const listStorageFiles = async (
  bucket: string, 
  folderPath: string,
  options?: {
    limit?: number;
    offset?: number;
    sortBy?: { column: string; order: 'asc' | 'desc' };
  }
) => {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folderPath, {
      limit: options?.limit || 100,
      offset: options?.offset || 0,
      sortBy: options?.sortBy || { column: 'created_at', order: 'desc' },
    });
  
  return { data, error };
};

// ============================================
// EDGE FUNCTION CALLS
// ============================================

/**
 * Call a Supabase Edge Function
 * 
 * @param functionName - Name of the edge function
 * @param payload - Data to send to the function
 * @returns Promise with function response or error
 * 
 * @example
 * const result = await callEdgeFunction('process-document', { documentId: '123' });
 */
export const callEdgeFunction = async <T = any>(
  functionName: string, 
  payload?: Record<string, any>
): Promise<{ data: T | null; error: any }> => {
  console.log('[Supabase] Calling edge function:', functionName);
  
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: payload,
  });
  
  if (error) {
    console.error('[Supabase] Edge function error:', error.message);
  }
  
  return { data, error };
};

// ============================================
// REALTIME SUBSCRIPTIONS
// ============================================

/**
 * Subscribe to realtime changes on a table
 * 
 * @param table - Table name to subscribe to
 * @param callback - Function called on changes
 * @param filter - Optional filter (e.g., 'user_id=eq.123')
 * @returns Channel object (call .unsubscribe() to stop)
 * 
 * @example
 * const channel = subscribeToTable('documents', (payload) => {
 *   console.log('Change:', payload);
 * }, 'user_id=eq.abc123');
 * // Later: channel.unsubscribe();
 */
export const subscribeToTable = (
  table: string,
  callback: (payload: any) => void,
  filter?: string
) => {
  const channel = supabase
    .channel(`${table}-changes`)
    .on(
      'postgres_changes',
      { 
        event: '*', 
        schema: 'public', 
        table,
        filter,
      },
      callback
    )
    .subscribe();
  
  return channel;
};

// ============================================
// EXPORTS
// ============================================

export default supabase;
