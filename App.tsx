import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider as PaperProvider } from 'react-native-paper';
import { StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { DocumentProvider } from './src/context/DocumentContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { PremiumProvider } from './src/context/PremiumContext';
import { GamificationProvider } from './src/context/GamificationContext';
import { FeatureFlagProvider } from './src/context/FeatureFlagContext';
import { initDatabase, deleteAllDocuments } from './src/services/storage';
import { Alert, InteractionManager, Linking } from 'react-native';
import type { RootStackParamList } from './src/navigation/types';

const APP_VERSION_KEY = '@mindsparkle_app_version';
const CURRENT_APP_VERSION = '2.0.0'; // Pro version - clear old data

const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Keep the native splash visible until our first screen is ready.
// This avoids a blank screen while JS is still warming up.
void SplashScreen.preventAutoHideAsync();

function parseHashParams(hash: string): Record<string, string> {
  const raw = (hash || '').replace(/^#/, '');
  const params: Record<string, string> = {};
  if (!raw) return params;
  for (const part of raw.split('&')) {
    const [k, v] = part.split('=');
    if (!k) continue;
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return params;
}

export default function App() {
  const pendingResetNav = React.useRef(false);
  const isHandlingUrl = React.useRef(false);

  useEffect(() => {
    // Kick off heavy startup work in the background.
    // We render immediately and hide the splash once navigation is ready.
    void prepareApp();
  }, []);

  useEffect(() => {
    const handleUrl = async (url: string | null | undefined) => {
      if (!url) return;
      if (isHandlingUrl.current) return;
      isHandlingUrl.current = true;

      try {
        const parsed = new URL(url);

        // Supabase email links for PKCE typically provide ?code=...
        const code = parsed.searchParams.get('code');
        const type = parsed.searchParams.get('type') || parsed.searchParams.get('token_type');
        const errorDescription = parsed.searchParams.get('error_description');

        if (errorDescription) {
          Alert.alert('Link Error', decodeURIComponent(errorDescription));
          return;
        }

        // Lazy-load Supabase only when we actually need to handle an auth link.
        const { supabase } = await import('./src/services/supabase');

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            Alert.alert('Link Error', error.message || 'Could not verify link.');
            return;
          }
        } else {
          // Fallback for implicit-style links that include tokens in the hash
          const hashParams = parseHashParams(parsed.hash);
          const accessToken = hashParams['access_token'];
          const refreshToken = hashParams['refresh_token'];
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) {
              Alert.alert('Link Error', error.message || 'Could not verify link.');
              return;
            }
          }
        }

        // If this is a password recovery link, open the in-app set-password screen.
        if (type === 'recovery') {
          if (navigationRef.isReady()) {
            navigationRef.navigate('ResetPassword');
          } else {
            pendingResetNav.current = true;
          }
        }
      } catch (e: any) {
        // If URL parsing fails, just ignore.
        console.warn('[DeepLink] Failed to handle URL:', e?.message || e);
      } finally {
        isHandlingUrl.current = false;
      }
    };

    // Handle cold start URL
    Linking.getInitialURL().then((initialUrl) => handleUrl(initialUrl));

    // Handle URLs while the app is running
    const sub = Linking.addEventListener('url', (event) => {
      void handleUrl(event?.url);
    });

    return () => {
      // RN returns an EventSubscription with remove()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sub as any)?.remove?.();
    };
  }, []);

  const prepareApp = async () => {
    try {
      // Warm up local DB schema (non-blocking for first render).
      // All storage calls are guarded to wait for schema init.
      void initDatabase();

      // Run maintenance AFTER first render/animations to keep startup snappy.
      InteractionManager.runAfterInteractions(() => {
        void (async () => {
          const storedVersion = await AsyncStorage.getItem(APP_VERSION_KEY);
          if (storedVersion !== CURRENT_APP_VERSION) {
            console.log('[App] New version detected - clearing old documents...');
            try {
              await deleteAllDocuments();
              console.log('[App] Old documents cleared successfully');
            } catch (clearError) {
              console.log('[App] Could not clear old documents:', clearError);
            }
            await AsyncStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION);
          }
        })();
      });
    } catch (error) {
      console.error('Error preparing app:', error);
    }
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <FeatureFlagProvider>
              <PremiumProvider>
                <GamificationProvider>
                  <DocumentProvider>
                    <PaperProvider>
                      <NavigationContainer
                        ref={navigationRef}
                        onReady={() => {
                          void SplashScreen.hideAsync();
                          if (pendingResetNav.current && navigationRef.isReady()) {
                            pendingResetNav.current = false;
                            navigationRef.navigate('ResetPassword');
                          }
                        }}
                      >
                        <AppNavigator />
                      </NavigationContainer>
                      <StatusBar style="light" />
                    </PaperProvider>
                  </DocumentProvider>
                </GamificationProvider>
              </PremiumProvider>
            </FeatureFlagProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
