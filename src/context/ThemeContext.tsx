import React, { createContext, useEffect, useMemo, useRef, useState, useContext, ReactNode } from 'react';
import { Appearance, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../constants/colors';

interface Theme {
  colors: typeof colors;
  isDark: boolean;
}

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const THEME_MODE_KEY = '@mindsparkle_theme_mode';
  const [mode, setMode] = useState<'system' | 'light' | 'dark'>('system');
  const [isLoaded, setIsLoaded] = useState(false);
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark' | null>(() => Appearance.getColorScheme());

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');

  // Load persisted preference once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_MODE_KEY);
        if (!cancelled && (saved === 'system' || saved === 'light' || saved === 'dark')) {
          setMode(saved);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Track system theme changes when in system mode.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => {
      // RN returns either { remove } or a function depending on version
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sub as any)?.remove?.();
    };
  }, []);

  // Persist changes (after initial load).
  useEffect(() => {
    if (!isLoaded) return;
    void AsyncStorage.setItem(THEME_MODE_KEY, mode).catch(() => {});
  }, [isLoaded, mode]);

  const themedColors = useMemo(() => {
    // Keep existing brand colors, only swap surfaces/text for dark mode.
    if (!isDark) {
      return {
        ...colors,
        background: '#ffffff',
        surface: '#f8fafc',
        card: '#ffffff',
        cardBackground: '#ffffff',
        text: '#1a1a2e',
        textSecondary: '#64748b',
        border: '#E5E7EB',
      };
    }

    return {
      ...colors,
      background: '#0f0f1a',
      surface: '#1a1a2e',
      card: '#16213e',
      cardBackground: '#16213e',
      text: '#e0e0e0',
      textSecondary: '#a0a0a0',
      border: '#2a2f45',
      shadowColor: '#000000',
    };
  }, [isDark]);

  const theme: Theme = useMemo(
    () => ({
      colors: themedColors,
      isDark,
    }),
    [themedColors, isDark]
  );

  const toggleTheme = () => {
    // Convert the current effective theme into the opposite explicit mode.
    setMode(isDark ? 'light' : 'dark');
  };

  // Smooth transition on theme change (fade).
  const opacity = useRef(new Animated.Value(1)).current;
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isDark, opacity]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
