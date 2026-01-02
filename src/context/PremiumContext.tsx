import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import { Alert } from 'react-native';
import revenueCatService, { 
  ProductInfo, 
  SubscriptionInfo, 
  PRODUCT_IDS,
  ENTITLEMENT_ID 
} from '../services/revenueCat';
import { useAuth } from './AuthContext';
import * as CloudStorage from '../services/cloudStorageService';

// Feature limits for free tier
export const FREE_TIER_LIMITS = {
  maxDocuments: 5,
  maxQuizzesPerDay: 3,
  maxFlashcardsPerDoc: 20,
  maxChatMessages: 10,
  canUseVideoGen: true, // Video is FREE for everyone!
  canUseAdvancedAnalytics: false,
  canUseCloudSync: false,
  canExportPdf: false,
  canUseAudioSummary: false,
  canCreateFolders: false,
  maxFolders: 0,
};

// Unlimited for pro tier
export const PRO_TIER_LIMITS = {
  maxDocuments: -1, // -1 means unlimited
  maxQuizzesPerDay: -1,
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
  dailyQuizCount: number;
  dailyChatCount: number;
  incrementQuizCount: () => void;
  incrementChatCount: () => void;
  
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
  const [dailyQuizCount, setDailyQuizCount] = useState(0);
  const [dailyChatCount, setDailyChatCount] = useState(0);
  const [lastResetDate, setLastResetDate] = useState<string>('');

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

  // 👑 Check premium status when user email changes
  // This ensures owner gets Pro access immediately after sign in
  useEffect(() => {
    const OWNER_EMAILS = [
      'ahmedadel737374@icloud.com',
      'jzggwd5ynj@privaterelay.appleid.com', // Apple private relay email
    ];
    const userEmail = user?.email?.toLowerCase();
    const isOwner = OWNER_EMAILS.some(email => email.toLowerCase() === userEmail);
    
    if (isOwner) {
      console.log('[Premium] 👑 Owner email detected - auto-granting Pro!');
      setIsPremium(true);
      setFeatures(PRO_TIER_LIMITS);
      setSubscription({
        isActive: true,
        willRenew: true,
        periodType: 'normal',
        expirationDate: null,
        productIdentifier: 'owner_free_pro',
      });
    }
  }, [user?.email]);

  // Reset daily counters at midnight - only runs once on mount
  useEffect(() => {
    const today = new Date().toDateString();
    if (lastResetDate !== today) {
      setDailyQuizCount(0);
      setDailyChatCount(0);
      setLastResetDate(today);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount, not when lastResetDate changes

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
  };

  const checkPremiumStatus = useCallback(async () => {
    try {
      // 👑 OWNER GETS FREE PRO ACCESS!
      // Only the app owner (ahmedadel737374@icloud.com) gets automatic Pro
      const OWNER_EMAIL = 'ahmedadel737374@icloud.com';
      const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
      
      if (isOwner) {
        console.log('[Premium] 👑 Owner account detected - granting Pro access automatically!');
        setSubscription({
          isActive: true,
          willRenew: true,
          periodType: 'normal',
          expirationDate: null, // Never expires for owner
          productIdentifier: 'owner_free_pro',
        });
        setIsPremium(true);
        setFeatures(PRO_TIER_LIMITS);
        
        // Update cloud storage limit
        if (user?.id) {
          CloudStorage.updateStorageLimit(user.id, true).catch(console.error);
        }
        return;
      }
      
      // Regular RevenueCat check for other users
      const status = await revenueCatService.checkSubscriptionStatus();
      setSubscription(status);
      setIsPremium(status.isActive);
      setFeatures(status.isActive ? PRO_TIER_LIMITS : FREE_TIER_LIMITS);
      
      // Update cloud storage limit based on premium status
      if (user?.id) {
        CloudStorage.updateStorageLimit(user.id, status.isActive).catch(console.error);
      }
    } catch (error) {
      console.error('Error checking premium status:', error);
      
      // Even on error, owner still gets Pro
      const OWNER_EMAIL = 'ahmedadel737374@icloud.com';
      if (user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
        console.log('[Premium] 👑 Owner account (fallback) - granting Pro access!');
        setIsPremium(true);
        setFeatures(PRO_TIER_LIMITS);
        return;
      }
      
      setIsPremium(false);
      setFeatures(FREE_TIER_LIMITS);
    }
  }, [user?.id, user?.email]);

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

  const incrementQuizCount = () => {
    if (!isPremium) {
      setDailyQuizCount(prev => prev + 1);
    }
  };

  const incrementChatCount = () => {
    if (!isPremium && !debugPremium) {
      setDailyChatCount(prev => prev + 1);
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
        dailyQuizCount,
        dailyChatCount,
        incrementQuizCount,
        incrementChatCount,
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
