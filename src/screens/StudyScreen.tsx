import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Image,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { DocumentSelector } from '../components/DocumentSelector';
import { useDocument } from '../hooks/useDocument';
import * as ApiService from '../services/apiService';
import type { Document, PageContent } from '../types/document';

type StudyScreenProps = any;

type AgentMode = 'chat' | 'whiteboard';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

function getPageText(doc: Document | null, pageNumber: number): string {
  if (!doc) return '';
  const pages = doc.extractedData?.pages;
  if (!pages || pages.length === 0) return '';
  const match = pages.find(p => p.pageNumber === pageNumber);
  return String(match?.text || '').trim();
}

function getPageThumbnailUrl(doc: Document | null, pageNumber: number): string {
  if (!doc) return '';
  const pages = doc.extractedData?.pages;
  if (!pages || pages.length === 0) return '';
  const match = pages.find(p => p.pageNumber === pageNumber);
  const imgs = (match as any)?.images;
  if (!Array.isArray(imgs) || imgs.length === 0) return '';
  const first = imgs.find((i: any) => typeof i?.url === 'string' && i.url.length > 0) || imgs[0];
  return String(first?.url || '').trim();
}

function getTotalPages(doc: Document | null): number {
  if (!doc) return 0;

  const explicit = Number(doc.extractedData?.totalPages || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const pages = doc.extractedData?.pages;
  if (pages && pages.length > 0) {
    const maxPage = Math.max(
      ...pages
        .map(p => Number(p.pageNumber))
        .filter(n => Number.isFinite(n) && n > 0)
    );
    if (Number.isFinite(maxPage) && maxPage > 0) return maxPage;
  }

  return 0;
}

function getAvailablePageNumbers(doc: Document | null): number[] {
  const pages = doc?.extractedData?.pages;
  if (!pages || pages.length === 0) return [];
  return pages
    .map(p => Number(p.pageNumber))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

function buildDocContext(doc: Document | null): string {
  if (!doc) return '';
  // Keep context small and rely on the page text primarily.
  const base = String(doc.content || '').trim();
  if (base.length > 0) return base.slice(0, 12000);
  const pages = doc.extractedData?.pages;
  if (!pages || pages.length === 0) return '';

  let acc = '';
  for (const p of pages.slice(0, 3)) {
    const t = String(p.text || '').trim();
    if (!t) continue;
    acc += (acc ? '\n\n' : '') + t.slice(0, 4000);
  }
  return acc.slice(0, 12000);
}

function buildPageSummaryPrompt(args: { docTitle: string; pageNumber: number; pageText: string }): string {
  return `Summarize ONLY page ${args.pageNumber} of this document.

Document title: ${args.docTitle || 'Untitled'}

Rules:
- Use ONLY the provided page text.
- If the page text is empty or insufficient, say exactly: "PAGE_TEXT_NOT_AVAILABLE".
- Output:
  1) 5-10 bullet key points
  2) A small table (Markdown) if there are comparisons/steps/fields
  3) Key equations (LaTeX) if present

PAGE TEXT (page ${args.pageNumber}):
${args.pageText}`;
}

function buildAgentPrompt(args: {
  mode: AgentMode;
  docTitle: string;
  pageNumber: number;
  pageText: string;
  question: string;
}): string {
  if (args.mode === 'whiteboard') {
    return `WHITEBOARD MODE
You are an expert teacher. Teach the user clearly.

Constraints:
- Ground your answer in the page text when it is relevant.
- If the page text is empty, say you don't have page text and proceed with general teaching.

Output format:
- Start with a short explanation.
- Include:
  - Tables in Markdown when useful
  - Equations in LaTeX when useful
  - Diagrams as fenced blocks with label DIAGRAM, using simple ASCII boxes/lines.

Document: ${args.docTitle || 'Untitled'}
Current page: ${args.pageNumber}

PAGE TEXT:
${args.pageText || '(empty)'}

User question:
${args.question}`;
  }

  return `You are a helpful study assistant. Answer the user's question concisely.
If the question depends on the page, use the page text. If the page text is empty, ask 1 short clarifying question.

Document: ${args.docTitle || 'Untitled'}
Current page: ${args.pageNumber}

PAGE TEXT:
${args.pageText || '(empty)'}

User question:
${args.question}`;
}

export const StudyScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { getDocument } = useDocument();

  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [jumpToPageText, setJumpToPageText] = useState('1');

  const [pageSummary, setPageSummary] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState(false);

  const [agentMode, setAgentMode] = useState<AgentMode>('chat');
  const [agentInput, setAgentInput] = useState('');
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([]);
  const [isAsking, setIsAsking] = useState(false);

  const [whiteboardVisible, setWhiteboardVisible] = useState(false);

  const totalPages = useMemo(() => getTotalPages(document), [document]);
  const availablePages = useMemo(() => getAvailablePageNumbers(document), [document]);

  const pageText = useMemo(() => getPageText(document, currentPage), [document, currentPage]);
  const pageThumbUrl = useMemo(() => getPageThumbnailUrl(document, currentPage), [document, currentPage]);

  const loadDocumentById = async (documentId: string, openMode?: AgentMode) => {
    setIsLoading(true);
    try {
      const doc = await getDocument(documentId);
      if (!doc) {
        Alert.alert('Document Not Found', 'Could not load this document.');
        return;
      }
      setDocument(doc);

      // Initialize page to 1 or first available extracted page.
      const first = getAvailablePageNumbers(doc)[0] || 1;
      setCurrentPage(first);
      setJumpToPageText(String(first));
      setPageSummary('');
      setAgentMessages([]);

      if (openMode === 'whiteboard') {
        setAgentMode('whiteboard');
        setWhiteboardVisible(true);
      } else {
        setAgentMode('chat');
        setWhiteboardVisible(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    const documentId = route.params?.documentId;
    if (documentId) {
      const requested = route.params?.initialMode === 'whiteboard' ? 'whiteboard' : undefined;
      loadDocumentById(documentId, requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.documentId]);

  const handleSelectDocument = async (doc: Document) => {
    await loadDocumentById(doc.id);
  };

  const clampPage = (n: number) => {
    // Prefer full-document navigation when totalPages is known.
    if (totalPages > 0) return Math.max(1, Math.min(totalPages, n));

    // If we don't know total pages, at least allow navigation to the max extracted page.
    if (availablePages.length > 0) {
      const maxExtracted = availablePages[availablePages.length - 1];
      return Math.max(1, Math.min(maxExtracted, n));
    }

    return Math.max(1, n);
  };

  const goToPage = (n: number) => {
    const next = clampPage(n);
    setCurrentPage(next);
    setJumpToPageText(String(next));
    setPageSummary('');
  };

  const handleJump = () => {
    const n = Number(jumpToPageText);
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Invalid Page', 'Please enter a valid page number.');
      return;
    }
    goToPage(n);
  };

  const handleSummarizePage = async () => {
    if (!document) return;

    const pageTextToUse = pageText;
    if (!pageTextToUse || pageTextToUse.trim().length < 20) {
      Alert.alert(
        'Page Not Extracted',
        'This page has no extracted text. Ask the Study Agent about the topic of this page.'
      );
      return;
    }

    setIsSummarizing(true);
    try {
      const prompt = buildPageSummaryPrompt({
        docTitle: document.title,
        pageNumber: currentPage,
        pageText: pageTextToUse,
      });

      const resp = await ApiService.callApi('chat', {
        content: buildDocContext(document),
        question: prompt,
      });

      const text = String((resp as any)?.response ?? resp ?? '').trim();
      if (text === 'PAGE_TEXT_NOT_AVAILABLE') {
        Alert.alert('Page Text Not Available', 'The AI could not summarize because page text is missing.');
        return;
      }
      setPageSummary(text);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to summarize this page');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleAskAgent = async () => {
    if (!document) return;
    const question = agentInput.trim();
    if (!question) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: question };
    setAgentMessages(prev => [...prev, userMsg]);
    setAgentInput('');

    setIsAsking(true);
    try {
      const prompt = buildAgentPrompt({
        mode: agentMode,
        docTitle: document.title,
        pageNumber: currentPage,
        pageText,
        question,
      });

      const history = agentMessages
        .slice(-8)
        .map(m => ({ role: m.role, content: m.content }));

      const resp = await ApiService.callApi('chat', {
        content: buildDocContext(document),
        question: prompt,
        history,
      });

      const answer = String((resp as any)?.response ?? resp ?? '').trim();
      const assistantMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: answer || 'No response.' };
      setAgentMessages(prev => [...prev, assistantMsg]);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'Failed to get an answer');
    } finally {
      setIsAsking(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading document..." />;
  }

  if (!document) {
    return (
      <View style={styles.container}>
        <Header title="Study" subtitle="Choose a document" />
        <ScrollView style={styles.content}>
          <DocumentSelector
            onDocumentSelect={handleSelectDocument}
            title="Study"
            subtitle="Select a document to open and study page-by-page"
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Study" subtitle={document.title} />

      <ScrollView style={styles.content}>
        <TouchableOpacity
          style={styles.backToActions}
          onPress={() => navigation.navigate('DocumentActions', { documentId: document.id })}
        >
          <Text style={styles.backToActionsText}>← Back to Features</Text>
        </TouchableOpacity>

        <Card>
          <Text style={styles.sectionTitle}>📄 Document Viewer</Text>

          <View style={styles.pageRow}>
            <TouchableOpacity style={styles.pageNavBtn} onPress={() => goToPage(currentPage - 1)}>
              <Text style={styles.pageNavText}>←</Text>
            </TouchableOpacity>

            <View style={styles.pageInfo}>
              <Text style={styles.pageLabel}>Page</Text>
              <Text style={styles.pageNumber}>{currentPage}</Text>
              <Text style={styles.pageMeta}>
                {totalPages > 0 ? `of ${totalPages}` : availablePages.length > 0 ? `(${availablePages.length} extracted)` : ''}
              </Text>
            </View>

            <TouchableOpacity style={styles.pageNavBtn} onPress={() => goToPage(currentPage + 1)}>
              <Text style={styles.pageNavText}>→</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.jumpRow}>
            <TextInput
              style={styles.jumpInput}
              value={jumpToPageText}
              onChangeText={setJumpToPageText}
              keyboardType="number-pad"
              placeholder="Page"
              placeholderTextColor={colors.textSecondary}
            />
            <Button title="Go" onPress={handleJump} />
          </View>

          <Text style={styles.pageTextTitle}>Extracted Text (this page)</Text>
          <View style={styles.pageTextBox}>
            <Text style={styles.pageText}>
              {pageText && pageText.trim().length > 0
                ? pageText
                : 'No extracted text for this page. Ask the Study Agent about the topic of this page.'}
            </Text>
          </View>

          {!pageText?.trim() && pageThumbUrl ? (
            <View style={styles.pageThumbWrap}>
              <Text style={styles.pageTextTitle}>Page Preview (image)</Text>
              <View style={styles.pageThumbBox}>
                <Image
                  source={{ uri: pageThumbUrl }}
                  style={styles.pageThumb}
                  resizeMode="contain"
                />
              </View>
            </View>
          ) : null}

          <Button
            title={isSummarizing ? 'Summarizing...' : 'Summarize This Page'}
            onPress={handleSummarizePage}
            disabled={isSummarizing}
            style={styles.primaryButton}
          />
        </Card>

        {isSummarizing && (
          <Card>
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Generating page summary...</Text>
            </View>
          </Card>
        )}

        {pageSummary ? (
          <Card>
            <Text style={styles.sectionTitle}>🧾 Page Summary</Text>
            <Text style={styles.summaryText}>{pageSummary}</Text>
          </Card>
        ) : null}

        <Card>
          <View style={styles.agentHeader}>
            <Text style={styles.sectionTitle}>🤖 Study Agent (GPT‑5.2)</Text>
            <TouchableOpacity
              style={styles.whiteboardButton}
              onPress={() => {
                setAgentMode('whiteboard');
                setWhiteboardVisible(true);
              }}
            >
              <Text style={styles.whiteboardText}>🧑‍🏫 Whiteboard</Text>
            </TouchableOpacity>
          </View>

          {agentMessages.length === 0 ? (
            <Text style={styles.agentHint}>Ask a question about this page, or open Whiteboard mode.</Text>
          ) : (
            <View style={styles.chatBox}>
              {agentMessages.map(m => (
                <View key={m.id} style={[styles.chatBubble, m.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                  <Text style={styles.chatRole}>{m.role === 'user' ? 'You' : 'AI'}</Text>
                  <Text style={styles.chatText}>{m.content}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.agentInputRow}>
            <TextInput
              style={styles.agentInput}
              value={agentInput}
              onChangeText={setAgentInput}
              placeholder="Ask anything..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, isAsking && styles.sendBtnDisabled]}
              onPress={handleAskAgent}
              disabled={isAsking}
            >
              <Text style={styles.sendBtnText}>{isAsking ? '...' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </Card>

        <TouchableOpacity
          style={styles.changeDoc}
          onPress={() => {
            setDocument(null);
            setPageSummary('');
            setAgentMessages([]);
          }}
        >
          <Text style={styles.changeDocText}>📚 Change Document</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={whiteboardVisible}
        animationType="slide"
        onRequestClose={() => {
          setWhiteboardVisible(false);
          setAgentMode('chat');
        }}
      >
        <View style={styles.whiteboardContainer}>
          <SafeAreaView style={styles.whiteboardHeader}>
            <TouchableOpacity
              style={styles.whiteboardIconButton}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              onPress={() => {
                console.log('[StudyScreen] Whiteboard close pressed');
                setWhiteboardVisible(false);
                setAgentMode('chat');
              }}
            >
              <Text style={styles.whiteboardClose}>✕</Text>
            </TouchableOpacity>

            <Text style={styles.whiteboardTitle}>Whiteboard</Text>

            <TouchableOpacity
              style={styles.whiteboardIconButton}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              onPress={() => navigation.navigate('DocumentActions', { documentId: document.id })}
            >
              <Text style={styles.whiteboardBack}>↩︎</Text>
            </TouchableOpacity>
          </SafeAreaView>

          <ScrollView style={styles.whiteboardBody}>
            <Text style={styles.whiteboardSubtitle}>
              Teaching mode. Ask anything — you’ll get tables, equations, and diagram blocks.
            </Text>

            {agentMessages.length > 0 ? (
              <View style={styles.chatBox}>
                {agentMessages.map(m => (
                  <View key={m.id} style={[styles.chatBubble, m.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                    <Text style={styles.chatRole}>{m.role === 'user' ? 'You' : 'AI'}</Text>
                    <Text style={styles.chatText}>{m.content}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.whiteboardInputRow}>
            <TextInput
              style={styles.agentInput}
              value={agentInput}
              onChangeText={setAgentInput}
              placeholder="Ask your question..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, isAsking && styles.sendBtnDisabled]}
              onPress={handleAskAgent}
              disabled={isAsking}
            >
              <Text style={styles.sendBtnText}>{isAsking ? '...' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 12 },
  backToActions: { paddingVertical: 10, alignItems: 'center' },
  backToActionsText: { color: colors.primary, fontWeight: '800' },
  pageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageNavBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNavText: { fontSize: 18, fontWeight: '800', color: colors.text },
  pageInfo: { alignItems: 'center' },
  pageLabel: { fontSize: 12, color: colors.textSecondary },
  pageNumber: { fontSize: 22, fontWeight: '900', color: colors.text },
  pageMeta: { fontSize: 12, color: colors.textSecondary },
  jumpRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 12 },
  jumpInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.cardBackground,
  },
  pageTextTitle: { marginTop: 12, fontSize: 13, fontWeight: '700', color: colors.text },
  pageTextBox: {
    marginTop: 8,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    maxHeight: 260,
  },
  pageThumbWrap: { marginTop: 12 },
  pageThumbBox: {
    marginTop: 8,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  pageThumb: { width: '100%', height: 260 },
  pageText: { color: colors.text, lineHeight: 18 },
  primaryButton: { marginTop: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },
  loadingText: { marginLeft: 10, color: colors.textSecondary },
  summaryText: { color: colors.text, lineHeight: 20 },
  agentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  agentHint: { color: colors.textSecondary, marginBottom: 12 },
  whiteboardButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  whiteboardText: { fontWeight: '800', color: colors.text },
  chatBox: { gap: 10 },
  chatBubble: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userBubble: { backgroundColor: colors.cardBackground },
  assistantBubble: { backgroundColor: colors.background },
  chatRole: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginBottom: 6 },
  chatText: { color: colors.text, lineHeight: 18 },
  agentInputRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 12, gap: 10 },
  agentInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.cardBackground,
    color: colors.text,
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  sendBtnDisabled: { opacity: 0.7 },
  sendBtnText: { color: '#fff', fontWeight: '800' },
  changeDoc: { alignItems: 'center', padding: 16 },
  changeDocText: { color: colors.primary, fontWeight: '800' },

  whiteboardContainer: { flex: 1, backgroundColor: colors.background },
  whiteboardHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  whiteboardIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whiteboardClose: { fontSize: 20, fontWeight: '900', color: colors.text },
  whiteboardTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  whiteboardBack: { fontSize: 18, fontWeight: '900', color: colors.text },
  whiteboardBody: { flex: 1, padding: 16 },
  whiteboardSubtitle: { color: colors.textSecondary, marginBottom: 12 },
  whiteboardInputRow: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
});
