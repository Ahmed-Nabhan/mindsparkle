import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { User, AuthState } from '../types/user';
import { getCurrentUser, signIn as supabaseSignIn, signOut as supabaseSignOut, signUp as supabaseSignUp } from '../services/supabase';

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { data, error } = await getCurrentUser();
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email || '',
          isPremium: false, // Default to free
          createdAt: new Date(data.user.created_at),
        });
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Error checking user:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
