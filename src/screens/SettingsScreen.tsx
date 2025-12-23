import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { usePremiumContext } from '../context/PremiumContext';
import { useAuth } from '../context/AuthContext';
import { restorePurchases } from '../services/revenueCat';
import { notificationService } from '../services/notificationService';
import type { MainDrawerScreenProps } from '../navigation/types';

type SettingsScreenProps = MainDrawerScreenProps<'Settings'>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsScreenProps['navigation']>();
  const { isPremium, features, checkPremiumStatus, debugPremium, toggleDebugPremium } = usePremiumContext();
  const { user, signOut } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [studyReminders, setStudyReminders] = useState(true);
  const [streakReminders, setStreakReminders] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = notificationService.getSettings();
      setStudyReminders(settings.studyReminders);
      setStreakReminders(settings.streakReminders);
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleRestorePurchases = async () => {
    setIsLoading(true);
    try {
      const result = await restorePurchases();
      if (result.success) {
        await checkPremiumStatus();
        Alert.alert('Success', 'Your purchases have been restored!');
      } else {
        Alert.alert('No Purchases Found', 'No previous purchases were found for your account.');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to restore purchases');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              await signOut();
              Alert.alert('Account Deleted', 'Your account has been deleted.');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete account');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleUpgrade = () => {
    navigation.navigate('Paywall', { source: 'settings' });
  };

  if (isLoading) {
    return <LoadingSpinner message="Please wait..." />;
  }

  return (
    <View style={styles.container}>
      <Header title="Settings" />
      
      <ScrollView style={styles.content}>
        {/* Account Section */}
        <Text style={styles.sectionTitle}>Account</Text>
        <Card style={styles.card}>
          {user ? (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>{user.email}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Status</Text>
                <View style={[styles.statusBadge, isPremium ? styles.proBadge : styles.freeBadge]}>
                  <Text style={styles.statusText}>{isPremium ? 'PRO' : 'FREE'}</Text>
                </View>
              </View>
            </>
          ) : (
            <TouchableOpacity 
              style={styles.signInButton}
              onPress={() => navigation.navigate('Auth', { mode: 'signin' })}
            >
              <Text style={styles.signInText}>Sign In to Sync Data</Text>
            </TouchableOpacity>
          )}
        </Card>

        {/* Subscription Section */}
        <Text style={styles.sectionTitle}>Subscription</Text>
        <Card style={styles.card}>
          {isPremium ? (
            <>
              <View style={styles.row}>
                <Text style={styles.premiumIcon}>⭐</Text>
                <Text style={styles.premiumText}>You're a Pro member!</Text>
              </View>
              <Text style={styles.premiumFeatures}>
                Enjoy unlimited access to all features
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.upgradeTitle}>Upgrade to Pro</Text>
              <Text style={styles.upgradeDescription}>
                Unlock unlimited documents, flashcards, AI chat, audio, and more!
              </Text>
              <Button title="View Plans" onPress={handleUpgrade} />
            </>
          )}
          
          <TouchableOpacity 
            style={styles.restoreButton}
            onPress={handleRestorePurchases}
          >
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </TouchableOpacity>
        </Card>

        {/* Notifications Section */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <Card style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.label}>Study Reminders</Text>
            <Switch
              value={studyReminders}
              onValueChange={setStudyReminders}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          
          <View style={styles.switchRow}>
            <Text style={styles.label}>Streak Reminders</Text>
            <Switch
              value={streakReminders}
              onValueChange={setStreakReminders}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </Card>

        {/* Cloud Sync Section */}
        <Text style={styles.sectionTitle}>Cloud Sync</Text>
        <Card style={styles.card}>
          {isPremium ? (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Status</Text>
                <Text style={styles.value}>Available</Text>
              </View>
              <Text style={styles.syncNote}>
                Cloud sync is enabled for Pro users
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.lockIcon}>🔒</Text>
              <Text style={styles.lockedText}>
                Cloud sync is a Pro feature
              </Text>
              <Button title="Upgrade to Unlock" onPress={handleUpgrade} />
            </>
          )}
        </Card>

        {/* Data & Privacy Section */}
        <Text style={styles.sectionTitle}>Data & Privacy</Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Documents</Text>
            <Text style={styles.value}>{features.maxDocuments === -1 ? 'Unlimited' : `${features.maxDocuments} max`}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Quizzes/Day</Text>
            <Text style={styles.value}>{features.maxQuizzesPerDay === -1 ? 'Unlimited' : features.maxQuizzesPerDay}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Flashcards/Doc</Text>
            <Text style={styles.value}>{features.maxFlashcardsPerDoc === -1 ? 'Unlimited' : features.maxFlashcardsPerDoc}</Text>
          </View>
          
          {user && (
            <TouchableOpacity 
              style={styles.deleteButton}
              onPress={handleDeleteAccount}
            >
              <Text style={styles.deleteText}>Delete Account</Text>
            </TouchableOpacity>
          )}
        </Card>

        {/* About Section */}
        <Text style={styles.sectionTitle}>About</Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Version</Text>
            <Text style={styles.value}>1.0.0</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Build</Text>
            <Text style={styles.value}>100</Text>
          </View>
        </Card>

        {/* Debug Section - Development Only */}
        {__DEV__ && (
          <>
            <Text style={styles.sectionTitle}>🔧 Developer Options</Text>
            <Card style={[styles.card, styles.debugCard]}>
              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.label}>Debug Premium Mode</Text>
                  <Text style={styles.debugHint}>Enable to test Pro features</Text>
                </View>
                <Switch
                  value={debugPremium}
                  onValueChange={toggleDebugPremium}
                  trackColor={{ false: colors.border, true: colors.success }}
                />
              </View>
              {debugPremium && (
                <Text style={styles.debugActive}>✅ Pro features unlocked for testing</Text>
              )}
            </Card>
          </>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Made with ❤️ by MindSparkle Team</Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  card: {
    padding: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  label: {
    fontSize: 16,
    color: colors.text,
  },
  value: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  proBadge: {
    backgroundColor: colors.accent,
  },
  freeBadge: {
    backgroundColor: colors.textSecondary,
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  signInButton: {
    padding: 16,
    backgroundColor: colors.primary,
    borderRadius: 8,
    alignItems: 'center',
  },
  signInText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  premiumIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  premiumText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.accent,
  },
  premiumFeatures: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 8,
  },
  upgradeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  upgradeDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  restoreButton: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  restoreText: {
    color: colors.primary,
    fontSize: 14,
  },
  lockIcon: {
    fontSize: 40,
    textAlign: 'center',
    marginBottom: 12,
  },
  lockedText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  syncNote: {
    fontSize: 14,
    color: colors.success,
    textAlign: 'center',
    marginTop: 8,
  },
  deleteButton: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  deleteText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    padding: 32,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  debugCard: {
    borderWidth: 1,
    borderColor: colors.warning,
    borderStyle: 'dashed',
  },
  debugHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  debugActive: {
    fontSize: 14,
    color: colors.success,
    textAlign: 'center',
    marginTop: 12,
    fontWeight: '600',
  },
});
