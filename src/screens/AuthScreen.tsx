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

interface AuthScreenProps {
  navigation: any;
}

type AuthMode = 'signin' | 'signup' | 'forgot';

export const AuthScreen: React.FC<AuthScreenProps> = ({ navigation }) => {
  const { signIn, signUp } = useAuth();
  
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);

  // Check if Apple Authentication is available
  useEffect(() => {
    const checkAppleAuth = async () => {
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      setAppleAuthAvailable(isAvailable);
    };
    checkAppleAuth();
  }, []);

  // Native Apple Sign In with Face ID/Touch ID
  const handleAppleSignIn = async () => {
    try {
      setIsLoading(true);
      
      // Generate a secure nonce for security
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      console.log('Starting Apple Sign In with nonce...');

      // This shows the native Apple Sign In sheet with Face ID/Touch ID
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      console.log('Apple credential received, identity token present:', !!credential.identityToken);

      // Sign in with Supabase using the Apple ID token
      if (credential.identityToken) {
        console.log('Sending token to Supabase...');
        
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
          nonce: rawNonce,
        });

        // Check if we got a session regardless of database errors
        const session = data?.session;
        const authUser = data?.user;
        
        if (error) {
          console.error('Supabase auth error:', JSON.stringify(error));
          
          // Handle database trigger errors gracefully
          // Auth may have succeeded even if profile creation failed
          if (error.message?.includes('Database error') || 
              error.message?.includes('saving new user') ||
              error.message?.includes('duplicate key') ||
              error.message?.includes('violates') ||
              error.message?.includes('trigger')) {
            console.log('Profile creation issue, checking if auth succeeded...');
            
            // Check if we actually have a valid session despite the error
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session) {
              console.log('Auth succeeded despite database error, proceeding...');
              // Continue with navigation
            } else if (!session) {
              throw new Error('Authentication failed. Please try again.');
            }
          } else {
            throw new Error(error.message || 'Supabase authentication failed');
          }
        }
        
        console.log('Apple Sign In successful, user:', authUser?.id || 'checking session...');
        
        // Verify we have a valid session
        const { data: finalSession } = await supabase.auth.getSession();
        if (!finalSession?.session) {
          throw new Error('Failed to establish session. Please try again.');
        }
        
        console.log('Session verified, navigating to Main...');
        
        // Wait a moment for auth state to propagate
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Use reset to clear the navigation stack and go to Main
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Main' }],
          })
        );
      } else {
        throw new Error('No identity token received from Apple');
      }
    } catch (error: any) {
      if (error.code === 'ERR_REQUEST_CANCELED') {
        // User cancelled - do nothing
        console.log('Apple Sign In cancelled by user');
        return;
      }
      
      console.error('Apple Sign In error:', error);
      
      // Provide more helpful error messages
      let errorMessage = 'Could not sign in with Apple. Please try again.';
      
      if (error.message) {
        // Show the actual error message for debugging
        errorMessage = error.message;
        
        if (errorMessage.includes('Network')) {
          errorMessage = 'Network connection error. Please check your internet and try again.';
        } else if (errorMessage.includes('invalid_grant')) {
          errorMessage = 'Apple Sign In session expired. Please try again.';
        } else if (errorMessage.includes('client_id')) {
          errorMessage = 'App configuration error (Bundle ID mismatch). Please contact support.';
        } else if (errorMessage.includes('Unacceptable audience')) {
          errorMessage = 'Configuration Error: Your Bundle ID (com.ahmednabhan.mindsparkle) is not registered in Supabase. Please go to Supabase Dashboard > Authentication > Providers > Apple and add "com.ahmednabhan.mindsparkle" to the "Bundle ID" field.';
        }
      }
      
      Alert.alert('Sign In Failed', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSignIn = async () => {
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
      await signIn(email.trim().toLowerCase(), password);
      // Navigation will happen automatically through auth state change
    } catch (error: any) {
      Alert.alert('Sign In Failed', error.message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (!validateEmail(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    try {
      setIsLoading(true);
      await signUp(email.trim().toLowerCase(), password);
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
      // Import the resetPassword function from supabase service
      const { supabase } = require('../services/supabase');
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
      
      if (error) throw error;
      
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
    }
  };

  const handleContinueAsGuest = () => {
    navigation.replace('Main');
  };

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
          </Text>

          <Text style={styles.subtitle}>
            {mode === 'signin' && 'Sign in to continue learning'}
            {mode === 'signup' && 'Join MindSparkle today'}
            {mode === 'forgot' && 'Enter your email to reset password'}
          </Text>

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

          {/* Password Input - Hide for forgot mode */}
          {mode !== 'forgot' && (
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
            <TouchableOpacity
              style={styles.forgotButton}
              onPress={() => setMode('forgot')}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>
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
              </Text>
            )}
          </TouchableOpacity>

          {/* Social Login Divider */}
          {mode !== 'forgot' && (
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
            {mode === 'forgot' && (
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
  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },
  forgotText: {
    color: colors.primary,
    fontSize: 14,
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
