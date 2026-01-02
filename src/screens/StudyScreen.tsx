import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Image, Dimensions, Alert, Animated } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Button } from '../components/Button';
import { useDocument } from '../hooks/useDocument';
import { generateStudyGuide } from '../services/openai';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type StudyScreenProps = MainDrawerScreenProps<'Study'>;

interface StudyGuideSection {
  title: string;
  pageRef: number;
  keyPoints: { point: string; pageRef: number }[];
}

interface StructuredStudyGuide {
  title: string;
  sections: StudyGuideSection[];
  keyTerms: { term: string; definition: string; pageRef: number }[];
  reviewChecklist: { item: string; pageRef: number }[];
}

const SCREEN_WIDTH = Dimensions.get('window').width;

export const StudyScreen: React.FC = () => {
  const route = useRoute<StudyScreenProps['route']>();
  const navigation = useNavigation<any>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [studyGuide, setStudyGuide] = useState<StructuredStudyGuide | null>(null);
  const [studyGuideText, setStudyGuideText] = useState<string>('');
  const [pageImages, setPageImages] = useState<{ pageNum: number; imageUrl: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPageViewer, setShowPageViewer] = useState(false);
  const [selectedPage, setSelectedPage] = useState<{ pageNum: number; imageUrl: string } | null>(null);
  
  // Flashcard mode state
  const [viewMode, setViewMode] = useState<'guide' | 'flashcards'>('guide');
  const [currentFlashcard, setCurrentFlashcard] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [masteredCards, setMasteredCards] = useState<Set<number>>(new Set());
  const flipAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadDocument();
  }, []);

  const loadDocument = async () => {
    const doc = await getDocument(route.params.documentId);
    if (doc) {
      setDocument(doc);
    } else {
      setDocument(null);
    }
    setIsLoading(false);
  };

  const handleGenerateStudyGuide = async () => {
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
    
    // Check if we have enough content
    if (!contentToUse || contentToUse.trim().length < 50) {
      Alert.alert(
        'Content Not Available', 
        'Could not extract text from this document. It may be:\n\n• A scanned PDF (image-only)\n• Password protected\n• Corrupted\n\nTry uploading a text-based PDF or different document.'
      );
      return;
    }
    
    setIsGenerating(true);
    try {
      const result = await generateStudyGuide(
        contentToUse,
        document.chunks,
        undefined,
        document.fileUri,
        document.fileType
      );
      
      // Handle the result properly - it's an object with structured and text
      if (typeof result === 'object' && result !== null) {
        if (result.structured) {
          setStudyGuide(result.structured);
        }
        if (result.text) {
          setStudyGuideText(result.text);
        }
        if (result.pageImages) {
          setPageImages(result.pageImages);
        }
      } else if (typeof result === 'string') {
        // Fallback for string result
        setStudyGuideText(result);
      }
    } catch (error: any) {
      console.error('Error generating study guide:', error);
      Alert.alert('Error', 'Failed to generate study guide: ' + (error.message || 'Unknown error'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGoToPage = (pageNum: number) => {
    // Find the page image
    const pageImage = pageImages.find(p => p.pageNum === pageNum);
    if (pageImage) {
      setSelectedPage(pageImage);
      setShowPageViewer(true);
    } else if (pageImages.length > 0) {
      // Find closest page
      const closest = pageImages.reduce((prev, curr) => 
        Math.abs(curr.pageNum - pageNum) < Math.abs(prev.pageNum - pageNum) ? curr : prev
      );
      setSelectedPage(closest);
      setShowPageViewer(true);
    } else {
      Alert.alert('Page Not Available', `Page ${pageNum} image is not available. The PDF may need to be re-processed.`);
    }
  };

  const handleBack = () => {
    navigation.navigate('DocumentActions', { documentId: route.params.documentId });
  };

  // Flashcard functions
  const flashcards = studyGuide?.keyTerms || [];
  
  const flipCard = () => {
    Animated.spring(flipAnimation, {
      toValue: isFlipped ? 0 : 1,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
    setIsFlipped(!isFlipped);
  };
  
  const nextFlashcard = () => {
    if (currentFlashcard < flashcards.length - 1) {
      setCurrentFlashcard(currentFlashcard + 1);
      setIsFlipped(false);
      flipAnimation.setValue(0);
    }
  };
  
  const prevFlashcard = () => {
    if (currentFlashcard > 0) {
      setCurrentFlashcard(currentFlashcard - 1);
      setIsFlipped(false);
      flipAnimation.setValue(0);
    }
  };
  
  const toggleMastered = () => {
    const newMastered = new Set(masteredCards);
    if (newMastered.has(currentFlashcard)) {
      newMastered.delete(currentFlashcard);
    } else {
      newMastered.add(currentFlashcard);
    }
    setMasteredCards(newMastered);
  };
  
  const shuffleCards = () => {
    setCurrentFlashcard(Math.floor(Math.random() * flashcards.length));
    setIsFlipped(false);
    flipAnimation.setValue(0);
  };

  // Animation interpolation for flip
  const frontInterpolate = flipAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  
  const backInterpolate = flipAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

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

  const renderPageButton = (pageNum: number) => (
    <TouchableOpacity 
      style={styles.pageButton} 
      onPress={() => handleGoToPage(pageNum)}
    >
      <Text style={styles.pageButtonText}>📄 Go to Page {pageNum}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Header title="Study Mode" subtitle={document.title} />
      
      <ScrollView style={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>← Back to Actions</Text>
        </TouchableOpacity>

        <Card>
          <Text style={styles.icon}>📚</Text>
          <Text style={styles.title}>AI-Assisted Study</Text>
          <Text style={styles.description}>
            Generate a comprehensive study guide with clickable page references to help you study each topic.
          </Text>
        </Card>

        {/* View Mode Toggle - only show when study guide exists */}
        {(studyGuide || studyGuideText) && !isGenerating && flashcards.length > 0 && (
          <View style={styles.viewModeToggle}>
            <TouchableOpacity
              style={[styles.modeButton, viewMode === 'guide' && styles.modeButtonActive]}
              onPress={() => setViewMode('guide')}
            >
              <Text style={[styles.modeButtonText, viewMode === 'guide' && styles.modeButtonTextActive]}>
                📖 Guide
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, viewMode === 'flashcards' && styles.modeButtonActive]}
              onPress={() => setViewMode('flashcards')}
            >
              <Text style={[styles.modeButtonText, viewMode === 'flashcards' && styles.modeButtonTextActive]}>
                🎴 Flashcards
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!studyGuide && !studyGuideText && !isGenerating && (
          <Button
            title="Generate Study Guide"
            onPress={handleGenerateStudyGuide}
            style={styles.button}
          />
        )}

        {isGenerating && (
          <Card>
            <LoadingSpinner message="Generating study guide with page references..." />
          </Card>
        )}

        {/* Flashcard Mode */}
        {viewMode === 'flashcards' && flashcards.length > 0 && !isGenerating && (
          <>
            {/* Progress indicator */}
            <View style={styles.flashcardProgress}>
              <Text style={styles.flashcardCount}>
                Card {currentFlashcard + 1} of {flashcards.length}
              </Text>
              <Text style={styles.masteredCount}>
                ✅ {masteredCards.size} mastered
              </Text>
            </View>

            {/* Flashcard */}
            <TouchableOpacity 
              style={styles.flashcardContainer}
              onPress={flipCard}
              activeOpacity={0.9}
            >
              {/* Front of card (Term) */}
              <Animated.View
                style={[
                  styles.flashcard,
                  styles.flashcardFront,
                  { transform: [{ rotateY: frontInterpolate }] },
                  masteredCards.has(currentFlashcard) && styles.flashcardMastered,
                ]}
              >
                <Text style={styles.flashcardLabel}>TERM</Text>
                <Text style={styles.flashcardTerm}>{flashcards[currentFlashcard]?.term}</Text>
                <Text style={styles.flipHint}>Tap to flip</Text>
              </Animated.View>

              {/* Back of card (Definition) */}
              <Animated.View
                style={[
                  styles.flashcard,
                  styles.flashcardBack,
                  { transform: [{ rotateY: backInterpolate }] },
                  masteredCards.has(currentFlashcard) && styles.flashcardMastered,
                ]}
              >
                <Text style={styles.flashcardLabel}>DEFINITION</Text>
                <Text style={styles.flashcardDefinition}>
                  {flashcards[currentFlashcard]?.definition}
                </Text>
                <TouchableOpacity 
                  style={styles.pageRefButton}
                  onPress={() => handleGoToPage(flashcards[currentFlashcard]?.pageRef)}
                >
                  <Text style={styles.pageRefText}>📄 Page {flashcards[currentFlashcard]?.pageRef}</Text>
                </TouchableOpacity>
              </Animated.View>
            </TouchableOpacity>

            {/* Navigation buttons */}
            <View style={styles.flashcardNav}>
              <TouchableOpacity
                style={[styles.flashcardNavButton, currentFlashcard === 0 && styles.navButtonDisabled]}
                onPress={prevFlashcard}
                disabled={currentFlashcard === 0}
              >
                <Text style={styles.flashcardNavText}>← Previous</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.flashcardNavButton, currentFlashcard === flashcards.length - 1 && styles.navButtonDisabled]}
                onPress={nextFlashcard}
                disabled={currentFlashcard === flashcards.length - 1}
              >
                <Text style={styles.flashcardNavText}>Next →</Text>
              </TouchableOpacity>
            </View>

            {/* Action buttons */}
            <View style={styles.flashcardActions}>
              <TouchableOpacity 
                style={[styles.actionButton, masteredCards.has(currentFlashcard) && styles.actionButtonActive]}
                onPress={toggleMastered}
              >
                <Text style={styles.actionButtonText}>
                  {masteredCards.has(currentFlashcard) ? '✅ Mastered' : '☐ Mark as Mastered'}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.actionButton} onPress={shuffleCards}>
                <Text style={styles.actionButtonText}>🔀 Shuffle</Text>
              </TouchableOpacity>
            </View>

            {/* Study tips */}
            <Card>
              <Text style={styles.studyTipsTitle}>💡 Study Tips</Text>
              <Text style={styles.studyTip}>• Tap the card to flip between term and definition</Text>
              <Text style={styles.studyTip}>• Mark cards as mastered to track your progress</Text>
              <Text style={styles.studyTip}>• Use shuffle for random review</Text>
            </Card>
          </>
        )}

        {/* Structured Study Guide */}
        {studyGuide && !isGenerating && viewMode === 'guide' && (
          <>
            <Card>
              <Text style={styles.guideTitle}>{studyGuide.title || 'Study Guide'}</Text>
            </Card>

            {/* Sections */}
            {studyGuide.sections && studyGuide.sections.map((section, sectionIndex) => (
              <Card key={`section-${sectionIndex}`}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {renderPageButton(section.pageRef)}
                </View>
                
                {section.keyPoints && section.keyPoints.map((point, pointIndex) => (
                  <View key={`point-${pointIndex}`} style={styles.keyPointRow}>
                    <Text style={styles.keyPoint}>• {point.point}</Text>
                    <TouchableOpacity 
                      style={styles.smallPageButton}
                      onPress={() => handleGoToPage(point.pageRef)}
                    >
                      <Text style={styles.smallPageButtonText}>p.{point.pageRef}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>
            ))}

            {/* Key Terms */}
            {studyGuide.keyTerms && studyGuide.keyTerms.length > 0 && (
              <Card>
                <Text style={styles.sectionTitle}>📖 Key Terms</Text>
                {studyGuide.keyTerms.map((term, index) => (
                  <View key={`term-${index}`} style={styles.termRow}>
                    <View style={styles.termContent}>
                      <Text style={styles.termName}>{term.term}</Text>
                      <Text style={styles.termDefinition}>{term.definition}</Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.smallPageButton}
                      onPress={() => handleGoToPage(term.pageRef)}
                    >
                      <Text style={styles.smallPageButtonText}>p.{term.pageRef}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>
            )}

            {/* Review Checklist */}
            {studyGuide.reviewChecklist && studyGuide.reviewChecklist.length > 0 && (
              <Card>
                <Text style={styles.sectionTitle}>✅ Review Checklist</Text>
                {studyGuide.reviewChecklist.map((item, index) => (
                  <View key={`checklist-${index}`} style={styles.checklistRow}>
                    <Text style={styles.checklistItem}>☐ {item.item}</Text>
                    <TouchableOpacity 
                      style={styles.smallPageButton}
                      onPress={() => handleGoToPage(item.pageRef)}
                    >
                      <Text style={styles.smallPageButtonText}>p.{item.pageRef}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>
            )}

            <Button
              title="Regenerate Study Guide"
              onPress={handleGenerateStudyGuide}
              variant="outline"
              style={styles.button}
            />
          </>
        )}

        {/* Fallback: Plain text study guide */}
        {!studyGuide && studyGuideText && !isGenerating && (
          <Card>
            <Text style={styles.sectionTitle}>Study Guide</Text>
            <Text style={styles.guideText}>{studyGuideText}</Text>
            <Button
              title="Regenerate"
              onPress={handleGenerateStudyGuide}
              variant="outline"
              style={styles.button}
            />
          </Card>
        )}
      </ScrollView>

      {/* Page Viewer Modal */}
      <Modal
        visible={showPageViewer}
        animationType="slide"
        onRequestClose={() => setShowPageViewer(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowPageViewer(false)}>
              <Text style={styles.closeButton}>✕ Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              Page {selectedPage?.pageNum || ''}
            </Text>
            <View style={{ width: 60 }} />
          </View>
          
          {selectedPage?.imageUrl ? (
            <ScrollView 
              style={styles.imageScrollView}
              maximumZoomScale={3}
              minimumZoomScale={1}
            >
              <Image
                source={{ uri: selectedPage.imageUrl }}
                style={styles.pageImage}
                resizeMode="contain"
              />
            </ScrollView>
          ) : (
            <View style={styles.noImageContainer}>
              <Text style={styles.noImageText}>Page image not available</Text>
            </View>
          )}
          
          {/* Page navigation */}
          <View style={styles.pageNavigation}>
            <TouchableOpacity 
              style={styles.navButton}
              onPress={() => {
                const currentIndex = pageImages.findIndex(p => p.pageNum === selectedPage?.pageNum);
                if (currentIndex > 0) {
                  setSelectedPage(pageImages[currentIndex - 1]);
                }
              }}
            >
              <Text style={styles.navButtonText}>← Previous</Text>
            </TouchableOpacity>
            
            <Text style={styles.pageIndicator}>
              {selectedPage?.pageNum} / {pageImages.length > 0 ? pageImages[pageImages.length - 1].pageNum : '?'}
            </Text>
            
            <TouchableOpacity 
              style={styles.navButton}
              onPress={() => {
                const currentIndex = pageImages.findIndex(p => p.pageNum === selectedPage?.pageNum);
                if (currentIndex < pageImages.length - 1) {
                  setSelectedPage(pageImages[currentIndex + 1]);
                }
              }}
            >
              <Text style={styles.navButtonText}>Next →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  icon: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  guideTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.primary,
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    flex: 1,
  },
  keyPointRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingLeft: 8,
  },
  keyPoint: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
    lineHeight: 20,
    marginRight: 8,
  },
  pageButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  pageButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  smallPageButton: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 40,
    alignItems: 'center',
  },
  smallPageButtonText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  termRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  termContent: {
    flex: 1,
    marginRight: 8,
  },
  termName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  termDefinition: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  checklistRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  checklistItem: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  guideText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
  button: {
    margin: 16,
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
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
    backgroundColor: '#111',
  },
  closeButton: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  imageScrollView: {
    flex: 1,
  },
  pageImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.4,
  },
  noImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImageText: {
    color: '#888',
    fontSize: 16,
  },
  pageNavigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#111',
    paddingBottom: 32,
  },
  navButton: {
    padding: 12,
  },
  navButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  pageIndicator: {
    color: '#fff',
    fontSize: 16,
  },
  // Flashcard mode styles
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  modeButtonActive: {
    backgroundColor: colors.primary,
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeButtonTextActive: {
    color: '#fff',
  },
  flashcardProgress: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  flashcardCount: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
  },
  masteredCount: {
    fontSize: 16,
    color: colors.success,
    fontWeight: '600',
  },
  flashcardContainer: {
    minHeight: 300,
    justifyContent: 'center',
  },
  flashcard: {
    minHeight: 250,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  flashcardFront: {
    backgroundColor: colors.primary + '10',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  flashcardBack: {
    backgroundColor: colors.secondary + '10',
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  flashcardMastered: {
    borderColor: colors.success,
    backgroundColor: colors.success + '10',
  },
  flashcardLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 12,
    letterSpacing: 1,
  },
  flashcardTerm: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
  },
  flashcardDefinition: {
    fontSize: 18,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 26,
  },
  flipHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 24,
  },
  pageRefButton: {
    marginTop: 16,
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  pageRefText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  flashcardNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  flashcardNavButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  navButtonDisabled: {
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  flashcardNavText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  flashcardActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 16,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: colors.border,
    borderRadius: 8,
  },
  actionButtonActive: {
    backgroundColor: colors.success,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  studyTipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  studyTip: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
    lineHeight: 20,
  },
});
