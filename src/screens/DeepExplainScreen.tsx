import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Image, Dimensions, NativeScrollEvent, NativeSyntheticEvent, FlatList, Platform } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Linking } from 'react-native';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors } from '../constants/colors';
import { supabase } from '../services/supabase';
import { VendorBadge, type VendorInfo } from '../components/VendorBadge';
import type { MainDrawerScreenProps } from '../navigation/types';
import DiagramRenderer from '../components/DiagramRenderer';
import ApiService from '../services/apiService';
import {
  requestDeepExplain,
  getDeepExplainOutput,
  subscribeToDeepExplainOutput,
  createDocAssetsSignedUrl,
  type DocumentOutputRow,
} from '../services/documentOutputsService';
import {
  getDocumentPageCount,
  listDocumentPages,
  listDocumentPageBlocks,
  normalizePageTextFromBlocks,
  getSignedPageImageUrl,
  findPageIndexForTopic,
  type DocumentPageRow,
} from '../services/documentPagesService';

type Props = MainDrawerScreenProps<'DeepExplain'>;

export const DeepExplainScreen: React.FC = () => {
  const route = useRoute<Props['route']>();
  const navigation = useNavigation<any>();
  const documentId = route.params.documentId;
  const initialPageIndex = (route.params as any)?.initialPageIndex ? Number((route.params as any).initialPageIndex) : null;

  const [pageCount, setPageCount] = useState(0);
  const [pages, setPages] = useState<DocumentPageRow[]>([]);
  const [pageImageUrls, setPageImageUrls] = useState<Record<number, string | null>>({});
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [pageExplanations, setPageExplanations] = useState<Record<number, string>>({});
  const [pageExplainLoading, setPageExplainLoading] = useState<Record<number, boolean>>({});
  const [activePageIndex, setActivePageIndex] = useState(1);
  const pagesListRef = useRef<FlatList<number>>(null);

  const [output, setOutput] = useState<DocumentOutputRow | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [autoRequested, setAutoRequested] = useState(false);
  const [figureUrls, setFigureUrls] = useState<Record<string, string | null>>({});
  const [prepMessage, setPrepMessage] = useState<string | null>(null);
  const [vendorInfo, setVendorInfo] = useState<VendorInfo | null>(null);

  const [docSignedUrl, setDocSignedUrl] = useState<string | null>(null);
  const [docIsPdf, setDocIsPdf] = useState(false);

  const status = output?.status || (requestError ? 'failed' : autoRequested ? 'queued' : 'idle');
  const content = output?.content || null;

  const vendorIdFromName = (name: string | null | undefined): string => {
    const n = String(name || '').toLowerCase();
    if (!n) return 'generic';
    if (n.includes('cisco')) return 'cisco';
    if (n.includes('amazon web services') || n.includes('aws')) return 'aws';
    if (n.includes('microsoft')) return 'microsoft';
    if (n.includes('google')) return 'google';
    if (n.includes('comptia')) return 'comptia';
    if (n.includes('vmware')) return 'vmware';
    if (n.includes('red hat') || n.includes('redhat')) return 'redhat';
    if (n.includes('fortinet')) return 'fortinet';
    if (n.includes('juniper')) return 'juniper';
    if (n.includes('oracle')) return 'oracle';
    if (n.includes('palo alto') || n.includes('paloalto')) return 'paloalto';
    return 'generic';
  };

  const friendlyRequestError = useMemo(() => {
    if (!requestError) return null;
    const msg = String(requestError);
    if (msg.includes('Not authorized to access document') || msg.includes('(HTTP 403)')) {
      return (
        'Deep Explain requires a cloud-synced document you have access to. ' +
        'This usually happens when the document was uploaded in “local-only” mode or the cloud record failed to save. '
      );
    }
    return msg;
  }, [requestError]);

  const outputFailureDetails = useMemo(() => {
    if (output?.status !== 'failed') return null;
    const c: any = output?.content;
    const message = c?.message || c?.error?.message || c?.error;
    if (typeof message === 'string' && message.trim().length > 0) return message.trim();
    return null;
  }, [output?.status, output?.content]);

  const coverageWarning = useMemo(() => {
    const ratio = Number(content?.coverage?.ratio ?? NaN);
    const warning = content?.coverage?.warning;
    if (warning) return String(warning);
    if (Number.isFinite(ratio) && ratio < 0.95) return `Extraction coverage is ${Math.round(ratio * 100)}%. Some pages may be missing.`;
    return null;
  }, [content]);

  const load = async () => {
    const row = await getDeepExplainOutput(documentId);
    if (row) setOutput(row);
  };

  const loadPages = async () => {
    const pc = await getDocumentPageCount(documentId);
    setPageCount(pc);
    const list = await listDocumentPages(documentId);
    setPages(list);

    // Pre-sign first couple of pages for fast initial render.
    const first = [1, 2].filter((n) => pc === 0 || n <= pc);
    for (const p of first) {
      if (pageImageUrls[p] !== undefined) continue;
      const url = await getSignedPageImageUrl(documentId, p);
      setPageImageUrls((prev) => ({ ...prev, [p]: url }));
    }
  };

  const ensurePageAssets = async (pageIndex: number) => {
    if (!pageIndex || pageIndex < 1) return;

    // Page image
    if (pageImageUrls[pageIndex] === undefined) {
      const url = await getSignedPageImageUrl(documentId, pageIndex);
      setPageImageUrls((prev) => ({ ...prev, [pageIndex]: url }));
    }

    // Page text (for preview + explanation)
    let pageText = pageTexts[pageIndex] || '';
    if (!pageText) {
      const blocks = await listDocumentPageBlocks(documentId, pageIndex);
      pageText = normalizePageTextFromBlocks(blocks);
      if (pageText) {
        setPageTexts((prev) => ({ ...prev, [pageIndex]: pageText }));
      }
    }

    // Page explanation (generate on demand)
    if (pageExplanations[pageIndex]) return;
    if (pageExplainLoading[pageIndex]) return;

    setPageExplainLoading((prev) => ({ ...prev, [pageIndex]: true }));
    try {
      if (!pageText.trim()) {
        setPageExplanations((prev) => ({ ...prev, [pageIndex]: 'No extractable text found on this page.' }));
        return;
      }

      const prompt =
        `Deep Explain - Page ${pageIndex}\n\n` +
        `Explain this page to a student so they can fully understand it.\n` +
        `Format:\n` +
        `- 1 short summary paragraph\n` +
        `- then 5-10 bullet points explaining the page step-by-step\n` +
        `- then a short "Key Terms" list (3-8 terms)\n` +
        `- then a short "Exam Tips" section (if relevant)\n\n` +
        `Rules: be grounded ONLY in the provided page text. If something isn't on the page, say it's not found. Avoid fluff.`;

      const text = await ApiService.chat(prompt, pageText);
      setPageExplanations((prev) => ({ ...prev, [pageIndex]: String(text || '').trim() }));
    } catch (e: any) {
      setPageExplanations((prev) => ({ ...prev, [pageIndex]: `Failed to generate explanation. ${String(e?.message || e)}` }));
    } finally {
      setPageExplainLoading((prev) => ({ ...prev, [pageIndex]: false }));
    }
  };

  const loadVendor = async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('vendor_name,vendor_confidence')
      .eq('id', documentId)
      .maybeSingle();

    if (error || !data) return;
    const vendorName = (data as any)?.vendor_name ? String((data as any).vendor_name) : '';
    const confidenceRaw = Number((data as any)?.vendor_confidence ?? 0);
    if (!vendorName) return;

    setVendorInfo({
      vendorId: vendorIdFromName(vendorName),
      vendorName,
      confidence: Number.isFinite(confidenceRaw) ? confidenceRaw : 0.75,
      detected: true,
    });
  };

  const getCoverage = async (): Promise<{ pageCount: number; donePages: number; ratio: number | null }> => {
    const { data } = await supabase
      .from('document_coverage_v')
      .select('page_count,done_pages,coverage_ratio')
      .eq('document_id', documentId)
      .maybeSingle();

    const pageCount = Number((data as any)?.page_count ?? 0);
    const donePages = Number((data as any)?.done_pages ?? 0);
    const ratioRaw = Number((data as any)?.coverage_ratio);
    const ratio = Number.isFinite(ratioRaw) ? ratioRaw : null;
    return { pageCount, donePages, ratio };
  };

  const ensureExtractionReady = async () => {
    setPrepMessage('Checking extraction status…');

    const first = await getCoverage();
    if (!Number.isFinite(first.pageCount) || first.pageCount <= 0) {
      setPrepMessage(null);
      return;
    }

    if ((first.ratio != null && first.ratio >= 0.95) || first.donePages >= first.pageCount) {
      setPrepMessage(null);
      return;
    }

    // Kick extraction (idempotent) then wait a bit for page/chunk rows to appear.
    setPrepMessage(`Extracting pages ${first.donePages}/${first.pageCount}…`);
    await supabase.functions.invoke('enqueue-extraction', { body: { documentId } }).catch(() => {});

    const startAt = Date.now();
    const maxWaitMs = 90_000;
    while (Date.now() - startAt < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 3000));
      const cov = await getCoverage();
      if (Number.isFinite(cov.pageCount) && cov.pageCount > 0) {
        setPrepMessage(`Extracting pages ${cov.donePages}/${cov.pageCount}…`);
      }

      if ((cov.ratio != null && cov.ratio >= 0.95) || (cov.pageCount > 0 && cov.donePages >= cov.pageCount)) {
        setPrepMessage(null);
        return;
      }

      // If extraction started producing some pages, allow Deep Explain to proceed sooner.
      if (cov.donePages > 0) {
        break;
      }
    }

    setPrepMessage(null);
  };

  const start = async () => {
    setIsRequesting(true);
    setRequestError(null);
    try {
      await ensureExtractionReady();
      await requestDeepExplain(documentId);
      await load();
      setAutoRequested(true);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setRequestError(msg);
    } finally {
      setIsRequesting(false);
    }
  };

  useEffect(() => {
    load();
    loadVendor().catch(() => {});
    loadPages().catch(() => {});
    const unsub = subscribeToDeepExplainOutput(documentId, (row) => {
      setOutput(row);
    });
    return unsub;
  }, [documentId]);

  // Load a signed URL for the original document (used as a preview fallback when page PNG isn't available).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('storage_path,file_type')
          .eq('id', documentId)
          .maybeSingle();

        if (cancelled || error) return;
        const storagePath = String((data as any)?.storage_path || '').trim();
        const fileType = String((data as any)?.file_type || '').toLowerCase();
        const isPdf = fileType.includes('pdf') || storagePath.toLowerCase().endsWith('.pdf');
        setDocIsPdf(isPdf);
        if (!isPdf || !storagePath) return;

        const { data: signed } = await supabase.storage
          .from('documents')
          .createSignedUrl(storagePath, 1800);

        if (cancelled) return;
        setDocSignedUrl(signed?.signedUrl || null);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Generate the first page explanation ASAP when pages exist.
  useEffect(() => {
    if (!pageCount || pageCount <= 0) return;
    ensurePageAssets(1).catch(() => {});
  }, [pageCount]);

  // Jump to a requested page (e.g., from Guide).
  useEffect(() => {
    if (!pageCount || pageCount <= 0) return;
    if (!initialPageIndex || !Number.isFinite(initialPageIndex)) return;
    const target = Math.max(1, Math.min(pageCount, Math.floor(initialPageIndex)));
    setActivePageIndex(target);
    ensurePageAssets(target).catch(() => {});
    requestAnimationFrame(() => {
      pagesListRef.current?.scrollToIndex?.({ index: target - 1, animated: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, initialPageIndex]);

  // Ensure we request generation if missing.
  useEffect(() => {
    if (!output && !isRequesting && !autoRequested && !requestError) {
      setAutoRequested(true);
      start().catch(() => {});
    }
  }, [output, isRequesting, autoRequested, requestError]);

  // Poll as a fallback in case realtime delivery is delayed.
  useEffect(() => {
    if (!output) return;
    if (output.status !== 'queued' && output.status !== 'processing') return;

    const id = setInterval(() => {
      load().catch(() => {});
    }, 4000);

    return () => clearInterval(id);
  }, [output?.status, documentId]);

  // Pre-sign figure URLs when completed
  useEffect(() => {
    const topFigures = Array.isArray(content?.figures) ? content.figures : [];
    const sections = Array.isArray(content?.sections) ? content.sections : [];
    const sectionFigures = sections.flatMap((s: any) => (Array.isArray(s?.figures) ? s.figures : []));
    const allFigures = [...topFigures, ...sectionFigures];
    if (allFigures.length === 0) return;

    let cancelled = false;
    (async () => {
      const next: Record<string, string | null> = {};
      for (const f of allFigures) {
        const imagePath = f?.imagePath;
        if (!imagePath) continue;
        const key = String(imagePath);
        if (figureUrls[key] !== undefined) continue;
        const url = await createDocAssetsSignedUrl(String(imagePath), 1800);
        next[key] = url;
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setFigureUrls((prev) => ({ ...prev, ...next }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content, figureUrls]);

  const sections = Array.isArray(content?.sections) ? content.sections : [];
  const diagrams = Array.isArray(content?.diagrams) ? content.diagrams : [];
  const equations = Array.isArray(content?.equationsLatex) ? content.equationsLatex : [];
  const tables = Array.isArray(content?.tables) ? content.tables : [];
  const figures = Array.isArray(content?.figures) ? content.figures : [];

  const pageWidth = Dimensions.get('window').width;

  const pageNumbers = useMemo(() => {
    if (!pageCount || pageCount <= 0) return [] as number[];
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }, [pageCount]);

  const onPageScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    // FlatList items render at (pageWidth - 32) with a 16px right margin => stride = (pageWidth - 16)
    // Keep this in sync with getItemLayout length/offset below.
    const idx0 = Math.round(x / (pageWidth - 16));
    const pageIdx = idx0 + 1;
    setActivePageIndex(pageIdx);
    ensurePageAssets(pageIdx).catch(() => {});
    ensurePageAssets(pageIdx + 1).catch(() => {});
  };

  const renderPage = ({ item: p }: { item: number }) => {
    const url = pageImageUrls[p] ?? null;
    const explanation = pageExplanations[p] || '';
    const isExplaining = Boolean(pageExplainLoading[p]);
    const pageText = pageTexts[p] || '';
    const pageMeta = pages.find((x) => Number((x as any)?.page_index) === p) as any;
    const pageStatus = pageMeta?.status ? String(pageMeta.status) : null;

    return (
      <View key={`page-${p}`} style={{ width: pageWidth - 32, marginRight: 16 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
          <Card>
            <Text style={styles.title}>Page {p}</Text>
            {pageStatus ? <Text style={styles.statusText}>Extraction: {pageStatus}</Text> : null}

            {url ? (
              <ScrollView
                style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden' }}
                contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}
                maximumZoomScale={3}
                minimumZoomScale={1}
                pinchGestureEnabled
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                <Image source={{ uri: url }} style={styles.pageImage} resizeMode="contain" />
              </ScrollView>
            ) : (
              <View style={styles.pageImagePlaceholder}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.statusText, { marginTop: 10 }]}>Preparing page preview…</Text>
                <Button
                  title="Retry"
                  variant="outline"
                  onPress={() => ensurePageAssets(p)}
                  style={{ marginTop: 12 }}
                />

                {docSignedUrl && docIsPdf ? (
                  <Button
                    title="Open PDF"
                    variant="outline"
                    onPress={() => Linking.openURL(docSignedUrl)}
                    style={{ marginTop: 10 }}
                  />
                ) : null}
              </View>
            )}
          </Card>

          <Card>
            <Text style={styles.title}>Page Text</Text>
            {pageText ? (
              <View style={{ marginTop: 10 }}>
                <ScrollView style={{ maxHeight: 220 }}>
                  <Text style={styles.bodySelectable} selectable>
                    {pageText}
                  </Text>
                </ScrollView>
              </View>
            ) : (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.statusText}>Swipe to this page to load its extracted text.</Text>
                <Button title="Load text" variant="outline" onPress={() => ensurePageAssets(p)} style={{ marginTop: 12 }} />
              </View>
            )}
          </Card>

          <Card>
            <Text style={styles.title}>Explanation</Text>
            {isExplaining ? (
              <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.statusText}>Generating…</Text>
              </View>
            ) : explanation ? (
              <Text style={styles.bodySelectable} selectable>{explanation}</Text>
            ) : (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.statusText}>Swipe to this page to generate its explanation.</Text>
                <Button
                  title="Generate for this page"
                  variant="primary"
                  onPress={() => ensurePageAssets(p)}
                  style={{ marginTop: 12 }}
                />
              </View>
            )}
          </Card>
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Header title="Deep Explain" subtitle="Page-by-page explanation (grounded in extracted text)" />

      <View style={styles.content}>
        <Button
          title="Back to Actions"
          variant="outline"
          onPress={() => navigation.navigate('DocumentActions', { documentId })}
          style={{ marginBottom: 12 }}
        />

        <Card>
          <Text style={styles.title}>Status</Text>

          {vendorInfo ? (
            <View style={{ marginTop: 10 }}>
              <VendorBadge vendor={vendorInfo} size="small" showConfidence={false} />
            </View>
          ) : null}

          <View style={styles.statusRow}>
            {(status === 'queued' || status === 'processing' || isRequesting) && (
              <ActivityIndicator size="small" color={colors.primary} />
            )}
            <Text style={styles.statusText}>{isRequesting ? 'Requesting…' : status}</Text>
          </View>

          {prepMessage ? <Text style={[styles.statusText, { marginTop: 8 }]}>{prepMessage}</Text> : null}

          {friendlyRequestError ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>{String(friendlyRequestError)}</Text>
            </View>
          ) : null}

          {coverageWarning ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>{coverageWarning}</Text>
            </View>
          ) : null}

          <Button title="Regenerate" variant="outline" onPress={start} style={{ marginTop: 12 }} />
        </Card>

        {pageCount > 0 ? (
          <View style={{ marginTop: 14, flex: 1 }}>
            <FlatList
              ref={pagesListRef}
              data={pageNumbers}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onPageScrollEnd}
              renderItem={renderPage}
              keyExtractor={(p) => `page-${p}`}
              getItemLayout={(_, index) => ({ length: pageWidth - 16, offset: (pageWidth - 16) * index, index })}
              initialScrollIndex={initialPageIndex && Number.isFinite(initialPageIndex) ? Math.max(0, Math.min(pageCount - 1, Math.floor(initialPageIndex) - 1)) : 0}
            />

            <Text style={[styles.statusText, { marginTop: 10, textAlign: 'center' }]}>
              Page {Math.min(Math.max(activePageIndex, 1), pageCount)} / {pageCount}
            </Text>
          </View>
        ) : null}

        {pageCount <= 0 && status === 'completed' && content && sections.length > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1, marginTop: 14 }}
          >
            {sections.map((s: any, idx: number) => {
              const explanation = s?.explanation ? String(s.explanation) : '';
              const bullets = Array.isArray(s?.bullets) ? s.bullets : [];

              const topicDiagrams = Array.isArray(s?.diagrams) ? s.diagrams : idx === 0 ? diagrams : [];
              const topicEquations = Array.isArray(s?.equationsLatex) ? s.equationsLatex : idx === 0 ? equations : [];
              const topicTables = Array.isArray(s?.tables) ? s.tables : idx === 0 ? tables : [];
              const topicFigures = Array.isArray(s?.figures) ? s.figures : idx === 0 ? figures : [];

              return (
                <View key={`topic-${idx}`} style={{ width: pageWidth - 32, marginRight: 16 }}>
                  <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
                    <Card>
                      <Text style={styles.title}>{String(s?.title || `Topic ${idx + 1}`)}</Text>
                      {explanation ? <Text style={styles.body}>{explanation}</Text> : null}
                      {bullets.length > 0 ? (
                        <View style={{ marginTop: 10 }}>
                          {bullets.map((b: any, bi: number) => (
                            <Text key={`b-${idx}-${bi}`} style={styles.bullet}>
                              • {String(b)}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </Card>

                    {Array.isArray(topicDiagrams) && topicDiagrams.length > 0 ? (
                      <Card>
                        <Text style={styles.title}>Diagrams</Text>
                        {topicDiagrams.map((dgm: any, di: number) => (
                          <View key={`dgm-${idx}-${di}`} style={{ marginTop: 10 }}>
                            {dgm?.title ? <Text style={styles.sectionTitle}>{String(dgm.title)}</Text> : null}
                            <DiagramRenderer mermaidCode={String(dgm?.code || '')} height={260} style={{ marginTop: 8 }} />
                          </View>
                        ))}
                      </Card>
                    ) : null}

                    {Array.isArray(topicEquations) && topicEquations.length > 0 ? (
                      <Card>
                        <Text style={styles.title}>Equations</Text>
                        {topicEquations.map((eq: any, i: number) => (
                          <Text key={`eq-${idx}-${i}`} style={styles.mono}>
                            {String(eq)}
                          </Text>
                        ))}
                      </Card>
                    ) : null}

                    {Array.isArray(topicTables) && topicTables.length > 0 ? (
                      <Card>
                        <Text style={styles.title}>Tables</Text>
                        {topicTables.map((tbl: any, ti: number) => (
                          <View key={`tbl-${idx}-${ti}`} style={styles.tableContainer}>
                            {tbl?.title ? <Text style={styles.sectionTitle}>{String(tbl.title)}</Text> : null}
                            {Array.isArray(tbl?.headers) && tbl.headers.length > 0 ? (
                              <View style={styles.tableRow}>
                                {tbl.headers.slice(0, 6).map((h: any, hi: number) => (
                                  <Text key={`th-${idx}-${ti}-${hi}`} style={[styles.tableCell, styles.tableHeaderCell]} numberOfLines={2}>
                                    {String(h)}
                                  </Text>
                                ))}
                              </View>
                            ) : null}
                            {(Array.isArray(tbl?.rows) ? tbl.rows : []).slice(0, 12).map((row: any[], ri: number) => (
                              <View key={`tr-${idx}-${ti}-${ri}`} style={styles.tableRow}>
                                {(Array.isArray(row) ? row : []).slice(0, 6).map((c: any, ci: number) => (
                                  <Text key={`tc-${idx}-${ti}-${ri}-${ci}`} style={styles.tableCell} numberOfLines={3}>
                                    {String(c)}
                                  </Text>
                                ))}
                              </View>
                            ))}
                          </View>
                        ))}
                      </Card>
                    ) : null}

                    {Array.isArray(topicFigures) && topicFigures.length > 0 ? (
                      <Card>
                        <Text style={styles.title}>Figures</Text>
                        {topicFigures.map((f: any, i: number) => {
                          const imagePath = f?.imagePath ? String(f.imagePath) : '';
                          const signedUrl = imagePath ? figureUrls[imagePath] : null;
                          return (
                            <View key={`fig-${idx}-${i}`} style={{ marginTop: 12 }}>
                              <Text style={styles.sectionTitle}>Page {String(f?.page ?? '?')}</Text>
                              {f?.summary ? <Text style={styles.bullet}>{String(f.summary)}</Text> : null}
                              {signedUrl ? (
                                <Image source={{ uri: signedUrl }} style={styles.figureImage} resizeMode="contain" />
                              ) : null}
                            </View>
                          );
                        })}
                      </Card>
                    ) : null}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>
        ) : null}

        {status === 'failed' ? (
          <Card>
            <Text style={styles.title}>Failed</Text>
            <Text style={styles.body}>
              Deep Explain generation failed. If this is a new setup, verify the worker has `OPENAI_API_KEY` configured.
            </Text>
            {outputFailureDetails ? (
              <View style={[styles.warningBox, { marginTop: 12 }]}>
                <Text style={styles.warningText}>{outputFailureDetails}</Text>
              </View>
            ) : null}
          </Card>
        ) : null}
      </View>
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  statusText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  warningBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warningText: {
    color: colors.text,
    fontSize: 13,
  },
  sectionTitle: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  bullet: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  bodySelectable: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  mono: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.cardBackground,
    color: colors.text,
    fontFamily: 'Courier',
  },
  tableContainer: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    flex: 1,
    padding: 8,
    fontSize: 12,
    color: colors.text,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderCell: {
    fontWeight: '700',
    backgroundColor: colors.cardBackground,
  },
  figureImage: {
    width: '100%',
    height: 220,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: colors.cardBackground,
  },

  pageImage: {
    width: '100%',
    height: 360,
    borderRadius: 10,
    backgroundColor: colors.cardBackground,
  },
  pdfPreviewWrap: {
    width: '100%',
    height: 360,
    marginTop: 10,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  pdfPreview: {
    flex: 1,
    backgroundColor: colors.cardBackground,
  },
  pageImagePlaceholder: {
    width: '100%',
    height: 360,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
});
