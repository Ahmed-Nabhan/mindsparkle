import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DrawerContentScrollView, DrawerItemList, DrawerContentComponentProps } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { useAuth } from '../context/AuthContext';
import { usePremiumContext } from '../context/PremiumContext';
import { useGamification } from '../context/GamificationContext';
import { LEVELS } from '../services/gamificationService';

export const Sidebar: React.FC<DrawerContentComponentProps> = (props) => {
  const { user, signOut } = useAuth();
  const { isPremium } = usePremiumContext();
  const { stats } = useGamification();
  
  // Get current level from XP
  const getCurrentLevel = () => {
    const sorted = [...LEVELS].sort((a, b) => b.xpRequired - a.xpRequired);
    return sorted.find(l => stats.totalXP >= l.xpRequired) || LEVELS[0];
  };
  const currentLevel = getCurrentLevel();

  const handleUpgrade = () => {
    props.navigation.navigate('Paywall', { source: 'sidebar' });
  };

  return (
    <DrawerContentScrollView {...props} style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={[styles.appName, { marginBottom: 0 }]}>MindSparkle</Text>
          <TouchableOpacity 
            onPress={() => props.navigation.closeDrawer()}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            style={{ padding: 5 }}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        {user && (
          <View style={styles.userInfo}>
            <Text style={styles.userEmail}>{user.email}</Text>
            <View style={[styles.badge, isPremium ? styles.premiumBadge : styles.freeBadge]}>
              <Text style={styles.badgeText}>{isPremium ? 'PRO' : 'FREE'}</Text>
            </View>
          </View>
        )}
        
        {/* Gamification Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statEmoji}>🔥</Text>
            <Text style={styles.statValue}>{stats.currentStreak}</Text>
            <Text style={styles.statLabel}>Streak</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statEmoji}>⭐</Text>
            <Text style={styles.statValue}>{stats.totalXP}</Text>
            <Text style={styles.statLabel}>XP</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statEmoji}>{currentLevel.emoji}</Text>
            <Text style={styles.statValue}>{currentLevel.level}</Text>
            <Text style={styles.statLabel}>Level</Text>
          </View>
        </View>
      </View>

      <DrawerItemList {...props} />

      {!isPremium && (
        <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
          <Text style={styles.upgradeText}>⭐ Upgrade to Pro</Text>
        </TouchableOpacity>
      )}

      {user && (
        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      )}
    </DrawerContentScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: colors.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userEmail: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  premiumBadge: {
    backgroundColor: colors.accent,
  },
  freeBadge: {
    backgroundColor: colors.textSecondary,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  statItem: {
    alignItems: 'center',
  },
  statEmoji: {
    fontSize: 20,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
  },
  upgradeButton: {
    margin: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: colors.accent,
    borderRadius: 8,
    alignItems: 'center',
  },
  upgradeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  signOutButton: {
    margin: 16,
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.error,
    borderRadius: 8,
    alignItems: 'center',
  },
  signOutText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
