import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider as PaperProvider } from 'react-native-paper';
import { StyleSheet } from 'react-native';

import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { DocumentProvider } from './src/context/DocumentContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { initDatabase } from './src/services/storage';
import { LoadingSpinner } from './src/components/LoadingSpinner';

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    prepareApp();
  }, []);

  const prepareApp = async () => {
    try {
      // Initialize database
      await initDatabase();
      
      // Add any other initialization here
      
      setIsReady(true);
    } catch (error) {
      console.error('Error preparing app:', error);
      // Still set ready to true to allow app to load
      setIsReady(true);
    }
  };

  if (!isReady) {
    return <LoadingSpinner message="Loading MindSparkle..." />;
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <DocumentProvider>
              <PaperProvider>
                <AppNavigator />
                <StatusBar style="light" />
              </PaperProvider>
            </DocumentProvider>
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
