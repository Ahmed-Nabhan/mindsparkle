import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import flashcardService, { 
  Flashcard, 
  QualityRating 
} from '../services/flashcardService';
import { usePremiumContext } from '../context/PremiumContext';
import { useDocument } from '../hooks/useDocument';
import type { MainDrawerScreenProps } from '../navigation/types';

const { width, height } = Dimensions.get('window');

type FlashcardScreenProps = MainDrawerScreenProps<'Flashcards'>;
type StudyPhase = 'settings' | 'studying' | 'results';

export const FlashcardScreen: React.FC = () => {
  const route = useRoute<FlashcardScreenProps['route']>();
  const navigation = useNavigation<FlashcardScreenProps['navigation']>();
  const { documentId, documentTitle } = route.params;
  const { isPremium, features, showPaywall } = usePremiumContext();
  const { getDocument } = useDocument();

  // Document content
  const [content, setContent] = useState<string>('');
  const [chunks, setChunks] = useState<string[]>([]);

  // State
  const [phase, setPhase] = useState<StudyPhase>('settings');
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  
  // Settings
  const [cardCount, setCardCount] = useState(10);
  const [studyMode, setStudyMode] = useState<'all' | 'due' | 'new'>('all');
  
  // Session stats
  const [sessionStats, setSessionStats] = useState({
    correct: 0,
    incorrect: 0,
    timeStarted: new Date(),
  });

  // Load document content on mount
  useEffect(() => {
    loadDocumentContent();
  }, [documentId]);

  const loadDocumentContent = async () => {
    try {
      const doc = await getDocument(documentId);
      if (doc) {
        setContent(doc.content || '');
        setChunks(doc.chunks || []);
      }
    } catch (error) {
      console.error('Error loading document:', error);
    }
  };

  // Animation
  const flipAnimation = useRef(new Animated.Value(0)).current;
  const slideAnimation = useRef(new Animated.Value(0)).current;

  const flipToFront = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });

  const flipToBack = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const generateCards = async () => {
    // Check premium limits
    const maxCards = features.maxFlashcardsPerDoc;
    if (maxCards !== -1 && cardCount > maxCards) {
      showPaywall('Unlimited Flashcards');
      return;
    }

    // Check if we have content
    const textContent = chunks.length > 0 ? chunks.join('\n\n') : content;
    if (!textContent || textContent.trim().length === 0) {
      Alert.alert('Error', 'No document content available. Please try again.');
      return;
    }

    try {
      setIsLoading(true);
      
      const generatedCards = await flashcardService.generateFlashcards(
        textContent,
        cardCount,
        (progress, message) => {
          setLoadingMessage(message);
        }
      );

      setCards(generatedCards);
      setPhase('studying');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate flashcards');
    } finally {
      setIsLoading(false);
    }
  };

  const flipCard = () => {
    const toValue = isFlipped ? 0 : 180;
    Animated.spring(flipAnimation, {
      toValue,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
    setIsFlipped(!isFlipped);
  };

  const handleRating = (quality: QualityRating) => {
    // Update card with spaced repetition
    const updatedCard = flashcardService.calculateNextReview(cards[currentIndex], quality);
    const newCards = [...cards];
    newCards[currentIndex] = updatedCard;
    setCards(newCards);

    // Update session stats
    if (quality >= 3) {
      setSessionStats(prev => ({ ...prev, correct: prev.correct + 1 }));
    } else {
      setSessionStats(prev => ({ ...prev, incorrect: prev.incorrect + 1 }));
    }

    // Move to next card
    if (currentIndex < cards.length - 1) {
      nextCard();
    } else {
      setPhase('results');
    }
  };

  const nextCard = () => {
    // Reset flip
    flipAnimation.setValue(0);
    setIsFlipped(false);

    // Slide animation
    Animated.sequence([
      Animated.timing(slideAnimation, {
        toValue: -width,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnimation, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]).start();

    setCurrentIndex(prev => prev + 1);
  };

  const restartSession = () => {
    setCurrentIndex(0);
    setIsFlipped(false);
    flipAnimation.setValue(0);
    setSessionStats({ correct: 0, incorrect: 0, timeStarted: new Date() });
    setCards(flashcardService.shuffleCards(cards));
    setPhase('studying');
  };

  const getStats = () => {
    return flashcardService.getStudyStats(cards);
  };

  // Settings Screen
  if (phase === 'settings') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>📇 Flashcards</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.settingsContainer}>
          <Text style={styles.documentTitle}>{documentTitle || 'Your Document'}</Text>
          
          <View style={styles.settingsCard}>
            <Text style={styles.settingsLabel}>Number of Cards</Text>
            <View style={styles.cardCountRow}>
              {[5, 10, 15, 20, 30].map(num => (
                <TouchableOpacity
                  key={num}
                  style={[
                    styles.countButton,
                    cardCount === num && styles.countButtonActive,
                    !isPremium && num > features.maxFlashcardsPerDoc && styles.countButtonLocked,
                  ]}
                  onPress={() => {
                    if (!isPremium && features.maxFlashcardsPerDoc !== -1 && num > features.maxFlashcardsPerDoc) {
                      showPaywall('More Flashcards');
                    } else {
                      setCardCount(num);
                    }
                  }}
                >
                  <Text style={[
                    styles.countButtonText,
                    cardCount === num && styles.countButtonTextActive,
                  ]}>
                    {num}
                    {!isPremium && features.maxFlashcardsPerDoc !== -1 && num > features.maxFlashcardsPerDoc && ' 🔒'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.settingsLabel, { marginTop: 20 }]}>Study Mode</Text>
            <View style={styles.modeRow}>
              {[
                { key: 'all', label: 'All Cards', icon: '📚' },
                { key: 'due', label: 'Due Today', icon: '📅' },
                { key: 'new', label: 'New Only', icon: '✨' },
              ].map(mode => (
                <TouchableOpacity
                  key={mode.key}
                  style={[
                    styles.modeButton,
                    studyMode === mode.key && styles.modeButtonActive,
                  ]}
                  onPress={() => setStudyMode(mode.key as any)}
                >
                  <Text style={styles.modeIcon}>{mode.icon}</Text>
                  <Text style={[
                    styles.modeText,
                    studyMode === mode.key && styles.modeTextActive,
                  ]}>{mode.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.startButton, isLoading && styles.startButtonDisabled]}
            onPress={generateCards}
            disabled={isLoading}
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.loadingText}>{loadingMessage}</Text>
              </View>
            ) : (
              <Text style={styles.startButtonText}>Generate Flashcards</Text>
            )}
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>📖 How It Works</Text>
            <Text style={styles.infoText}>
              • AI generates flashcards from your document{'\n'}
              • Flip cards to reveal answers{'\n'}
              • Rate your recall to optimize review schedule{'\n'}
              • Spaced repetition helps you remember longer
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Studying Screen
  if (phase === 'studying' && cards.length > 0) {
    const currentCard = cards[currentIndex];
    const progress = ((currentIndex + 1) / cards.length) * 100;

    return (
      <View style={styles.container}>
        <View style={styles.studyHeader}>
          <TouchableOpacity onPress={() => setPhase('settings')}>
            <Text style={styles.backButton}>✕</Text>
          </TouchableOpacity>
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressText}>{currentIndex + 1}/{cards.length}</Text>
        </View>

        {/* Card */}
        <Animated.View style={[styles.cardWrapper, { transform: [{ translateX: slideAnimation }] }]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={flipCard}
            style={styles.cardTouchable}
          >
            {/* Front of card */}
            <Animated.View
              style={[
                styles.card,
                styles.cardFront,
                { transform: [{ rotateY: flipToFront }] },
              ]}
            >
              <View style={styles.cardLabel}>
                <Text style={styles.cardLabelText}>QUESTION</Text>
              </View>
              <Text style={styles.cardText}>{currentCard.front}</Text>
              <View style={styles.cardHint}>
                <Text style={styles.cardHintText}>Tap to reveal answer</Text>
              </View>
              <View style={[styles.difficultyBadge, styles[`difficulty${currentCard.difficulty}`]]}>
                <Text style={styles.difficultyText}>{currentCard.difficulty}</Text>
              </View>
            </Animated.View>

            {/* Back of card */}
            <Animated.View
              style={[
                styles.card,
                styles.cardBack,
                { transform: [{ rotateY: flipToBack }] },
              ]}
            >
              <View style={styles.cardLabel}>
                <Text style={styles.cardLabelText}>ANSWER</Text>
              </View>
              <ScrollView 
                style={styles.cardScrollView}
                contentContainerStyle={styles.cardScrollContent}
              >
                <Text style={styles.cardText}>{currentCard.back}</Text>
              </ScrollView>
              {currentCard.category && (
                <Text style={styles.categoryText}>📂 {currentCard.category}</Text>
              )}
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>

        {/* Rating buttons - only show when flipped */}
        {isFlipped && (
          <View style={styles.ratingContainer}>
            <Text style={styles.ratingLabel}>How well did you know this?</Text>
            <View style={styles.ratingButtons}>
              <TouchableOpacity
                style={[styles.ratingButton, styles.ratingAgain]}
                onPress={() => handleRating(1)}
              >
                <Text style={styles.ratingEmoji}>😰</Text>
                <Text style={styles.ratingText}>Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ratingButton, styles.ratingHard]}
                onPress={() => handleRating(3)}
              >
                <Text style={styles.ratingEmoji}>🤔</Text>
                <Text style={styles.ratingText}>Hard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ratingButton, styles.ratingGood]}
                onPress={() => handleRating(4)}
              >
                <Text style={styles.ratingEmoji}>😊</Text>
                <Text style={styles.ratingText}>Good</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ratingButton, styles.ratingEasy]}
                onPress={() => handleRating(5)}
              >
                <Text style={styles.ratingEmoji}>🎯</Text>
                <Text style={styles.ratingText}>Easy</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  // Results Screen
  if (phase === 'results') {
    const stats = getStats();
    const totalAnswered = sessionStats.correct + sessionStats.incorrect;
    const accuracy = totalAnswered > 0 
      ? Math.round((sessionStats.correct / totalAnswered) * 100) 
      : 0;
    const timeSpent = Math.round((new Date().getTime() - sessionStats.timeStarted.getTime()) / 1000);

    return (
      <View style={styles.container}>
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsEmoji}>
            {accuracy >= 80 ? '🌟' : accuracy >= 60 ? '👍' : '💪'}
          </Text>
          <Text style={styles.resultsTitle}>Session Complete!</Text>
          
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{accuracy}%</Text>
              <Text style={styles.statLabel}>Accuracy</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{sessionStats.correct}</Text>
              <Text style={styles.statLabel}>Correct</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{sessionStats.incorrect}</Text>
              <Text style={styles.statLabel}>To Review</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{Math.floor(timeSpent / 60)}:{(timeSpent % 60).toString().padStart(2, '0')}</Text>
              <Text style={styles.statLabel}>Time</Text>
            </View>
          </View>

          <View style={styles.deckStats}>
            <Text style={styles.deckStatsTitle}>Deck Progress</Text>
            <View style={styles.deckStatsRow}>
              <View style={styles.deckStatItem}>
                <Text style={styles.deckStatValue}>{stats.mastered}</Text>
                <Text style={styles.deckStatLabel}>Mastered</Text>
              </View>
              <View style={styles.deckStatItem}>
                <Text style={styles.deckStatValue}>{stats.learning}</Text>
                <Text style={styles.deckStatLabel}>Learning</Text>
              </View>
              <View style={styles.deckStatItem}>
                <Text style={styles.deckStatValue}>{stats.new}</Text>
                <Text style={styles.deckStatLabel}>New</Text>
              </View>
            </View>
          </View>

          <View style={styles.resultsActions}>
            <TouchableOpacity
              style={styles.studyAgainButton}
              onPress={restartSession}
            >
              <Text style={styles.studyAgainText}>Study Again</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.primary,
  },
  backButton: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  settingsContainer: {
    flex: 1,
    padding: 20,
  },
  documentTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  settingsLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  cardCountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  countButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  countButtonActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(30, 58, 138, 0.1)',
  },
  countButtonLocked: {
    opacity: 0.5,
  },
  countButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  countButtonTextActive: {
    color: colors.primary,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeButtonActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(30, 58, 138, 0.1)',
  },
  modeIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  modeText: {
    fontSize: 12,
    color: colors.textLight,
  },
  modeTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  startButtonDisabled: {
    opacity: 0.7,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginLeft: 12,
    fontSize: 16,
  },
  infoBox: {
    backgroundColor: 'rgba(30, 58, 138, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: colors.textLight,
    lineHeight: 22,
  },
  // Study phase styles
  studyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.primary,
  },
  progressContainer: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  progressText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    width: 50,
    textAlign: 'right',
  },
  cardWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  cardTouchable: {
    width: width - 40,
    height: height * 0.45,
  },
  card: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardFront: {
    backgroundColor: '#fff',
  },
  cardBack: {
    backgroundColor: colors.primary,
  },
  cardLabel: {
    position: 'absolute',
    top: 16,
    left: 16,
  },
  cardLabelText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textLight,
  },
  cardText: {
    fontSize: 20,
    textAlign: 'center',
    color: colors.text,
    lineHeight: 30,
  },
  cardHint: {
    position: 'absolute',
    bottom: 20,
  },
  cardHintText: {
    color: colors.textLight,
    fontSize: 14,
  },
  cardScrollView: {
    flex: 1,
    width: '100%',
  },
  cardScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  difficultyBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  difficultyeasy: {
    backgroundColor: colors.success,
  },
  difficultymedium: {
    backgroundColor: colors.accent,
  },
  difficultyhard: {
    backgroundColor: colors.error,
  },
  difficultyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  categoryText: {
    position: 'absolute',
    bottom: 16,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  ratingContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  ratingLabel: {
    textAlign: 'center',
    fontSize: 16,
    color: colors.text,
    marginBottom: 16,
  },
  ratingButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  ratingButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  ratingAgain: {
    backgroundColor: '#FEE2E2',
  },
  ratingHard: {
    backgroundColor: '#FEF3C7',
  },
  ratingGood: {
    backgroundColor: '#D1FAE5',
  },
  ratingEasy: {
    backgroundColor: '#DBEAFE',
  },
  ratingEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  // Results styles
  resultsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  resultsEmoji: {
    fontSize: 60,
    marginBottom: 20,
  },
  resultsTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 30,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 30,
  },
  statBox: {
    width: (width - 80) / 2 - 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 14,
    color: colors.textLight,
    marginTop: 4,
  },
  deckStats: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 30,
  },
  deckStatsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  deckStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  deckStatItem: {
    alignItems: 'center',
  },
  deckStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  deckStatLabel: {
    fontSize: 12,
    color: colors.textLight,
    marginTop: 4,
  },
  resultsActions: {
    width: '100%',
    gap: 12,
  },
  studyAgainButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  studyAgainText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  doneButton: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default FlashcardScreen;
