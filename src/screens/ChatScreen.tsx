import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Keyboard,
  Alert,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import ApiService from '../services/apiService';
import { supabase } from '../services/supabase';
import { usePremiumContext } from '../context/PremiumContext';
import { useDocument } from '../hooks/useDocument';
import type { MainDrawerScreenProps } from '../navigation/types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageDataUrl?: string;
  fileUrl?: string;
  fileName?: string;
  timestamp: Date;
}

type StoredMessage = Omit<Message, 'timestamp'> & { timestamp: number };

type ChatMindScreenProps = MainDrawerScreenProps<'ChatMind'>;
type DocChatScreenProps = MainDrawerScreenProps<'DocChat'>;

export const ChatScreen: React.FC = () => {
  const route = useRoute<ChatMindScreenProps['route'] | DocChatScreenProps['route']>();
  const navigation = useNavigation<ChatMindScreenProps['navigation']>();
  const { documentId, documentContent, documentTitle, agentId, agentName } = (route as any).params || {};
  const { isPremium, features, dailyChatCount, incrementChatCount, showPaywall } = usePremiumContext();
  const { getDocument } = useDocument();

  const [activeAgentId, setActiveAgentId] = useState<string>(agentId || 'general');
  const [activeAgentName, setActiveAgentName] = useState<string>(agentName || 'General Study Assistant');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false);
  const [isAgentsLoading, setIsAgentsLoading] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [content, setContent] = useState(documentContent || '');
  const flatListRef = useRef<FlatList>(null);

  const [chatMindMode, setChatMindMode] = useState<'general' | 'study' | 'work' | 'health'>('general');
  const [chatMindMemoryEnabled, setChatMindMemoryEnabled] = useState(false);

  const isChatMind = !documentId;
  const CHAT_MIND_STORAGE_KEY = 'chatMind:v1';
  const DOC_CHAT_STORAGE_PREFIX = 'docChat:v1';

  const storageKey = isChatMind
    ? CHAT_MIND_STORAGE_KEY
    : (documentId ? `${DOC_CHAT_STORAGE_PREFIX}:${documentId}` : null);

  const toStoredMessage = (m: Message): StoredMessage => ({
    ...m,
    timestamp: m.timestamp instanceof Date ? m.timestamp.getTime() : Date.now(),
  });

  const fromStoredMessage = (m: StoredMessage): Message => ({
    ...m,
    timestamp: new Date(typeof m.timestamp === 'number' ? m.timestamp : Date.now()),
  });

  const extractSources = (text: string): { main: string; sources: Array<{ idx: number; title: string; url: string }> } => {
    const raw = String(text || '');
    const m = raw.match(/\n\s*Sources\s*:\s*\n/i);
    if (!m || typeof m.index !== 'number') return { main: raw, sources: [] };

    const main = raw.slice(0, m.index).trimEnd();
    // Explicitly drop sources from UI output
    return { main, sources: [] };
  };

  const linkifyParts = (text: string): Array<{ type: 'text' | 'link'; value: string }> => {
    const raw = String(text || '');
    const re = /(https?:\/\/[^\s)]+)([).,;]*)(?=\s|$)/gi;
    const parts: Array<{ type: 'text' | 'link'; value: string }> = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const start = m.index;
      const end = re.lastIndex;
      if (start > lastIndex) parts.push({ type: 'text', value: raw.slice(lastIndex, start) });
      const url = m[1];
      const trailing = m[2] || '';
      parts.push({ type: 'link', value: url });
      if (trailing) parts.push({ type: 'text', value: trailing });
      lastIndex = end;
    }
    if (lastIndex < raw.length) parts.push({ type: 'text', value: raw.slice(lastIndex) });
    return parts;
  };

  const renderLinkifiedText = (text: string, textStyle: any, linkStyle: any) => {
    const parts = linkifyParts(text);
    return (
      <Text style={textStyle} selectable>
        {parts.map((p, i) =>
          p.type === 'link' ? (
            <Text key={`lnk-${i}`} style={linkStyle} onPress={() => safeOpenUrl(p.value)}>
              {p.value}
            </Text>
          ) : (
            <Text key={`txt-${i}`}>{p.value}</Text>
          )
        )}
      </Text>
    );
  };

  const safeOpenUrl = async (url: string) => {
    const u = String(url || '').trim();
    if (!u) return;
    try {
      const ok = await Linking.canOpenURL(u);
      if (!ok) return;
      await Linking.openURL(u);
    } catch {
      // ignore
    }
  };

  const splitByCodeFences = (text: string): Array<{ type: 'text' | 'code'; content: string; lang?: string }> => {
    const raw = String(text || '');
    if (!raw.includes('```')) return [{ type: 'text', content: raw }];

    const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
    const re = /```(\w+)?\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const start = m.index;
      const end = re.lastIndex;
      if (start > lastIndex) {
        parts.push({ type: 'text', content: raw.slice(lastIndex, start) });
      }
      const lang = m[1] ? String(m[1]).trim() : undefined;
      const code = String(m[2] || '').replace(/\s+$/g, '');
      parts.push({ type: 'code', content: code, lang });
      lastIndex = end;
    }
    if (lastIndex < raw.length) {
      parts.push({ type: 'text', content: raw.slice(lastIndex) });
    }
    return parts;
  };

  const renderAssistantContent = (text: string) => {
    const blocks = splitByCodeFences(text);
    return (
      <View>
        {blocks.map((b, idx) => {
          if (b.type === 'code') {
            return (
              <View key={`code-${idx}`} style={styles.codeBlock}>
                {b.lang ? <Text style={styles.codeLang}>{b.lang}</Text> : null}
                <Text style={styles.codeText} selectable>
                  {b.content}
                </Text>
              </View>
            );
          }

          const t = String(b.content || '');
          if (!t.trim()) return null;
          return (
            <View key={`txt-${idx}`}>
              {renderLinkifiedText(t.trim(), [styles.messageText, styles.assistantText], styles.linkText)}
            </View>
          );
        })}
      </View>
    );
  };

  const normalizeStreamDelta = (raw: string): string => {
    const s = String(raw ?? '');
    if (!s) return '';

    // If the delta accidentally includes SSE framing (e.g. when a stream response is treated as plain text),
    // extract only the JSON text payloads.
    if (s.includes('data:')) {
      const out: string[] = [];
      const lines = s.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.replace(/^data:\s*/, '');
        if (!payload || payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          const t = typeof obj?.text === 'string' ? obj.text : '';
          if (t) out.push(t);
        } catch {
          // If it's not JSON, keep the payload as-is.
          out.push(payload);
        }
      }
      return out.length > 0 ? out.join('') : s;
    }

    // If the delta is a JSON object string, extract .text.
    const trimmed = s.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        const t = typeof obj?.text === 'string' ? obj.text : '';
        return t || s;
      } catch {
        return s;
      }
    }

    return s;
  };

  // Load document content if not provided
  useEffect(() => {
    if (!content && documentId) {
      loadContent(documentId);
    }
  }, [documentId]);

  // Restore chat history on mount (separately for Chat Mind vs Doc Chat).
  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw);

        const storedMessages: StoredMessage[] = Array.isArray(parsed?.messages) ? parsed.messages : [];
        const restored = storedMessages
          .slice(-50)
          .map((m) => fromStoredMessage(m))
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant'));

        if (!cancelled && restored.length > 0) {
          // Sanitize any previously-persisted SSE framing (e.g. "data: {...}")
          // so it can't show up in the UI after an update.
          const cleaned = restored.map((m) =>
            m.role === 'assistant' ? { ...m, content: normalizeStreamDelta(m.content) } : m
          );
          setMessages(cleaned);
        }

        const savedAgentId = typeof parsed?.activeAgentId === 'string' ? parsed.activeAgentId : null;
        const savedAgentName = typeof parsed?.activeAgentName === 'string' ? parsed.activeAgentName : null;
        if (!cancelled && savedAgentId) setActiveAgentId(savedAgentId);
        if (!cancelled && savedAgentName) setActiveAgentName(savedAgentName);

        if (!cancelled && storageKey === CHAT_MIND_STORAGE_KEY) {
          const savedMode = typeof parsed?.chatMindMode === 'string' ? parsed.chatMindMode : null;
          if (savedMode === 'general' || savedMode === 'study' || savedMode === 'work' || savedMode === 'health') {
            setChatMindMode(savedMode);
          }
          const savedMem = typeof parsed?.chatMindMemoryEnabled === 'boolean' ? parsed.chatMindMemoryEnabled : null;
          if (savedMem != null) setChatMindMemoryEnabled(Boolean(savedMem));
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist chat history whenever it changes (separate keys).
  useEffect(() => {
    if (!storageKey) return;
    (async () => {
      try {
        const payload = {
          version: 1,
          activeAgentId,
          activeAgentName,
          ...(storageKey === CHAT_MIND_STORAGE_KEY
            ? {
                chatMindMode,
                chatMindMemoryEnabled,
              }
            : {}),
          messages: messages
            .filter((m) => m && m.id !== 'welcome')
            .slice(-50)
            .map((m) => toStoredMessage(m)),
        };

        await AsyncStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {
        // ignore
      }
    })();
  }, [storageKey, messages, activeAgentId, activeAgentName]);

  const loadContent = async (docId: string) => {
    try {
      const doc = await getDocument(docId);
      if (doc) {
        // Try multiple sources for content
        let contentToUse = doc.content || '';

        if ((!contentToUse || contentToUse.length < 100) && doc.extractedData?.pages) {
          const MAX_CONTEXT = 200000;
          const MAX_PAGE_SNIPPET = 4000;
          let acc = '';
          for (const p of doc.extractedData.pages as any[]) {
            if (acc.length >= MAX_CONTEXT) break;
            const t = String(p?.text || '').trim();
            if (!t) continue;
            const next = t.slice(0, MAX_PAGE_SNIPPET);
            acc += (acc ? '\n\n' : '') + next;
          }
          contentToUse = acc;
          console.log('[Chat] Using extractedData.pages:', contentToUse.length, 'chars');
        }

        // Fallback 2: Try extracted data text
        if ((!contentToUse || contentToUse.length < 100) && doc.extractedData?.text) {
          contentToUse = doc.extractedData.text;
          console.log('[Chat] Using extractedData.text:', contentToUse.length, 'chars');
        }

        // Fallback 3: Try chunks
        if ((!contentToUse || contentToUse.length < 100) && Array.isArray((doc as any).chunks) && (doc as any).chunks.length > 0) {
          contentToUse = (doc as any).chunks.join('\n\n');
          console.log('[Chat] Using chunks:', contentToUse.length, 'chars');
        }

        setContent(contentToUse);
        console.log('[Chat] Loaded content:', contentToUse.length, 'chars');
      }
    } catch {
      // ignore
    }
  };

  // Document context for AI
  const documentContext = content;

  // Welcome message
  useEffect(() => {
    const welcomeMessage: Message = {
      id: 'welcome',
      role: 'assistant',
      content: documentId
        ? `👋 Hi! I'm your AI study assistant. I've analyzed "${documentTitle || 'your document'}" and I'm ready to help!\n\nYou can ask me:\n• Questions about the content\n• To explain concepts in detail\n• For examples and applications\n• To quiz you on the material\n\nWhat would you like to know?`
        : `👋 Hi! I'm your AI assistant${activeAgentName ? ` (${activeAgentName})` : ''}.\n\nAsk me anything about your study topics, exam prep, or concepts you want to learn.\n\nWhat are you working on today?`,
      timestamp: new Date(),
    };
    setMessages((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : [welcomeMessage]));
  }, []);

  useEffect(() => {
    if (!isAgentPickerOpen || agents.length > 0 || isAgentsLoading) return;

    (async () => {
      try {
        setIsAgentsLoading(true);
        const list = await ApiService.listAgents();
        const normalized = Array.isArray(list) ? list : [];
        setAgents(normalized);

        // Ensure we always have a sensible default
        if (!activeAgentId || !normalized.some(a => a.id === activeAgentId)) {
          const general = normalized.find(a => a.id === 'general') || normalized[0];
          if (general) {
            setActiveAgentId(general.id);
            setActiveAgentName(general.name);
          }
        }
      } catch (e) {
        setAgents([{ id: 'general', name: 'General Study Assistant' }]);
      } finally {
        setIsAgentsLoading(false);
      }
    })();
  }, [isAgentPickerOpen, agents.length, isAgentsLoading, activeAgentId]);

  const canSendMessage = (): boolean => {
    if (isPremium) return true;
    const limit = features.maxChatMessages;
    if (limit === -1) return true;
    return dailyChatCount < limit;
  };

  const clearChatMind = async () => {
    if (!isChatMind) return;

    Alert.alert(
      'Clear chat?',
      'This will remove the current Chat Mind conversation on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsLoading(false);
              setInputText('');
              Keyboard.dismiss();

              // Remove persisted history first so it doesn't immediately restore.
              await AsyncStorage.removeItem(CHAT_MIND_STORAGE_KEY);

              const welcomeMessage: Message = {
                id: 'welcome',
                role: 'assistant',
                content: `👋 Hi! I'm your AI assistant${activeAgentName ? ` (${activeAgentName})` : ''}.\n\nAsk me anything about your study topics, exam prep, or concepts you want to learn.\n\nWhat are you working on today?`,
                timestamp: new Date(),
              };
              setMessages([welcomeMessage]);
            } catch {
              // Even if storage fails, at least clear in-memory state.
              setMessages([]);
            }
          },
        },
      ]
    );
  };

  const handleMessageLongPress = (msg: Message) => {
    const content = String(msg?.content || '');
    Alert.alert('Message', 'Choose an action', [
      {
        text: 'Copy',
        onPress: async () => {
          try {
            await Clipboard.setStringAsync(content);
          } catch {
            // ignore
          }
        },
      },
      {
        text: 'Reply',
        onPress: () => setReplyTo(msg),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    let isAuthed = false;
    try {
      const { data } = await supabase.auth.getSession();
      isAuthed = Boolean(data?.session?.access_token);
    } catch {
      isAuthed = false;
    }
    
    // Check limit for free users
    if (!canSendMessage()) {
      if (!isAuthed) {
        Alert.alert(
          '💬 Chat limit reached',
          `You reached today's free limit (${features.maxChatMessages}). Sign in to unlock Pro and get unlimited chats.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Sign in', onPress: () => navigation.navigate('Auth', { mode: 'signin' } as any) },
          ]
        );
      } else {
        Alert.alert(
          '💬 Chat limit reached',
          `Free plan includes ${features.maxChatMessages === -1 ? 'unlimited' : features.maxChatMessages} chat messages per day.\n\nSubscribe to Pro to get unlimited chats.`,
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Upgrade to Pro',
              onPress: () => navigation.navigate('Paywall', { source: 'Unlimited AI Chat' }),
            },
          ]
        );
      }
      return;
    }

    const trimmed = inputText.trim();
    const replySnippet = replyTo ? String(replyTo.content || '').slice(0, 500) : '';
    const userMessageText = replyTo
      ? `Replying to ${replyTo.role}:\n${replySnippet}\n\n${trimmed}`
      : trimmed;

    // Export files (downloadable): /export (notes|study_guide|flashcards|quiz)
    const exportMatch = userMessageText.match(/^\/(?:export|download)(?:\s+(notes|study_guide|studyguide|flashcards|quiz|report|reports))?\s*([\s\S]{0,300})$/i);
    const exportKindRaw = (exportMatch?.[1] || '').trim().toLowerCase();
    const exportMessage = (exportMatch?.[2] || '').trim();
    const isExportRequest = Boolean(exportMatch);
    const exportKind: 'notes' | 'study_guide' | 'flashcards_csv' | 'quiz_json' | 'report' =
      exportKindRaw === 'studyguide' || exportKindRaw === 'study_guide'
        ? 'study_guide'
        : exportKindRaw === 'flashcards'
          ? 'flashcards_csv'
          : exportKindRaw === 'quiz'
            ? 'quiz_json'
            : exportKindRaw === 'report' || exportKindRaw === 'reports'
              ? 'report'
            : 'notes';

    // Image generation:
    // - Explicit: /image <prompt> or image: <prompt>
    // - Optional mode: /image (default|realism|premium|mj|midjourney|nb|nano|banana) <prompt>
    // - Natural language: "create image of ..." / "ارسم صورة ..."
    const explicitImageMatch =
      userMessageText.match(/^\/(?:image|img)(?:\s+(default|realism|premium|mj|midjourney|nb|nano|banana))?\s+([\s\S]{1,1200})$/i) ||
      userMessageText.match(/^image:\s*(?:(default|realism|premium|mj|midjourney|nb|nano|banana)\s*[:\-])?\s*([\s\S]{1,1200})$/i);

    const naturalImageMatch =
      // English variants
      userMessageText.match(/^(?:create|generate|make|draw)\s+(?:an?\s+)?(?:image|picture|photo|icon)(?:\s+(?:of|showing|about)|\s*[:\-])?\s*([\s\S]{1,1200})$/i) ||
      userMessageText.match(/^(?:image|picture|photo)\s+(?:of|showing|about)\s+([\s\S]{1,1200})$/i) ||
      userMessageText.match(/^(?:create|generate|make|draw)\s+(?:an?\s+)?(?:diagram|flowchart|chart|architecture\s+diagram|network\s+diagram)(?:\s+(?:of|showing|about|for|on)|\s*[:\-])?\s*([\s\S]{1,1200})$/i) ||
      userMessageText.match(/^(?:diagram|flowchart|architecture\s+diagram|network\s+diagram)\s+(?:of|showing|about|for|on)\s+([\s\S]{1,1200})$/i) ||
      // Arabic variants
      userMessageText.match(/^(?:صمم|اعمل|انشئ|أنشئ|ارسم)\s+(?:صورة|صوره)\s*(?:عن|لـ|:|\-)?\s*([\s\S]{1,1200})$/i) ||
      userMessageText.match(/^(?:صمم|اعمل|انشئ|أنشئ|ارسم)\s+(?:مخطط|دايغرام|diagram|رسم\s+تخطيطي)\s*(?:عن|لـ|:|\-)?\s*([\s\S]{1,1200})$/i) ||
      userMessageText.match(/^(?:صورة|صوره)\s*(?:عن|لـ)?\s*([\s\S]{1,1200})$/i);

    const explicitMode = (explicitImageMatch?.[1] || explicitImageMatch?.[2] || '').trim().toLowerCase();
    const imageMode: 'default' | 'realism' | 'premium' =
      explicitMode === 'premium' || explicitMode === 'mj' || explicitMode === 'midjourney'
        ? 'premium'
        : explicitMode === 'realism' || explicitMode === 'nb' || explicitMode === 'nano' || explicitMode === 'banana'
          ? 'realism'
          : 'default';

    const imagePrompt = (explicitImageMatch?.[2] || explicitImageMatch?.[3] || naturalImageMatch?.[1] || naturalImageMatch?.[2] || '').trim();
    const isImageRequest = Boolean(explicitImageMatch || naturalImageMatch || /^\/(?:image|img)\b/i.test(userMessageText) || /^image:\s*$/i.test(userMessageText));
    const userMessage: Message = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: userMessageText,
      timestamp: new Date(),
    };

    const pendingId = `assistant_pending_${Date.now()}`;
    const pendingMessage: Message = {
      id: pendingId,
      role: 'assistant',
      content: isExportRequest ? 'Preparing your file…' : 'Thinking…',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage, pendingMessage]);
    setInputText('');
    setReplyTo(null);
    Keyboard.dismiss();
    setIsLoading(true);

    // Increment chat count for free users
    incrementChatCount();

    const buildRelevantContext = (fullText: string, question: string): string => {
      const text = String(fullText || '');
      if (!text.trim()) return '';

      // Keep some head context (useful for titles/introductions)
      const head = text.slice(0, 1500);

      const qTokens = question
        .toLowerCase()
        .split(/[^a-z0-9\u0600-\u06FF]+/i)
        .filter(t => t.length >= 3)
        .slice(0, 20);

      // Chunk the doc into windows and score by token overlap
      const chunkSize = 900;
      const maxChunks = 60;
      const chunks: { idx: number; text: string; score: number }[] = [];
      for (let i = 0; i < Math.min(text.length, chunkSize * maxChunks); i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        const lower = chunk.toLowerCase();
        let score = 0;
        for (const tok of qTokens) {
          if (lower.includes(tok)) score += 1;
        }
        // Small boost if chunk contains headings/bullets
        if (/\n\s*#+\s+|\n\s*[-•]\s+/.test(chunk)) score += 0.5;
        chunks.push({ idx: i, text: chunk, score });
      }

      const top = chunks
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .filter(c => c.score > 0);

      const body = top.length > 0 ? top.map(c => c.text).join('\n\n---\n\n') : text.slice(0, 4500);
      const combined = `${head}\n\n---\n\n${body}`;
      return combined.slice(0, 9000);
    };

    try {
      if (isExportRequest) {
        const relevantContext = buildRelevantContext(documentContext, userMessageText);
        const history = messages
          .filter(m => m.id !== 'welcome')
          .slice(-8)
          .map(m => ({ role: m.role, content: m.content }));

        const res = await ApiService.exportFile({
          kind: exportKind,
          message: exportMessage,
          context: relevantContext,
          history,
          agentId: activeAgentId,
        });

        setMessages(prev => prev.map(m => (
          m.id === pendingId
            ? {
                ...m,
                content: `✅ File ready: ${res.filename}`,
                fileUrl: res.url,
                fileName: res.filename,
              }
            : m
        )));
      } else if (isImageRequest) {
        if (!imagePrompt) throw new Error('Missing prompt. Try: /image mj a sparkle brain studying, neon style');
        const imageDataUrl = await ApiService.generateImage(imagePrompt, { imageMode });
        setMessages(prev => prev.map(m => (m.id === pendingId ? { ...m, content: 'Generated image:', imageDataUrl } : m)));
      } else {
        const relevantContext = buildRelevantContext(documentContext, userMessageText);
        const history = messages
          .filter(m => m.id !== 'welcome')
          .slice(-8)
          .map(m => ({ role: m.role, content: m.content }));

        // Stream response for speed.
        let acc = '';
        setMessages(prev => prev.map(m => (m.id === pendingId ? { ...m, content: '' } : m)));

        const apiAny: any = ApiService as any;
        const preferredStreamFn = isChatMind ? apiAny.chatMindStream : apiAny.docChatStream;
        const streamFnToUse: any = typeof preferredStreamFn === 'function' ? preferredStreamFn : ApiService.chatStream;

        try {
          const onDelta = (delta: string) => {
            const cleaned = normalizeStreamDelta(delta);
            if (!cleaned) return;
            acc += cleaned;
            // Update pending message progressively
            setMessages(prev => prev.map(m => (m.id === pendingId ? { ...m, content: acc } : m)));
          };

          const onError = (err: any) => {
            console.warn('chatStream error:', err?.message || err);
          };

          if (isChatMind) {
            await streamFnToUse(
              userMessageText,
              '',
              history,
              activeAgentId,
              onDelta,
              undefined,
              onError,
              {
                mode: chatMindMode,
                memoryEnabled: chatMindMemoryEnabled,
              }
            );
          } else {
            await streamFnToUse(
              userMessageText,
              relevantContext,
              history,
              activeAgentId,
              onDelta,
              undefined,
              onError
            );
          }
        } catch (e: any) {
          console.warn('chatStream failed, falling back:', e?.message || e);
        }

        if (!acc.trim()) {
          // Fallback to non-streaming (and guard against any accidental SSE text)
          const apiAny: any = ApiService as any;
          const response = isChatMind
            ? (typeof apiAny.chatMind === 'function'
              ? await apiAny.chatMind(userMessageText, history, activeAgentId, { mode: chatMindMode, memoryEnabled: chatMindMemoryEnabled })
                : await ApiService.chat(userMessageText, '', history, activeAgentId))
            : (typeof apiAny.docChat === 'function'
                ? await apiAny.docChat(userMessageText, relevantContext, history, activeAgentId)
                : await ApiService.chat(userMessageText, relevantContext, history, activeAgentId));
          const cleaned = normalizeStreamDelta(response);
          setMessages(prev => prev.map(m => (
            m.id === pendingId
              ? { ...m, content: cleaned || response || 'No response received. Please try again.' }
              : m
          )));
        }
      }
    } catch (error: any) {
      let msg = typeof error?.message === 'string' && error.message.trim().length > 0
        ? error.message
        : 'Sorry, I encountered an error. Please try again.';

      const status = error?.status || error?.response?.status;
      const isAuthError = status === 401 || status === 403 || /please\s+sign\s+in/i.test(msg);

      if (isImageRequest) {
        const lower = msg.toLowerCase();
        if (lower.includes('openai_api_key') || lower.includes('not configured')) {
          msg = 'Image generation is not available right now (server not configured).';
        }
        if (lower.includes('missing image prompt') || lower.includes('missing prompt')) {
          msg = 'Missing prompt. Try: /image mj a sparkle brain studying, neon style';
        }
      }

      if (isAuthError) {
        Alert.alert(
          'Sign in required',
          'Please sign in to use AI chat features.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Sign in', onPress: () => navigation.navigate('Auth', { mode: 'signin' } as any) },
          ]
        );
      }
      setMessages(prev => prev.map(m => (m.id === pendingId ? { ...m, content: `❌ ${msg}` } : m)));
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const parsed = !isUser ? extractSources(item.content) : { main: item.content, sources: [] as any[] };
    
    return (
      <TouchableOpacity
        activeOpacity={1}
        onLongPress={() => handleMessageLongPress(item)}
        style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}
      >
        {!isUser && (
          <View style={styles.avatarContainer}>
            <Text style={styles.avatar}>🧠</Text>
          </View>
        )}

        <View style={[styles.messageContent, isUser ? styles.userContent : styles.assistantContent]}>
          {isUser ? (
            !!parsed.main && (
              renderLinkifiedText(parsed.main, [styles.messageText, styles.userText], styles.linkText)
            )
          ) : (
            !!parsed.main && renderAssistantContent(parsed.main)
          )}
          {!!item.imageDataUrl && (
            <Image source={{ uri: item.imageDataUrl }} style={styles.messageImage} resizeMode="cover" />
          )}
          {!!item.fileUrl && (
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={() => {
                const url = String(item.fileUrl || '');
                if (!url) return;
                Linking.openURL(url).catch(() => {});
              }}
            >
              <Text style={styles.downloadButtonText}>Download</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.timestamp}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        {isUser && (
          <View style={styles.avatarContainer}>
            <Text style={styles.avatar}>👤</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const suggestedQuestions = [
    "Summarize the main points",
    "Explain this in simple terms",
    "Give me an example",
    "Quiz me on this topic",
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (documentId) (navigation as any).navigate('DocumentActions', { documentId });
            else navigation.goBack();
          }}
        >
          <Text style={styles.backButton}>{documentId ? '← Actions' : '← Back'}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>💬 {documentId ? (activeAgentName ? activeAgentName : 'AI Chat') : 'Chat Mind'}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {documentId ? (documentTitle || (activeAgentName ? 'Chat' : 'Your Document')) : (activeAgentName || 'General')}
          </Text>
        </View>
        {!isPremium && (
          <View style={styles.limitBadge}>
            <Text style={styles.limitText}>
              {features.maxChatMessages - dailyChatCount} left
            </Text>
          </View>
        )}
      </View>

      {isChatMind && (
        <View style={styles.chatMindControls}>
          <View style={styles.modeRow}>
            {([
              { id: 'general', label: 'General' },
              { id: 'study', label: 'Study' },
              { id: 'work', label: 'Work' },
              { id: 'health', label: 'Health' },
            ] as const).map((m) => {
              const selected = chatMindMode === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.modeChip, selected && styles.modeChipSelected]}
                  onPress={() => setChatMindMode(m.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Set mode to ${m.label}`}
                >
                  <Text style={[styles.modeChipText, selected && styles.modeChipTextSelected]}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.memoryRow}>
            <TouchableOpacity
              onPress={() => {
                if (chatMindMemoryEnabled) {
                  setChatMindMemoryEnabled(false);
                  return;
                }
                Alert.alert(
                  'Enable Memory?',
                  'When enabled, ChatMind can save a short summary of your preferences to improve future replies. You can turn it off anytime and tap Forget to delete it.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Enable', onPress: () => setChatMindMemoryEnabled(true) },
                  ]
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="Toggle memory"
              style={[styles.memoryToggle, chatMindMemoryEnabled && styles.memoryToggleOn]}
            >
              <Text style={[styles.memoryToggleText, chatMindMemoryEnabled && styles.memoryToggleTextOn]}>
                Memory: {chatMindMemoryEnabled ? 'On' : 'Off'}
              </Text>
            </TouchableOpacity>

            <View style={styles.memoryActions}>
              <TouchableOpacity
                onPress={clearChatMind}
                accessibilityRole="button"
                accessibilityLabel="Clear chat"
                style={[styles.forgetButton, styles.clearChatButton]}
                disabled={isLoading}
              >
                <Text style={styles.forgetButtonText}>Clear chat</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  Alert.alert('Forget memory?', 'This will delete your saved ChatMind memory.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Forget',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          const apiAny: any = ApiService as any;
                          if (typeof apiAny.chatMindMemoryClear === 'function') {
                            await apiAny.chatMindMemoryClear();
                          }
                          Alert.alert('Done', 'Saved memory deleted.');
                        } catch {
                          Alert.alert('Error', 'Could not delete memory. Please try again.');
                        }
                      },
                    },
                  ]);
                }}
                accessibilityRole="button"
                accessibilityLabel="Forget memory"
                style={styles.forgetButton}
              >
                <Text style={styles.forgetButtonText}>Forget</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        showsVerticalScrollIndicator={false}
      />

      {/* Suggested Questions - only show when few messages */}
      {messages.length <= 2 && !isLoading && (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.suggestionsLabel}>Try asking:</Text>
          <View style={styles.suggestions}>
            {suggestedQuestions.map((question, index) => (
              <TouchableOpacity
                key={index}
                style={styles.suggestionChip}
                onPress={() => setInputText(question)}
              >
                <Text style={styles.suggestionText}>{question}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Thinking...</Text>
        </View>
      )}

      {/* Agent picker (inline, non-modal) */}
      <View style={styles.agentBar}>
        <TouchableOpacity
          onPress={() => setIsAgentPickerOpen(prev => !prev)}
          accessibilityRole="button"
          accessibilityLabel="Select agent"
        >
          <Text style={styles.agentBarText} numberOfLines={1}>
            Agent: {activeAgentName}
          </Text>
        </TouchableOpacity>
        <View style={styles.agentBarActions}>
          <TouchableOpacity onPress={() => navigation.navigate('Agents')}>
            <Text style={styles.agentBarAction}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsAgentPickerOpen(prev => !prev)}>
            <Text style={styles.agentBarAction}>{isAgentPickerOpen ? 'Hide' : 'Change'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isAgentPickerOpen && (
        <View style={styles.agentPicker}>
          {isAgentsLoading ? (
            <View style={styles.agentPickerLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.agentPickerLoadingText}>Loading agents…</Text>
            </View>
          ) : (
            <View style={styles.agentList}>
              {(agents.length > 0 ? agents : [{ id: 'general', name: 'General Study Assistant' }]).map(a => {
                const isSelected = a.id === activeAgentId;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.agentItem, isSelected && styles.agentItemSelected]}
                    onPress={() => {
                      setActiveAgentId(a.id);
                      setActiveAgentName(a.name);
                      setIsAgentPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.agentItemName, isSelected && styles.agentItemNameSelected]} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* Input */}
      {replyTo && (
        <View style={styles.replyBar}>
          <View style={styles.replyTextWrap}>
            <Text style={styles.replyLabel}>Replying to {replyTo.role}</Text>
            <Text style={styles.replySnippet} numberOfLines={1}>{replyTo.content}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Text style={styles.replyClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={
            canSendMessage()
              ? (isChatMind ? 'Ask me anything…' : 'Ask me anything about this document…')
              : 'Upgrade to continue chatting'
          }
          placeholderTextColor={colors.textLight}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={500}
          editable={!isLoading && canSendMessage()}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!inputText.trim() || isLoading) && styles.sendButtonDisabled,
          ]}
          onPress={sendMessage}
          disabled={!inputText.trim() || isLoading}
        >
          <Text style={styles.sendButtonText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: colors.primary,
    gap: 12,
  },
  chatMindControls: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  modeChipTextSelected: {
    color: colors.textLight,
  },
  memoryRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  memoryToggle: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    flex: 1,
  },
  memoryToggleOn: {
    borderColor: colors.primary,
  },
  memoryToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  memoryToggleTextOn: {
    color: colors.primary,
  },
  forgetButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clearChatButton: {
    // Keep the same visual style; just add spacing via a separate style hook.
  },
  forgetButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  backButton: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 2,
  },
  limitBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  limitText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  messageList: {
    padding: 16,
    paddingBottom: 100,
  },
  messageBubble: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-end',
  },
  userBubble: {
    justifyContent: 'flex-end',
  },
  assistantBubble: {
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  avatar: {
    fontSize: 20,
  },
  messageContent: {
    maxWidth: '75%',
    borderRadius: 20,
    padding: 14,
  },
  userContent: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  assistantContent: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  linkText: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  userText: {
    color: '#fff',
  },
  assistantText: {
    color: colors.text,
  },
  messageImage: {
    width: 240,
    height: 240,
    borderRadius: 12,
    marginTop: 10,
    backgroundColor: colors.surface,
  },
  downloadButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  downloadButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(0,0,0,0.4)',
    marginTop: 6,
    alignSelf: 'flex-end',
  },

  sourcesBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: colors.cardBackground,
  },
  sourcesTitle: {
    color: colors.textSecondary,
    fontWeight: '800',
    marginBottom: 6,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  sourceIndex: { color: colors.textSecondary, fontWeight: '800' },
  sourceText: { flex: 1, color: colors.text, fontWeight: '700' },

  codeBlock: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: colors.surface,
  },
  codeLang: {
    color: colors.textSecondary,
    fontWeight: '800',
    marginBottom: 6,
  },
  codeText: {
    color: colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 18,
  },
  suggestionsContainer: {
    padding: 16,
    paddingTop: 0,
  },
  suggestionsLabel: {
    fontSize: 14,
    color: colors.textLight,
    marginBottom: 10,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionText: {
    fontSize: 13,
    color: colors.primary,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 8,
  },
  loadingText: {
    color: colors.textLight,
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    paddingBottom: 30,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  replyTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  replyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  replySnippet: {
    fontSize: 12,
    color: colors.text,
  },
  replyClose: {
    fontSize: 16,
    color: colors.textSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  agentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  agentBarText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 240,
  },
  agentBarAction: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  agentBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  agentPicker: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  agentPickerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  agentPickerLoadingText: {
    color: colors.textLight,
    fontSize: 13,
  },
  agentList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 10,
  },
  agentItem: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    maxWidth: '100%',
  },
  agentItemSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  agentItemName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  agentItemNameSelected: {
    color: '#fff',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
});

export default ChatScreen;
