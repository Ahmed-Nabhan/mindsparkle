import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { usePerformance } from '../hooks/usePerformance';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { formatDuration, formatDate, calculatePercentage } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';

type PerformanceScreenProps = MainDrawerScreenProps<'Performance'>;

const SCREEN_WIDTH = Dimensions.get('window').width;

// Simple bar chart component
const BarChart = ({ data, maxValue, color }: { data: number[]; maxValue: number; color: string }) => {
  const barWidth = (SCREEN_WIDTH - 80) / data.length - 4;
  return (
    <View style={chartStyles.barContainer}>
      {data.map((value, index) => {
        const height = maxValue > 0 ? (value / maxValue) * 100 : 0;
        return (
          <View key={index} style={chartStyles.barWrapper}>
            <View style={[chartStyles.bar, { height: `${Math.max(height, 5)}%`, backgroundColor: color }]} />
            <Text style={chartStyles.barLabel}>{index + 1}</Text>
          </View>
        );
      })}
    </View>
  );
};

// Simple progress ring component
const ProgressRing = ({ percentage, size, color, label }: { percentage: number; size: number; color: string; label: string }) => {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const progress = Math.min(percentage, 100);
  
  return (
    <View style={[chartStyles.ringContainer, { width: size, height: size }]}>
      <View style={[chartStyles.ringBackground, { width: size, height: size, borderRadius: size / 2, borderWidth: strokeWidth, borderColor: colors.border }]} />
      <View style={[chartStyles.ringProgress, { 
        width: size, 
        height: size, 
        borderRadius: size / 2, 
        borderWidth: strokeWidth,
        borderColor: color,
        borderTopColor: 'transparent',
        borderRightColor: progress > 25 ? color : 'transparent',
        borderBottomColor: progress > 50 ? color : 'transparent',
        borderLeftColor: progress > 75 ? color : 'transparent',
        transform: [{ rotate: '-90deg' }]
      }]} />
      <View style={chartStyles.ringCenter}>
        <Text style={[chartStyles.ringValue, { color }]}>{Math.round(percentage)}%</Text>
        <Text style={chartStyles.ringLabel}>{label}</Text>
      </View>
    </View>
  );
};

export const PerformanceScreen: React.FC = () => {
  const { stats, isLoading } = usePerformance();

  // Calculate streak (consecutive days with tests)
  const streak = useMemo(() => {
    if (stats.recentTests.length === 0) return 0;
    
    let currentStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const testDates = stats.recentTests.map(t => {
      const d = new Date(t.completedAt);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    });
    
    const uniqueDates = [...new Set(testDates)].sort((a, b) => b - a);
    
    for (let i = 0; i < uniqueDates.length; i++) {
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);
      expectedDate.setHours(0, 0, 0, 0);
      
      if (uniqueDates.includes(expectedDate.getTime())) {
        currentStreak++;
      } else {
        break;
      }
    }
    
    return currentStreak;
  }, [stats.recentTests]);

  // Calculate weekly scores for chart
  const weeklyScores = useMemo(() => {
    const last7Days = Array(7).fill(0);
    const last7Counts = Array(7).fill(0);
    const today = new Date();
    
    stats.recentTests.forEach(test => {
      const testDate = new Date(test.completedAt);
      const daysAgo = Math.floor((today.getTime() - testDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo < 7 && daysAgo >= 0) {
        last7Days[6 - daysAgo] += test.score;
        last7Counts[6 - daysAgo]++;
      }
    });
    
    return last7Days.map((total, i) => last7Counts[i] > 0 ? total / last7Counts[i] : 0);
  }, [stats.recentTests]);

  // Get improvement trend
  const improvementTrend = useMemo(() => {
    if (stats.recentTests.length < 2) return null;
    const recent = stats.recentTests.slice(0, 5);
    const older = stats.recentTests.slice(5, 10);
    
    if (older.length === 0) return null;
    
    const recentAvg = recent.reduce((sum, t) => sum + t.score, 0) / recent.length;
    const olderAvg = older.reduce((sum, t) => sum + t.score, 0) / older.length;
    
    return recentAvg - olderAvg;
  }, [stats.recentTests]);

  if (isLoading) {
    return <LoadingSpinner message="Loading performance data..." />;
  }

  return (
    <View style={styles.container}>
      <Header title="Performance" subtitle="Track your learning progress" />
      
      <ScrollView style={styles.content}>
        {/* Streak Card */}
        <Card>
          <View style={styles.streakContainer}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View style={styles.streakInfo}>
              <Text style={styles.streakValue}>{streak} day{streak !== 1 ? 's' : ''}</Text>
              <Text style={styles.streakLabel}>Current Streak</Text>
            </View>
            {streak >= 3 && <Text style={styles.streakBadge}>🏆</Text>}
            {streak >= 7 && <Text style={styles.streakBadge}>⭐</Text>}
          </View>
        </Card>

        {/* Progress Rings */}
        <Card>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.ringRow}>
            <ProgressRing 
              percentage={stats.averageScore} 
              size={100} 
              color={stats.averageScore >= 70 ? colors.success || '#28a745' : colors.warning || '#ffc107'}
              label="Avg Score"
            />
            <View style={styles.overviewStats}>
              <View style={styles.overviewItem}>
                <Text style={styles.overviewValue}>{stats.totalTests}</Text>
                <Text style={styles.overviewLabel}>Total Tests</Text>
              </View>
              <View style={styles.overviewItem}>
                <Text style={styles.overviewValue}>{formatDuration(stats.totalTimeSpent)}</Text>
                <Text style={styles.overviewLabel}>Time Spent</Text>
              </View>
              {improvementTrend !== null && (
                <View style={styles.overviewItem}>
                  <Text style={[styles.overviewValue, { color: improvementTrend >= 0 ? colors.success || '#28a745' : '#dc3545' }]}>
                    {improvementTrend >= 0 ? '↑' : '↓'} {Math.abs(improvementTrend).toFixed(1)}%
                  </Text>
                  <Text style={styles.overviewLabel}>Trend</Text>
                </View>
              )}
            </View>
          </View>
        </Card>

        {/* Weekly Chart */}
        <Card>
          <Text style={styles.sectionTitle}>📊 Last 7 Days</Text>
          <View style={styles.chartContainer}>
            <BarChart data={weeklyScores} maxValue={100} color={colors.primary} />
            <View style={styles.chartLabels}>
              <Text style={styles.chartLabelText}>Mon</Text>
              <Text style={styles.chartLabelText}>Today</Text>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Tests by Type</Text>
          
          <View style={styles.typeRow}>
            <View style={styles.typeItem}>
              <Text style={styles.typeIcon}>📝</Text>
              <Text style={styles.typeValue}>{stats.testsByType.quiz}</Text>
              <Text style={styles.typeLabel}>Quizzes</Text>
            </View>
            
            <View style={styles.typeItem}>
              <Text style={styles.typeIcon}>📋</Text>
              <Text style={styles.typeValue}>{stats.testsByType.exam}</Text>
              <Text style={styles.typeLabel}>Exams</Text>
            </View>
            
            <View style={styles.typeItem}>
              <Text style={styles.typeIcon}>💼</Text>
              <Text style={styles.typeValue}>{stats.testsByType.interview}</Text>
              <Text style={styles.typeLabel}>Interviews</Text>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Recent Tests</Text>
          
          {stats.recentTests.length === 0 ? (
            <Text style={styles.noData}>No tests taken yet</Text>
          ) : (
            stats.recentTests.map((test, index) => (
              <View key={test.id} style={styles.testItem}>
                <View style={styles.testHeader}>
                  <Text style={styles.testDate}>{formatDate(test.completedAt)}</Text>
                  <View style={[styles.scoreBadge, { backgroundColor: test.score >= 70 ? '#d4edda' : test.score >= 50 ? '#fff3cd' : '#f8d7da' }]}>
                    <Text style={[
                      styles.testScore,
                      { color: test.score >= 70 ? '#155724' : test.score >= 50 ? '#856404' : '#721c24' }
                    ]}>
                      {test.score.toFixed(0)}%
                    </Text>
                  </View>
                </View>
                <Text style={styles.testDetails}>
                  {test.correctAnswers}/{test.totalQuestions} correct • {test.testType}
                </Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </View>
  );
};

const chartStyles = StyleSheet.create({
  barContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingHorizontal: 8,
  },
  barWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  bar: {
    width: '80%',
    borderRadius: 4,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 4,
  },
  ringContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringBackground: {
    position: 'absolute',
  },
  ringProgress: {
    position: 'absolute',
  },
  ringCenter: {
    alignItems: 'center',
  },
  ringValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  ringLabel: {
    fontSize: 10,
    color: colors.textSecondary,
  },
});

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
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  // Streak styles
  streakContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  streakEmoji: {
    fontSize: 48,
    marginRight: 16,
  },
  streakInfo: {
    flex: 1,
  },
  streakValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FF6B35',
  },
  streakLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  streakBadge: {
    fontSize: 24,
    marginLeft: 8,
  },
  // Ring row
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overviewStats: {
    flex: 1,
    marginLeft: 20,
  },
  overviewItem: {
    marginBottom: 12,
  },
  overviewValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  overviewLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  // Chart styles
  chartContainer: {
    marginTop: 8,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginTop: 8,
  },
  chartLabelText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  typeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  typeItem: {
    alignItems: 'center',
  },
  typeIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  typeValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  typeLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  testItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  testHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  testDate: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  testScore: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  testDetails: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  noData: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 16,
  },
});
