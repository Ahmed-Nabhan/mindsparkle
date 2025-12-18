import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Header } from '../components/Header';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type DocumentActionsScreenProps = MainDrawerScreenProps<'DocumentActions'>;

export const DocumentActionsScreen: React.FC = () => {
  const route = useRoute<DocumentActionsScreenProps['route']>();
  const navigation = useNavigation<DocumentActionsScreenProps['navigation']>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDocument();
  }, []);

  const loadDocument = async () => {
    const doc = await getDocument(route.params.documentId);
    setDocument(doc);
    setIsLoading(false);
  };

  const handleSummarize = () => {
    if (!document) return;
    navigation.navigate('Summary', { documentId: document.id });
  };

  const handleStudy = () => {
    if (!document) return;
    navigation.navigate('Study', { documentId: document.id });
  };

  const handleGenerateVideo = () => {
    if (!document) return;
    navigation.navigate('Video', { documentId: document.id });
  };

  const handleTest = () => {
    if (!document) return;
    navigation.navigate('Test', { documentId: document.id });
  };

  const handleLabs = () => {
    if (!document) return;
    navigation.navigate('Labs', { documentId: document.id });
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading document..." />;
  }

  if (!document) {
    return (
      <View style={styles.container}>
        <Header title="Document Not Found" />
        <View style={styles.content}>
          <Text style={styles.errorText}>Document not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title={document.title} subtitle="Choose an action" />
      
      <ScrollView style={styles.content}>
        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>📝</Text>
          <Text style={styles.actionTitle}>{strings.actions.summarize}</Text>
          <Text style={styles.actionDescription}>
            Get an AI-generated summary of your document
          </Text>
          <Button title={strings.actions.summarize} onPress={handleSummarize} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>📚</Text>
          <Text style={styles.actionTitle}>{strings.actions.study}</Text>
          <Text style={styles.actionDescription}>
            Study with AI-assisted learning tools
          </Text>
          <Button title={strings.actions.study} onPress={handleStudy} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>🎥</Text>
          <Text style={styles.actionTitle}>{strings.actions.generateVideo}</Text>
          <Text style={styles.actionDescription}>
            Create an AI video summary
          </Text>
          <Button title={strings.actions.generateVideo} onPress={handleGenerateVideo} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>✏️</Text>
          <Text style={styles.actionTitle}>{strings.actions.test}</Text>
          <Text style={styles.actionDescription}>
            Take an AI-generated quiz
          </Text>
          <Button title={strings.actions.test} onPress={handleTest} />
        </Card>

        <Card style={styles.actionCard}>
          <Text style={styles.actionIcon}>🔬</Text>
          <Text style={styles.actionTitle}>{strings.actions.labs}</Text>
          <Text style={styles.actionDescription}>
            Access interactive labs and exercises
          </Text>
          <Button title={strings.actions.labs} onPress={handleLabs} />
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
  actionCard: {
    alignItems: 'center',
    marginVertical: 8,
  },
  actionIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  actionDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
});
