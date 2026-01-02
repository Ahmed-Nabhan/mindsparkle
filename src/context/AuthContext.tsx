import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import { User, AuthState } from '../types/user';
import { getCurrentUser, signIn as supabaseSignIn, signOut as supabaseSignOut, signUp as supabaseSignUp, supabase } from '../services/supabase';
import { cloudSyncService } from '../services/cloudSyncService';

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const updateUserFromSession = useCallback((supabaseUser: any) => {
    if (supabaseUser) {
      setUser({
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        isPremium: false,
        createdAt: new Date(supabaseUser.created_at),
      });
      setIsAuthenticated(true);
      cloudSyncService.initialize(supabaseUser.id);
    } else {
      setUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkUser();
    
    // Listen for auth state changes (handles Apple Sign In auto-login)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.id);
      
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          updateUserFromSession(session.user);
          setIsLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsAuthenticated(false);
      } else if (event === 'INITIAL_SESSION') {
        // Handle initial session on app load
        if (session?.user) {
          updateUserFromSession(session.user);
        }
        setIsLoading(false);
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [updateUserFromSession]);

  const checkUser = async () => {
    try {
      // First check for existing session
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        updateUserFromSession(sessionData.session.user);
        setIsLoading(false);
        return;
      }
      
      // Fallback to getUser
      const { data, error } = await getCurrentUser();
      if (data?.user) {
        updateUserFromSession(data.user);
      }
    } catch (error) {
      console.error('Error checking user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Method to manually refresh auth state
  const refreshAuth = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        updateUserFromSession(sessionData.session.user);
      }
    } catch (error) {
      console.error('Error refreshing auth:', error);
    }
  }, [updateUserFromSession]);

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabaseSignIn(email, password);
      if (error) throw error;
      
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email || '',
          isPremium: false,
          createdAt: new Date(data.user.created_at),
        });
        setIsAuthenticated(true);
        
        // Initialize sync service
        cloudSyncService.initialize(data.user.id);
        
        // Trigger background sync (don't await)
        cloudSyncService.downloadDocuments().catch(console.error);
        cloudSyncService.downloadFolders().catch(console.error);
      }
    } catch (error) {
      console.error('Error signing in:', error);
      throw error;
    }
  };

  const signUp = async (email: string, password: string) => {
    try {
      const { data, error } = await supabaseSignUp(email, password);
      if (error) throw error;
      
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email || '',
          isPremium: false,
          createdAt: new Date(data.user.created_at),
        });
        setIsAuthenticated(true);
        
        // Initialize sync service
        cloudSyncService.initialize(data.user.id);
      }
    } catch (error) {
      console.error('Error signing up:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await supabaseSignOut();
      setUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        signIn,
        signUp,
        signOut,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
