// RevenueCat Service for In-App Purchases
// MindSparkle Premium Subscription Management

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// RevenueCat API Keys (do NOT hardcode secrets)
const extras = Constants.expoConfig?.extra || {};
const REVENUECAT_API_KEY_IOS = (extras as any).revenueCatIosKey || process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '';
const REVENUECAT_API_KEY_ANDROID = (extras as any).revenueCatAndroidKey || process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';

// Product identifiers - Must match what you set up in App Store Connect / Google Play Console
const IOS_PRODUCT_IDS = {
  MONTHLY: 'com.ahmednabhan.mindsparkle.premium.monthly',
  YEARLY: 'com.ahmednabhan.mindsparkle.premium.yearly',
} as const;

// Google Play enforces a 40-character limit on subscription product IDs.
// Use shorter identifiers on Android while keeping the existing iOS IDs.
const ANDROID_PRODUCT_IDS = {
  MONTHLY: 'mindsparkle_premium_monthly',
  YEARLY: 'mindsparkle_premium_yearly',
} as const;

export const PRODUCT_IDS = (Platform.OS === 'android' ? ANDROID_PRODUCT_IDS : IOS_PRODUCT_IDS) as typeof IOS_PRODUCT_IDS;

export const PRODUCT_IDS_BY_PLATFORM = {
  ios: IOS_PRODUCT_IDS,
  android: ANDROID_PRODUCT_IDS,
} as const;

// Entitlement identifier - The access level in RevenueCat
export const ENTITLEMENT_ID = 'MindSparkle Pro';

// Types
export interface ProductInfo {
  identifier: string;
  title: string;
  description: string;
  price: string;
  priceString: string;
  currencyCode: string;
  introPrice?: {
    price: string;
    priceString: string;
    period: string;
    cycles: number;
  };
}

export interface SubscriptionInfo {
  isActive: boolean;
  willRenew: boolean;
  periodType: 'normal' | 'trial' | 'intro';
  expirationDate: Date | null;
  productIdentifier: string;
}

export interface PurchaseResult {
  success: boolean;
  productIdentifier?: string;
  error?: string;
}

// RevenueCat Service Class
class RevenueCatService {
  private isInitialized = false;
  private purchases: any = null;
  private isAvailable = false;

  // Simulated purchase state (for Expo Go / environments without native IAP)
  private simulatedEntitlementActive = false;
  private simulatedProductId: string | null = null;

  private isSimulatedPurchasesEnabled(): boolean {
    const currentExtras = Constants.expoConfig?.extra || {};
    const extraValue = (currentExtras as any).simulatePurchases;

    // If explicitly set in app config, respect it.
    if (typeof extraValue === 'boolean') return extraValue;
    if (typeof extraValue === 'string') return extraValue === '1' || extraValue.toLowerCase() === 'true';

    // Env flags (support both public and non-public names).
    const env = process.env.EXPO_SIMULATE_PURCHASES || process.env.EXPO_PUBLIC_SIMULATE_PURCHASES;
    if (env === '1') return true;
    if (env === '0') return false;

    // Default: simulate in dev builds so missing offerings don't crash the app.
    return __DEV__;
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[unserializable]';
    }
  }

  private getSimulatedExpirationDate(productId: string): Date {
    const now = new Date();
    const days = productId === PRODUCT_IDS.YEARLY ? 365 : 30;
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private enableSimulatedEntitlement(productId: string): void {
    this.simulatedEntitlementActive = true;
    this.simulatedProductId = productId;
  }

  // Initialize RevenueCat SDK
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Dynamic import for RevenueCat
      const Purchases = require('react-native-purchases').default;
      this.purchases = Purchases;

      const apiKey = Platform.OS === 'ios' 
        ? REVENUECAT_API_KEY_IOS 
        : REVENUECAT_API_KEY_ANDROID;

      if (!apiKey || apiKey === 'CHANGE_ME_IOS_KEY' || apiKey === 'CHANGE_ME_ANDROID_KEY') {
        console.warn('RevenueCat API key not configured. Please add your RevenueCat API key to app.json extra.revenueCatIosKey');
        this.isAvailable = false;
        return;
      }

      await Purchases.configure({ apiKey });
      // Enable verbose logging when available to aid debugging (native SDK)
      if (typeof Purchases.setDebugLogsEnabled === 'function') {
        try {
          // Avoid verbose purchase logging in production builds.
          if (__DEV__) {
            Purchases.setDebugLogsEnabled(true);
            console.log('RevenueCat debug logs enabled');
          }
        } catch (e) {
          // ignore
        }
      }
      // Helpful hint for developers: Expo Go does not include native IAP modules.
      // Use a development build or TestFlight (sandbox) to test real purchases.
      if (Constants.appOwnership === 'expo') {
        console.warn('Running inside Expo Go - RevenueCat may run in Preview mode. Use a development build or TestFlight to test real IAP behavior.');
      }
      this.isInitialized = true;
      this.isAvailable = true;
      console.log('RevenueCat initialized successfully');
    } catch (error) {
      // If running in Expo Go (or otherwise missing native modules), allow simulation mode
      // so the paywall and premium unlock can be tested end-to-end.
      if (this.isSimulatedPurchasesEnabled()) {
        console.warn('RevenueCat native module unavailable; using simulated purchases mode:', error);
        this.purchases = null;
        this.isInitialized = true;
        this.isAvailable = true;
        return;
      }

      console.log('RevenueCat not available (may be in development):', error);
      this.isAvailable = false;
      // Continue without RevenueCat for development
    }
  }

  // Expose availability so UI can show clear state
  getAvailable(): boolean {
    return this.isAvailable;
  }

  // Set user ID for RevenueCat (call after user signs in)
  async setUserId(userId: string): Promise<void> {
    if (!this.purchases || !this.isAvailable) return;
    
    try {
      await this.purchases.logIn(userId);
      console.log('RevenueCat user ID set:', userId);
    } catch (error) {
      console.error('Error setting RevenueCat user ID:', error);
    }
  }

  // Get available products/packages
  async getProducts(): Promise<ProductInfo[]> {
    if (!this.purchases || !this.isAvailable) {
      // In Expo Go / simulation, return mock products so UX can be tested.
      // In production/TestFlight, returning mock products is misleading and leads to purchase failures.
      return this.isSimulatedPurchasesEnabled() || __DEV__ ? this.getMockProducts() : [];
    }

    try {
      const offerings = await this.purchases.getOfferings();
      console.log('RevenueCat.getOfferings response:', this.safeStringify(offerings));

      if (!offerings.current?.availablePackages) {
        console.warn('No available packages in offerings');
        return this.isSimulatedPurchasesEnabled() || __DEV__ ? this.getMockProducts() : [];
      }

      // RevenueCat Preview API mode (Expo Go) often returns "preview-*" product IDs.
      // If we’re in simulation mode and the expected product IDs aren’t present,
      // fall back to mock products so the paywall can exercise the real IDs.
      if (this.isSimulatedPurchasesEnabled()) {
        const availableIds = (offerings.current.availablePackages || []).map((pkg: any) => pkg?.product?.identifier).filter(Boolean);
        const expected = Object.values(PRODUCT_IDS);
        const hasAnyExpected = expected.some((id) => availableIds.includes(id));
        if (!hasAnyExpected) {
          console.warn('Offerings do not include expected product IDs; using mock products for simulated purchases.', {
            availableIds,
            expected,
          });
          return this.getMockProducts();
        }
      }

      return offerings.current.availablePackages.map((pkg: any) => ({
        identifier: pkg.product.identifier,
        title: pkg.product.title,
        description: pkg.product.description,
        price: pkg.product.price,
        priceString: pkg.product.priceString,
        currencyCode: pkg.product.currencyCode,
        introPrice: pkg.product.introPrice ? {
          price: pkg.product.introPrice.price,
          priceString: pkg.product.introPrice.priceString,
          period: pkg.product.introPrice.period,
          cycles: pkg.product.introPrice.cycles,
        } : undefined,
      }));
    } catch (error) {
      const msg = (error as any)?.message || String(error);
      // In development builds, console.error can surface as a full-screen redbox.
      // This failure is commonly caused by missing/unsynced IAP configuration.
      console.warn('[RevenueCat] Failed to fetch products (offerings).', msg);
      return this.isSimulatedPurchasesEnabled() || __DEV__ ? this.getMockProducts() : [];
    }
  }

  // Get mock products for development
  private getMockProducts(): ProductInfo[] {
    return [
      {
        identifier: PRODUCT_IDS.MONTHLY,
        title: 'MindSparkle Pro Monthly',
        description: 'Unlock all features with monthly subscription',
        price: '6.99',
        priceString: '$6.99/month',
        currencyCode: 'USD',
        introPrice: {
          price: '0',
          priceString: 'Free',
          period: '7 days',
          cycles: 1,
        },
      },
      {
        identifier: PRODUCT_IDS.YEARLY,
        title: 'MindSparkle Pro Yearly',
        description: 'Best value! Save 50% with yearly subscription',
        price: '39.99',
        priceString: '$39.99/year',
        currencyCode: 'USD',
        introPrice: {
          price: '0',
          priceString: 'Free',
          period: '7 days',
          cycles: 1,
        },
      },
    ];
  }

  // Purchase a product
  async purchaseProduct(productId: string): Promise<PurchaseResult> {
    if (!this.purchases || !this.isAvailable) {
      // If running in Expo Go or without native RevenueCat, allow a simulated purchase
      if (this.isSimulatedPurchasesEnabled()) {
        console.warn('Simulating purchase (no native RevenueCat available) for', productId);
        // Simulate network latency
        await new Promise((r) => setTimeout(r, 600));
        this.enableSimulatedEntitlement(productId);
        return { success: true, productIdentifier: productId };
      }

      console.log('Purchases unavailable; cannot process purchase');
      return { success: false, error: 'Purchases unavailable' };
    }

    try {
      const offerings = await this.purchases.getOfferings();
      console.log('RevenueCat.getOfferings (purchase flow):', this.safeStringify(offerings));

      const availablePackages = offerings.current?.availablePackages || [];
      if (availablePackages.length === 0) {
        // In dev builds, products may not be synced/available yet. Allow simulation so the
        // paywall UX can be tested without waiting on App Store Connect / RevenueCat.
        if (this.isSimulatedPurchasesEnabled()) {
          console.warn('[RevenueCat] No available packages; simulating purchase for', productId);
          await new Promise((r) => setTimeout(r, 600));
          this.enableSimulatedEntitlement(productId);
          return { success: true, productIdentifier: productId };
        }

        // In production, this usually indicates products are not attached to an Offering in RevenueCat
        // or App Store Connect products are not yet synced/available.
        const details = __DEV__
          ?
              'RevenueCat returned no available packages for the current Offering.\n\n' +
              'Checklist:\n' +
              `• RevenueCat: create an Offering and attach Packages for ${PRODUCT_IDS.MONTHLY} and ${PRODUCT_IDS.YEARLY}\n` +
              '• App Store Connect: set subscriptions to “Ready to Submit” (and complete agreements/tax/banking)\n' +
              '• Wait 15–60 minutes for product sync\n' +
              '• Test purchases via TestFlight + Sandbox tester\n'
          : 'Subscriptions are temporarily unavailable. Please try again later.';

        return { success: false, error: details };
      }

      const packageToPurchase = availablePackages.find(
        (pkg: any) => pkg.product.identifier === productId
      );

      if (!packageToPurchase) {
        if (this.isSimulatedPurchasesEnabled()) {
          console.warn('ProductId not found in offerings; simulating purchase for', productId);
          await new Promise((r) => setTimeout(r, 600));
          this.enableSimulatedEntitlement(productId);
          return { success: true, productIdentifier: productId };
        }

        const availableIds = availablePackages
          .map((pkg: any) => pkg?.product?.identifier)
          .filter(Boolean);
        console.error('Requested productId not found in availablePackages:', productId);
        console.warn('[RevenueCat] Available product identifiers:', availableIds);

        const details = __DEV__
          ?
              'Requested subscription product is not available in the current RevenueCat Offering for this build.\n\n' +
              `Requested: ${productId}\n` +
              `Available: ${availableIds.length ? availableIds.join(', ') : '(none)'}\n\n` +
              'This is common in RevenueCat Preview API mode or when products are not yet synced/attached.\n\n' +
              'Fix checklist:\n' +
              `• App Store Connect: create subscriptions ${PRODUCT_IDS.MONTHLY} and ${PRODUCT_IDS.YEARLY}\n` +
              '• RevenueCat: attach them to an Offering + Packages\n' +
              '• Wait for product sync, then test via TestFlight + Sandbox tester\n'
          : 'Subscriptions are temporarily unavailable. Please try again later.';

        return { success: false, error: details, productIdentifier: productId };
      }

      console.log('Purchasing package:', packageToPurchase.product.identifier);
      const purchaseResponse = await this.purchases.purchasePackage(packageToPurchase);
      console.log('purchasePackage response:', this.safeStringify(purchaseResponse));

      const customerInfo = purchaseResponse.customerInfo || purchaseResponse;
      const activeEntitlements = customerInfo?.entitlements?.active || {};
      const isPro = activeEntitlements?.[ENTITLEMENT_ID]?.isActive;

      if (!isPro) {
        // Purchase may have succeeded but entitlement identifier may not match.
        const activeKeys = Object.keys(activeEntitlements);
        const msg = __DEV__
          ?
              `Purchase completed but entitlement "${ENTITLEMENT_ID}" is not active.\n\n` +
              `Active entitlements: ${activeKeys.length ? activeKeys.join(', ') : '(none)'}\n\n` +
              'Fix: Ensure your RevenueCat Entitlement Identifier matches ENTITLEMENT_ID in src/services/revenueCat.ts.'
          : 'Purchase completed, but the subscription could not be activated. Please try restoring purchases or contact support.';
        return { success: false, productIdentifier: productId, error: msg };
      }

      return {
        success: !!isPro,
        productIdentifier: productId,
      };
    } catch (error: any) {
      if (error.userCancelled) {
        return { success: false, error: 'Purchase cancelled' };
      }
      const msg = String(error?.message || 'Purchase failed');
      // Avoid full-screen redbox for expected sandbox/configuration issues in dev.
      console.warn('[RevenueCat] Purchase error:', msg);
      // Common RevenueCat/TestFlight misconfiguration
      if (
        msg.includes('None of the products registered in the RevenueCat dashboard could be fetched') ||
        msg.includes('why-are-offerings-empty')
      ) {
        return {
          success: false,
          error:
            'In-app purchases are not available yet for this build.\n\n' +
            'Fix checklist:\n' +
            `• App Store Connect: create the subscriptions with IDs ${PRODUCT_IDS.MONTHLY} and ${PRODUCT_IDS.YEARLY} under this app\n` +
            '• Set them to “Ready to Submit” (and complete Paid Apps agreements/tax/banking)\n' +
            '• RevenueCat: attach those products to an Offering + Packages\n' +
            '• Wait 15–60 minutes for App Store Connect sync\n' +
            '• TestFlight: install fresh and sign in with a Sandbox tester when prompted'
        };
      }

      return { success: false, error: msg };
    }
  }

  // Check subscription status
  async checkSubscriptionStatus(): Promise<SubscriptionInfo> {
    if (this.isSimulatedPurchasesEnabled() && this.simulatedEntitlementActive) {
      const productId = this.simulatedProductId || PRODUCT_IDS.MONTHLY;
      return {
        isActive: true,
        willRenew: true,
        periodType: 'normal',
        expirationDate: this.getSimulatedExpirationDate(productId),
        productIdentifier: productId,
      };
    }

    if (!this.purchases || !this.isAvailable) {
      if (this.isSimulatedPurchasesEnabled() && this.simulatedEntitlementActive) {
        const productId = this.simulatedProductId || PRODUCT_IDS.MONTHLY;
        return {
          isActive: true,
          willRenew: true,
          periodType: 'normal',
          expirationDate: this.getSimulatedExpirationDate(productId),
          productIdentifier: productId,
        };
      }

      // Return mock status for development
      return {
        isActive: false,
        willRenew: false,
        periodType: 'normal',
        expirationDate: null,
        productIdentifier: '',
      };
    }

    try {
      const customerInfo = await this.purchases.getCustomerInfo();
      const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];

      if (!entitlement) {
        return {
          isActive: false,
          willRenew: false,
          periodType: 'normal',
          expirationDate: null,
          productIdentifier: '',
        };
      }

      return {
        isActive: entitlement.isActive,
        willRenew: entitlement.willRenew,
        periodType: entitlement.periodType,
        expirationDate: entitlement.expirationDate 
          ? new Date(entitlement.expirationDate) 
          : null,
        productIdentifier: entitlement.productIdentifier,
      };
    } catch (error) {
      console.error('Error checking subscription:', error);
      return {
        isActive: false,
        willRenew: false,
        periodType: 'normal',
        expirationDate: null,
        productIdentifier: '',
      };
    }
  }

  // Restore purchases
  async restorePurchases(): Promise<PurchaseResult> {
    if (this.isSimulatedPurchasesEnabled() && this.simulatedEntitlementActive) {
      return {
        success: true,
        productIdentifier: this.simulatedProductId || undefined,
      };
    }

    if (!this.purchases || !this.isAvailable) {
      if (this.isSimulatedPurchasesEnabled() && this.simulatedEntitlementActive) {
        return {
          success: true,
          productIdentifier: this.simulatedProductId || undefined,
        };
      }
      return { success: false, error: 'RevenueCat not available' };
    }

    try {
      const customerInfo = await this.purchases.restorePurchases();
      const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID]?.isActive;
      
      return {
        success: isPro,
        productIdentifier: customerInfo.entitlements.active[ENTITLEMENT_ID]?.productIdentifier,
      };
    } catch (error: any) {
      console.error('Restore error:', error);
      return { success: false, error: error.message || 'Restore failed' };
    }
  }

  // Log out user (call when user signs out)
  async logout(): Promise<void> {
    if (!this.purchases) return;
    
    try {
      await this.purchases.logOut();
    } catch (error) {
      console.error('Error logging out of RevenueCat:', error);
    }
  }
}

// Export singleton instance
export const revenueCatService = new RevenueCatService();

// Export helper functions
export const initRevenueCat = () => revenueCatService.initialize();
export const purchaseProduct = (productId: string) => revenueCatService.purchaseProduct(productId);
export const restorePurchases = () => revenueCatService.restorePurchases();
export const checkSubscriptionStatus = () => revenueCatService.checkSubscriptionStatus();
export const getProducts = () => revenueCatService.getProducts();

export default revenueCatService;

// Runtime configuration validator - call this in app startup or debug screen
export const validateRevenueCatConfiguration = async (): Promise<{ ok: boolean; details: string[] }> => {
  const details: string[] = [];
  const extras = Constants.expoConfig?.extra || {};
  const simulate = (extras as any).simulatePurchases || process.env.EXPO_SIMULATE_PURCHASES === '1';

  if (simulate) {
    details.push('Simulated purchases enabled (EXPO_SIMULATE_PURCHASES). Skipping native RevenueCat checks.');
    return { ok: true, details };
  }

  if (!REVENUECAT_API_KEY_IOS && !REVENUECAT_API_KEY_ANDROID) {
    details.push('RevenueCat API keys are missing. Add keys to expo.extra or env variables.');
    return { ok: false, details };
  }

  try {
    await revenueCatService.initialize();
    if (!revenueCatService.getAvailable()) {
      details.push('RevenueCat SDK initialized but reported unavailable (running in Expo Go or missing native modules).');
      return { ok: false, details };
    }

    const offerings = await revenueCatService.getProducts().catch(e => {
      details.push('Failed to fetch RevenueCat offerings: ' + (e?.message || e));
      return null;
    });

    if (!offerings || offerings.length === 0) {
      details.push('No products returned from RevenueCat. Verify App Store Connect product setup and RevenueCat dashboard synchronization.');
      details.push('Check that product IDs in `src/services/revenueCat.ts` match App Store Connect exactly.');
      return { ok: false, details };
    }

    // Verify expected product ids exist
    const expected = Object.values(PRODUCT_IDS);
    const foundIds = offerings.map(p => p.identifier);
    const missing = expected.filter(e => !foundIds.includes(e));
    if (missing.length > 0) {
      details.push('Missing product IDs in RevenueCat offerings: ' + missing.join(', '));
      details.push('Ensure these products are configured in App Store Connect and synced to RevenueCat.');
      return { ok: false, details };
    }

    details.push('RevenueCat configuration looks good: API key present and products found.');
    return { ok: true, details };
  } catch (err: any) {
    details.push('Error validating RevenueCat configuration: ' + (err?.message || err));
    return { ok: false, details };
  }
};
