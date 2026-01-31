import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, FlatList, Dimensions } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument, isSummaryGenerating } from '../hooks/useDocument';
import { generateSummaryOutline, generateModuleForPage } from '../services/openai';
import { updateDocumentSummaryPaged, getDocumentById } from '../services/storage';
import DiagramRenderer from '../components/DiagramRenderer';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document, DocumentPagedSummary, PagedModule } from '../types/document';

type SummaryScreenProps = MainDrawerScreenProps<'Summary'>;
type SummaryLanguage = 'en' | 'ar';

type SummaryPagerItem =
  | { type: 'toc'; id: string }
  | { type: 'page'; id: string; page: PagedModule };

const SCREEN_WIDTH = Dimensions.get('window').width;
// Account for outer screen padding (16*2) + Card padding (16*2)
const PAGER_WIDTH = SCREEN_WIDTH - 64;

export const SummaryScreen: React.FC = () => {
  const route = useRoute<SummaryScreenProps['route']>();
  const navigation = useNavigation<any>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [summaryPaged, setSummaryPaged] = useState<DocumentPagedSummary | null>(null);
  const [summaryImage, setSummaryImage] = useState<string | null>(null);
  const [documentImages, setDocumentImages] = useState<{pageNum: number, url: string}[]>([]);
  const [displaySummary, setDisplaySummary] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBackgroundGenerating, setIsBackgroundGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguage>('en');
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generatingPagesRef = useRef<Set<number>>(new Set());
  const [pageProgress, setPageProgress] = useState<Record<number, { progress: number; message: string }>>({});

  // Reset state when documentId changes
  useEffect(() => {
    // Clear previous state when document changes
    setSummary('');
    setDisplaySummary('');
    setSummaryImage(null);
    setSummaryPaged(null);
    setDocument(null);
    setIsLoading(true);
    setIsGenerating(false);
    setIsBackgroundGenerating(false);
    setProgress(0);
    setProgressMessage('');
    setDocumentImages([]);
    
    // Load the new document
    loadDocumentAndSummary();
    
    // Cleanup polling on unmount or document change
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [route.params.documentId]); // Re-run when documentId changes

  // Parse summary for images whenever it changes
  useEffect(() => {
    if (summary) {
      // Check for markdown image at the start: ![Alt](Url)
      const imgMatch = summary.match(/^!\[.*?\]\((.*?)\)\n\n/);
      if (imgMatch) {
        setSummaryImage(imgMatch[1]);
        setDisplaySummary(summary.replace(imgMatch[0], ''));
      } else {
        setSummaryImage(null);
        setDisplaySummary(summary);
      }
    } else {
      setSummaryImage(null);
      setDisplaySummary('');
    }
  }, [summary]);

  const loadDocumentAndSummary = async () => {
    const documentId = route.params.documentId;
    const doc = await getDocument(documentId);
    setDocument(doc);
    
    // Check if the summary is a "fake" summary generated from help message content
    const isFakeSummary = (text: string): boolean => {
      const lower = text.toLowerCase();
      return (lower.includes('pdf') && lower.includes('text extraction')) ||
             (lower.includes('custom font') && lower.includes('encoding')) ||
             (lower.includes('google drive') && lower.includes('ocr')) ||
             lower.includes('standard text extraction tools') ||
             lower.includes('pdf processing notice') ||
             lower.includes('embedded custom fonts') ||
             lower.includes('ilovepdf.com') ||
             lower.includes('npx expo run') ||
             lower.includes('vision ocr') ||
             lower.includes('proprietary font encoding') ||
             lower.includes('how to fix');
    };
    
    if (doc?.summary && !isFakeSummary(doc.summary)) {
      // Summary already exists and is valid - show it instantly
      setSummary(doc.summary);
      setIsLoading(false);
    } else if (doc?.summaryPaged && doc.summaryPaged.modules && Array.isArray(doc.summaryPaged.modules) && doc.summaryPaged.modules.length > 0) {
      setSummaryPaged(doc.summaryPaged as any);
      setIsLoading(false);
    } else if (doc?.summary && isFakeSummary(doc.summary)) {
      // Cached summary is fake (generated from help text) - clear it and show generate button
      console.log('[Summary] Detected fake summary from help message, clearing...');
      setIsLoading(false);
    } else if (isSummaryGenerating(documentId)) {
      // Background generation in progress - poll for completion
      setIsBackgroundGenerating(true);
      setIsLoading(false);
      startPollingForSummary(documentId);
    } else {
      setIsLoading(false);
    }
    
    // Extract images from document's extracted data
    if (doc?.extractedData?.images && doc.extractedData.images.length > 0) {
      const images = doc.extractedData.images.map((img: any) => ({
        pageNum: img.pageNumber || 0,
        url: img.url,
      })).filter((img: any) => img.url);
      setDocumentImages(images);
    } else if (doc?.extractedData?.pages) {
      // Try to get images from pages
      const images = doc.extractedData.pages
        .filter((p: any) => p.images && p.images.length > 0)
        .flatMap((p: any) => p.images.map((img: any) => ({
          pageNum: p.pageNumber || 0,
          url: img.url,
        })))
        .filter((img: any) => img.url);
      setDocumentImages(images);
    }
  };

  // Poll for summary completion every 1 second
  const startPollingForSummary = (documentId: string) => {
    pollIntervalRef.current = setInterval(async () => {
      // Check if still generating
      if (!isSummaryGenerating(documentId)) {
        // Generation complete - fetch updated document
        const updatedDoc = await getDocumentById(documentId);
        if (updatedDoc?.summary) {
          setSummary(updatedDoc.summary);
          setDocument(updatedDoc);
        }
        setIsBackgroundGenerating(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    }, 1000);
  };

  const handleProgress = (prog: number, message:  string) => {
    setProgress(prog);
    setProgressMessage(message);
  };

  const handleGenerateSummary = async () => {
    const doc = document;
    if (!doc) return;
    
    // ENHANCED: Try multiple sources for content
    let contentToUse = '';
    
    const extractedPagesText = (doc.extractedData?.pages && Array.isArray(doc.extractedData.pages))
      ? doc.extractedData.pages.map((p: any) => p.text || '').join('\n\n')
      : '';
    const extractedFullText = String(
      doc.extractedData?.text ||
        (doc.extractedData as any)?.canonical?.content?.full_text ||
        (doc.extractedData as any)?.canonical?.content?.fullText ||
        (doc.extractedData as any)?.canonical?.content?.text ||
        ''
    );
    const chunkedText = (doc.chunks && doc.chunks.length > 0) ? doc.chunks.join('\n\n') : '';
    const directText = doc.content || '';

    // Prefer the longest usable source to avoid truncated local content.
    const candidates = [extractedFullText, extractedPagesText, chunkedText, directText]
      .map((t) => String(t || ''))
      .filter((t) => t.length > 100);
    candidates.sort((a, b) => b.length - a.length);
    contentToUse = candidates[0] || directText || '';
    
    const isPendingModule = (m: PagedModule | undefined | null) => {
      if (!m) return true;
      const blocks = m.content?.textBlocks;
      return Array.isArray(blocks) && blocks.includes('__PENDING__');
    };

    const ensureModuleGenerated = async (pageIndex: number) => {
      const currentDoc = document;
      if (!currentDoc) return;
      const currentSummary = summaryPaged;
      if (!currentSummary || !Array.isArray(currentSummary.modules)) return;
      if (pageIndex < 0 || pageIndex >= currentSummary.modules.length) return;
      if (!isPendingModule(currentSummary.modules[pageIndex])) return;
      if (generatingPagesRef.current.has(pageIndex)) return;

      generatingPagesRef.current.add(pageIndex);
      setPageProgress((prev) => ({
        ...prev,
        [pageIndex]: { progress: 0, message: summaryLanguage === 'ar' ? 'جاري التوليد...' : 'Generating...' },
      }));

      try {
        const generated = await generateModuleForPage(
          pageIndex,
          contentToUse,
          currentDoc.chunks,
          (p: number, msg: string) => {
            setPageProgress((prev) => ({
              ...prev,
              [pageIndex]: { progress: p, message: msg },
            }));
          },
          currentDoc.fileUri,
          currentDoc.fileType,
          currentDoc.pdfCloudUrl,
          currentDoc.extractedData,
          summaryLanguage,
          currentDoc.id
        );

        setSummaryPaged((prev) => {
          if (!prev) return prev;
          const next: DocumentPagedSummary = {
            ...prev,
            modules: prev.modules.map((m, i) => (i === pageIndex ? generated : m)),
          };
          updateDocumentSummaryPaged(currentDoc.id, next as any).catch((e) => console.warn('[Summary] Persist failed', e));
          return next as any;
        });
      } finally {
        generatingPagesRef.current.delete(pageIndex);
        setPageProgress((prev) => {
          const copy = { ...prev };
          delete copy[pageIndex];
          return copy;
        });
      }
    };

    setIsGenerating(true);
    setProgress(0);
    setProgressMessage(summaryLanguage === 'ar' ? 'جاري البدء...' : 'Starting...');

    try {
      // Phase 1: fast outline (placeholder pages)
      const outline = await generateSummaryOutline(
        contentToUse,
        doc.chunks,
        handleProgress,
        doc.fileUri,
        doc.fileType,
        doc.pdfCloudUrl,
        doc.extractedData,
        summaryLanguage,
        doc.id
      );
      setSummaryPaged(outline as any);
      await updateDocumentSummaryPaged(doc.id, outline as any);

      // Phase 2: generate the first page immediately for perceived speed
      setTimeout(() => {
        ensureModuleGenerated(0).catch((e) => console.warn('[Summary] Failed generating first page', e));
      }, 250);
      return;
    } catch (error:  any) {
      console.error('Error generating summary:', error);
      setSummary(summaryLanguage === 'ar' 
        ? 'فشل في إنشاء الملخص: ' + (error.message || 'خطأ غير معروف')
        : 'Failed to generate summary:  ' + (error.message || 'Unknown error'));
    } finally {
      setIsGenerating(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading document..." />;
  }

  if (! document) {
    return (
      <View style={styles.container}>
        <Header title="Document Not Found" />
        <View style={styles.content}>
          <Text style={styles.errorText}>Document not found</Text>
        </View>
      </View>
    );
  }

  const handleBack = () => {
    navigation.navigate('DocumentActions', { documentId: route.params.documentId });
  };

  return (
    <View style={styles.container}>
      <Header title="Summary" subtitle={document.title} />
      
      <ScrollView style={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>← Back to Actions</Text>
        </TouchableOpacity>
        {/* File info */}
        {document.isLargeFile && (
          <Card>
            <Text style={styles.infoLabel}>Large Document Detected</Text>
            <Text style={styles.infoText}>
              This document has {document.totalChunks} sections and will be processed in parts.
            </Text>
          </Card>
        )}

        {!summary && !summaryPaged && !isGenerating && !isBackgroundGenerating && (
          <Card>
            {/* Check if document content is a help message */}
            {document.content && (
              document.content.toLowerCase().includes('pdf processing notice') || 
              document.content.toLowerCase().includes('embedded custom fonts') ||
              document.content.toLowerCase().includes('__needs_ocr__')
            ) ? (
              <>
                <Text style={styles.sectionTitle}>📄 Document Notice</Text>
                <Text style={styles.summaryText}>{document.content}</Text>
              </>
            ) : (
              <>
                <Text style={styles.infoText}>
                  No summary available yet. Generate one now! 
                </Text>
                
                {/* Language Selection */}
                <View style={styles.languageSelector}>
                  <Text style={styles.languageLabel}>Summary Language:</Text>
                  <View style={styles.languageButtons}>
                    <TouchableOpacity
                      style={[
                        styles.languageButton,
                        summaryLanguage === 'en' && styles.languageButtonActive
                      ]}
                      onPress={() => setSummaryLanguage('en')}
                    >
                      <Text style={[
                        styles.languageButtonText,
                        summaryLanguage === 'en' && styles.languageButtonTextActive
                      ]}>🇺🇸 English</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.languageButton,
                        summaryLanguage === 'ar' && styles.languageButtonActive
                      ]}
                      onPress={() => setSummaryLanguage('ar')}
                    >
                      <Text style={[
                        styles.languageButtonText,
                        summaryLanguage === 'ar' && styles.languageButtonTextActive
                      ]}>🇸🇦 العربية</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                
                <Button
                  title={summaryLanguage === 'ar' ? 'إنشاء ملخص' : 'Generate Summary'}
                  onPress={handleGenerateSummary}
                  style={styles.button}
                />
              </>
            )}
          </Card>
        )}

        {isBackgroundGenerating && (
          <Card>
            <Text style={styles.progressTitle}>✨ Summary generating automatically...</Text>
            <Text style={styles.infoText}>
              Your summary is being prepared in the background. It will appear here shortly!
            </Text>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBar, styles.progressBarAnimated]} />
            </View>
          </Card>
        )}

        {isGenerating && (
          <Card>
            <Text style={styles.progressTitle}>Generating Summary... </Text>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBar, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{progressMessage}</Text>
            <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
          </Card>
        )}

        {summaryPaged && summaryPaged.modules && summaryPaged.modules.length > 0 && !isGenerating && (
          <Card>
            <Text style={styles.sectionTitle}>AI Summary (Pages)</Text>
            <Text style={styles.infoText}>Swipe left/right to change page.</Text>
            <View style={{ width: PAGER_WIDTH, alignSelf: 'center' }}>
              <FlatList
                style={{ width: PAGER_WIDTH }}
                data={([
                  { type: 'toc', id: 'toc' },
                  // Do NOT rely on model-provided moduleId for React keys (it may repeat).
                  ...summaryPaged.modules.map((m, i) => ({ type: 'page', id: `page-${i + 1}`, page: m } as SummaryPagerItem)),
                ] as SummaryPagerItem[])}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item, idx) => `${item.type}:${item.id}:${idx}`}
                onMomentumScrollEnd={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  const idx = Math.round(x / PAGER_WIDTH);
                  if (idx <= 0) return;
                  const pageIndex = idx - 1;
                  const m = summaryPaged.modules[pageIndex];
                  const blocks = m?.content?.textBlocks;
                  const pending = Array.isArray(blocks) && blocks.includes('__PENDING__');
                  if (!pending) return;

                  // Re-run the same content selection logic (must match generation) to avoid empty/truncated input.
                  const extractedPagesText = (document.extractedData?.pages && Array.isArray(document.extractedData.pages))
                    ? document.extractedData.pages.map((p: any) => p.text || '').join('\n\n')
                    : '';
                  const extractedFullText = String(
                    document.extractedData?.text ||
                      (document.extractedData as any)?.canonical?.content?.full_text ||
                      (document.extractedData as any)?.canonical?.content?.fullText ||
                      (document.extractedData as any)?.canonical?.content?.text ||
                      ''
                  );
                  const chunkedText = (document.chunks && document.chunks.length > 0) ? document.chunks.join('\n\n') : '';
                  const directText = document.content || '';
                  const candidates = [extractedFullText, extractedPagesText, chunkedText, directText]
                    .map((t) => String(t || ''))
                    .filter((t) => t.length > 100);
                  candidates.sort((a, b) => b.length - a.length);
                  const contentToUse = candidates[0] || directText || '';

                  if (generatingPagesRef.current.has(pageIndex)) return;
                  generatingPagesRef.current.add(pageIndex);
                  setPageProgress((prev) => ({
                    ...prev,
                    [pageIndex]: { progress: 0, message: summaryLanguage === 'ar' ? 'جاري التوليد...' : 'Generating...' },
                  }));

                  (async () => {
                    try {
                      const generated = await generateModuleForPage(
                        pageIndex,
                        contentToUse,
                        document.chunks,
                        (p: number, msg: string) => {
                          setPageProgress((prev) => ({
                            ...prev,
                            [pageIndex]: { progress: p, message: msg },
                          }));
                        },
                        document.fileUri,
                        document.fileType,
                        document.pdfCloudUrl,
                        document.extractedData,
                        summaryLanguage,
                        document.id
                      );
                      setSummaryPaged((prev) => {
                        if (!prev) return prev;
                        const next: DocumentPagedSummary = {
                          ...prev,
                          modules: prev.modules.map((mm, i) => (i === pageIndex ? generated : mm)),
                        };
                        updateDocumentSummaryPaged(document.id, next as any).catch((e) => console.warn('[Summary] Persist failed', e));
                        return next as any;
                      });
                    } catch (err) {
                      console.warn('[Summary] Failed generating module', err);
                    } finally {
                      generatingPagesRef.current.delete(pageIndex);
                      setPageProgress((prev) => {
                        const copy = { ...prev };
                        delete copy[pageIndex];
                        return copy;
                      });
                    }
                  })();
                }}
                renderItem={({ item, index }) => {
                  if (item.type === 'toc') {
                    return (
                      <View style={[styles.modulePage, { width: PAGER_WIDTH }]}>
                        <ScrollView style={styles.moduleScroll} showsVerticalScrollIndicator={true}>
                          <Text style={styles.moduleIndex}>Table of contents</Text>
                          <Text style={styles.moduleTitle}>Pages ({summaryPaged.totalPages})</Text>
                          {summaryPaged.modules.map((m, i) => (
                            <View key={`toc-${i}-${m.title}`} style={{ marginBottom: 10 }}>
                              <Text style={styles.moduleBody}>
                                Page {i + 1}. {m.title}
                              </Text>
                              {Array.isArray((m as any).toc) && (m as any).toc.length > 0 ? (
                                (m as any).toc.slice(0, 5).map((t: string, j: number) => (
                                  <Text key={`toc-item-${i}-${j}-${String(t).slice(0, 12)}`} style={styles.tocItem}>
                                    • {t}
                                  </Text>
                                ))
                              ) : null}
                            </View>
                          ))}
                          <Text style={styles.moduleMeta}>Swipe left to start.</Text>
                        </ScrollView>
                      </View>
                    );
                  }

                  const page = item.page;
                  const pageIndex = Math.max(0, index - 1);
                  const pageIsPending = Array.isArray(page.content?.textBlocks) && page.content.textBlocks.includes('__PENDING__');
                  const pp = pageProgress[pageIndex];

                  return (
                    <View style={[styles.modulePage, { width: PAGER_WIDTH }]}>
                      <ScrollView style={styles.moduleScroll} showsVerticalScrollIndicator={true}>
                        <Text style={styles.moduleIndex}>Page {pageIndex + 1}/{summaryPaged.totalPages}</Text>
                        <Text style={styles.moduleTitle}>{page.title}</Text>

                        {page.content?.imageDataUrl ? (
                          <Image
                            source={{ uri: page.content.imageDataUrl }}
                            style={styles.moduleImage}
                            resizeMode="cover"
                          />
                        ) : null}

                        {pageIsPending && (
                          <View style={{ marginTop: 8, marginBottom: 12 }}>
                            <Text style={styles.infoText}>
                              {pp?.message || (summaryLanguage === 'ar' ? 'اسحب هنا لتوليد هذا القسم.' : 'Swipe here to generate this page.')}
                            </Text>
                            {pp && (
                              <View style={styles.progressBarContainer}>
                                <View style={[styles.progressBar, { width: `${pp.progress}%` }]} />
                              </View>
                            )}
                          </View>
                        )}

                        <Text style={styles.moduleSectionHeading}>Executive summary</Text>
                        {Array.isArray(page.content?.executiveSummary) && page.content.executiveSummary.length > 0 ? (
                          page.content.executiveSummary.map((b, i) => (
                            <Text key={`exec-${pageIndex}-${i}-${String(b).slice(0, 16)}`} style={styles.moduleBody}>• {b}</Text>
                          ))
                        ) : (
                          <Text style={styles.moduleBody}>{pageIsPending ? '—' : 'Not specified.'}</Text>
                        )}

                        <Text style={styles.moduleSectionHeading}>Content</Text>
                        {Array.isArray(page.content?.textBlocks) && page.content.textBlocks.length > 0 ? (
                          page.content.textBlocks.map((t, i) => (
                            <Text key={`blk-${pageIndex}-${i}-${String(t).slice(0, 16)}`} style={styles.moduleBody}>{t}</Text>
                          ))
                        ) : (
                          <Text style={styles.moduleBody}>{pageIsPending ? '—' : 'Not specified.'}</Text>
                        )}

                        {Array.isArray(page.content?.tables) && page.content.tables.length > 0 ? (
                          <>
                            <Text style={styles.moduleSectionHeading}>Tables</Text>
                            {page.content.tables.map((tbl, ti) => (
                              <View key={`tbl-${pageIndex}-${ti}`} style={styles.tableContainer}>
                                {Array.isArray(tbl.headers) && tbl.headers.length > 0 && (
                                  <View style={styles.tableRow}>
                                    {tbl.headers.slice(0, 6).map((h, hi) => (
                                      <Text key={`th-${pageIndex}-${ti}-${hi}`} style={[styles.tableCell, styles.tableHeaderCell]} numberOfLines={2}>
                                        {h}
                                      </Text>
                                    ))}
                                  </View>
                                )}
                                {(tbl.rows || []).slice(0, 12).map((row, ri) => (
                                  <View key={`tr-${pageIndex}-${ti}-${ri}`} style={styles.tableRow}>
                                    {(row || []).slice(0, 6).map((c, ci) => (
                                      <Text key={`tc-${pageIndex}-${ti}-${ri}-${ci}`} style={styles.tableCell} numberOfLines={3}>
                                        {c}
                                      </Text>
                                    ))}
                                  </View>
                                ))}
                              </View>
                            ))}
                          </>
                        ) : null}

                        {Array.isArray(page.content?.diagrams) && page.content.diagrams.length > 0 ? (
                          <>
                            <Text style={styles.moduleSectionHeading}>Diagrams</Text>
                            {page.content.diagrams.map((dgm, di) => (
                              <DiagramRenderer
                                key={`dgm-${pageIndex}-${di}`}
                                mermaidCode={String((dgm as any)?.code || '')}
                                height={260}
                                style={{ marginTop: 8 }}
                              />
                            ))}
                          </>
                        ) : null}

                        {Array.isArray(page.content?.equations) && page.content.equations.length > 0 ? (
                          <>
                            <Text style={styles.moduleSectionHeading}>Equations</Text>
                            {page.content.equations.map((eq, i) => (
                              <Text key={`eq-${pageIndex}-${i}`} style={styles.moduleMono}>{eq}</Text>
                            ))}
                          </>
                        ) : null}

                        {Array.isArray(page.content?.visuals) && page.content.visuals.length > 0 ? (
                          <>
                            <Text style={styles.moduleSectionHeading}>Suggested visuals</Text>
                            {page.content.visuals.map((v, i) => (
                              <Text key={`vis-${pageIndex}-${i}-${String(v).slice(0, 16)}`} style={styles.moduleBody}>• {v}</Text>
                            ))}
                          </>
                        ) : null}
                      </ScrollView>
                    </View>
                  );
                }}
              />
            </View>
            <Button
              title="Regenerate"
              onPress={handleGenerateSummary}
              variant="outline"
              style={styles.button}
            />
          </Card>
        )}

        {summary && !summaryPaged && ! isGenerating && (
          <Card>
            <Text style={styles.sectionTitle}>
              {summary.includes('⚠️') || summary.includes('Unable to Generate') ? 'Notice' : 'AI Summary'}
            </Text>
            
            {summaryImage && (
              <Image 
                source={{ uri: summaryImage }} 
                style={styles.summaryImage} 
                resizeMode="cover"
              />
            )}
            
            <Text style={styles.summaryText}>{displaySummary}</Text>
            
            {/* Show document images if available */}
            {documentImages.length > 0 && (
              <View style={styles.imagesSection}>
                <Text style={styles.imagesSectionTitle}>📷 Document Images ({documentImages.length})</Text>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  style={styles.imagesScroll}
                >
                  {documentImages.map((img, index) => (
                    <View key={`img-${img.pageNum}-${img.url}-${index}`} style={styles.imageContainer}>
                      <Image 
                        source={{ uri: img.url }} 
                        style={styles.documentImage} 
                        resizeMode="contain"
                      />
                      {img.pageNum > 0 && (
                        <Text style={styles.imageCaption}>Page {img.pageNum}</Text>
                      )}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
            
            {/* Only show Regenerate button if this is a real summary, not a warning */}
            {!summary.includes('⚠️') && !summary.includes('Unable to Generate') && (
              <Button
                title="Regenerate"
                onPress={handleGenerateSummary}
                variant="outline"
                style={styles.button}
              />
            )}
          </Card>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  moduleImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginTop: 12,
    marginBottom: 12,
    backgroundColor: colors.cardBackground,
  },
  content: {
    flex: 1,
    padding:  16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  summaryImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: colors.surface,
  },
  summaryText:  {
    fontSize:  16,
    color: colors.text,
    lineHeight: 24,
    marginBottom: 16,
  },
  modulePage: {
    paddingRight: 0,
  },
  moduleScroll: {
    maxHeight: 520,
  },
  moduleIndex: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  moduleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 6,
  },
  moduleMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  moduleSectionHeading: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginTop: 12,
    marginBottom: 6,
  },
  moduleBody: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    marginBottom: 6,
  },
  tocItem: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 4,
    marginLeft: 10,
  },
  moduleMono: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 18,
    fontFamily: 'Courier',
    marginBottom: 8,
  },
  tableContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    color: colors.text,
  },
  tableHeaderCell: {
    fontWeight: '700',
  },
  imagesSection: {
    marginTop: 16,
    marginBottom: 16,
  },
  imagesSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  imagesScroll: {
    flexDirection: 'row',
  },
  imageContainer: {
    marginRight: 12,
    alignItems: 'center',
  },
  documentImage: {
    width: SCREEN_WIDTH * 0.6,
    height: 200,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  imageCaption: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color:  colors.primary,
    marginBottom: 4,
  },
  infoText:  {
    fontSize:  14,
    color:  colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color:  colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
  button: {
    marginTop: 8,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  progressBarContainer:  {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressBarAnimated: {
    width: '100%',
    opacity: 0.7,
  },
  progressText: {
    fontSize: 14,
    color:  colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  progressPercent:  {
    fontSize:  18,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  languageSelector: {
    marginBottom: 16,
  },
  languageLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  languageButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  languageButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  languageButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  languageButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  languageButtonTextActive: {
    color: colors.primary,
  },
});
