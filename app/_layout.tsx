import React, { useEffect, useState } from 'react';
import { Slot } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '../src/context/AuthContext';
import { ThemeProvider } from '../src/context/ThemeContext';
import { PremiumProvider } from '../src/context/PremiumContext';
import { GamificationProvider } from '../src/context/GamificationContext';
import { initDatabase } from '../src/services/storage';
import { initRevenueCat } from '../src/services/revenueCat';

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const setupApp = async () => {
      try {
        await initDatabase();
        console.log('Database initialized successfully');
        
        await initRevenueCat();
        console.log('RevenueCat initialized successfully');
        
        setDbReady(true);
      } catch (error) {
        console.error('Error initializing app:', error);
        setDbReady(true); // Continue anyway
      }
    };
    
    setupApp();
  }, []);

  if (!dbReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <PremiumProvider>
            <GamificationProvider>
              <Slot />
            </GamificationProvider>
          </PremiumProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
