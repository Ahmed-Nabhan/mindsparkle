import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { usePerformance } from '../hooks/usePerformance';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { formatDuration, formatDate, calculatePercentage } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';

type PerformanceScreenProps = MainDrawerScreenProps<'Performance'>;

export const PerformanceScreen: React.FC = () => {
  const { stats, isLoading } = usePerformance();

  if (isLoading) {
    return <LoadingSpinner message="Loading performance data..." />;
  }

  return (
    <View style={styles.container}>
      <Header title="Performance" subtitle="Track your learning progress" />
      
      <ScrollView style={styles.content}>
        <Card>
          <Text style={styles.sectionTitle}>Overview</Text>
          
          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalTests}</Text>
              <Text style={styles.statLabel}>Total Tests</Text>
            </View>
            
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.averageScore.toFixed(0)}%</Text>
              <Text style={styles.statLabel}>Average Score</Text>
            </View>
            
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatDuration(stats.totalTimeSpent)}</Text>
              <Text style={styles.statLabel}>Time Spent</Text>
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
                  <Text style={[
                    styles.testScore,
                    { color: test.score >= 70 ? colors.success : colors.warning }
                  ]}>
                    {test.score.toFixed(0)}%
                  </Text>
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
    marginBottom: 4,
  },
  testDate: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  testScore: {
    fontSize: 16,
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
