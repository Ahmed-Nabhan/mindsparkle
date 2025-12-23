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
  Keyboard,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import ApiService from '../services/apiService';
import { usePremiumContext } from '../context/PremiumContext';
import { useDocument } from '../hooks/useDocument';
import type { MainDrawerScreenProps } from '../navigation/types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type ChatScreenProps = MainDrawerScreenProps<'Chat'>;

export const ChatScreen: React.FC = () => {
  const route = useRoute<ChatScreenProps['route']>();
  const navigation = useNavigation<ChatScreenProps['navigation']>();
  const { documentId, documentContent, documentTitle } = route.params;
  const { isPremium, features, dailyChatCount, incrementChatCount, showPaywall } = usePremiumContext();
  const { getDocument } = useDocument();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [content, setContent] = useState(documentContent || '');
  const flatListRef = useRef<FlatList>(null);

  // Load document content if not provided
  useEffect(() => {
    if (!content && documentId) {
      loadContent();
    }
  }, [documentId]);

  const loadContent = async () => {
    const doc = await getDocument(documentId);
    if (doc) {
      setContent(doc.content || '');
    }
  };

  // Document context for AI
  const documentContext = content;

  // Welcome message
  useEffect(() => {
    const welcomeMessage: Message = {
      id: 'welcome',
      role: 'assistant',
      content: `👋 Hi! I'm your AI study assistant. I've analyzed "${documentTitle || 'your document'}" and I'm ready to help!\n\nYou can ask me:\n• Questions about the content\n• To explain concepts in detail\n• For examples and applications\n• To quiz you on the material\n\nWhat would you like to know?`,
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  }, []);

  const canSendMessage = (): boolean => {
    if (isPremium) return true;
    const limit = features.maxChatMessages;
    if (limit === -1) return true;
    return dailyChatCount < limit;
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    
    // Check limit for free users
    if (!canSendMessage()) {
      showPaywall('Unlimited AI Chat');
      return;
    }

    const userMessage: Message = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    Keyboard.dismiss();
    setIsLoading(true);

    // Increment chat count for free users
    incrementChatCount();

    try {
      // Build conversation history for context
      const conversationHistory = messages
        .filter(m => m.id !== 'welcome')
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      const prompt = `You are a helpful AI tutor assistant. You have been given a document to help the user study.

DOCUMENT CONTENT:
${documentContext.substring(0, 6000)}

CONVERSATION HISTORY:
${conversationHistory}

USER QUESTION: ${userMessage.content}

Provide a helpful, accurate response based on the document content. If the question is not related to the document, politely redirect to the document topics. Use markdown formatting for better readability. Include examples where helpful.`;

      const response = await ApiService.chat(prompt);

      const assistantMessage: Message = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: '❌ Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    
    return (
      <View style={[
        styles.messageBubble,
        isUser ? styles.userBubble : styles.assistantBubble,
      ]}>
        {!isUser && (
          <View style={styles.avatarContainer}>
            <Text style={styles.avatar}>🤖</Text>
          </View>
        )}
        <View style={[
          styles.messageContent,
          isUser ? styles.userContent : styles.assistantContent,
        ]}>
          <Text style={[
            styles.messageText,
            isUser ? styles.userText : styles.assistantText,
          ]}>
            {item.content}
          </Text>
          <Text style={styles.timestamp}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        {isUser && (
          <View style={styles.avatarContainer}>
            <Text style={styles.avatar}>👤</Text>
          </View>
        )}
      </View>
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
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>💬 AI Chat</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {documentTitle || 'Your Document'}
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

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={canSendMessage() ? "Ask me anything about this document..." : "Upgrade to continue chatting"}
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
  userText: {
    color: '#fff',
  },
  assistantText: {
    color: colors.text,
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(0,0,0,0.4)',
    marginTop: 6,
    alignSelf: 'flex-end',
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
