import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import type { MainDrawerScreenProps } from '../navigation/types';

type ExamsScreenProps = MainDrawerScreenProps<'Exams'>;

export const ExamsScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Header title="Exams" subtitle="Practice with exam-style questions" />
      
      <ScrollView style={styles.content}>
        <Card>
          <Text style={styles.icon}>📋</Text>
          <Text style={styles.title}>Exam Preparation</Text>
          <Text style={styles.description}>
            Take comprehensive exams based on your study materials. Get detailed feedback and track your progress.
          </Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Available Exams</Text>
          <Text style={styles.placeholder}>
            Upload documents to generate custom exams
          </Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Features</Text>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={styles.featureText}>AI-generated questions</Text>
          </View>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>⏱️</Text>
            <Text style={styles.featureText}>Timed exam mode</Text>
          </View>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>📊</Text>
            <Text style={styles.featureText}>Detailed performance analytics</Text>
          </View>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>🎯</Text>
            <Text style={styles.featureText}>Targeted improvement suggestions</Text>
          </View>
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
  icon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  placeholder: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 16,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  featureText: {
    fontSize: 16,
    color: colors.text,
  },
});
