import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { colors } from '../constants/colors';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import * as ApiService from '../services/apiService';
import type { Document } from '../types/document';
import type { MainDrawerScreenProps } from '../navigation/types';

type WhiteboardScreenProps = MainDrawerScreenProps<'Whiteboard'>;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

function buildDocContext(doc: Document | null): string {
  if (!doc) return '';
  const base = String(doc.content || '').trim();
  if (base.length > 0) return base.slice(0, 12000);

  const pages = doc.extractedData?.pages;
  if (!pages || pages.length === 0) return '';

  let acc = '';
  for (const p of pages.slice(0, 3)) {
    const t = String((p as any)?.text || '').trim();
    if (!t) continue;
    acc += (acc ? '\n\n' : '') + t.slice(0, 4000);
  }
  return acc.slice(0, 12000);
}

function getFirstPageText(doc: Document | null): string {
  if (!doc) return '';
  const pages = doc.extractedData?.pages;
  if (!pages || pages.length === 0) return '';

  const first = pages
    .slice()
    .sort((a: any, b: any) => Number(a?.pageNumber || 0) - Number(b?.pageNumber || 0))[0];
  return String((first as any)?.text || '').trim();
}

function buildWhiteboardPrompt(args: { docTitle: string; pageText: string; question: string }): string {
  return `WHITEBOARD MODE\nYou are an expert teacher. Teach the user clearly.\n\nConstraints:\n- Ground your answer in the document text when it is relevant.\n- If the document text is empty, say you don't have document text and proceed with general teaching.\n\nOutput format:\n- Start with a short explanation.\n- Include:\n  - Tables in Markdown when useful\n  - Equations in LaTeX when useful\n  - Diagrams as fenced blocks with label DIAGRAM, using simple ASCII boxes/lines.\n\nDocument: ${args.docTitle || 'Untitled'}\n\nDOCUMENT TEXT (may be partial):\n${args.pageText || '(empty)'}\n\nUser question:\n${args.question}`;
}

export const WhiteboardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<WhiteboardScreenProps['route']>();
  const { getDocument } = useDocument();

  const canvasRef = useRef<WebView>(null);

  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [agentInput, setAgentInput] = useState('');
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([]);
  const [isAsking, setIsAsking] = useState(false);

  const canvasHtml = useMemo(() => {
    const bg = colors.cardBackground;
    const stroke = colors.text;
    const grid = colors.border;
    return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <style>
      html, body { height: 100%; margin: 0; padding: 0; background: ${bg}; }
      #wrap { height: 100%; width: 100%; }
      canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    </style>
  </head>
  <body>
    <div id="wrap"><canvas id="c"></canvas></div>
    <script>
      (function() {
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let lastX = 0;
        let lastY = 0;

        function resize() {
          const dpr = window.devicePixelRatio || 1;
          const rect = canvas.getBoundingClientRect();
          const w = Math.max(1, Math.floor(rect.width * dpr));
          const h = Math.max(1, Math.floor(rect.height * dpr));
          if (canvas.width !== w || canvas.height !== h) {
            const img = ctx.getImageData(0, 0, canvas.width || 1, canvas.height || 1);
            canvas.width = w;
            canvas.height = h;
            ctx.scale(dpr, dpr);
            try { ctx.putImageData(img, 0, 0); } catch (e) {}
          }
        }

        function getPoint(e) {
          const rect = canvas.getBoundingClientRect();
          if (e.touches && e.touches.length) {
            return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
          }
          return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        function start(e) {
          e.preventDefault && e.preventDefault();
          drawing = true;
          const p = getPoint(e);
          lastX = p.x; lastY = p.y;
        }

        function move(e) {
          if (!drawing) return;
          e.preventDefault && e.preventDefault();
          const p = getPoint(e);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '${stroke}';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          lastX = p.x; lastY = p.y;
        }

        function end(e) {
          e.preventDefault && e.preventDefault();
          drawing = false;
        }

        function clearCanvas() {
          const rect = canvas.getBoundingClientRect();
          ctx.clearRect(0, 0, rect.width, rect.height);
          // subtle border grid line to indicate area
          ctx.strokeStyle = '${grid}';
          ctx.lineWidth = 1;
          ctx.strokeRect(0.5, 0.5, rect.width - 1, rect.height - 1);
        }

        window.clearCanvas = clearCanvas;

        window.addEventListener('resize', function(){ resize(); clearCanvas(); });
        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);

        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end, { passive: false });
        canvas.addEventListener('touchcancel', end, { passive: false });

        function handleMessage(event) {
          const msg = String(event && event.data || '').trim();
          if (msg === 'CLEAR') clearCanvas();
        }
        window.addEventListener('message', handleMessage);
        document.addEventListener('message', handleMessage);

        resize();
        clearCanvas();
      })();
    </script>
  </body>
</html>`;
  }, []);

  const handleClearDrawing = () => {
    try {
      canvasRef.current?.injectJavaScript(`window.clearCanvas && window.clearCanvas(); true;`);
    } catch {
      // no-op
    }
  };

  const docText = useMemo(() => {
    const firstPage = getFirstPageText(document);
    if (firstPage) return firstPage;
    return buildDocContext(document);
  }, [document]);

  const loadDocumentById = async (documentId: string) => {
    setIsLoading(true);
    try {
      const doc = await getDocument(documentId);
      if (!doc) {
        Alert.alert('Document Not Found', 'Could not load this document.');
        return;
      }
      setDocument(doc);
      setAgentMessages([]);
      setAgentInput('');
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    const documentId = route.params?.documentId;
    if (documentId) {
      loadDocumentById(documentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.documentId]);

  const handleAsk = async () => {
    if (!document) return;
    const question = agentInput.trim();
    if (!question) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: question };
    setAgentMessages(prev => [...prev, userMsg]);
    setAgentInput('');

    setIsAsking(true);
    try {
      const prompt = buildWhiteboardPrompt({
        docTitle: document.title,
        pageText: docText,
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
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: answer || 'No response.',
      };
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
        <SafeAreaView style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.headerButtonText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Whiteboard</Text>
          <View style={styles.headerButton} />
        </SafeAreaView>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No document selected.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          onPress={() => navigation.navigate('DocumentActions', { documentId: document.id })}
        >
          <Text style={styles.headerButtonText}>↩︎</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Whiteboard</Text>

        <TouchableOpacity
          style={styles.headerButton}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          onPress={() => navigation.navigate('DocumentActions', { documentId: document.id })}
        >
          <Text style={styles.headerButtonText}>✕</Text>
        </TouchableOpacity>
      </SafeAreaView>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.subtitle}>
          Teaching mode. Ask anything — you’ll get tables, equations, and diagram blocks.
        </Text>

        <View style={styles.drawingCard}>
          <View style={styles.drawingHeaderRow}>
            <Text style={styles.drawingTitle}>Draw</Text>
            <TouchableOpacity style={styles.clearBtn} onPress={handleClearDrawing}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.canvasWrap}>
            <WebView
              ref={canvasRef}
              originWhitelist={['*']}
              source={{ html: canvasHtml }}
              scrollEnabled={false}
              bounces={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              style={styles.canvas}
            />
          </View>
        </View>

        {agentMessages.length > 0 ? (
          <View style={styles.chatBox}>
            {agentMessages.map(m => (
              <View
                key={m.id}
                style={[styles.chatBubble, m.role === 'user' ? styles.userBubble : styles.assistantBubble]}
              >
                <Text style={styles.chatRole}>{m.role === 'user' ? 'You' : 'AI'}</Text>
                <Text style={styles.chatText}>{m.content}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {isAsking ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Thinking...</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={agentInput}
          onChangeText={setAgentInput}
          placeholder="Ask your question..."
          placeholderTextColor={colors.textSecondary}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, isAsking && styles.sendBtnDisabled]}
          onPress={handleAsk}
          disabled={isAsking}
        >
          <Text style={styles.sendBtnText}>{isAsking ? '...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: { fontSize: 18, fontWeight: '900', color: colors.text },
  body: { flex: 1, padding: 16 },
  bodyContent: { paddingBottom: 12 },
  subtitle: { color: colors.textSecondary, marginBottom: 12 },
  drawingCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    marginBottom: 12,
    overflow: 'hidden',
  },
  drawingHeaderRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawingTitle: { color: colors.text, fontWeight: '900' },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  clearBtnText: { color: colors.text, fontWeight: '800' },
  canvasWrap: { height: 220 },
  canvas: { flex: 1, backgroundColor: colors.cardBackground },
  chatBox: { gap: 10 },
  chatBubble: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  userBubble: { borderColor: colors.primary },
  assistantBubble: { borderColor: colors.border },
  chatRole: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginBottom: 4 },
  chatText: { color: colors.text },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  loadingText: { color: colors.textSecondary, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.cardBackground,
    maxHeight: 140,
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { color: '#FFFFFF', fontWeight: '800' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: colors.textSecondary, fontWeight: '700' },
});
