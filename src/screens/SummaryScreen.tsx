import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, FlatList, Dimensions } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument, isSummaryGenerating } from '../hooks/useDocument';
import { generateSummary } from '../services/openai';
import { updateDocumentSummary, getDocumentById } from '../services/storage';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type SummaryScreenProps = MainDrawerScreenProps<'Summary'>;
type SummaryLanguage = 'en' | 'ar';

const SCREEN_WIDTH = Dimensions.get('window').width;

export const SummaryScreen: React.FC = () => {
  const route = useRoute<SummaryScreenProps['route']>();
  const navigation = useNavigation<any>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [summaryImage, setSummaryImage] = useState<string | null>(null);
  const [documentImages, setDocumentImages] = useState<{pageNum: number, url: string}[]>([]);
  const [displaySummary, setDisplaySummary] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBackgroundGenerating, setIsBackgroundGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguage>('en');
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadDocumentAndSummary();
    
    // Cleanup polling on unmount
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

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
    if (!document) return;
    
    // ENHANCED: Try multiple sources for content
    let contentToUse = document.content || '';
    
    // Fallback 1: Try extracted data pages
    if (!contentToUse && document.extractedData?.pages) {
      contentToUse = document.extractedData.pages
        .map(p => p.text || '')
        .join('\n\n');
    }
    
    // Fallback 2: Try extracted data text
    if (!contentToUse && document.extractedData?.text) {
      contentToUse = document.extractedData.text;
    }
    
    // Fallback 3: Try chunks
    if (!contentToUse && document.chunks && document.chunks.length > 0) {
      contentToUse = document.chunks.join('\n\n');
    }
    
    setIsGenerating(true);
    setProgress(0);
    setProgressMessage(summaryLanguage === 'ar' ? 'جاري البدء...' : 'Starting...');

    try {
      // Pass existing extracted data to avoid re-uploading to cloud
      const generatedSummary = await generateSummary(
        contentToUse,
        document.chunks,
        handleProgress,
        document.fileUri,
        document.fileType,
        document.pdfCloudUrl,  // Pass existing cloud URL
        document.extractedData,  // Pass existing extracted data
        summaryLanguage  // Pass selected language
      );
      setSummary(generatedSummary);
      
      // Save summary to document for future instant access
      await updateDocumentSummary(document.id, generatedSummary);
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

        {!summary && !isGenerating && !isBackgroundGenerating && (
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

        {summary && ! isGenerating && (
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
                    <View key={index} style={styles.imageContainer}>
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
