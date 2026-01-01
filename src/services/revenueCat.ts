// RevenueCat Service for In-App Purchases
// MindSparkle Premium Subscription Management

import { Platform } from 'react-native';

// RevenueCat API Keys
const REVENUECAT_API_KEY_IOS = 'appl_wcbcmHnxMHWXswtgYXDNZkVrjur';
const REVENUECAT_API_KEY_ANDROID = 'goog_YOUR_ANDROID_API_KEY';

// Product identifiers - Must match what you set up in App Store Connect / Google Play Console
export const PRODUCT_IDS = {
  MONTHLY: 'com.ahmednabhan.mindsparkle.premium.monthly',
  YEARLY: 'com.ahmednabhan.mindsparkle.premium.yearly',
};

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

      await Purchases.configure({ apiKey });
      this.isInitialized = true;
      console.log('RevenueCat initialized successfully');
    } catch (error) {
      console.log('RevenueCat not available (may be in development):', error);
      // Continue without RevenueCat for development
    }
  }

  // Set user ID for RevenueCat (call after user signs in)
  async setUserId(userId: string): Promise<void> {
    if (!this.purchases) return;
    
    try {
      await this.purchases.logIn(userId);
      console.log('RevenueCat user ID set:', userId);
    } catch (error) {
      console.error('Error setting RevenueCat user ID:', error);
    }
  }

  // Get available products/packages
  async getProducts(): Promise<ProductInfo[]> {
    if (!this.purchases) {
      // Return mock products for development
      return this.getMockProducts();
    }

    try {
      const offerings = await this.purchases.getOfferings();
      
      if (!offerings.current?.availablePackages) {
        return this.getMockProducts();
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
      console.error('Error fetching products:', error);
      return this.getMockProducts();
    }
  }

  // Get mock products for development
  private getMockProducts(): ProductInfo[] {
    return [
      {
        identifier: PRODUCT_IDS.MONTHLY,
        title: 'MindSparkle Pro Monthly',
        description: 'Unlock all features with monthly subscription',
        price: '4.99',
        priceString: '$4.99/month',
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
        price: '29.99',
        priceString: '$29.99/year',
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
    if (!this.purchases) {
      // Mock purchase for development
      console.log('Mock purchase:', productId);
      return { success: true, productIdentifier: productId };
    }

    try {
      const offerings = await this.purchases.getOfferings();
      const packageToPurchase = offerings.current?.availablePackages?.find(
        (pkg: any) => pkg.product.identifier === productId
      );

      if (!packageToPurchase) {
        throw new Error('Product not found');
      }

      const { customerInfo } = await this.purchases.purchasePackage(packageToPurchase);
      
      const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID]?.isActive;
      
      return {
        success: isPro,
        productIdentifier: productId,
      };
    } catch (error: any) {
      if (error.userCancelled) {
        return { success: false, error: 'Purchase cancelled' };
      }
      console.error('Purchase error:', error);
      return { success: false, error: error.message || 'Purchase failed' };
    }
  }

  // Check subscription status
  async checkSubscriptionStatus(): Promise<SubscriptionInfo> {
    if (!this.purchases) {
      // Return mock status for development - change to test different states
      return {
        isActive: false, // Set to true to test pro features in dev
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
    if (!this.purchases) {
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
