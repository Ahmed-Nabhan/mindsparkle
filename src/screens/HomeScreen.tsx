import React from 'react';
import { View, Text, StyleSheet, ImageBackground } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Button } from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { usePremiumContext } from '../context/PremiumContext';
import type { MainDrawerScreenProps } from '../navigation/types';

type HomeScreenProps = MainDrawerScreenProps<'Home'>;

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeScreenProps['navigation']>();
  const { user, isAuthenticated } = useAuth();
  const { isPremium } = usePremiumContext();

  const handleGetStarted = () => {
    navigation.navigate('Upload');
  };

  // Get display name from email
  const getDisplayName = () => {
    if (!user?.email) return 'User';
    const emailPart = user.email.split('@')[0];
    // Capitalize first letter
    return emailPart.charAt(0).toUpperCase() + emailPart.slice(1);
  };

  return (
    <View style={styles.container}>
      {/* Background with tech/sparkle theme */}
      <View style={styles.backgroundOverlay} />
      
      <View style={styles.content}>
        {/* Show user profile if signed in */}
        {isAuthenticated && user ? (
          <>
            <View style={styles.profileContainer}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getDisplayName().charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.userName}>{getDisplayName()}</Text>
              <Text style={styles.userEmail}>{user.email}</Text>
              <View style={[styles.badge, isPremium ? styles.premiumBadge : styles.freeBadge]}>
                <Text style={styles.badgeText}>{isPremium ? '⭐ PRO' : 'FREE'}</Text>
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sparkle}>✨</Text>
            <Text style={styles.title}>{strings.home.title}</Text>
            <Text style={styles.description}>{strings.home.description}</Text>
          </>
        )}
        
        <Button
          title={isAuthenticated ? 'Upload Document' : strings.home.getStarted}
          onPress={handleGetStarted}
          style={styles.button}
        />
      </View>

      {/* Decorative elements */}
      <View style={styles.decorativeCircle1} />
      <View style={styles.decorativeCircle2} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.primary,
    opacity: 0.95,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    zIndex: 1,
  },
  profileContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  welcomeText: {
    fontSize: 18,
    color: '#FFFFFF',
    opacity: 0.8,
  },
  userName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.7,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  premiumBadge: {
    backgroundColor: '#FFD700',
  },
  freeBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  sparkle: {
    fontSize: 80,
    marginBottom: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  description: {
    fontSize: 18,
    color: '#FFFFFF',
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 48,
  },
  button: {
    minWidth: 200,
    backgroundColor: colors.accent,
  },
  decorativeCircle1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.secondary,
    opacity: 0.1,
    top: -50,
    left: -50,
  },
  decorativeCircle2: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.accent,
    opacity: 0.1,
    bottom: 50,
    right: -30,
  },
});
