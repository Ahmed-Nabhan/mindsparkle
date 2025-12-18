import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import type { MainDrawerScreenProps } from '../navigation/types';

type InterviewScreenProps = MainDrawerScreenProps<'Interview'>;

export const InterviewScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Header title="Interview Tests" subtitle="Prepare for technical interviews" />
      
      <ScrollView style={styles.content}>
        <Card>
          <Text style={styles.icon}>💼</Text>
          <Text style={styles.title}>Interview Preparation</Text>
          <Text style={styles.description}>
            Practice with AI-generated interview questions. Perfect for technical job preparation.
          </Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Interview Categories</Text>
          
          <View style={styles.categoryItem}>
            <Text style={styles.categoryIcon}>💻</Text>
            <View style={styles.categoryContent}>
              <Text style={styles.categoryTitle}>Technical Questions</Text>
              <Text style={styles.categoryDescription}>
                Programming, algorithms, and problem-solving
              </Text>
            </View>
          </View>

          <View style={styles.categoryItem}>
            <Text style={styles.categoryIcon}>🧠</Text>
            <View style={styles.categoryContent}>
              <Text style={styles.categoryTitle}>Conceptual Questions</Text>
              <Text style={styles.categoryDescription}>
                Theory, concepts, and best practices
              </Text>
            </View>
          </View>

          <View style={styles.categoryItem}>
            <Text style={styles.categoryIcon}>🎯</Text>
            <View style={styles.categoryContent}>
              <Text style={styles.categoryTitle}>Behavioral Questions</Text>
              <Text style={styles.categoryDescription}>
                Situation-based and experience questions
              </Text>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Features</Text>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>🤖</Text>
            <Text style={styles.featureText}>AI-powered question generation</Text>
          </View>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>📝</Text>
            <Text style={styles.featureText}>Practice with real scenarios</Text>
          </View>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>💡</Text>
            <Text style={styles.featureText}>Detailed answer explanations</Text>
          </View>
          
          <View style={styles.feature}>
            <Text style={styles.featureIcon}>📈</Text>
            <Text style={styles.featureText}>Track your improvement</Text>
          </View>
        </Card>

        <Card>
          <Text style={styles.placeholder}>
            Upload your study materials to start generating interview questions
          </Text>
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
    marginBottom: 16,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  categoryIcon: {
    fontSize: 36,
    marginRight: 16,
  },
  categoryContent: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  categoryDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
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
  placeholder: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 16,
  },
});
