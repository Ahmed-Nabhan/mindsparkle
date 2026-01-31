import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Image,
  Platform,
  Share,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { DocumentSelector } from '../components/DocumentSelector';
import { useDocument } from '../hooks/useDocument';
import { usePremiumContext } from '../context/PremiumContext';
import Config from '../services/config';
import canvaService from '../services/canvaService';
import type { Document } from '../types/document';
import type { MainDrawerScreenProps } from '../navigation/types';

// Presentation styles
const PRESENTATION_STYLES = [
  { id: 'professional', name: 'Professional', icon: '💼', description: 'Clean corporate look' },
  { id: 'modern', name: 'Modern', icon: '✨', description: 'Bold contemporary design' },
  { id: 'minimal', name: 'Minimal', icon: '⬜', description: 'Simple elegant whitespace' },
  { id: 'creative', name: 'Creative', icon: '🎨', description: 'Colorful dynamic style' },
  { id: 'dark', name: 'Dark Mode', icon: '🌙', description: 'Dark background theme' },
  { id: 'academic', name: 'Academic', icon: '📚', description: 'Scholarly formal style' },
  { id: 'startup', name: 'Startup Pitch', icon: '🚀', description: 'High-energy investor ready' },
  { id: 'education', name: 'Education', icon: '🎓', description: 'Friendly learning style' },
];

const SLIDE_COUNTS = [5, 8, 10, 15, 20];

const PRESENTATION_STRUCTURE: 'topics' | 'classic' = 'topics';

type Phase = 'select' | 'configure' | 'generating' | 'preview' | 'complete';

type PresentationScreenProps = MainDrawerScreenProps<'Presentation'>;

export const PresentationScreen: React.FC = () => {
  const route = useRoute<PresentationScreenProps['route']>();
  const navigation = useNavigation<PresentationScreenProps['navigation']>();
  const { getDocument } = useDocument();
  const { isPremium, features, dailyPresentationCount, incrementPresentationCount, showPaywall } = usePremiumContext();
  
  const [phase, setPhase] = useState<Phase>('select');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedStyle, setSelectedStyle] = useState('professional');
  const [slideCount, setSlideCount] = useState(10);
  const [includeImages, setIncludeImages] = useState(true);
  const [imageMode, setImageMode] = useState<'default' | 'realism' | 'premium'>('default');
  const [includeWebSearch, setIncludeWebSearch] = useState(true);
  const [outputFormat, setOutputFormat] = useState<'pptx' | 'pdf'>('pptx');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [previewSlides, setPreviewSlides] = useState<any[]>([]);

  // If launched from Document Actions, auto-select the document.
  useEffect(() => {
    const documentId = route.params?.documentId;
    if (!documentId) return;
    (async () => {
      try {
        const doc = await getDocument(documentId);
        if (doc) {
          setSelectedDocument(doc);
          setPhase('configure');
        }
      } catch (err) {
        console.warn('[Presentation] Failed to auto-load document:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.documentId]);

  const canGeneratePresentation = (): boolean => {
    if (isPremium) return true;
    const limit = features.maxPresentationsPerDay;
    if (limit === -1) return true;
    return dailyPresentationCount < limit;
  };

  const handleDocumentSelect = (doc: Document) => {
    setSelectedDocument(doc);
    setPhase('configure');
  };

  const handleGeneratePreview = async () => {
    if (!selectedDocument) return;

    // Daily limit check (free tier)
    if (!canGeneratePresentation()) {
      showPaywall('Unlimited AI Presentations');
      return;
    }
    
    // Premium check for advanced features
    if (!isPremium && (slideCount > 10 || includeImages)) {
      showPaywall('AI Presentations');
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Analyzing document structure...');
    setProgress(10);

    try {
      // Get document content
      let content = selectedDocument.content || '';
      if (!content && selectedDocument.extractedData?.pages) {
        content = selectedDocument.extractedData.pages
          .map((p: any) => p.text || '')
          .join('\n\n');
      }
      if (!content && selectedDocument.chunks) {
        content = selectedDocument.chunks.join('\n\n');
      }

      if (!content || content.length < 100) {
        Alert.alert('Error', 'Document content not available. Please try re-uploading.');
        return;
      }

      setProgress(30);
      setLoadingMessage('Generating slide structure with AI...');

      // Call preview endpoint (fast, no images)
      const response = await fetch(`${Config.PRESENTATION_AI_URL}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.substring(0, 20000),
          style: selectedStyle,
          slide_count: slideCount,
          structure: PRESENTATION_STRUCTURE,
        }),
      });

      const data = await response.json();
      
      if (data.success && data.slides) {
        setPreviewSlides(data.slides);
        setProgress(100);
        setPhase('preview');
      } else {
        throw new Error(data.error || 'Failed to generate preview');
      }

    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate preview');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateFull = async () => {
    if (!selectedDocument) return;

    // Daily limit check (free tier)
    if (!canGeneratePresentation()) {
      showPaywall('Unlimited AI Presentations');
      return;
    }

    // Count a full generation against the daily limit.
    incrementPresentationCount();

    setIsLoading(true);
    setPhase('generating');
    setProgress(0);
    setLoadingMessage('Starting presentation generation...');

    try {
      let content = selectedDocument.content || '';
      if (!content && selectedDocument.extractedData?.pages) {
        content = selectedDocument.extractedData.pages
          .map((p: any) => p.text || '')
          .join('\n\n');
      }

      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev < 90) {
            const newProgress = prev + Math.random() * 10;
            
            if (newProgress < 30) {
              setLoadingMessage('🤖 GPT-4o analyzing content structure...');
            } else if (newProgress < 50) {
              setLoadingMessage('🎨 Generating custom images...');
            } else if (newProgress < 70) {
              setLoadingMessage('📊 Creating diagrams and charts...');
            } else if (newProgress < 90) {
              setLoadingMessage(outputFormat === 'pdf' ? '📄 Building PDF slides...' : '📝 Building PowerPoint slides...');
            }
            
            return newProgress;
          }
          return prev;
        });
      }, 2000);

      // Optionally generate images via Canva (best-effort) when images requested
      let imageUrls: string[] | undefined = undefined;
      if (includeImages && outputFormat === 'pptx') {
        try {
          setLoadingMessage('🎨 Generating images (Canva)...');
          imageUrls = await canvaService.generateImagesForPresentation(content, slideCount, selectedStyle);
          console.log('[Presentation] Canva returned', imageUrls?.length, 'images');
        } catch (err) {
          console.warn('Canva image generation failed, proceeding without images:', err);
          imageUrls = [];
        }
      }

      // Choose endpoint based on format. Use enhanced generation when web search requested.
      const endpointBase = outputFormat === 'pdf' ? '/generate-pdf' : '/generate';
      const endpoint = includeWebSearch ? `${endpointBase}-enhanced` : endpointBase;
      
      const response = await fetch(`${Config.PRESENTATION_AI_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.substring(0, 20000),
          style: selectedStyle,
          slide_count: slideCount,
          structure: PRESENTATION_STRUCTURE,
          include_images: outputFormat === 'pptx' ? includeImages : false, // PDF doesn't have images yet
          image_mode: outputFormat === 'pptx' ? imageMode : undefined,
          imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
          include_web_search: includeWebSearch,
          canva_style: selectedStyle,
          title: selectedDocument.title || 'AI Generated Presentation',
        }),
      });

      clearInterval(progressInterval);
      
      const data = await response.json();
      
      if (data.success) {
        setResult({ ...data, format: outputFormat });
        setProgress(100);
        setLoadingMessage(`✅ ${outputFormat.toUpperCase()} ready!`);
        setPhase('complete');
      } else {
        throw new Error(data.error || 'Failed to generate presentation');
      }

    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate presentation');
      setPhase('configure');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!result?.download_url) return;

    try {
      const downloadUrl = result.download_url.startsWith('http') 
        ? result.download_url 
        : `${Config.PRESENTATION_AI_URL}${result.download_url}`;
      
      // Determine file extension and MIME type based on format
      const format = result.format || 'pptx';
      const extension = format === 'pdf' ? 'pdf' : 'pptx';
      const mimeType = format === 'pdf' 
        ? 'application/pdf' 
        : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      const uti = format === 'pdf' 
        ? 'com.adobe.pdf' 
        : 'org.openxmlformats.presentationml.presentation';
      
      // Generate filename
      const filename = `presentation_${result.request_id || Date.now()}.${extension}`;
      const fileUri = `${FileSystem.documentDirectory}${filename}`;
      
      Alert.alert('Downloading...', `Your ${format.toUpperCase()} is being downloaded.`);
      
      // Download file
      const downloadResult = await FileSystem.downloadAsync(downloadUrl, fileUri);
      
      if (downloadResult.status === 200) {
        // Check if sharing is available
        const canShare = await Sharing.isAvailableAsync();
        
        if (canShare) {
          // Open share sheet so user can save to Files, AirDrop, etc.
          await Sharing.shareAsync(fileUri, {
            mimeType: mimeType,
            dialogTitle: `Save ${format.toUpperCase()}`,
            UTI: uti
          });
          
          const appSuggestion = format === 'pdf' 
            ? 'You can open it with any PDF reader.'
            : 'You can open it with PowerPoint, Keynote, or Google Slides.';
          
          Alert.alert(
            '✅ Downloaded!', 
            `${format.toUpperCase()} saved: ${filename}\n\n${appSuggestion}`
          );
        } else {
          // Fallback: Open in browser
          await Linking.openURL(downloadUrl);
        }
      } else {
        throw new Error('Download failed');
      }
    } catch (error: any) {
      console.error('Download error:', error);
      // Fallback to browser download
      try {
        const downloadUrl = result.download_url.startsWith('http') 
          ? result.download_url 
          : `${Config.PRESENTATION_AI_URL}${result.download_url}`;
        await Linking.openURL(downloadUrl);
      } catch (e) {
        Alert.alert('Error', 'Failed to download presentation');
      }
    }
  };

  // Phase: Document Selection
  if (phase === 'select') {
    return (
      <View style={styles.container}>
        <Header 
          title="AI Presentation" 
          subtitle="Create professional presentations with AI" 
        />
        <ScrollView style={styles.content}>
          <Card>
            <Text style={styles.icon}>🎨</Text>
            <Text style={styles.title}>AI Presentation Generator</Text>
            <Text style={styles.description}>
              Transform your documents into stunning presentations with{'\n'}
              GPT-4o content • DALL-E 3 images • Professional templates
            </Text>
          </Card>

          <DocumentSelector
            onDocumentSelect={handleDocumentSelect}
            title="Select Source Document"
            subtitle="Choose a document to create presentation from"
          />

          <Card>
            <Text style={styles.sectionTitle}>✨ AI-Powered Features</Text>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>🤖</Text>
              <Text style={styles.featureText}>GPT-4o for intelligent slide structure</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>🎨</Text>
              <Text style={styles.featureText}>DALL-E 3 for custom HD images</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>📊</Text>
              <Text style={styles.featureText}>Auto-generated diagrams & charts</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>🎭</Text>
              <Text style={styles.featureText}>8 professional style templates</Text>
            </View>
            <View style={styles.feature}>
              <Text style={styles.featureIcon}>💾</Text>
              <Text style={styles.featureText}>Download as PowerPoint (PPTX)</Text>
            </View>
          </Card>
        </ScrollView>
      </View>
    );
  }

  // Phase: Configuration
  if (phase === 'configure') {
    return (
      <View style={styles.container}>
        <Header 
          title="Configure Presentation" 
          subtitle={selectedDocument?.title || 'Customize your presentation'} 
        />
        <ScrollView style={styles.content}>
          {/* Style Selection */}
          <Card>
            <Text style={styles.sectionTitle}>🎨 Choose Style</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stylesRow}>
              {PRESENTATION_STYLES.map((style) => (
                <TouchableOpacity
                  key={style.id}
                  style={[
                    styles.styleCard,
                    selectedStyle === style.id && styles.styleCardSelected
                  ]}
                  onPress={() => setSelectedStyle(style.id)}
                >
                  <Text style={styles.styleIcon}>{style.icon}</Text>
                  <Text style={[
                    styles.styleName,
                    selectedStyle === style.id && styles.styleNameSelected
                  ]}>{style.name}</Text>
                  <Text style={styles.styleDesc}>{style.description}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Card>

          {/* Slide Count */}
          <Card>
            <Text style={styles.sectionTitle}>📊 Number of Slides</Text>
            <View style={styles.countRow}>
              {SLIDE_COUNTS.map((count) => (
                <TouchableOpacity
                  key={count}
                  style={[
                    styles.countButton,
                    slideCount === count && styles.countButtonSelected
                  ]}
                  onPress={() => setSlideCount(count)}
                >
                  <Text style={[
                    styles.countText,
                    slideCount === count && styles.countTextSelected
                  ]}>{count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* Options */}
          <Card>
            <Text style={styles.sectionTitle}>⚙️ Options</Text>
            
            {/* Output Format */}
            <View style={styles.formatSelector}>
              <Text style={styles.optionTitle}>Output Format</Text>
              <View style={styles.formatButtons}>
                <TouchableOpacity
                  style={[styles.formatButton, outputFormat === 'pptx' && styles.formatButtonActive]}
                  onPress={() => setOutputFormat('pptx')}
                >
                  <Text style={styles.formatIcon}>📊</Text>
                  <Text style={[styles.formatText, outputFormat === 'pptx' && styles.formatTextActive]}>PPTX</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.formatButton, outputFormat === 'pdf' && styles.formatButtonActive]}
                  onPress={() => setOutputFormat('pdf')}
                >
                  <Text style={styles.formatIcon}>📄</Text>
                  <Text style={[styles.formatText, outputFormat === 'pdf' && styles.formatTextActive]}>PDF</Text>
                </TouchableOpacity>
              </View>
            </View>
            
            {outputFormat === 'pptx' && (
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => setIncludeImages(!includeImages)}
              >
                <View style={styles.optionLeft}>
                  <Text style={styles.optionIcon}>🖼️</Text>
                  <View>
                    <Text style={styles.optionTitle}>Generate AI Images</Text>
                    <Text style={styles.optionDesc}>Choose image quality</Text>
                  </View>
                </View>
                <View style={[styles.toggle, includeImages && styles.toggleOn]}>
                  <View style={[styles.toggleCircle, includeImages && styles.toggleCircleOn]} />
                </View>
              </TouchableOpacity>
            )}

            {outputFormat === 'pptx' && includeImages && (
              <View style={styles.imageModeSelector}>
                <Text style={styles.optionTitle}>Image Quality</Text>
                <View style={styles.imageModeButtons}>
                  <TouchableOpacity
                    style={[styles.imageModeButton, imageMode === 'default' && styles.imageModeButtonActive]}
                    onPress={() => setImageMode('default')}
                  >
                    <Text style={[styles.imageModeText, imageMode === 'default' && styles.imageModeTextActive]}>Default</Text>
                    <Text style={styles.imageModeSub}>DALL·E</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.imageModeButton, imageMode === 'realism' && styles.imageModeButtonActive]}
                    onPress={() => setImageMode('realism')}
                  >
                    <Text style={[styles.imageModeText, imageMode === 'realism' && styles.imageModeTextActive]}>Enhance realism</Text>
                    <Text style={styles.imageModeSub}>Nano Banana</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.imageModeButton, imageMode === 'premium' && styles.imageModeButtonActive]}
                    onPress={() => setImageMode('premium')}
                  >
                    <Text style={[styles.imageModeText, imageMode === 'premium' && styles.imageModeTextActive]}>Premium visuals</Text>
                    <Text style={styles.imageModeSub}>Midjourney (optional)</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            
            {outputFormat === 'pdf' && (
              <View style={styles.formatNote}>
                <Text style={styles.formatNoteText}>📝 PDF format creates a clean, printable document</Text>
              </View>
            )}
            
            {!isPremium && (
              <View style={styles.proNotice}>
                <View style={styles.optionRow}>
                  <Text style={styles.optionTitle}>Enrich from Web</Text>
                  <TouchableOpacity onPress={() => setIncludeWebSearch(!includeWebSearch)}>
                    <Text style={styles.toggleText}>{includeWebSearch ? 'Yes' : 'No'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.proNoticeText}>
                  ⭐ Pro unlocks unlimited slides & AI images
                </Text>
              </View>
            )}
          </Card>

          {/* Generate Button */}
          <View style={styles.buttonContainer}>
            <Button
              title="Preview Slides"
              onPress={handleGeneratePreview}
              disabled={isLoading}
              style={styles.previewButton}
            />
            <Button
              title={isLoading ? 'Generating...' : `✨ Generate ${outputFormat.toUpperCase()}`}
              onPress={handleGenerateFull}
              disabled={isLoading}
            />
          </View>

          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>{loadingMessage}</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // Phase: Generating
  if (phase === 'generating') {
    return (
      <View style={styles.container}>
        <Header title="Creating Presentation" subtitle="AI is working its magic..." />
        <View style={styles.generatingContainer}>
          <View style={styles.generatingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.generatingTitle}>{loadingMessage}</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
            
            <View style={styles.aiStack}>
              <Text style={styles.aiStackTitle}>AI Stack in Action:</Text>
              <Text style={[styles.aiStackItem, progress > 10 && styles.aiStackItemActive]}>
                🤖 GPT-4o - Content Structure
              </Text>
              <Text style={[styles.aiStackItem, progress > 30 && styles.aiStackItemActive]}>
                🎨 Image Generation - DALL·E / Nano Banana / Midjourney
              </Text>
              <Text style={[styles.aiStackItem, progress > 50 && styles.aiStackItemActive]}>
                📊 Mermaid - Diagrams & Charts
              </Text>
              <Text style={[styles.aiStackItem, progress > 70 && styles.aiStackItemActive]}>
                📝 Python-PPTX - Slide Builder
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Phase: Preview
  if (phase === 'preview') {
    return (
      <View style={styles.container}>
        <Header title="Preview Slides" subtitle={`${previewSlides.length} slides generated`} />
        <ScrollView style={styles.content}>
          {previewSlides.map((slide, index) => (
            <Card key={index} style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <Text style={styles.previewSlideNum}>Slide {index + 1}</Text>
                <Text style={styles.previewType}>{slide.slide_type}</Text>
              </View>
              <Text style={styles.previewTitle}>{slide.title}</Text>
              {slide.bullet_points && slide.bullet_points.map((point: string, i: number) => (
                <Text key={i} style={styles.previewBullet}>• {point}</Text>
              ))}
              {slide.image_prompt && (
                <Text style={styles.previewImage}>🖼️ AI Image: {slide.image_prompt.substring(0, 60)}...</Text>
              )}
            </Card>
          ))}
          
          <View style={styles.buttonContainer}>
            <Button
              title="← Modify"
              onPress={() => setPhase('configure')}
              style={styles.secondaryButton}
            />
            <Button
              title="✨ Generate Full Presentation"
              onPress={handleGenerateFull}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  // Phase: Complete
  if (phase === 'complete') {
    return (
      <View style={styles.container}>
        <Header title="Presentation Ready!" subtitle="Your AI presentation is complete" />
        <ScrollView style={styles.content} contentContainerStyle={styles.completeContainer}>
          <Card style={styles.completeCard}>
            <Text style={styles.completeIcon}>🎉</Text>
            <Text style={styles.completeTitle}>Presentation Created!</Text>
            <Text style={styles.completeStats}>
              {result?.slide_count} slides • {result?.style} style • {result?.duration}s
            </Text>
            
            <View style={styles.completeInfo}>
              <Text style={styles.completeInfoItem}>✅ AI-structured content</Text>
              {includeImages && <Text style={styles.completeInfoItem}>✅ Custom AI images</Text>}
              <Text style={styles.completeInfoItem}>✅ Professional {selectedStyle} design</Text>
              {result?.include_notes === false || result?.structure === 'topics' || PRESENTATION_STRUCTURE === 'topics' ? (
                <Text style={styles.completeInfoItem}>✅ No speaker notes</Text>
              ) : (
                <Text style={styles.completeInfoItem}>✅ Speaker notes included</Text>
              )}
            </View>
            
            <TouchableOpacity style={styles.downloadButton} onPress={handleDownload}>
              <Text style={styles.downloadButtonText}>📥 Download PowerPoint</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.newButton}
              onPress={() => {
                setPhase('select');
                setResult(null);
                setSelectedDocument(null);
              }}
            >
              <Text style={styles.newButtonText}>Create Another</Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      </View>
    );
  }

  return null;
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
  icon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  featureText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  stylesRow: {
    marginHorizontal: -8,
  },
  styleCard: {
    width: 120,
    padding: 16,
    marginHorizontal: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  styleCardSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}10`,
  },
  styleIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  styleName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  styleNameSelected: {
    color: colors.primary,
  },
  styleDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  countButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  countButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}20`,
  },
  countText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  countTextSelected: {
    color: colors.primary,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  optionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  optionDesc: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  imageModeSelector: {
    marginTop: 12,
  },
  imageModeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  imageModeButton: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
  },
  imageModeButtonActive: {
    borderColor: colors.primary,
  },
  imageModeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  imageModeTextActive: {
    color: colors.primary,
  },
  imageModeSub: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
  },
  toggle: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    padding: 2,
  },
  toggleOn: {
    backgroundColor: colors.primary,
  },
  toggleCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  toggleCircleOn: {
    marginLeft: 22,
  },
  proNotice: {
    backgroundColor: `${colors.primary}10`,
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  proNoticeText: {
    color: colors.primary,
    fontSize: 13,
    textAlign: 'center',
  },
  buttonContainer: {
    marginVertical: 20,
    gap: 12,
  },
  previewButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 8,
  },
  generatingContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  generatingCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  generatingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  aiStack: {
    marginTop: 24,
    width: '100%',
  },
  aiStackTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  aiStackItem: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingVertical: 8,
    opacity: 0.5,
  },
  aiStackItemActive: {
    opacity: 1,
    color: colors.primary,
  },
  previewCard: {
    marginBottom: 12,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  previewSlideNum: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  previewType: {
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  previewBullet: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
    paddingLeft: 8,
  },
  previewImage: {
    fontSize: 12,
    color: colors.primary,
    fontStyle: 'italic',
    marginTop: 8,
  },
  completeContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  completeCard: {
    alignItems: 'center',
    padding: 32,
  },
  completeIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  completeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  completeStats: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  completeInfo: {
    alignSelf: 'stretch',
    marginBottom: 24,
  },
  completeInfoItem: {
    fontSize: 15,
    color: colors.text,
    paddingVertical: 6,
  },
  downloadButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  newButton: {
    paddingVertical: 12,
  },
  newButtonText: {
    color: colors.primary,
    fontSize: 16,
  },
  formatSelector: {
    marginBottom: 16,
  },
  formatButtons: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 12,
  },
  formatButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  formatButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  formatIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  formatText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  formatTextActive: {
    color: colors.primary,
  },
  formatNote: {
    backgroundColor: colors.primary + '10',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  formatNoteText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  toggleText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
});

export default PresentationScreen;
