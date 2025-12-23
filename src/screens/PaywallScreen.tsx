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
  { icon: '🧠', title: 'Daily Quizzes', free: '3/day', pro: 'Unlimited' },
  { icon: '📇', title: 'Flashcards', free: '20/doc', pro: 'Unlimited' },
  { icon: '💬', title: 'AI Chat', free: '10 msgs', pro: 'Unlimited' },
  { icon: '🎬', title: 'Video Summaries', free: '❌', pro: '✅' },
  { icon: '🎧', title: 'Audio Summaries', free: '❌', pro: '✅' },
  { icon: '📊', title: 'Advanced Analytics', free: '❌', pro: '✅' },
  { icon: '☁️', title: 'Cloud Sync', free: '❌', pro: '✅' },
  { icon: '📁', title: 'Folders', free: '❌', pro: '✅' },
  { icon: '📤', title: 'Export to PDF', free: '❌', pro: '✅' },
];

export const PaywallScreen: React.FC = () => {
  const route = useRoute<PaywallScreenProps['route']>();
  const navigation = useNavigation<PaywallScreenProps['navigation']>();
  const { products, purchaseProduct, restorePurchases, isLoading, isPremium } = usePremiumContext();
  const [selectedProduct, setSelectedProduct] = useState(PRODUCT_IDS.YEARLY);
  const [purchasing, setPurchasing] = useState(false);

  const featureRequested = route.params?.source;

  const handlePurchase = async () => {
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
      priceString: productId === PRODUCT_IDS.MONTHLY ? '$4.99/mo' : 
                   productId === PRODUCT_IDS.YEARLY ? '$29.99/yr' : '$79.99',
      title: productId === PRODUCT_IDS.MONTHLY ? 'Monthly' : 
             productId === PRODUCT_IDS.YEARLY ? 'Yearly' : 'Lifetime',
    };
  };

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
            <Text style={styles.planSaving}>Save 50%</Text>
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
            <Text style={styles.planDesc}>Cancel anytime</Text>
          </View>
          <View style={styles.radioOuter}>
            {selectedProduct === PRODUCT_IDS.MONTHLY && (
              <View style={styles.radioInner} />
            )}
          </View>
        </TouchableOpacity>

        {/* Lifetime */}
        <TouchableOpacity
          style={[
            styles.planCard,
            selectedProduct === PRODUCT_IDS.LIFETIME && styles.planCardSelected,
          ]}
          onPress={() => setSelectedProduct(PRODUCT_IDS.LIFETIME)}
        >
          <View style={styles.planInfo}>
            <Text style={styles.planName}>Lifetime</Text>
            <Text style={styles.planPrice}>
              {getProductDetails(PRODUCT_IDS.LIFETIME).priceString}
            </Text>
            <Text style={styles.planDesc}>One-time purchase</Text>
          </View>
          <View style={styles.radioOuter}>
            {selectedProduct === PRODUCT_IDS.LIFETIME && (
              <View style={styles.radioInner} />
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Free Trial Badge */}
      {selectedProduct !== PRODUCT_IDS.LIFETIME && (
        <View style={styles.trialBadge}>
          <Text style={styles.trialText}>🎁 7-day free trial included</Text>
        </View>
      )}

      {/* Purchase Button */}
      <TouchableOpacity
        style={[styles.purchaseButton, purchasing && styles.purchaseButtonDisabled]}
        onPress={handlePurchase}
        disabled={purchasing}
      >
        {purchasing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.purchaseButtonText}>
            {selectedProduct === PRODUCT_IDS.LIFETIME 
              ? 'Get Lifetime Access'
              : 'Start Free Trial'
            }
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
        {selectedProduct !== PRODUCT_IDS.LIFETIME 
          ? 'After the free trial, subscription will automatically renew. Cancel anytime in Settings.'
          : 'One-time purchase. Access all Pro features forever.'
        }
      </Text>
      
      <View style={styles.legalLinks}>
        <TouchableOpacity>
          <Text style={styles.legalLink}>Terms of Use</Text>
        </TouchableOpacity>
        <Text style={styles.legalDivider}>•</Text>
        <TouchableOpacity>
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
  trialBadge: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  trialText: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
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
