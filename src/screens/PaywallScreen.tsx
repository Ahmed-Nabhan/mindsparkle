import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Image,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { usePremiumContext, FREE_TIER_LIMITS } from '../context/PremiumContext';
import { PRODUCT_IDS } from '../services/revenueCat';
import type { RootStackScreenProps } from '../navigation/types';

const { width } = Dimensions.get('window');

type PaywallScreenProps = RootStackScreenProps<'Paywall'>;

const FEATURES = [
  { icon: '📚', title: 'Unlimited Documents', free: '5 docs', pro: 'Unlimited' },
  { icon: '🧠', title: 'Daily Quizzes', free: 'Unlimited', pro: 'Unlimited' },
  { icon: '📇', title: 'Flashcards', free: 'Unlimited', pro: 'Unlimited' },
  { icon: '💬', title: 'AI Chat', free: '30 msgs', pro: 'Unlimited' },
  { icon: '🎬', title: 'Video Summaries', free: '✅', pro: '✅' },
  { icon: '🎧', title: 'Audio Summaries', free: '✅', pro: '✅' },
  { icon: '📊', title: 'Advanced Analytics', free: '✅', pro: '✅' },
  { icon: '☁️', title: 'Cloud Sync', free: '✅', pro: '✅' },
  { icon: '📁', title: 'Folders', free: '✅', pro: '✅' },
  { icon: '📤', title: 'Export to PDF', free: '✅', pro: '✅' },
];

export const PaywallScreen: React.FC = () => {
  const route = useRoute<PaywallScreenProps['route']>();
  const navigation = useNavigation<PaywallScreenProps['navigation']>();
  const { products, purchaseProduct, restorePurchases, isLoading, isPremium, purchasesAvailable } = usePremiumContext();
  const [selectedProduct, setSelectedProduct] = useState(PRODUCT_IDS.YEARLY);
  const [purchasing, setPurchasing] = useState(false);

  const termsUrl =
    Platform.OS === 'ios'
      ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
      : 'https://ahmed-nabhan.github.io/mindsparkle/terms.html';

  const featureRequested = route.params?.source;

  const handlePurchase = async () => {
    if (!purchasesAvailable) {
      Alert.alert(
        'Purchases Not Available',
        'Subscriptions are temporarily unavailable. Please try again later or restore purchases if you already subscribed.',
        [{ text: 'OK' }]
      );
      return;
    }
    setPurchasing(true);
    const success = await purchaseProduct(selectedProduct);
    setPurchasing(false);
    if (success) {
      navigation.goBack();
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    await restorePurchases();
    setPurchasing(false);
  };

  const getProductDetails = (productId: string) => {
    return products.find(p => p.identifier === productId) || {
      identifier: productId,
      priceString: '—',
      title: productId === PRODUCT_IDS.MONTHLY ? 'Monthly' : 'Yearly',
    };
  };

  const selectedProductDetails = getProductDetails(selectedProduct);

  const getBillingPeriodLabel = (productId: string): 'month' | 'year' => {
    return productId === PRODUCT_IDS.MONTHLY ? 'month' : 'year';
  };

  const formatPriceWithPeriod = (priceString: string, period: 'month' | 'year') => {
    const normalized = String(priceString || '').toLowerCase();
    if (normalized.includes('per month') || normalized.includes('/month') || normalized.includes('monthly')) return priceString;
    if (normalized.includes('per year') || normalized.includes('/year') || normalized.includes('yearly')) return priceString;
    return `${priceString}/${period}`;
  };

  const formatDurationParts = (parts: Array<{ value: number; unit: 'year' | 'month' | 'week' | 'day' }>) => {
    const nonZero = parts.filter(p => Number.isFinite(p.value) && p.value > 0);
    if (nonZero.length === 0) return null;
    const toWord = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
    // Keep this short and reviewer-friendly (avoid long multi-unit strings).
    const first = nonZero[0];
    const second = nonZero[1];
    if (!first) return null;
    if (!second) return toWord(first.value, first.unit);
    return `${toWord(first.value, first.unit)} ${toWord(second.value, second.unit)}`;
  };

  // NOTE: App Store Guideline 3.1.2 compliance hardening:
  // Do not show any UI or copy referencing free trials or introductory offers.
  const billingPeriod = getBillingPeriodLabel(selectedProduct);
  const priceWithPeriod = formatPriceWithPeriod(selectedProductDetails.priceString, billingPeriod);

  const getPriceWithPeriodForProduct = (productId: string) => {
    const details = getProductDetails(productId);
    const period = getBillingPeriodLabel(productId);
    return formatPriceWithPeriod(details.priceString, period);
  };

  const billingDisclosure = `This is an auto-renewable subscription. Payment will be charged to your Apple ID account at confirmation of purchase. You will be charged ${priceWithPeriod} and the subscription automatically renews unless cancelled at least 24 hours before the end of the current period. Your account will be charged for renewal within 24 hours prior to the end of the current period. You can manage or cancel your subscription in Apple ID Account Settings at any time.`;

  const getSavingsLabel = () => {
    const monthly = getProductDetails(PRODUCT_IDS.MONTHLY) as any;
    const yearly = getProductDetails(PRODUCT_IDS.YEARLY) as any;

    const monthlyPrice = Number.parseFloat(monthly?.price);
    const yearlyPrice = Number.parseFloat(yearly?.price);
    const monthlyCurrency = monthly?.currencyCode;
    const yearlyCurrency = yearly?.currencyCode;

    if (!Number.isFinite(monthlyPrice) || !Number.isFinite(yearlyPrice)) return null;
    if (!monthlyCurrency || !yearlyCurrency || monthlyCurrency !== yearlyCurrency) return null;
    if (monthlyPrice <= 0 || yearlyPrice <= 0) return null;

    const savings = 1 - yearlyPrice / (monthlyPrice * 12);
    if (!Number.isFinite(savings)) return null;

    const pct = Math.round(savings * 100);
    if (pct <= 0 || pct >= 95) return null;
    return `Save ${pct}%`;
  };

  const savingsLabel = getSavingsLabel();

  if (isPremium) {
    return (
      <View style={styles.container}>
        <View style={styles.alreadyProContainer}>
          <Text style={styles.alreadyProEmoji}>🎉</Text>
          <Text style={styles.alreadyProTitle}>You're Already Pro!</Text>
          <Text style={styles.alreadyProText}>
            You have access to all premium features.
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
        
        <Text style={styles.sparkle}>✨</Text>
        <Text style={styles.title}>Upgrade to Pro</Text>
        <Text style={styles.subtitle}>
          {featureRequested 
            ? `Unlock ${featureRequested} and all premium features`
            : 'Unlock your full learning potential'
          }
        </Text>
      </View>

      {/* Features Comparison */}
      <View style={styles.featuresContainer}>
        <View style={styles.featuresHeader}>
          <Text style={styles.featuresHeaderText}>Feature</Text>
          <Text style={styles.featuresHeaderFree}>Free</Text>
          <Text style={styles.featuresHeaderPro}>Pro</Text>
        </View>
        
        {FEATURES.map((feature, index) => (
          <View key={index} style={styles.featureRow}>
            <View style={styles.featureInfo}>
              <Text style={styles.featureIcon}>{feature.icon}</Text>
              <Text style={styles.featureTitle}>{feature.title}</Text>
            </View>
            <Text style={styles.featureFree}>{feature.free}</Text>
            <Text style={styles.featurePro}>{feature.pro}</Text>
          </View>
        ))}
      </View>

      {/* Pricing Options */}
      <View style={styles.pricingContainer}>
        <Text style={styles.pricingTitle}>Choose Your Plan</Text>
        
        {/* Yearly - Best Value */}
        <TouchableOpacity
          style={[
            styles.planCard,
            selectedProduct === PRODUCT_IDS.YEARLY && styles.planCardSelected,
          ]}
          onPress={() => setSelectedProduct(PRODUCT_IDS.YEARLY)}
        >
          <View style={styles.bestValueBadge}>
            <Text style={styles.bestValueText}>BEST VALUE</Text>
          </View>
          <View style={styles.planInfo}>
            <Text style={styles.planName}>Yearly</Text>
            <Text style={styles.planPrice}>
              {getProductDetails(PRODUCT_IDS.YEARLY).priceString}
            </Text>
            <Text style={styles.planBilling}>{getPriceWithPeriodForProduct(PRODUCT_IDS.YEARLY)}</Text>
            {!!savingsLabel && <Text style={styles.planSaving}>{savingsLabel}</Text>}
          </View>
          <View style={styles.radioOuter}>
            {selectedProduct === PRODUCT_IDS.YEARLY && (
              <View style={styles.radioInner} />
            )}
          </View>
        </TouchableOpacity>

        {/* Monthly */}
        <TouchableOpacity
          style={[
            styles.planCard,
            selectedProduct === PRODUCT_IDS.MONTHLY && styles.planCardSelected,
          ]}
          onPress={() => setSelectedProduct(PRODUCT_IDS.MONTHLY)}
        >
          <View style={styles.planInfo}>
            <Text style={styles.planName}>Monthly</Text>
            <Text style={styles.planPrice}>
              {getProductDetails(PRODUCT_IDS.MONTHLY).priceString}
            </Text>
            <Text style={styles.planBilling}>{getPriceWithPeriodForProduct(PRODUCT_IDS.MONTHLY)}</Text>
            <Text style={styles.planDesc}>Cancel anytime in Apple ID settings</Text>
          </View>
          <View style={styles.radioOuter}>
            {selectedProduct === PRODUCT_IDS.MONTHLY && (
              <View style={styles.radioInner} />
            )}
          </View>
        </TouchableOpacity>

      </View>

      {/* Billing Disclosure (App Review Guideline 3.1.2) */}
      <Text style={styles.billingDisclosure}>
        {billingDisclosure}
      </Text>

      {/* Purchase Button */}
      <TouchableOpacity
        style={[styles.purchaseButton, purchasing && styles.purchaseButtonDisabled]}
        onPress={handlePurchase}
        disabled={purchasing || isLoading || !purchasesAvailable}
      >
        {purchasing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.purchaseButtonText}>
            {`Subscribe • ${priceWithPeriod}`}
          </Text>
        )}
      </TouchableOpacity>

      {/* Restore */}
      <TouchableOpacity
        style={styles.restoreButton}
        onPress={handleRestore}
        disabled={purchasing}
      >
        <Text style={styles.restoreButtonText}>Restore Purchases</Text>
      </TouchableOpacity>

      {/* Terms */}
      <Text style={styles.terms}>
        {`Payment will be charged to your Apple ID account at confirmation of purchase. You will be charged ${priceWithPeriod} and the subscription automatically renews unless cancelled at least 24 hours before the end of the current period.`}
      </Text>
      
      <View style={styles.legalLinks}>
        <TouchableOpacity onPress={() => Linking.openURL(termsUrl)}>
          <Text style={styles.legalLink}>Terms of Use (EULA)</Text>
        </TouchableOpacity>
        <Text style={styles.legalDivider}>•</Text>
        <TouchableOpacity onPress={() => Linking.openURL('https://ahmed-nabhan.github.io/mindsparkle/privacy.html')}>
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 30,
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  sparkle: {
    fontSize: 50,
    marginBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  featuresContainer: {
    margin: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  featuresHeader: {
    flexDirection: 'row',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  featuresHeaderText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textLight,
  },
  featuresHeaderFree: {
    width: 60,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textLight,
    textAlign: 'center',
  },
  featuresHeaderPro: {
    width: 60,
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
    textAlign: 'center',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  featureInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  featureTitle: {
    fontSize: 14,
    color: colors.text,
  },
  featureFree: {
    width: 60,
    fontSize: 13,
    color: colors.textLight,
    textAlign: 'center',
  },
  featurePro: {
    width: 60,
    fontSize: 13,
    color: colors.success,
    textAlign: 'center',
    fontWeight: '600',
  },
  pricingContainer: {
    paddingHorizontal: 20,
    marginTop: 10,
  },
  pricingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: colors.border,
    position: 'relative',
    overflow: 'hidden',
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(30, 58, 138, 0.05)',
  },
  bestValueBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
  },
  bestValueText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  planPrice: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  planBilling: {
    fontSize: 13,
    color: colors.textLight,
    marginTop: 2,
  },
  planSaving: {
    fontSize: 13,
    color: colors.success,
    marginTop: 2,
  },
  planDesc: {
    fontSize: 13,
    color: colors.textLight,
    marginTop: 2,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
  },
  purchaseButton: {
    backgroundColor: colors.primary,
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  purchaseButtonDisabled: {
    opacity: 0.7,
  },
  billingDisclosure: {
    fontSize: 12,
    color: colors.textLight,
    textAlign: 'center',
    paddingHorizontal: 28,
    marginTop: 12,
    lineHeight: 18,
  },
  purchaseButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  restoreButton: {
    alignItems: 'center',
    marginTop: 16,
    padding: 12,
  },
  restoreButtonText: {
    color: colors.primary,
    fontSize: 15,
  },
  terms: {
    fontSize: 12,
    color: colors.textLight,
    textAlign: 'center',
    paddingHorizontal: 40,
    marginTop: 16,
    lineHeight: 18,
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  legalLink: {
    fontSize: 12,
    color: colors.primary,
  },
  legalDivider: {
    marginHorizontal: 8,
    color: colors.textLight,
  },
  alreadyProContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  alreadyProEmoji: {
    fontSize: 60,
    marginBottom: 20,
  },
  alreadyProTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 10,
  },
  alreadyProText: {
    fontSize: 16,
    color: colors.textLight,
    textAlign: 'center',
    marginBottom: 30,
  },
  backButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PaywallScreen;
