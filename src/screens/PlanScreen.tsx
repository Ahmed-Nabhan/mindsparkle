import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import * as ApiService from '../services/apiService';
import type { Document } from '../types/document';
import type { MainDrawerScreenProps } from '../navigation/types';

type PlanScreenProps = MainDrawerScreenProps<'Plan'>;

export const PlanScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<PlanScreenProps['route']>();
  const { getDocument } = useDocument();

  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [plan, setPlan] = useState<{ topic: string; hours: number }[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const doc = await getDocument(route.params.documentId);
      setDocument(doc || null);
      setIsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.documentId]);

  const getBestDocumentText = (doc: Document): string => {
    let contentToUse = doc.content || '';

    if (!contentToUse && (doc as any).extractedData?.pages) {
      const MAX_CONTEXT = 200000;
      const MAX_PAGE_SNIPPET = 4000;
      let acc = '';
      for (const p of (doc as any).extractedData.pages as any[]) {
        if (acc.length >= MAX_CONTEXT) break;
        const t = String(p?.text || '').trim();
        if (!t) continue;
        acc += (acc ? '\n\n' : '') + t.slice(0, MAX_PAGE_SNIPPET);
      }
      contentToUse = acc;
    }

    if (!contentToUse && (doc as any).extractedData?.text) {
      contentToUse = String((doc as any).extractedData.text || '');
    }

    if (!contentToUse && (doc as any).chunks && (doc as any).chunks.length > 0) {
      contentToUse = (doc as any).chunks.join('\n\n');
    }

    return String(contentToUse || '');
  };

  const toggleTopic = (topic: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const generatePlan = async () => {
    if (!document) return;

    const text = getBestDocumentText(document);
    if (!text || text.trim().length < 50) {
      Alert.alert(
        'Content Not Available',
        'Could not extract enough text from this document. If it is scanned, re-upload with OCR enabled.'
      );
      return;
    }

    setIsGeneratingPlan(true);
    try {
      const result = await ApiService.generateStudyPlan(text);
      const next = Array.isArray(result?.plan) ? result.plan : [];
      setPlan(next);
      setChecked(new Set());
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to generate plan');
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const testCheckedTopics = () => {
    const topics = Array.from(checked).filter(Boolean);
    if (topics.length === 0) {
      Alert.alert('Select Topics', 'Check at least one topic to generate a focused test.');
      return;
    }
    navigation.navigate('Test', {
      documentId: route.params.documentId,
      focusTopics: topics,
    });
  };

  const title = useMemo(() => document?.title || 'Plan', [document]);

  if (isLoading) {
    return <LoadingSpinner message="Loading document..." />;
  }

  if (!document) {
    return (
      <View style={styles.container}>
        <Header title="Plan" subtitle="Document not found" />
        <View style={styles.content}>
          <Text style={styles.emptyText}>Document not found.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Plan" subtitle={title} />
      <ScrollView style={styles.content}>
        <TouchableOpacity
          style={styles.backToActions}
          onPress={() => navigation.navigate('DocumentActions', { documentId: route.params.documentId })}
        >
          <Text style={styles.backToActionsText}>← Back to Features</Text>
        </TouchableOpacity>

        <Card>
          <Text style={styles.introTitle}>🗓️ Study Plan</Text>
          <Text style={styles.introText}>
            Generate a plan from this document, then check topics you want to test.
          </Text>
        </Card>

        <Button
          title={isGeneratingPlan ? 'Generating...' : 'Generate Plan'}
          onPress={generatePlan}
          disabled={isGeneratingPlan}
          style={styles.primaryButton}
        />

        {plan.length > 0 && (
          <Card>
            <View style={styles.tableHeader}>
              <Text style={[styles.headerCell, styles.topicCol]}>Topic</Text>
              <Text style={[styles.headerCell, styles.hoursCol]}>Hours</Text>
            </View>

            {plan.map((item, idx) => {
              const isChecked = checked.has(item.topic);
              return (
                <TouchableOpacity key={`${idx}-${item.topic}`} style={styles.row} onPress={() => toggleTopic(item.topic)}>
                  <View style={styles.topicCell}>
                    <Text style={styles.checkbox}>{isChecked ? '☑' : '☐'}</Text>
                    <Text style={styles.topicText}>{item.topic}</Text>
                  </View>
                  <Text style={styles.hoursText}>{item.hours}</Text>
                </TouchableOpacity>
              );
            })}

            <Button title="Test Checked Topics" onPress={testCheckedTopics} style={styles.primaryButton} />
          </Card>
        )}
      </ScrollView>
    </View>
  );
};

export default PlanScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: 16 },
  emptyText: { color: colors.textSecondary },
  backToActions: { paddingVertical: 10, alignItems: 'center' },
  backToActionsText: { color: colors.primary, fontWeight: '800' },
  introTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginBottom: 8, textAlign: 'center' },
  introText: { color: colors.textSecondary, textAlign: 'center' },
  primaryButton: { marginTop: 12 },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  headerCell: { fontSize: 12, color: colors.textSecondary, fontWeight: '800' },
  topicCol: { flex: 1 },
  hoursCol: { width: 60, textAlign: 'right' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topicCell: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  checkbox: { width: 26, fontSize: 18, color: colors.text },
  topicText: { flex: 1, color: colors.text },
  hoursText: { width: 60, textAlign: 'right', color: colors.text, fontWeight: '700' },
});
