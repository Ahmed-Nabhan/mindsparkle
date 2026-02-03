import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from './ThemeContext';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ id: String(Date.now()), message, type });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  const typeColor = (t: ToastType) => {
    if (t === 'success') return '#10B981';
    if (t === 'warning') return '#F59E0B';
    if (t === 'error') return '#EF4444';
    return '#3B82F6';
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <View style={[styles.toast, { backgroundColor: c.card, borderColor: c.border }]}
          pointerEvents="none"
        >
          <View style={[styles.dot, { backgroundColor: typeColor(toast.type) }]} />
          <Text style={[styles.text, { color: c.text }]}>{toast.message}</Text>
        </View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
