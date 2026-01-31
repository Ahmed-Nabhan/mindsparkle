import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors } from '../constants/colors';
import { useDocument } from '../hooks/useDocument';
import ApiService from '../services/apiService';
import { findPageIndexForTopic } from '../services/documentPagesService';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type Props = MainDrawerScreenProps<'Guide'>;

type TopicRow = {
  id: string;
  title: string;
  selected: boolean;
};

function buildTopicContext(doc: Document | null): string {
  if (!doc) return '';
  const base = String(doc.content || '').trim();
  if (base) return base.slice(0, 12000);

  const extracted = String((doc as any)?.extractedData?.text || '').trim();
  if (extracted) return extracted.slice(0, 12000);

  const pages = (doc as any)?.extractedData?.pages;
  if (Array.isArray(pages) && pages.length > 0) {
    let acc = '';
    for (const p of pages.slice(0, 4)) {
      const t = String(p?.text || '').trim();
      if (!t) continue;
      acc += (acc ? '\n\n' : '') + t.slice(0, 3000);
      if (acc.length >= 12000) break;
    }
    return acc.slice(0, 12000);
  }

  return '';
}

function parseTopicsFromModel(text: string): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  // Try JSON array first.
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .map((x) => String(x || '').trim())
          .filter((s) => s.length > 0)
          .slice(0, 20);
      }
    } catch {
      // fall through
    }
  }

  // Fallback: one topic per line.
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•\d\.)\s]+/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 20);
}

export const GuideScreen: React.FC = () => {
  const navigation = useNavigation<Props['navigation']>();
  const route = useRoute<Props['route']>();
  const { getDocument } = useDocument();

  const documentId = route.params.documentId;

  const [document, setDocument] = useState<Document | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);

  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);

  useEffect(() => {
    (async () => {
      setIsLoadingDoc(true);
      try {
        const doc = await getDocument(documentId);
        setDocument(doc || null);
      } finally {
        setIsLoadingDoc(false);
      }
    })();
  }, [documentId]);

  const topicContext = useMemo(() => buildTopicContext(document), [document]);

  const loadTopics = async () => {
    if (isLoadingTopics) return;

    setIsLoadingTopics(true);
    try {
      const prompt =
        `Extract the main topics from this document.\n\n` +
        `Return ONLY a JSON array of 8-16 short topic titles (strings).\n` +
        `Rules:\n` +
        `- No extra text\n` +
        `- Keep each topic under 60 chars\n` +
        `- Use the same language as the document when possible.\n`;

      const resp = await ApiService.chat(prompt, topicContext);
      const titles = parseTopicsFromModel(resp);
      if (titles.length === 0) {
        Alert.alert('No topics found', 'Could not detect topics for this document yet.');
        setTopics([]);
        return;
      }

      setTopics(
        titles.map((t, idx) => ({
          id: `t-${idx}-${Date.now()}`,
          title: t,
          selected: false,
        }))
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load topics');
    } finally {
      setIsLoadingTopics(false);
    }
  };

  useEffect(() => {
    if (!document) return;
    if (topics.length > 0) return;
    loadTopics().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document]);

  const toggle = (id: string) => {
    setTopics((prev) => prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)));
  };

  const explainTopic = async (topicTitle: string) => {
    try {
      const page = await findPageIndexForTopic(documentId, topicTitle);
      if (!page) {
        Alert.alert('Couldn\'t find page', 'I couldn\'t map this topic to a specific page yet. Opening Deep Explain from page 1.');
      }
      // Drawer navigation doesn't support `push`; navigate with params.
      (navigation as any).navigate('DeepExplain', {
        documentId,
        initialPageIndex: page || 1,
      });
    } catch (e: any) {
      (navigation as any).navigate('DeepExplain', { documentId });
    }
  };

  if (isLoadingDoc) {
    return (
      <View style={styles.container}>
        <Header title="Guide" subtitle="Topics from this document" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusText}>Loading…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Guide" subtitle="Select topics, then explain" />

      <View style={styles.content}>
        <Button
          title="Back to Actions"
          variant="outline"
          onPress={() => navigation.navigate('DocumentActions', { documentId })}
          style={{ marginBottom: 12 }}
        />

        <Card>
          <Text style={styles.title}>{document?.title || 'Document'}</Text>
          <Text style={styles.statusText}>
            {isLoadingTopics ? 'Loading topics…' : `${topics.length} topics`}
          </Text>
          <Button
            title={isLoadingTopics ? 'Loading…' : 'Reload topics'}
            variant="outline"
            onPress={loadTopics}
            disabled={isLoadingTopics}
            style={{ marginTop: 12 }}
          />
        </Card>

        <ScrollView style={{ marginTop: 12 }} contentContainerStyle={{ paddingBottom: 24 }}>
          {topics.map((t) => (
            <Card key={t.id}>
              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.left}
                  onPress={() => toggle(t.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${t.title}`}
                >
                  <View style={[styles.checkbox, t.selected && styles.checkboxSelected]}>
                    {t.selected ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                  <Text style={styles.topicText} numberOfLines={2}>
                    {t.title}
                  </Text>
                </TouchableOpacity>

                <Button
                  title="Explain"
                  variant="primary"
                  onPress={() => explainTopic(t.title)}
                  style={styles.explainButton}
                />
              </View>
            </Card>
          ))}

          {topics.length === 0 && !isLoadingTopics ? (
            <Card>
              <Text style={styles.statusText}>No topics yet.</Text>
            </Card>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  statusText: { marginTop: 6, fontSize: 14, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: { color: '#fff', fontWeight: '900', fontSize: 14, marginTop: -1 },
  topicText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  explainButton: { minWidth: 110, minHeight: 44 },
});
