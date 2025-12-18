import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DrawerContentScrollView, DrawerItemList, DrawerContentComponentProps } from '@react-navigation/drawer';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { useAuth } from '../context/AuthContext';
import { usePremium } from '../hooks/usePremium';

export const Sidebar: React.FC<DrawerContentComponentProps> = (props) => {
  const { user, signOut } = useAuth();
  const { isPremium } = usePremium();

  return (
    <DrawerContentScrollView {...props} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.appName}>MindSparkle</Text>
        {user && (
          <View style={styles.userInfo}>
            <Text style={styles.userEmail}>{user.email}</Text>
            <View style={[styles.badge, isPremium ? styles.premiumBadge : styles.freeBadge]}>
              <Text style={styles.badgeText}>{isPremium ? 'PRO' : 'FREE'}</Text>
            </View>
          </View>
        )}
      </View>

      <DrawerItemList {...props} />

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
  signOutButton: {
    margin: 16,
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
