import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { colors } from '../constants/colors';
import { useGamification } from '../context/GamificationContext';
import { LEVELS } from '../services/gamificationService';

const { width } = Dimensions.get('window');

interface AchievementsScreenProps {
  navigation: any;
}

export const AchievementsScreen: React.FC<AchievementsScreenProps> = ({ navigation }) => {
  const { stats, getAllAchievements } = useGamification();
  const [activeTab, setActiveTab] = useState<'achievements' | 'levels'>('achievements');
  const achievements = getAllAchievements();

  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const progressPercentage = (unlockedCount / achievements.length) * 100;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🏆 Achievements</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Stats Banner */}
      <View style={styles.statsBanner}>
        <View style={styles.levelCircle}>
          <Text style={styles.levelEmoji}>{stats.levelEmoji}</Text>
          <Text style={styles.levelNumber}>Lv. {stats.level}</Text>
        </View>
        <View style={styles.statsInfo}>
          <Text style={styles.levelTitle}>{stats.levelTitle}</Text>
          <View style={styles.xpBar}>
            <View style={[styles.xpProgress, { width: `${stats.xpProgress}%` }]} />
          </View>
          <Text style={styles.xpText}>
            {stats.totalXP} XP • {stats.xpToNextLevel} to next level
          </Text>
        </View>
      </View>

      {/* Streak Badge */}
      <View style={styles.streakContainer}>
        <View style={styles.streakBadge}>
          <Text style={styles.streakFire}>🔥</Text>
          <Text style={styles.streakCount}>{stats.currentStreak}</Text>
          <Text style={styles.streakLabel}>Day Streak</Text>
        </View>
        <View style={styles.streakDivider} />
        <View style={styles.streakBadge}>
          <Text style={styles.streakFire}>🏅</Text>
          <Text style={styles.streakCount}>{stats.longestStreak}</Text>
          <Text style={styles.streakLabel}>Best Streak</Text>
        </View>
        <View style={styles.streakDivider} />
        <View style={styles.streakBadge}>
          <Text style={styles.streakFire}>🎯</Text>
          <Text style={styles.streakCount}>{unlockedCount}/{achievements.length}</Text>
          <Text style={styles.streakLabel}>Unlocked</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'achievements' && styles.tabActive]}
          onPress={() => setActiveTab('achievements')}
        >
          <Text style={[styles.tabText, activeTab === 'achievements' && styles.tabTextActive]}>
            Achievements
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'levels' && styles.tabActive]}
          onPress={() => setActiveTab('levels')}
        >
          <Text style={[styles.tabText, activeTab === 'levels' && styles.tabTextActive]}>
            Levels
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'achievements' ? (
          <>
            {/* Progress */}
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>
                {unlockedCount} of {achievements.length} achievements unlocked
              </Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPercentage}%` }]} />
              </View>
            </View>

            {/* Achievement Grid */}
            <View style={styles.achievementGrid}>
              {achievements.map((achievement) => (
                <View
                  key={achievement.id}
                  style={[
                    styles.achievementCard,
                    !achievement.unlocked && styles.achievementLocked,
                  ]}
                >
                  <Text style={[
                    styles.achievementIcon,
                    !achievement.unlocked && styles.achievementIconLocked,
                  ]}>
                    {achievement.icon}
                  </Text>
                  <Text style={[
                    styles.achievementTitle,
                    !achievement.unlocked && styles.achievementTitleLocked,
                  ]}>
                    {achievement.title}
                  </Text>
                  <Text style={styles.achievementDesc}>
                    {achievement.description}
                  </Text>
                  <View style={styles.achievementReward}>
                    <Text style={styles.rewardText}>+{achievement.xpReward} XP</Text>
                    {achievement.unlocked && (
                      <Text style={styles.unlockedBadge}>✓</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            {/* Levels List */}
            <View style={styles.levelsList}>
              {LEVELS.map((level) => {
                const isCurrentLevel = level.level === stats.level;
                const isUnlocked = stats.totalXP >= level.xpRequired;
                
                return (
                  <View
                    key={level.level}
                    style={[
                      styles.levelCard,
                      isCurrentLevel && styles.levelCardCurrent,
                      !isUnlocked && styles.levelCardLocked,
                    ]}
                  >
                    <View style={styles.levelLeft}>
                      <Text style={[
                        styles.levelListEmoji,
                        !isUnlocked && styles.levelEmojiLocked,
                      ]}>
                        {level.emoji}
                      </Text>
                      <View>
                        <Text style={[
                          styles.levelListTitle,
                          !isUnlocked && styles.levelTitleLocked,
                        ]}>
                          Level {level.level} - {level.title}
                        </Text>
                        <Text style={styles.levelXPRequired}>
                          {level.xpRequired} XP required
                        </Text>
                      </View>
                    </View>
                    {isUnlocked && (
                      <Text style={styles.levelUnlocked}>
                        {isCurrentLevel ? '⭐ Current' : '✓'}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.primary,
  },
  backButton: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  statsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingBottom: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  levelCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  levelEmoji: {
    fontSize: 32,
  },
  levelNumber: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  statsInfo: {
    flex: 1,
  },
  levelTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  xpBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  xpProgress: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  xpText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  streakContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: -20,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  streakBadge: {
    flex: 1,
    alignItems: 'center',
  },
  streakDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  streakFire: {
    fontSize: 28,
    marginBottom: 4,
  },
  streakCount: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
  },
  streakLabel: {
    fontSize: 12,
    color: colors.textLight,
    marginTop: 2,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textLight,
  },
  tabTextActive: {
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  progressContainer: {
    marginBottom: 20,
  },
  progressText: {
    fontSize: 14,
    color: colors.textLight,
    marginBottom: 8,
    textAlign: 'center',
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  achievementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  achievementCard: {
    width: (width - 52) / 2,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  achievementLocked: {
    opacity: 0.6,
    backgroundColor: colors.surface,
  },
  achievementIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  achievementIconLocked: {
    opacity: 0.4,
  },
  achievementTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  achievementTitleLocked: {
    color: colors.textLight,
  },
  achievementDesc: {
    fontSize: 12,
    color: colors.textLight,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 16,
  },
  achievementReward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rewardText: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },
  unlockedBadge: {
    fontSize: 14,
    color: colors.success,
    fontWeight: 'bold',
  },
  levelsList: {
    gap: 12,
  },
  levelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  levelCardCurrent: {
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  levelCardLocked: {
    opacity: 0.5,
  },
  levelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  levelListEmoji: {
    fontSize: 36,
  },
  levelEmojiLocked: {
    opacity: 0.4,
  },
  levelListTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  levelTitleLocked: {
    color: colors.textLight,
  },
  levelXPRequired: {
    fontSize: 13,
    color: colors.textLight,
  },
  levelUnlocked: {
    fontSize: 14,
    color: colors.success,
    fontWeight: '600',
  },
});

export default AchievementsScreen;
