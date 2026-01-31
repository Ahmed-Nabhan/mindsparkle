/**
 * AuthScreen - User authentication interface
 * 
 * SUPPORTED AUTH METHODS:
 * 1. Email/Password - Traditional sign in/up
 * 2. Apple Sign In - Native iOS authentication with Face ID/Touch ID
 * 3. Magic Link - Passwordless email authentication
 * 4. Password Reset - Email-based password recovery
 * 
 * DATA FLOW:
 * 1. User enters credentials or taps OAuth button
 * 2. Validation occurs client-side
 * 3. Auth request sent to Supabase
 * 4. On success: JWT stored securely → AuthContext updated → Navigate to Main
 * 5. On error: Display error message to user
 * 
 * UI STATES:
 * - Loading: Shows spinner, disables inputs
 * - Error: Shows alert with error message
 * - Success: Navigates to main app
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { CommonActions } from '@react-navigation/native';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface AuthScreenProps {
  navigation: any;
}

/**
 * Authentication modes:
 * - signin: Email/password login
 * - signup: Create new account
 * - forgot: Password reset
 * - magiclink: Passwordless login via email link
 */
type AuthMode = 'signin' | 'signup' | 'forgot' | 'magiclink';

// ============================================
// COMPONENT
// ============================================

export const AuthScreen: React.FC<AuthScreenProps> = ({ navigation }) => {
  // Get auth methods from context
  const { 
    signIn, 
    signUp, 
    signInWithApple, 
    signInWithMagicLink,
    resetPassword,
    isAuthenticated,
    authError,
    clearError,
  } = useAuth();
  
  // ============================================
  // STATE
  // ============================================
  
  // Form state
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  
  // Success message for magic link/reset
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ============================================
  // EFFECTS
  // ============================================

  /**
   * Check if Apple Authentication is available on this device
   * Only available on iOS 13+ with Apple ID configured
   */
  useEffect(() => {
    const checkAppleAuth = async () => {
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      setAppleAuthAvailable(isAvailable);
    };
    checkAppleAuth();
  }, []);

  /**
   * Clear errors when switching auth modes
   */
  useEffect(() => {
    clearError();
    setSuccessMessage(null);
  }, [mode, clearError]);

  const resetToMain = () => {
    const parentNav = typeof navigation.getParent === 'function' ? navigation.getParent() : null;
    const nav = parentNav || navigation;

    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      })
    );
  };

  // If auth state flips to authenticated while this screen is mounted
  // (e.g., delayed propagation, OAuth callback, magic link), ensure we exit Auth.
  useEffect(() => {
    if (!isAuthenticated) return;
    resetToMain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ============================================
  // VALIDATION
  // ============================================

  /**
   * Validate email format using regex
   */
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  /**
   * Validate password strength
   * Requirements: min 8 characters
   */
  const validatePassword = (password: string): { valid: boolean; message?: string } => {
    if (password.length < 8) {
      return { valid: false, message: 'Password must be at least 8 characters' };
    }
    return { valid: true };
  };

  // ============================================
  // AUTH HANDLERS
  // ============================================

  /**
   * Handle Apple Sign In
   * 
   * FLOW:
   * 1. Generate secure nonce for CSRF protection
   * 2. Show native Apple Sign In sheet (Face ID/Touch ID)
   * 3. Get identity token from Apple
   * 4. Send token to Supabase for verification
   * 5. Navigate to main app on success
   * 
   * SECURITY:
   * - Nonce prevents replay attacks
   * - Token is short-lived
   * - Verified server-side by Supabase
   */
  const handleAppleSignIn = async () => {
    try {
      setIsLoading(true);
      clearError();
      
      // Generate a secure nonce for CSRF protection
      // Raw nonce sent to Supabase, hashed nonce sent to Apple
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      console.log('[Auth] Starting Apple Sign In with nonce...');

      // Show native Apple Sign In sheet
      // This triggers Face ID/Touch ID automatically
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      console.log('[Auth] Apple credential received, identity token present:', !!credential.identityToken);

      // Verify token with Supabase
      if (credential.identityToken) {
        console.log('[Auth] Sending token to Supabase...');
        
        // Use context method which handles all the logic
        await signInWithApple(credential.identityToken, rawNonce);
        
        console.log('[Auth] Apple Sign In successful, navigating to Main...');
        
        // Wait for auth state to propagate
        await new Promise(resolve => setTimeout(resolve, 300));
        
        resetToMain();
      } else {
        throw new Error('No identity token received from Apple');
      }
    } catch (error: any) {
      // User cancelled - don't show error
      if (error.code === 'ERR_REQUEST_CANCELED') {
        console.log('[Auth] Apple Sign In cancelled by user');
        return;
      }
      
      console.error('[Auth] Apple Sign In error:', error);
      
      // Map error to user-friendly message
      let errorMessage = 'Could not sign in with Apple. Please try again.';
      
      if (error.message) {
        if (error.message.includes('Network')) {
          errorMessage = 'Network connection error. Please check your internet.';
        } else if (error.message.includes('invalid_grant')) {
          errorMessage = 'Apple Sign In session expired. Please try again.';
        } else if (error.message.includes('Unacceptable audience')) {
          errorMessage = 'Configuration Error: Bundle ID not registered in Supabase.';
        } else {
          errorMessage = error.message;
        }
      }
      
      Alert.alert('Sign In Failed', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle email/password sign in
   * 
   * VALIDATION:
   * - Email format check
   * - Non-empty password
   */
  const handleSignIn = async () => {
    // Validate inputs
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!validateEmail(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    try {
      setIsLoading(true);
      clearError();
      
      // Sign in via context (handles JWT storage automatically)
      await signIn(email.trim().toLowerCase(), password);
      
      console.log('[Auth] Sign in successful, navigating to Main...');
      
      // Wait briefly for auth state to propagate
      await new Promise(resolve => setTimeout(resolve, 300));
      
      resetToMain();
    } catch (error: any) {
      Alert.alert('Sign In Failed', error.message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle new account creation
   * 
   * VALIDATION:
   * - Email format check
   * - Password strength (min 8 chars)
   * - Password confirmation match
   */
  const handleSignUp = async () => {
    // Validate inputs
    if (!email.trim() || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!validateEmail(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      Alert.alert('Error', passwordValidation.message);
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    try {
      setIsLoading(true);
      clearError();
      
      // Create account via context
      await signUp(email.trim().toLowerCase(), password);
      
      // Show verification email notice
      Alert.alert(
        'Check Your Email',
        'We sent you a verification link. Please check your email to complete registration.',
        [{ text: 'OK', onPress: () => setMode('signin') }]
      );
    } catch (error: any) {
      Alert.alert('Sign Up Failed', error.message || 'Could not create account');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle password reset request
   * Sends email with reset link
   */
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    if (!validateEmail(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    try {
      setIsLoading(true);
      clearError();
      
      // Use context method
      await resetPassword(email.trim().toLowerCase());
      
      // Show success message
      setSuccessMessage('Password reset email sent! Check your inbox.');
      Alert.alert(
        'Password Reset Email Sent',
        'Check your email for a link to reset your password.',
        [{ text: 'OK', onPress: () => setMode('signin') }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle Magic Link (passwordless) sign in
   * Sends email with login link
   */
  const handleMagicLink = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    if (!validateEmail(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    try {
      setIsLoading(true);
      clearError();
      
      // Send magic link via context
      await signInWithMagicLink(email.trim().toLowerCase());
      
      // Show success message
      setSuccessMessage('Magic link sent! Check your email to sign in.');
      Alert.alert(
        'Magic Link Sent',
        'Check your email for a link to sign in. No password needed!',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not send magic link');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Route to appropriate handler based on auth mode
   */
  const handleSubmit = () => {
    switch (mode) {
      case 'signin':
        handleSignIn();
        break;
      case 'signup':
        handleSignUp();
        break;
      case 'forgot':
        handleForgotPassword();
        break;
      case 'magiclink':
        handleMagicLink();
        break;
    }
  };

  /**
   * Skip authentication and continue as guest
   * Limited functionality without account
   */
  const handleContinueAsGuest = () => {
    navigation.replace('Main');
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo/Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>✨</Text>
          <Text style={styles.appName}>MindSparkle</Text>
          <Text style={styles.tagline}>AI-Powered Learning</Text>
        </View>

        {/* Auth Card */}
        <View style={styles.authCard}>
          <Text style={styles.title}>
            {mode === 'signin' && 'Welcome Back'}
            {mode === 'signup' && 'Create Account'}
            {mode === 'forgot' && 'Reset Password'}
            {mode === 'magiclink' && 'Magic Link Sign In'}
          </Text>

          <Text style={styles.subtitle}>
            {mode === 'signin' && 'Sign in to continue learning'}
            {mode === 'signup' && 'Join MindSparkle today'}
            {mode === 'forgot' && 'Enter your email to reset password'}
            {mode === 'magiclink' && 'No password needed - we\'ll email you a link'}
          </Text>

          {/* Success Message */}
          {successMessage && (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>✅ {successMessage}</Text>
            </View>
          )}

          {/* Email Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>📧</Text>
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor={colors.textLight}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isLoading}
              />
            </View>
          </View>

          {/* Password Input - Hide for forgot and magiclink modes */}
          {(mode === 'signin' || mode === 'signup') && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputIcon}>🔒</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textLight}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  editable={!isLoading}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                >
                  <Text>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Confirm Password - Only for signup */}
          {mode === 'signup' && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Confirm Password</Text>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputIcon}>🔒</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textLight}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  editable={!isLoading}
                />
              </View>
            </View>
          )}

          {/* Forgot Password Link */}
          {mode === 'signin' && (
            <View style={styles.forgotContainer}>
              <TouchableOpacity
                style={styles.forgotButton}
                onPress={() => setMode('forgot')}
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.forgotButton}
                onPress={() => setMode('magiclink')}
              >
                <Text style={styles.magicLinkText}>🔗 Magic Link</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>
                {mode === 'signin' && 'Sign In'}
                {mode === 'signup' && 'Create Account'}
                {mode === 'forgot' && 'Send Reset Link'}
                {mode === 'magiclink' && 'Send Magic Link'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Social Login Divider */}
          {(mode === 'signin' || mode === 'signup') && (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Social Login Buttons */}
              <View style={styles.socialButtons}>
                {/* Native Apple Sign In Button - Only show on iOS if available */}
                {Platform.OS === 'ios' && appleAuthAvailable ? (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={12}
                    style={styles.appleButton}
                    onPress={handleAppleSignIn}
                  />
                ) : (
                  <TouchableOpacity 
                    style={styles.socialButton}
                    onPress={handleAppleSignIn}
                    disabled={!appleAuthAvailable}
                  >
                    <Text style={styles.socialIcon}>🍎</Text>
                    <Text style={styles.socialText}>Apple</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {/* Switch Mode */}
          <View style={styles.switchContainer}>
            {mode === 'signin' && (
              <>
                <Text style={styles.switchText}>Don't have an account? </Text>
                <TouchableOpacity onPress={() => setMode('signup')}>
                  <Text style={styles.switchLink}>Sign Up</Text>
                </TouchableOpacity>
              </>
            )}
            {mode === 'signup' && (
              <>
                <Text style={styles.switchText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => setMode('signin')}>
                  <Text style={styles.switchLink}>Sign In</Text>
                </TouchableOpacity>
              </>
            )}
            {(mode === 'forgot' || mode === 'magiclink') && (
              <TouchableOpacity onPress={() => setMode('signin')}>
                <Text style={styles.switchLink}>← Back to Sign In</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Guest Option */}
        <TouchableOpacity
          style={styles.guestButton}
          onPress={handleContinueAsGuest}
        >
          <Text style={styles.guestText}>Continue as Guest</Text>
        </TouchableOpacity>

        {/* Terms */}
        <Text style={styles.terms}>
          By continuing, you agree to our{' '}
          <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 60,
    marginBottom: 10,
  },
  appName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
  },
  tagline: {
    fontSize: 16,
    color: colors.textLight,
    marginTop: 4,
  },
  authCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
    color: colors.text,
  },
  eyeButton: {
    padding: 8,
  },
  forgotContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  forgotButton: {
    padding: 4,
  },
  forgotText: {
    color: colors.primary,
    fontSize: 14,
  },
  magicLinkText: {
    color: colors.secondary || colors.primary,
    fontSize: 14,
  },
  successBanner: {
    backgroundColor: '#d4edda',
    borderColor: '#c3e6cb',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    color: '#155724',
    fontSize: 14,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: 12,
    color: colors.textLight,
    fontSize: 14,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    alignItems: 'center',
  },
  appleButton: {
    width: 140,
    height: 48,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  socialIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  socialText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  switchText: {
    color: colors.textLight,
    fontSize: 14,
  },
  switchLink: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  guestButton: {
    alignItems: 'center',
    marginTop: 24,
    padding: 16,
  },
  guestText: {
    color: colors.textLight,
    fontSize: 16,
  },
  terms: {
    fontSize: 12,
    color: colors.textLight,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
  termsLink: {
    color: colors.primary,
  },
});

export default AuthScreen;
