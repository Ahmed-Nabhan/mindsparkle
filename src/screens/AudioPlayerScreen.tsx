import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { colors } from '../constants/colors';
import audioService, { VoiceOption, AudioSettings } from '../services/audioService';
import { usePremiumContext } from '../context/PremiumContext';
import ApiService from '../services/apiService';
import type { MainDrawerScreenProps } from '../navigation/types';

type AudioPlayerScreenProps = MainDrawerScreenProps<'AudioPlayer'>;

export const AudioPlayerScreen: React.FC = () => {
  const route = useRoute<AudioPlayerScreenProps['route']>();
  const navigation = useNavigation<AudioPlayerScreenProps['navigation']>();
  const { content, title, documentId } = route.params;
  const { isPremium, showPaywall, features } = usePremiumContext();

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioText, setAudioText] = useState('');
  const [settings, setSettings] = useState<AudioSettings>(audioService.getSettings());
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    initializeAudio();
    return () => {
      audioService.stop();
    };
  }, []);

  const initializeAudio = async () => {
    // Check premium access
    if (!isPremium && !features.canUseAudioSummary) {
      showPaywall('Audio Summaries');
      navigation.goBack();
      return;
    }

    setIsLoading(true);
    try {
      // Get available voices
      const availableVoices = await audioService.initialize();
      const englishVoices = audioService.getEnglishVoices();
      setVoices(englishVoices);
      
      if (englishVoices.length > 0) {
        setSelectedVoice(englishVoices[0].identifier);
        audioService.setSettings({ voice: englishVoices[0].identifier });
      }

      // Set up callbacks
      audioService.setOnPlayingChange((playing) => {
        setIsPlaying(playing);
        if (!playing) setIsPaused(false);
      });
      audioService.setOnProgressChange(setProgress);

      // Prepare text for audio
      const cleanedText = audioService.cleanTextForSpeech(content);
      setAudioText(cleanedText);
    } catch (error) {
      console.error('Error initializing audio:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = async () => {
    if (isPaused) {
      await audioService.resume();
      setIsPaused(false);
    } else {
      setProgress(0);
      await audioService.speakWithProgress(audioText);
    }
  };

  const handlePause = async () => {
    await audioService.pause();
    setIsPaused(true);
  };

  const handleStop = async () => {
    await audioService.stop();
    setProgress(0);
    setIsPaused(false);
  };

  const handleRateChange = (rate: number) => {
    const newSettings = { ...settings, rate };
    setSettings(newSettings);
    audioService.setSettings(newSettings);
  };

  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoice(voiceId);
    audioService.setSettings({ voice: voiceId });
  };

  const generateAudioSummary = async () => {
    setIsLoading(true);
    try {
      const prompt = audioService.getAudioSummaryPrompt(content);
      const audioFriendlySummary = await ApiService.chat(prompt);
      const cleaned = audioService.cleanTextForSpeech(audioFriendlySummary);
      setAudioText(cleaned);
    } catch (error) {
      console.error('Error generating audio summary:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Preparing audio...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🎧 Audio Player</Text>
        <TouchableOpacity onPress={() => setShowSettings(!showSettings)}>
          <Text style={styles.settingsButton}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Now Playing Card */}
        <View style={styles.nowPlayingCard}>
          <Text style={styles.nowPlayingLabel}>Now Playing</Text>
          <Text style={styles.nowPlayingTitle}>{title || 'Your Summary'}</Text>
          
          {/* Waveform Visualization (simplified) */}
          <View style={styles.waveformContainer}>
            {[...Array(20)].map((_, i) => (
              <View
                key={i}
                style={[
                  styles.waveformBar,
                  {
                    height: isPlaying 
                      ? 10 + Math.random() * 40 
                      : 20,
                    backgroundColor: progress > (i / 20) * 100 
                      ? colors.primary 
                      : colors.border,
                  },
                ]}
              />
            ))}
          </View>

          {/* Progress */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={handleStop}
            >
              <Text style={styles.controlIcon}>⏹️</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.playButton, isPlaying && styles.playButtonActive]}
              onPress={isPlaying && !isPaused ? handlePause : handlePlay}
            >
              <Text style={styles.playIcon}>
                {isPlaying && !isPaused ? '⏸️' : '▶️'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.controlButton}
              onPress={generateAudioSummary}
            >
              <Text style={styles.controlIcon}>🔄</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Speed Control */}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Playback Speed</Text>
          <View style={styles.speedButtons}>
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((speed) => (
              <TouchableOpacity
                key={speed}
                style={[
                  styles.speedButton,
                  settings.rate === speed && styles.speedButtonActive,
                ]}
                onPress={() => handleRateChange(speed)}
              >
                <Text style={[
                  styles.speedText,
                  settings.rate === speed && styles.speedTextActive,
                ]}>
                  {speed}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Voice Selection */}
        {showSettings && voices.length > 0 && (
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>Select Voice</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.voiceButtons}>
                {voices.slice(0, 6).map((voice) => (
                  <TouchableOpacity
                    key={voice.identifier}
                    style={[
                      styles.voiceButton,
                      selectedVoice === voice.identifier && styles.voiceButtonActive,
                    ]}
                    onPress={() => handleVoiceChange(voice.identifier)}
                  >
                    <Text style={[
                      styles.voiceName,
                      selectedVoice === voice.identifier && styles.voiceNameActive,
                    ]}>
                      {voice.name.split(' ')[0]}
                    </Text>
                    <Text style={styles.voiceLanguage}>{voice.language}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Text Preview */}
        <View style={styles.textPreview}>
          <Text style={styles.textPreviewTitle}>📝 Text Content</Text>
          <Text style={styles.textPreviewContent} numberOfLines={10}>
            {audioText}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.textLight,
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
  settingsButton: {
    fontSize: 24,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  nowPlayingCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    marginBottom: 20,
  },
  nowPlayingLabel: {
    fontSize: 12,
    color: colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  nowPlayingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 8,
    marginBottom: 24,
    textAlign: 'center',
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    gap: 4,
    marginBottom: 24,
  },
  waveformBar: {
    width: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  progressContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    color: colors.textLight,
    width: 40,
    textAlign: 'right',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: {
    fontSize: 24,
  },
  playButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  playButtonActive: {
    backgroundColor: colors.accent,
  },
  playIcon: {
    fontSize: 32,
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  settingsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  speedButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  speedButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  speedText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  speedTextActive: {
    color: '#fff',
  },
  voiceButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  voiceButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  voiceButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  voiceName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  voiceNameActive: {
    color: '#fff',
  },
  voiceLanguage: {
    fontSize: 11,
    color: colors.textLight,
    marginTop: 2,
  },
  textPreview: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 40,
  },
  textPreviewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  textPreviewContent: {
    fontSize: 14,
    color: colors.textLight,
    lineHeight: 22,
  },
});

export default AudioPlayerScreen;
