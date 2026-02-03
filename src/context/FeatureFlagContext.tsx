import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ApiService from '../services/apiService';
import { useToast } from './ToastContext';

export type FeatureFlag = {
  enabled: boolean;
  settings?: Record<string, any> | null;
};

export type FeatureFlags = Record<string, FeatureFlag>;

const DEFAULT_FLAGS: FeatureFlags = {
  streaming: { enabled: true },
  multi_model: { enabled: true, settings: { models: ['claude', 'gpt', 'gemini'] } },
  retry_button: { enabled: true },
  like_dislike: { enabled: true },
  dark_mode: { enabled: true },
  guest_mode: { enabled: true, settings: { message_limit: 10, history_retention_hours: 24 } },
  file_upload: { enabled: true, settings: { max_size_mb: 50, allowed_types: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp3', 'mp4'] } },
  document_generation: { enabled: true, settings: { formats: ['docx', 'pdf', 'xlsx', 'pptx', 'md'] } },
  voice_input: { enabled: true },
  suggested_prompts: { enabled: true },
};

interface FeatureFlagContextValue {
  flags: FeatureFlags;
  isReady: boolean;
  getFlag: (name: string) => FeatureFlag | undefined;
}

const FeatureFlagContext = createContext<FeatureFlagContextValue>({
  flags: DEFAULT_FLAGS,
  isReady: false,
  getFlag: () => undefined,
});

export const FeatureFlagProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [isReady, setIsReady] = useState(false);
  const { showToast } = useToast();
  const lastFlagsRef = useRef<FeatureFlags | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchFlags = async () => {
      try {
        const res = await ApiService.getRemoteConfig();
        if (cancelled) return;
        if (res && typeof res === 'object') {
          const nextFlags = { ...DEFAULT_FLAGS, ...(res as FeatureFlags) };
          const prevFlags = lastFlagsRef.current;
          setFlags(nextFlags);
          if (prevFlags) {
            const changed = JSON.stringify(prevFlags) !== JSON.stringify(nextFlags);
            if (changed) {
              showToast('✨ New features available!', 'info');
            }
          }
          lastFlagsRef.current = nextFlags;
        }
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) setIsReady(true);
      }
    };

    fetchFlags();
    const interval = setInterval(fetchFlags, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const value = useMemo<FeatureFlagContextValue>(() => ({
    flags,
    isReady,
    getFlag: (name: string) => flags[name],
  }), [flags, isReady]);

  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  );
};

export const useFeatureFlags = () => useContext(FeatureFlagContext);
