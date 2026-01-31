import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, Modal, TouchableOpacity, SafeAreaView, Image } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Header } from '../components/Header';
import { Button } from '../components/Button';
import { LoadingSpinner } from '../components/LoadingSpinner';
import ApiService from '../services/apiService';
import { useDocument } from '../hooks/useDocument';
import { useDocumentContext } from '../context/DocumentContext';
import { usePremiumContext } from '../context/PremiumContext';
import { VENDOR_CONFIGS, vendorDetector } from '../services/documentIntelligence/vendorDetector';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';
import { supabase } from '../services/supabase';
import { buildVendorDisplay } from '../utils/qualityControls';

/**
 * DocumentActionsScreen - Shows available actions for a document
 * 
 * REAL-TIME INTEGRATION:
 * - Subscribes to document-specific changes on mount
 * - Receives instant updates when AI processing completes
 * - Unsubscribes on unmount to prevent memory leaks
 * 
 * @component
 */

type DocumentActionsScreenProps = MainDrawerScreenProps<'DocumentActions'>;

export const DocumentActionsScreen:  React.FC = () => {
  const route = useRoute<DocumentActionsScreenProps['route']>();
  const navigation = useNavigation<DocumentActionsScreenProps['navigation']>();
  const { getDocument } = useDocument();
  const { isPremium } = usePremiumContext();
  
  // Get real-time context values
  const { 
    subscribeToDocument, 
    unsubscribeFromDocument,
    documentAnalysis,
    documentSummaries,
    isProcessing,
    processingMessage,
    loadStoredAIData,
  } = useDocumentContext();
  
  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showYoutube, setShowYoutube] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeQueries, setYoutubeQueries] = useState<string[]>([]);
  const [selectedYoutubeQueryIndex, setSelectedYoutubeQueryIndex] = useState(0);
  const [vendorCandidates, setVendorCandidates] = useState<Array<{ name: string; confidence?: number }>>([]);
  const [fallbackVendor, setFallbackVendor] = useState<{
    vendorId?: string;
    vendorName?: string;
    vendorConfidence?: number;
  } | null>(null);

  /**
   * Load document and subscribe to real-time updates on mount
   * This ensures we get instant updates when:
   * - AI processing status changes
   * - New summaries are generated
   * - Knowledge graph is built
   */
  useEffect(() => {
    const documentId = route.params.documentId;
    let cancelled = false;

    // Reset local state immediately so we never show the previous document while loading.
    setIsLoading(true);
    setDocument(null);
    setVendorCandidates([]);
    setFallbackVendor(null);

    // Close any document-scoped modals when switching docs.
    setShowYoutube(false);
    setYoutubeUrl('');
    setYoutubeQueries([]);
    setSelectedYoutubeQueryIndex(0);

    // Subscribe to real-time updates for this document
    subscribeToDocument(documentId);
    // Load any existing AI data from Supabase
    loadStoredAIData(documentId);

    // Load document content from local storage
    (async () => {
      const doc = await getDocument(documentId);
      if (cancelled) return;
      setDocument(doc);
      setIsLoading(false);
    })();

    // Load document_insights vendor candidates (optional)
    ;(async () => {
      try {
        const { data } = await supabase
          .from('document_insights')
          .select('vendor_candidates')
          .eq('document_id', documentId)
          .single();

        if (cancelled) return;
        const raw = (data as any)?.vendor_candidates;
        const list = Array.isArray(raw) ? raw : [];
        const cleaned = list
          .map((v: any) => ({
            name: String(v?.name || '').trim(),
            confidence: typeof v?.confidence === 'number' ? v.confidence : undefined,
          }))
          .filter((v: any) => v.name.length > 0)
          .slice(0, 3);
        setVendorCandidates(cleaned);
      } catch {
        // ignore
      }
    })();

    // Cleanup: runs on unmount AND when documentId changes.
    return () => {
      cancelled = true;
      console.log('[DocumentActionsScreen] Cleaning up - unsubscribing from document');
      unsubscribeFromDocument();
    };
  }, [route.params.documentId, getDocument, loadStoredAIData, subscribeToDocument, unsubscribeFromDocument]);

  // Fallback vendor detection for local/offline documents.
  // Priority order:
  // 1) Supabase document_analysis (documentAnalysis)
  // 2) Supabase document_insights.vendor_candidates (vendorCandidates)
  // 3) On-device heuristic vendor detector (vendorDetector)
  useEffect(() => {
    if (!document) return;

    if (documentAnalysis?.vendorName) {
      setFallbackVendor(null);
      return;
    }

    if (vendorCandidates.length > 0) {
      const top = vendorCandidates[0];
      setFallbackVendor({
        vendorName: top.name,
        vendorConfidence: typeof top.confidence === 'number' ? top.confidence : undefined,
      });
      return;
    }

    const rawText = (document.content || document.extractedData?.text || '').trim();
    if (!rawText) {
      setFallbackVendor(null);
      return;
    }

    const sample = rawText.slice(0, 20000);
    const detected = vendorDetector.detect(sample, document.fileName || document.title);
    if (detected.detected && detected.vendorId !== 'generic') {
      setFallbackVendor({
        vendorId: detected.vendorId,
        vendorName: detected.vendorName,
        vendorConfidence: detected.confidence,
      });
    } else {
      setFallbackVendor(null);
    }
  }, [document, documentAnalysis?.vendorName, vendorCandidates]);

  const handleSummarize = () => {
    if (!document) return;
    navigation.navigate('Summary', { documentId: document.id });
  };

  const handleDeepExplain = () => {
    if (!document) return;
    navigation.navigate('DeepExplain', { documentId: document.id });
  };

  const handlePlan = () => {
    if (!document) return;
    navigation.navigate('Plan', { documentId: document.id });
  };

  const handleGuide = () => {
    if (!document) return;
    navigation.navigate('Guide', { documentId: document.id });
  };

  const handleWhiteboard = () => {
    if (!document) return;
    navigation.navigate('Whiteboard', { documentId: document.id });
  };

  const handleWatchVideos = async () => {
    if (!document) return;

    // 1) Build a fallback query
    const baseTitle = (document.title || '').trim();
    const vendorHint = (documentAnalysis?.vendorName || '').trim();
    const baseQuery = `${baseTitle || 'education'} ${vendorHint ? vendorHint + ' ' : ''}tutorial`;

    // Open immediately (don't block UI on AI)
    const arabicQuery = `شرح ${baseTitle || vendorHint || 'مادة تعليمية'}${vendorHint ? ' ' + vendorHint : ''}`.trim();
    const initialQueries = [baseQuery, arabicQuery].filter(Boolean);
    setYoutubeQueries(initialQueries);
    setSelectedYoutubeQueryIndex(0);
    setYoutubeUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(baseQuery)}`);
    setShowYoutube(true);

    // 2) Ask AI for a few YouTube search queries in multiple languages
    // Keep it simple: return 3 short search queries, one per line.
    // Non-blocking: if AI fails or returns junk (greetings), we keep the fallback queries.
    let queries: string[] = initialQueries;
    try {
      const prompt = `You are helping a student find YouTube videos related to a document.

Document title: "${baseTitle || 'Untitled'}"
Detected topic/vendor: "${vendorHint || 'Unknown'}"

Return 3 YouTube search queries (ONE per line):
- Query 1: English
- Query 2: Arabic
- Query 3: Same language as the title if possible, otherwise English

Rules:
- No numbering, no quotes, no extra text.
- Keep each query under 80 characters.`;

      const aiText = await ApiService.chat(prompt);
      const lines = String(aiText)
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

      // Heuristic validation: keep only query-like lines; drop generic assistant greetings.
      const titleTokens = baseTitle
        .toLowerCase()
        .split(/[^a-z0-9\u0600-\u06FF]+/i)
        .filter(Boolean)
        .slice(0, 12);
      const vendorTokens = vendorHint
        .toLowerCase()
        .split(/[^a-z0-9\u0600-\u06FF]+/i)
        .filter(Boolean)
        .slice(0, 6);
      const stopPhrases = ['how can i assist', 'assist you', 'hello', 'hi,', 'hi ', 'مرحبا', 'كيف', 'ساعد'];

      const looksValid = (q: string) => {
        const s = q.toLowerCase();
        if (stopPhrases.some(p => s.includes(p))) return false;
        if (s.length < 6) return false;
        // Prefer queries that overlap the title/vendor tokens
        const hasOverlap = [...titleTokens, ...vendorTokens].some(t => t && s.includes(t));
        return hasOverlap || (!!vendorHint && s.includes(vendorHint.toLowerCase())) || (!!baseTitle && s.includes(baseTitle.toLowerCase().slice(0, 10)));
      };

      const cleaned = lines
        .map(l => l.replace(/^[-•\d\.)\s]+/, '').trim())
        .filter(l => l.length > 0 && l.length <= 80)
        .filter(looksValid);

      if (cleaned.length > 0) {
        queries = cleaned.slice(0, 3);
      }
    } catch (err) {
      // Non-fatal: we'll fall back to baseQuery
      console.warn('[YouTube] Failed to generate AI queries:', err);
    }

    // Update chips; keep current selection/url if user already switched.
    if (queries.length > 0) {
      setYoutubeQueries(queries);
    }
  };

  const handleTest = () => {
    if (!document) return;
    navigation.navigate('Test', { documentId: document.id });
  };

  const handleLabs = () => {
    if (!document) return;
    navigation.navigate('Labs', { documentId: document.id });
  };

  const handleFlashcards = () => {
    if (!document) return;
    navigation.navigate('Flashcards', { 
      documentId: document.id,
      documentTitle: document.title,
    });
  };

  const handlePresentation = () => {
    if (!document) return;
    navigation.navigate('Presentation', { documentId: document.id });
  };

  const handleChat = () => {
    if (!document) return;
    navigation.navigate('DocChat', {
      documentId: document.id,
      documentContent: document.content,
      documentTitle: document.title,
    });
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
      
      {/* Real-time AI Processing Indicator */}
      {isProcessing && (
        <View style={styles.processingBanner}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.processingText}>{processingMessage || 'Processing...'}</Text>
        </View>
      )}
      
      {/* Vendor Detection Header - shows logo + detected vendor */}
      {(!!documentAnalysis?.vendorName || vendorCandidates.length > 0 || !!fallbackVendor?.vendorName) && (
        <View style={styles.vendorHeader}>
          {(() => {
            const vendorId = documentAnalysis?.vendorId || fallbackVendor?.vendorId;
            const logo = (vendorId && (VENDOR_CONFIGS as any)[vendorId]?.logo) ? (VENDOR_CONFIGS as any)[vendorId].logo : '📚';
            const isUrl = typeof logo === 'string' && /^https?:\/\//i.test(logo);
            if (isUrl) {
              return (
                <Image
                  source={{ uri: logo }}
                  style={styles.vendorLogoImage}
                  resizeMode="contain"
                />
              );
            }
            return <Text style={styles.vendorLogo}>{String(logo || '📚')}</Text>;
          })()}
          <View style={styles.vendorHeaderText}>
            {(() => {
              const vendorName = (documentAnalysis?.vendorName || fallbackVendor?.vendorName || '').trim();
              const vendorConfidence = (typeof documentAnalysis?.vendorConfidence === 'number')
                ? documentAnalysis.vendorConfidence
                : (typeof fallbackVendor?.vendorConfidence === 'number' ? fallbackVendor.vendorConfidence : undefined);

              const display = buildVendorDisplay({
                vendorName,
                vendorConfidence,
                candidates: vendorCandidates,
              });

              return (
                <>
                  <Text style={styles.vendorLabel}>{display.showSingle ? 'Detected' : 'Detected (low confidence)'}</Text>
                  <Text style={styles.vendorName}>{display.title}</Text>
                  {display.subtitle ? (
                    <Text style={styles.certBadge}>{display.subtitle}</Text>
                  ) : null}
                </>
              );
            })()}
            {documentAnalysis?.certificationDetected && (
              <Text style={styles.certBadge}>{documentAnalysis.certificationDetected}</Text>
            )}
          </View>
        </View>
      )}
      
      {/* AI Summaries Available Indicator */}
      {documentSummaries.length > 0 && !isProcessing && (
        <View style={styles.summariesBadge}>
          <Text style={styles.summariesText}>
            ✨ {documentSummaries.length} AI-generated content{documentSummaries.length > 1 ? 's' : ''} available
          </Text>
        </View>
      )}
      
      <ScrollView style={styles.content}>
        <View style={styles.actionsGrid}>
          <TouchableOpacity style={styles.actionItem} onPress={handleSummarize} accessibilityRole="button" accessibilityLabel={strings.actions.summarize}>
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>📝</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>{strings.actions.summarize}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleDeepExplain} accessibilityRole="button" accessibilityLabel="Deep Explain">
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>🧠</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>Deep Explain</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handlePlan} accessibilityRole="button" accessibilityLabel={strings.actions.study}>
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>🗓️</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>{strings.actions.study}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleGuide} accessibilityRole="button" accessibilityLabel="Guide">
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>🧭</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>Guide</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleWhiteboard} accessibilityRole="button" accessibilityLabel="Whiteboard">
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>🧑‍🏫</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>Whiteboard</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleWatchVideos} accessibilityRole="button" accessibilityLabel="Watch Videos">
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>📺</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>Watch Videos</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleTest} accessibilityRole="button" accessibilityLabel={strings.actions.test}>
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>✏️</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>{strings.actions.test}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleLabs} accessibilityRole="button" accessibilityLabel={strings.actions.labs}>
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>🔬</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>{strings.actions.labs}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleFlashcards} accessibilityRole="button" accessibilityLabel="Flashcards">
            <View style={styles.actionIconWrap}>
              {!isPremium && <Text style={styles.badgeText}>Limited</Text>}
              <Text style={styles.actionIcon}>🃏</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>Flashcards</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handleChat} accessibilityRole="button" accessibilityLabel="AI Chat (Doc)">
            <View style={styles.actionIconWrap}>
              {!isPremium && <Text style={styles.badgeText}>PRO</Text>}
              <Image
                source={require('../../assets/icon.png')}
                style={styles.actionIconImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>AI Chat (Doc)</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionItem} onPress={handlePresentation} accessibilityRole="button" accessibilityLabel="AI Presentation">
            <View style={styles.actionIconWrap}>
              <Text style={styles.actionIcon}>📊</Text>
            </View>
            <Text style={styles.actionLabel} numberOfLines={2}>AI Presentation</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      
      {/* YouTube Modal */}
      <Modal
        visible={showYoutube}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowYoutube(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Related Videos</Text>
            <TouchableOpacity onPress={() => setShowYoutube(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
          {youtubeQueries.length > 1 && (
            <View style={styles.queryRow}>
              {youtubeQueries.map((q, idx) => {
                const active = idx === selectedYoutubeQueryIndex;
                return (
                  <TouchableOpacity
                    key={`${idx}-${q}`}
                    onPress={() => {
                      setSelectedYoutubeQueryIndex(idx);
                      const encoded = encodeURIComponent(q);
                      setYoutubeUrl(`https://www.youtube.com/results?search_query=${encoded}`);
                    }}
                    style={[styles.queryChip, active && styles.queryChipActive]}
                  >
                    <Text style={[styles.queryChipText, active && styles.queryChipTextActive]} numberOfLines={1}>
                      {q}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {youtubeUrl ? (
            <WebView 
              source={{ uri: youtubeUrl }} 
              style={{ flex: 1 }}
              startInLoadingState={true}
              renderLoading={() => <LoadingSpinner />}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  vendorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vendorLogo: {
    fontSize: 28,
    marginRight: 12,
  },
  vendorLogoImage: {
    width: 84,
    height: 28,
    marginRight: 12,
  },
  vendorHeaderText: {
    flex: 1,
  },
  tilesGrid: {
    // deprecated: replaced by actionsGrid
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 16,
  },
  actionItem: {
    width: '25%',
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  badgeText: {
    position: 'absolute',
    top: 6,
    right: 6,
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  actionIcon: {
    fontSize: 26,
  },
  actionIconImage: {
    width: 28,
    height: 28,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  queryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cardBackground,
    gap: 8,
  },
  queryChip: {
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  queryChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  queryChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    maxWidth: 280,
  },
  queryChipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  // Real-time processing banner styles
  processingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 10,
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  // Vendor detection badge styles
  vendorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardBackground,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  vendorLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  vendorName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  certBadge: {
    fontSize: 11,
    backgroundColor: colors.secondary,
    color: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  // AI summaries available badge
  summariesBadge: {
    backgroundColor: '#E8F5E9',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#C8E6C9',
  },
  summariesText: {
    fontSize: 13,
    color: '#2E7D32',
    textAlign: 'center',
  },
  actionCard:  {
    alignItems: 'center',
    marginVertical: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  proBadge: {
    backgroundColor: colors.secondary,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionIconLarge: {
    fontSize: 48,
    marginBottom:  12,
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
    marginBottom:  16,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
});
