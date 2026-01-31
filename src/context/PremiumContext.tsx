import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import revenueCatService, { 
  ProductInfo, 
  SubscriptionInfo, 
  PRODUCT_IDS,
  ENTITLEMENT_ID 
} from '../services/revenueCat';
import { useAuth } from './AuthContext';
import * as CloudStorage from '../services/cloudStorageService';
import { supabase } from '../services/supabase';

// Feature limits for free tier
export const FREE_TIER_LIMITS = {
  maxDocuments: 15,
  // Free users can use all learning features, but only for up to 5 documents.
  maxQuizzesPerDay: -1,
  maxPresentationsPerDay: -1,
  maxFlashcardsPerDoc: -1,
  maxChatMessages: 30,
  canUseVideoGen: true,
  canUseAdvancedAnalytics: true,
  canUseCloudSync: true,
  canExportPdf: true,
  canUseAudioSummary: true,
  canCreateFolders: true,
  maxFolders: -1,
};

// Unlimited for pro tier
export const PRO_TIER_LIMITS = {
  maxDocuments: -1, // -1 means unlimited
  maxQuizzesPerDay: -1,
  maxPresentationsPerDay: -1,
  maxFlashcardsPerDoc: -1,
  maxChatMessages: -1,
  canUseVideoGen: true,
  canUseAdvancedAnalytics: true,
  canUseCloudSync: true,
  canExportPdf: true,
  canUseAudioSummary: true,
  canCreateFolders: true,
  maxFolders: -1,
};

export interface PremiumFeatures {
  maxDocuments: number;
  maxQuizzesPerDay: number;
  maxPresentationsPerDay: number;
  maxFlashcardsPerDoc: number;
  maxChatMessages: number;
  canUseVideoGen: boolean;
  canUseAdvancedAnalytics: boolean;
  canUseCloudSync: boolean;
  canExportPdf: boolean;
  canUseAudioSummary: boolean;
  canCreateFolders: boolean;
  maxFolders: number;
}

interface PremiumContextType {
  isPremium: boolean;
  isLoading: boolean;
  purchasesAvailable: boolean;
  subscription: SubscriptionInfo | null;
  products: ProductInfo[];
  features: PremiumFeatures;
  
  // Actions
  checkPremiumStatus: () => Promise<void>;
  purchaseProduct: (productId: string) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  
  // Feature checks
  canAccessFeature: (feature: keyof PremiumFeatures) => boolean;
  checkLimit: (feature: keyof PremiumFeatures, currentCount: number) => boolean;
  showPaywall: (feature: string) => void;
  
  // Daily usage tracking
  dailyDocumentCount: number;
  dailyQuizCount: number;
  dailyChatCount: number;
  dailyPresentationCount: number;
  incrementDocumentCount: () => void;
  incrementQuizCount: () => void;
  incrementChatCount: () => void;
  incrementPresentationCount: () => void;
  
  // Debug (development only)
  debugPremium: boolean;
  toggleDebugPremium: () => void;
}

const PremiumContext = createContext<PremiumContextType | undefined>(undefined);

export const PremiumProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [purchasesAvailable, setPurchasesAvailable] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [features, setFeatures] = useState<PremiumFeatures>(FREE_TIER_LIMITS);
  
  // Debug mode for testing premium features in development
  const [debugPremium, setDebugPremium] = useState(false);
  
  // Daily usage counters (reset at midnight)
  const [dailyDocumentCount, setDailyDocumentCount] = useState(0);
  const [dailyQuizCount, setDailyQuizCount] = useState(0);
  const [dailyChatCount, setDailyChatCount] = useState(0);
  const [dailyPresentationCount, setDailyPresentationCount] = useState(0);
  const [lastResetDate, setLastResetDate] = useState<string>('');

  const getTodayKey = () => new Date().toDateString();
  const getDailyUsageStorageKey = useCallback(() => {
    return `mindsparkle.dailyUsage.v2:${user?.id || 'anon'}`;
  }, [user?.id]);

  const persistDailyUsage = useCallback(async (next: {
    date: string;
    documents: number;
    quiz: number;
    chat: number;
    presentation: number;
  }) => {
    try {
      await AsyncStorage.setItem(getDailyUsageStorageKey(), JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [getDailyUsageStorageKey]);

  const resetDailyUsageIfNeeded = useCallback(() => {
    const today = getTodayKey();
    if (lastResetDate === today) return;

    setDailyDocumentCount(0);
    setDailyQuizCount(0);
    setDailyChatCount(0);
    setDailyPresentationCount(0);
    setLastResetDate(today);

    void persistDailyUsage({
      date: today,
      documents: 0,
      quiz: 0,
      chat: 0,
      presentation: 0,
    });
  }, [lastResetDate, persistDailyUsage]);

  // Initialize RevenueCat
  useEffect(() => {
    initializeRevenueCat();
  }, []);

  // Set user ID when user changes
  useEffect(() => {
    if (user?.id) {
      revenueCatService.setUserId(user.id);
    }
  }, [user?.id]);

  // Check subscription from database
  useEffect(() => {
    const checkDatabaseSubscription = async () => {
      if (!user?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('user_subscriptions')
          .select('is_active, tier, expires_at')
          .eq('user_id', user.id)
          .single();
        
        if (!error && data && data.is_active) {
          // Check if not expired
          const notExpired = !data.expires_at || new Date(data.expires_at) > new Date();
          if (notExpired && (data.tier === 'pro' || data.tier === 'enterprise')) {
            console.log('[Premium] ✅ Database subscription found - granting Pro access!');
            setIsPremium(true);
            setFeatures(PRO_TIER_LIMITS);
            setSubscription({
              isActive: true,
              willRenew: true,
              periodType: 'normal',
              expirationDate: data.expires_at,
              productIdentifier: 'database_subscription',
            });
            return;
          }
        }
        
        // No valid database subscription - check RevenueCat
        console.log('[Premium] No database subscription, checking RevenueCat...');
      } catch (err) {
        console.log('[Premium] Error checking database subscription:', err);
      }
    };
    
    checkDatabaseSubscription();
  }, [user?.id]);

  // Load persisted daily usage (and reset if it's a new day)
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(getDailyUsageStorageKey());
        const today = getTodayKey();

        if (raw) {
          const parsed = JSON.parse(raw);
          const storedDate = typeof parsed?.date === 'string' ? parsed.date : '';
          const documents = typeof parsed?.documents === 'number' ? parsed.documents : 0;
          const quiz = typeof parsed?.quiz === 'number' ? parsed.quiz : 0;
          const chat = typeof parsed?.chat === 'number' ? parsed.chat : 0;
          const presentation = typeof parsed?.presentation === 'number' ? parsed.presentation : 0;

          if (storedDate === today) {
            setDailyDocumentCount(documents);
            setDailyQuizCount(quiz);
            setDailyChatCount(chat);
            setDailyPresentationCount(presentation);
            setLastResetDate(today);
            return;
          }
        }

        // New day or missing data
        setDailyDocumentCount(0);
        setDailyQuizCount(0);
        setDailyChatCount(0);
        setDailyPresentationCount(0);
        setLastResetDate(today);
        await persistDailyUsage({ date: today, documents: 0, quiz: 0, chat: 0, presentation: 0 });
      } catch {
        const today = getTodayKey();
        setLastResetDate(today);
      }
    })();
  }, [getDailyUsageStorageKey, persistDailyUsage]);

  // Ensure counters reset when day changes (even if app stays open)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        resetDailyUsageIfNeeded();
      }
    });

    const interval = setInterval(() => {
      resetDailyUsageIfNeeded();
    }, 60 * 1000);

    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [resetDailyUsageIfNeeded]);

  const initializeRevenueCat = async () => {
    try {
      setIsLoading(true);
      await revenueCatService.initialize();
      const available = revenueCatService.getAvailable();
      setPurchasesAvailable(available);
      if (!available) {
        // Don't show alert - just silently fail and use free tier
        console.log('RevenueCat not available - using free tier');
        setProducts([]);
        setSubscription(null);
        setIsPremium(false);
        setFeatures(FREE_TIER_LIMITS);
        return;
      }
      await checkPremiumStatus();
      await loadProducts();
    } catch (error) {
      console.error('Error initializing RevenueCat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadProducts = async () => {
    if (!purchasesAvailable) {
      setProducts([]);
      return;
    }
    const availableProducts = await revenueCatService.getProducts();
    setProducts(availableProducts);

    // If we couldn't fetch any real products in production/TestFlight,
    // disable purchases so the UI doesn't attempt failing purchases.
    if (!__DEV__ && availableProducts.length === 0) {
      console.warn('[Premium] No RevenueCat products returned; marking purchases unavailable');
      setPurchasesAvailable(false);
    }
  };

  const checkPremiumStatus = useCallback(async () => {
    try {
      // First check database subscription
      if (user?.id) {
        const { data, error } = await supabase
          .from('user_subscriptions')
          .select('is_active, tier, expires_at')
          .eq('user_id', user.id)
          .single();
        
        if (!error && data && data.is_active) {
          const notExpired = !data.expires_at || new Date(data.expires_at) > new Date();
          if (notExpired && (data.tier === 'pro' || data.tier === 'enterprise')) {
            console.log('[Premium] ✅ Database Pro subscription active!');
            setSubscription({
              isActive: true,
              willRenew: true,
              periodType: 'normal',
              expirationDate: data.expires_at,
              productIdentifier: 'database_subscription',
            });
            setIsPremium(true);
            setFeatures(PRO_TIER_LIMITS);
            CloudStorage.updateStorageLimit(user.id, true).catch(console.error);
            return;
          }
        }
      }
      
      // Fall back to RevenueCat
      if (!purchasesAvailable) {
        console.log('[Premium] No database subscription and RevenueCat unavailable - free tier');
        setIsPremium(false);
        setFeatures(FREE_TIER_LIMITS);
        return;
      }
      
      const sub = await revenueCatService.checkSubscriptionStatus();
      setSubscription(sub);
      
      if (sub.isActive) {
        console.log('[Premium] RevenueCat subscription active!');
        setIsPremium(true);
        setFeatures(PRO_TIER_LIMITS);
        if (user?.id) {
          CloudStorage.updateStorageLimit(user.id, true).catch(console.error);
        }
      } else {
        console.log('[Premium] No active subscription - free tier');
        setIsPremium(false);
        setFeatures(FREE_TIER_LIMITS);
      }
    } catch (error) {
      console.error('Error checking premium status:', error);
      // On error, default to free tier
      setIsPremium(false);
      setFeatures(FREE_TIER_LIMITS);
    }
  }, [user?.id, purchasesAvailable]);

  const purchaseProduct = async (productId: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      if (!purchasesAvailable) {
        Alert.alert('Purchases unavailable', 'In-app purchases are not available on this device.');
        return false;
      }
      const result = await revenueCatService.purchaseProduct(productId);
      
      if (result.success) {
        await checkPremiumStatus();
        Alert.alert(
          '🎉 Welcome to Pro!',
          'Thank you for upgrading! You now have access to all premium features.',
          [{ text: 'Awesome!' }]
        );
        return true;
      } else if (result.error && result.error !== 'Purchase cancelled') {
        Alert.alert('Purchase Failed', result.error);
      }
      return false;
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Something went wrong');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      const result = await revenueCatService.restorePurchases();
      
      if (result.success) {
        await checkPremiumStatus();
        Alert.alert(
          'Purchases Restored!',
          'Your Pro subscription has been restored.',
          [{ text: 'Great!' }]
        );
        return true;
      } else {
        Alert.alert(
          'No Purchases Found',
          'We couldn\'t find any previous purchases to restore.',
          [{ text: 'OK' }]
        );
        return false;
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to restore purchases');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const canAccessFeature = (feature: keyof PremiumFeatures): boolean => {
    const value = features[feature];
    if (typeof value === 'boolean') return value;
    return value !== 0;
  };

  const checkLimit = (feature: keyof PremiumFeatures, currentCount: number): boolean => {
    const limit = features[feature];
    if (typeof limit !== 'number') return true;
    if (limit === -1) return true; // Unlimited
    return currentCount < limit;
  };

  const showPaywall = (feature: string) => {
    Alert.alert(
      '✨ Pro Feature',
      `${feature} is a Pro feature. Upgrade to unlock unlimited access to all features!`,
      [
        { text: 'Maybe Later', style: 'cancel' },
        { text: 'View Plans', onPress: () => {
          // Navigation to paywall would happen here
          // This will be handled by the component using this
        }},
      ]
    );
  };

  const incrementDocumentCount = () => {
    if (!isPremium && !debugPremium) {
      resetDailyUsageIfNeeded();
      setDailyDocumentCount(prev => {
        const next = prev + 1;
        persistDailyUsage({
          date: getTodayKey(),
          documents: next,
          quiz: dailyQuizCount,
          chat: dailyChatCount,
          presentation: dailyPresentationCount,
        });
        return next;
      });
    }
  };

  const incrementQuizCount = () => {
    if (!isPremium) {
      resetDailyUsageIfNeeded();
      setDailyQuizCount(prev => {
        const next = prev + 1;
        persistDailyUsage({
          date: getTodayKey(),
          documents: dailyDocumentCount,
          quiz: next,
          chat: dailyChatCount,
          presentation: dailyPresentationCount,
        });
        return next;
      });
    }
  };

  const incrementChatCount = () => {
    if (!isPremium && !debugPremium) {
      resetDailyUsageIfNeeded();
      setDailyChatCount(prev => {
        const next = prev + 1;
        persistDailyUsage({
          date: getTodayKey(),
          documents: dailyDocumentCount,
          quiz: dailyQuizCount,
          chat: next,
          presentation: dailyPresentationCount,
        });
        return next;
      });
    }
  };

  const incrementPresentationCount = () => {
    if (!isPremium && !debugPremium) {
      resetDailyUsageIfNeeded();
      setDailyPresentationCount(prev => {
        const next = prev + 1;
        persistDailyUsage({
          date: getTodayKey(),
          documents: dailyDocumentCount,
          quiz: dailyQuizCount,
          chat: dailyChatCount,
          presentation: next,
        });
        return next;
      });
    }
  };

  // Toggle debug premium for development testing
  const toggleDebugPremium = useCallback(() => {
    setDebugPremium(prev => {
      const newValue = !prev;
      setFeatures(newValue ? PRO_TIER_LIMITS : FREE_TIER_LIMITS);
      if (__DEV__) {
        console.log(`🔧 Debug Premium: ${newValue ? 'ENABLED' : 'DISABLED'}`);
      }
      return newValue;
    });
  }, []);

  // Computed isPremium includes debug mode
  const effectiveIsPremium = isPremium || debugPremium;
  const effectiveFeatures = (isPremium || debugPremium) ? PRO_TIER_LIMITS : features;

  return (
    <PremiumContext.Provider
      value={{
        isPremium: effectiveIsPremium,
        isLoading,
        purchasesAvailable,
        subscription,
        products,
        features: effectiveFeatures,
        checkPremiumStatus,
        purchaseProduct,
        restorePurchases,
        canAccessFeature: (feature: keyof PremiumFeatures) => {
          const value = effectiveFeatures[feature];
          if (typeof value === 'boolean') return value;
          return value !== 0;
        },
        checkLimit: (feature: keyof PremiumFeatures, currentCount: number) => {
          const limit = effectiveFeatures[feature];
          if (typeof limit !== 'number') return true;
          if (limit === -1) return true;
          return currentCount < limit;
        },
        showPaywall,
        dailyDocumentCount,
        dailyQuizCount,
        dailyChatCount,
        dailyPresentationCount,
        incrementDocumentCount,
        incrementQuizCount,
        incrementChatCount,
        incrementPresentationCount,
        debugPremium,
        toggleDebugPremium,
      }}
    >
      {children}
    </PremiumContext.Provider>
  );
};

export const usePremiumContext = () => {
  const context = useContext(PremiumContext);
  if (!context) {
    throw new Error('usePremiumContext must be used within a PremiumProvider');
  }
  return context;
};

export default PremiumContext;
