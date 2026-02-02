import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import ApiService from '../services/apiService';

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
  dark_mode: { enabled: false },
  guest_mode: { enabled: true, settings: { message_limit: 10, history_retention_hours: 24 } },
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

  useEffect(() => {
    let cancelled = false;
    const fetchFlags = async () => {
      try {
        const res = await ApiService.getRemoteConfig();
        if (cancelled) return;
        if (res && typeof res === 'object') {
          setFlags((prev) => ({ ...prev, ...(res as FeatureFlags) }));
        }
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) setIsReady(true);
      }
    };

    fetchFlags();
    const interval = setInterval(fetchFlags, 60000);
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
