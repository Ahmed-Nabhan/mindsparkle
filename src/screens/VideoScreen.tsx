import React, { useState, useEffect, useRef } from "react";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Animated, Image, Dimensions } from "react-native";
import * as Speech from "expo-speech";
import { useRoute, useNavigation } from "@react-navigation/native";
import Config from "../services/config";
import PdfService from "../services/pdfService";
import ApiService from "../services/apiService";
import { colors } from "../constants/colors";
import { usePremiumContext } from "../context/PremiumContext";
import type { MainDrawerScreenProps } from "../navigation/types";

// Type definitions
interface VideoSection {
  title: string;
  narration: string;
  pageRef?: number;
  slideUrl?: string;
  keyPoints?: string[];
  visualType?: string;
  timestamp?: string;
  visualDirections?: string[];
}

interface VideoTable {
  title?: string;
  headers?: string[];
  rows?: string[][];
  pageNumber?: number;
}

interface VideoImage {
  type: string;
  description: string;
  url?: string;
}

interface VideoScript {
  title?: string;
  introduction?: string;
  conclusion?: string;
  sections: VideoSection[];
  tables?: VideoTable[];
  pageImages?: string[];
  images?: VideoImage[];
}

interface ExtractedPage {
  pageNum: number;
  text: string;
  imageUrl?: string;
}

interface ExtractedData {
  pages: ExtractedPage[];
  pageCount: number;
}

interface Teacher {
  id: string;
  name: string;
  gender: string;
  avatar: string;
  color: string;
  voiceConfig: {
    language: string;
    pitch: number;
    rate: number;
  };
}

type VideoScreenProps = MainDrawerScreenProps<'Video'>;

var SCREEN_WIDTH = Dimensions.get("window").width;

var SECTION_COLORS = ["#4CAF50", "#2196F3", "#FF9800", "#E91E63", "#9C27B0", "#00BCD4", "#FF5722", "#3F51B5"];

// Speed settings
var SPEED_OPTIONS = [
  { value: 0.5, label: "0.5x" },
  { value: 0.75, label: "0.75x" },
  { value: 1, label: "1x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
];

var TEACHERS: Teacher[] = [
  { id: "male1", name: "Alex", gender: "male", avatar: "👨‍🏫", color: "#4CAF50", voiceConfig: { language: "en-US", pitch: 1, rate: 85 / 100 } },
  { id: "male2", name:  "James", gender: "male", avatar:  "🧑‍💼", color: "#2196F3", voiceConfig: { language:  "en-GB", pitch: 95 / 100, rate: 9 / 10 } },
  { id: "female1", name: "Sarah", gender: "female", avatar:  "👩‍🏫", color: "#E91E63", voiceConfig:  { language: "en-US", pitch: 11 / 10, rate: 85 / 100 } },
  { id: "female2", name: "Emma", gender: "female", avatar:  "👩‍💼", color: "#9C27B0", voiceConfig: { language: "en-GB", pitch: 105 / 100, rate: 9 / 10 } },
  // Arabic Teachers
  { id: "male_ar", name: "Ahmed", gender: "male", avatar: "👨🏽‍🏫", color: "#009688", voiceConfig: { language: "ar-SA", pitch: 1, rate: 9 / 10 } },
  { id: "female_ar", name: "Layla", gender: "female", avatar: "🧕", color: "#E91E63", voiceConfig: { language: "ar-SA", pitch: 11 / 10, rate: 9 / 10 } },
];

export var VideoScreen: React.FC = function() {
  var route = useRoute<VideoScreenProps['route']>();
  var navigation = useNavigation<VideoScreenProps['navigation']>();
  var { isPremium, features } = usePremiumContext();
  var params = route.params;
  var content = params.content || "";
  var fileUri = params.fileUri || "";
  var documentId = params.documentId;
  var cachedPdfUrl = (params as any).pdfCloudUrl || "";
  var cachedExtractedData = (params as any).extractedData || null;

  var [isLoading, setIsLoading] = useState(true);
  var [loadingMessage, setLoadingMessage] = useState("Preparing your lesson...");
  var [loadingProgress, setLoadingProgress] = useState(0);
  var [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  var [videoScript, setVideoScript] = useState<VideoScript | null>(null);
  var [selectedTeacher, setSelectedTeacher] = useState<Teacher>(TEACHERS[0]);
  var [showTeacherSelect, setShowTeacherSelect] = useState(true);
  var [isPlaying, setIsPlaying] = useState(false);
  var [isPaused, setIsPaused] = useState(false);
  // Video generation options
  var [videoLanguage, setVideoLanguage] = useState<'en' | 'ar' | string>('en');
  var [useAnimationsOption, setUseAnimationsOption] = useState(true);

  // Load saved user preferences (video language and animations)
  useEffect(() => {
    (async () => {
      try {
        const lang = await AsyncStorage.getItem('videoLanguage');
        const anim = await AsyncStorage.getItem('videoUseAnimations');
        if (lang) setVideoLanguage(lang);
        if (anim !== null) setUseAnimationsOption(anim === 'true');
      } catch (e) {
        console.warn('Failed to load video settings', e);
      }
    })();
  }, []);
  var [currentSectionIndex, setCurrentSectionIndex] = useState(-1);
  var [activeTab, setActiveTab] = useState("video");
  
  // New states for speed and auto-advance
  var [playbackSpeed, setPlaybackSpeed] = useState(1);
  var [autoAdvance, setAutoAdvance] = useState(true);
  var [showSpeedMenu, setShowSpeedMenu] = useState(false);

  var teacherAnim = useRef(new Animated.Value(0)).current;
  var progressAnim = useRef(new Animated.Value(0)).current;
  var pulseAnim = useRef(new Animated.Value(1)).current;
  var isPausedRef = useRef(false);

  useEffect(function() {
    if (! showTeacherSelect) {
      loadVideoContent();
    }
  }, [showTeacherSelect]);

  useEffect(function() {
    if (isPlaying) {
      Animated.loop(Animated.sequence([
        Animated.timing(teacherAnim, { toValue: 1, duration:  400, useNativeDriver: true }),
        Animated.timing(teacherAnim, { toValue:  0, duration: 400, useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue:  12 / 10, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue:  1, duration: 500, useNativeDriver: true }),
      ])).start();
    } else {
      teacherAnim.setValue(0);
      pulseAnim.setValue(1);
    }
  }, [isPlaying]);

  var [slides, setSlides] = useState<{ pageNum: number; imageUrl: string }[]>([]);
  var [currentSlide, setCurrentSlide] = useState<string | null>(null);

  var loadVideoContent = async function() {
    try {
      setLoadingMessage("Preparing your lesson...");
      setLoadingProgress(10);

      var pages: { pageNum: number; text: string; imageUrl?: string }[] = [];

      // PRIORITY 1: Use cached extracted data from document upload (already processed!)
      if (cachedExtractedData && cachedExtractedData.pages && cachedExtractedData.pages.length > 0) {
        console.log('Using cached data - no cloud upload needed!');
        setLoadingMessage("Loading your document...");
        setLoadingProgress(50);
        
        // Use cached data - much faster, no API calls!
        pages = cachedExtractedData.pages.map(function(p: any) {
          return {
            pageNum: p.pageNumber || p.pageNum,
            text: p.text || '',
            imageUrl: p.images && p.images.length > 0 ? p.images[0].url : undefined,
          };
        });
        
        // Store slides for display
        var cachedSlideImages = pages.filter(function(p) { return p.imageUrl; }).map(function(p) {
          return { pageNum: p.pageNum, imageUrl: p.imageUrl! };
        });
        setSlides(cachedSlideImages);
        
        if (cachedSlideImages.length > 0) {
          setCurrentSlide(cachedSlideImages[0].imageUrl);
        }

        setExtractedData({ pages, pageCount: cachedExtractedData.totalPages || pages.length });
        setLoadingProgress(70);
        
        console.log('Using cached data:', pages.length, 'pages');
      }
      // PRIORITY 2: Use document content directly if available (no API needed)
      else if (content && content.trim().length > 100) {
        console.log('Using document content directly - no cloud processing needed!');
        setLoadingMessage("Processing content...");
        setLoadingProgress(40);
        
        // Split content into chunks for video sections
        var contentChunks = content.match(/.{1,2000}/g) || [];
        pages = contentChunks.slice(0, 15).map(function(chunk, index) {
          return { 
            pageNum: index + 1, 
            text: '=== PAGE ' + (index + 1) + ' ===\n' + chunk 
          };
        });
        
        setExtractedData({ pages, pageCount: pages.length });
        setLoadingProgress(70);
        console.log('Created', pages.length, 'sections from document content');
      }
      // PRIORITY 3: Process PDF only if no cached data (uses API, may fail if credits exhausted)
      else if (fileUri) {
        setLoadingMessage("Reading PDF file...");
        setLoadingProgress(15);

        // Use centralized PDF service
        var doc = await PdfService.processDocument(fileUri, function(progress, message) {
          setLoadingProgress(15 + progress * 0.5);
          setLoadingMessage(message);
        });

        pages = doc.pages;
        
        // Store slides for display
        var slideImages = pages.filter(function(p) { return p.imageUrl; }).map(function(p) {
          return { pageNum: p.pageNum, imageUrl: p.imageUrl! };
        });
        setSlides(slideImages);
        
        if (slideImages.length > 0) {
          setCurrentSlide(slideImages[0].imageUrl);
        }

        setExtractedData({ pages, pageCount: doc.pageCount });
        setLoadingProgress(70);
      }

      // Check if pages have actual text content
      var pagesWithText = pages.filter(function(p) { return p.text && p.text.trim().length > 50; });

      // If no pages with meaningful text, create text-based pages from document content
      if (pagesWithText.length === 0 && content && content.trim().length > 50) {
        // Split content into chunks for video sections
        var contentChunks = content.match(/.{1,2000}/g) || [];
        pages = contentChunks.slice(0, 10).map(function(chunk, index) {
          return { pageNum: index + 1, text: chunk };
        });
      } else if (pagesWithText.length > 0) {
        pages = pagesWithText;
      }

      if (pages.length === 0) {
        // Last resort - create a simple lesson from any available content
        var fallbackContent = content || "This document could not be processed for video. Please try uploading a text-based PDF.";
        pages = [{ pageNum: 1, text: fallbackContent.substring(0, 2000) }];
      }

      setLoadingMessage("Creating video lesson with " + selectedTeacher.name + "...");
      setLoadingProgress(75);

      // Generate video script with slide references (pass selected language/animation options)
      var script: VideoScript = await ApiService.generateVideoScript(pages, { language: videoLanguage, style: 'educational', useAnimations: useAnimationsOption });
      
      // Ensure sections have slide URLs
      if (script.sections) {
        script.sections = script.sections.map(function(section: VideoSection, index: number) {
          var slideUrl = section.slideUrl;
          if (!slideUrl && slides.length > 0) {
            // Find matching slide by page ref or use sequential
            var pageRef = section.pageRef || (index + 1);
            var matchingSlide = slides.find(function(s) { return s.pageNum === pageRef; });
            slideUrl = matchingSlide ? matchingSlide.imageUrl : slides[Math.min(index, slides.length - 1)].imageUrl;
          }
          return { ...section, slideUrl };
        });
      }

      setLoadingProgress(100);
      setVideoScript(script);
      setIsLoading(false);
    } catch (error: any) {
      console.error("Error:", error);
      Alert.alert("Error", error.message || "Failed to create lesson");
      navigation.goBack();
    }
  };

  var handlePlay = function() {
    if (isPlaying) {
      // Pause - stop speech and mark as paused
      Speech.stop();
      setIsPlaying(false);
      setIsPaused(true);
      isPausedRef.current = true;
    } else {
      // Resume or start
      setIsPaused(false);
      isPausedRef.current = false;
      if (currentSectionIndex < 0) {
        playIntroduction();
      } else {
        playSection(currentSectionIndex);
      }
    }
  };

  var playIntroduction = function() {
    if (!videoScript) return;
    setIsPlaying(true);
    setCurrentSectionIndex(-1);
    
    // Show first slide during intro
    if (slides.length > 0) {
      setCurrentSlide(slides[0].imageUrl);
    }
    
    var intro = "Hello! I am " + selectedTeacher.name + ", your instructor today. " + (videoScript.introduction || "Let us begin our lesson.");
    var adjustedRate = selectedTeacher.voiceConfig.rate * playbackSpeed;
    Speech.speak(intro, {
      language: selectedTeacher.voiceConfig.language,
      pitch: selectedTeacher.voiceConfig.pitch,
      rate: adjustedRate,
      onDone: function() { 
        // Only auto-advance if not paused and auto-advance is enabled
        if (!isPausedRef.current && autoAdvance) {
          playSection(0); 
        } else if (!isPausedRef.current) {
          setIsPlaying(false);
        }
      },
      onError: function() { setIsPlaying(false); },
    });
  };

  var playSection = function(index: number) {
    if (!videoScript) return;
    var sections = videoScript.sections || [];
    if (index >= sections.length) {
      playConclusion();
      return;
    }

    setCurrentSectionIndex(index);
    setIsPlaying(true);

    var section = sections[index];
    
    // Update slide for this section
    if (section.slideUrl) {
      setCurrentSlide(section.slideUrl);
    } else if (slides.length > 0) {
      // Fallback to sequential slides
      var slideIndex = Math.min(index, slides.length - 1);
      setCurrentSlide(slides[slideIndex].imageUrl);
    }
    
    var progress = ((index + 1) / sections.length) * 100;
    Animated.timing(progressAnim, { toValue: progress, duration: 300, useNativeDriver: false }).start();

    var sectionIntro = "Section " + (index + 1) + ": " + section.title + ". ";
    var adjustedRate = selectedTeacher.voiceConfig.rate * playbackSpeed;
    Speech.speak(sectionIntro + section.narration, {
      language: selectedTeacher.voiceConfig.language,
      pitch: selectedTeacher.voiceConfig.pitch,
      rate: adjustedRate,
      onDone: function() {
        // Only auto-advance if not paused and auto-advance is enabled
        if (!isPausedRef.current && autoAdvance) {
          setTimeout(function() { playSection(index + 1); }, 600);
        } else if (!isPausedRef.current) {
          setIsPlaying(false);
        }
      },
      onError: function() { setIsPlaying(false); },
    });
  };

  var playConclusion = function() {
    if (!videoScript) return;
    var sections = videoScript.sections || [];
    setCurrentSectionIndex(sections.length);
    
    // Show last slide during conclusion
    if (slides.length > 0) {
      setCurrentSlide(slides[slides.length - 1].imageUrl);
    }
    
    var adjustedRate = selectedTeacher.voiceConfig.rate * playbackSpeed;
    Speech.speak((videoScript.conclusion || "That concludes our lesson.") + " Thank you for learning with me!", {
      language: selectedTeacher.voiceConfig.language,
      pitch: selectedTeacher.voiceConfig.pitch,
      rate: adjustedRate,
      onDone: function() {
        setIsPlaying(false);
        Alert.alert("Lesson Complete!", "Would you like to test your knowledge?", [
          { text: "Back to Menu", onPress: function() { navigation.navigate("DocumentActions", { documentId: documentId }); } },
          { text: "Take Quiz", onPress: function() { navigation.navigate("Test", params); } },
        ]);
      },
      onError: function() { setIsPlaying(false); },
    });
  };

  var handleBack = function() {
    Speech.stop();
    setIsPlaying(false);
    setIsPaused(false);
    isPausedRef.current = false;
    navigation.navigate("DocumentActions", { documentId:  documentId });
  };

  var handleRestart = function() {
    Speech.stop();
    setCurrentSectionIndex(-1);
    setIsPaused(false);
    isPausedRef.current = false;
    progressAnim.setValue(0);
    playIntroduction();
  };

  var handlePrevious = function() {
    Speech.stop();
    setIsPaused(false);
    isPausedRef.current = false;
    var idx = Math.max(-1, currentSectionIndex - 1);
    setCurrentSectionIndex(idx);
    if (isPlaying) {
      if (idx < 0) {
        playIntroduction();
      } else {
        playSection(idx);
      }
    }
  };

  var handleNext = function() {
    Speech.stop();
    setIsPaused(false);
    isPausedRef.current = false;
    var sections = videoScript ?  (videoScript.sections || []) : [];
    var idx = Math.min(sections.length, currentSectionIndex + 1);
    setCurrentSectionIndex(idx);
    if (isPlaying) {
      playSection(idx);
    }
  };

  var getSectionColor = function(index: number) {
    return SECTION_COLORS[index % SECTION_COLORS.length];
  };

  type VisualResult = 
    | { type: "table"; data: VideoTable }
    | { type: "image"; url: string }
    | { type: "points"; data: string[] }
    | { type: "directions"; data: string[] }
    | null;

  var getCurrentVisual = function(): VisualResult {
    if (!videoScript || currentSectionIndex < 0) return null;
    var sections = videoScript.sections || [];
    if (currentSectionIndex >= sections.length) return null;
    var section = sections[currentSectionIndex];

    // Priority 1: Visual Directions (Smart Screen)
    if (section.visualDirections && section.visualDirections.length > 0) {
      return { type: "directions", data: section.visualDirections };
    }

    if (section.visualType === "table" && videoScript.tables && videoScript.tables.length > 0) {
      var tableIdx = Math.min(currentSectionIndex, videoScript.tables.length - 1);
      return { type: "table", data: videoScript.tables[tableIdx] };
    }
    // Use current slide from state
    if (currentSlide) {
      return { type: "image", url: currentSlide };
    }
    if (videoScript.pageImages && videoScript.pageImages.length > 0) {
      var imgIdx = Math.min(currentSectionIndex, videoScript.pageImages.length - 1);
      return { type: "image", url: videoScript.pageImages[imgIdx] };
    }
    return { type: "points", data: section.keyPoints || [] };
  };

  var renderVisual = function() {
    var visual = getCurrentVisual();
    var sectionColor = currentSectionIndex >= 0 ? getSectionColor(currentSectionIndex) : selectedTeacher.color;

    if (!visual) {
      return (
        <View style={[styles.visualCard, { borderColor: sectionColor }]}>
          <Text style={styles.welcomeEmoji}>📚</Text>
          <Text style={styles.welcomeText}>{currentSectionIndex < 0 ? "Welcome to Your Lesson!" : "Lesson Complete!"}</Text>
        </View>
      );
    }

    if (visual.type === "directions") {
      return (
        <View style={[styles.pointsCard, { borderColor: sectionColor, backgroundColor: '#0d1117', borderWidth: 4, borderStyle: 'solid' }]}>
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#30363d', paddingBottom: 8}}>
            <Text style={{fontSize: 20, marginRight: 8}}>🖥️</Text>
            <Text style={{color: sectionColor, fontWeight: 'bold', fontSize: 16}}>Smart Board</Text>
          </View>
          {visual.data.map(function(point: string, i: number) {
            return (
              <View key={i} style={[styles.pointRow, { marginBottom: 16 }]}>
                <Text style={[styles.pointText, { fontSize: 18, color: '#fff', textAlign: 'center', fontWeight: '600' }]}>{point}</Text>
              </View>
            );
          })}
        </View>
      );
    }

    if (visual.type === "table") {
      return (
        <ScrollView horizontal style={styles.tableScroll}>
          <View style={[styles.tableCard, { borderColor: sectionColor }]}>
            <Text style={[styles.tableTitle, { color: sectionColor }]}>{visual.data.title || "Data Table"}</Text>
            <View style={[styles.tableHeaderRow, { backgroundColor: sectionColor }]}>
              {(visual.data.headers || []).map(function(h: string, i: number) { return <Text key={i} style={styles.tableHeaderCell}>{h}</Text>; })}
            </View>
            {(visual.data.rows || []).slice(0, 5).map(function(row: string[], ri: number) {
              return (
                <View key={ri} style={[styles.tableDataRow, { backgroundColor: ri % 2 === 0 ? "rgba(255,255,255,0.05)" : "transparent" }]}>
                  {row.map(function(cell: string, ci: number) { return <Text key={ci} style={styles.tableDataCell}>{cell}</Text>; })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      );
    }

    if (visual.type === "image") {
      const imageUrl = visual.url;
      return (
        <View style={[styles.imageCard, { borderColor: sectionColor }]}>
          <Image source={{ uri: imageUrl }} style={styles.slideImage} resizeMode="contain" />
          {currentSectionIndex >= 0 && slides.length > 0 && (
            <Text style={styles.slidePageRef}>Page {slides.find(s => s.imageUrl === imageUrl)?.pageNum || (currentSectionIndex + 1)}</Text>
          )}
        </View>
      );
    }

    if (visual.type === "points") {
      return (
        <View style={[styles.pointsCard, { borderColor: sectionColor }]}>
          {visual.data.map(function(point: string, i: number) {
            return (
              <View key={i} style={styles.pointRow}>
                <View style={[styles.pointBullet, { backgroundColor: sectionColor }]}>
                  <Text style={styles.pointNumber}>{i + 1}</Text>
                </View>
                <Text style={styles.pointText}>{point}</Text>
              </View>
            );
          })}
        </View>
      );
    }

    return null;
  };

  if (showTeacherSelect) {
    return (
      <View style={styles.teacherSelectContainer}>
        <TouchableOpacity style={styles.backButtonTop} onPress={handleBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.selectTitle}>Choose Your AI Teacher</Text>
        <Text style={styles.selectSubtitle}>Select who will guide you through this lesson</Text>
        <View style={styles.teacherGrid}>
          {TEACHERS.map(function(teacher) {
            var isSelected = selectedTeacher.id === teacher.id;
            return (
              <TouchableOpacity key={teacher.id} style={[styles.teacherOption, isSelected && { borderColor: teacher.color, backgroundColor: teacher.color + "20" }]} onPress={function() { setSelectedTeacher(teacher); }}>
                <View style={[styles.teacherAvatarCircle, { backgroundColor: teacher.color + "30", borderColor: teacher.color }]}>
                  <Text style={styles.teacherAvatarEmoji}>{teacher.avatar}</Text>
                </View>
                <Text style={styles.teacherOptionName}>{teacher.name}</Text>
                <Text style={[styles.teacherOptionGender, { color: teacher.color }]}>{teacher.gender === "male" ? "Male Voice" : "Female Voice"}</Text>
                {isSelected && <View style={[styles.selectedIndicator, { backgroundColor: teacher.color }]}><Text style={styles.selectedCheck}>✓</Text></View>}
              </TouchableOpacity>
            );
          })}
        </View>
        {/* Language and animation options for generated video */}
        <View style={{ marginTop: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
          <TouchableOpacity style={[styles.optionBtn, { borderColor: selectedTeacher.color }]} onPress={async function() { const newLang = videoLanguage === 'en' ? 'ar' : 'en'; setVideoLanguage(newLang); try { await AsyncStorage.setItem('videoLanguage', newLang); } catch(e){console.warn('Failed to save language', e);} }}>
            <Text style={styles.optionText}>Language: {videoLanguage === 'en' ? 'English' : 'Arabic'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.optionBtn, useAnimationsOption ? { backgroundColor: selectedTeacher.color } : {}]} onPress={async function() { const newVal = !useAnimationsOption; setUseAnimationsOption(newVal); try { await AsyncStorage.setItem('videoUseAnimations', String(newVal)); } catch(e){console.warn('Failed to save animation setting', e);} }}>
            <Text style={[styles.optionText, useAnimationsOption ? { color: '#fff' } : {}]}>{useAnimationsOption ? 'Animations: ON' : 'Animations: OFF'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.startLessonButton, { backgroundColor: selectedTeacher.color }]} onPress={function() { 
          // Video generation is FREE for everyone!
          setShowTeacherSelect(false); 
        }}>
          <Text style={styles.startLessonText}>Start Lesson with {selectedTeacher.name} →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingEmoji}>{selectedTeacher.avatar}</Text>
        <Text style={styles.loadingTitle}>Creating Your Lesson</Text>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${loadingProgress}%`, backgroundColor: selectedTeacher.color }]} />
        </View>
        <Text style={styles.loadingMessage}>{loadingMessage}</Text>
        <ActivityIndicator size="large" color={selectedTeacher.color} style={{ marginTop: 20 }} />
      </View>
    );
  }

  if (! videoScript) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Failed to create lesson</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleBack}><Text style={styles.retryButtonText}>Go Back</Text></TouchableOpacity>
      </View>
    );
  }

  var sections = videoScript.sections || [];
  var currentSection = sections[currentSectionIndex] || null;
  var totalSections = sections.length;
  var sectionColor = (currentSectionIndex >= 0 && currentSectionIndex < totalSections) ? getSectionColor(currentSectionIndex) : selectedTeacher.color;

  var teacherTranslateY = teacherAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: sectionColor }]}>
        <TouchableOpacity style={styles.headerBackButton} onPress={handleBack}>
          <Text style={styles.headerBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{videoScript.title || "AI Lesson"}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.videoArea}>
        <View style={styles.mainContent}>
          <View style={styles.slideContainer}>
            <View style={[styles.sectionBadge, { backgroundColor: sectionColor }]}>
              <Text style={styles.sectionBadgeText}>
                {currentSectionIndex < 0 ? "Introduction" : currentSectionIndex >= totalSections ? "Complete" : "Section " + (currentSectionIndex + 1) + " of " + totalSections}
              </Text>
            </View>
            {renderVisual()}
            {currentSection && <Text style={[styles.currentSectionTitle, { color: sectionColor }]}>{currentSection.title}</Text>}
          </View>

          <Animated.View style={[styles.teacherArea, { transform: [{ translateY: teacherTranslateY }] }]}>
            <Animated.View style={[styles.teacherCircle, { borderColor: selectedTeacher.color, transform: [{ scale: pulseAnim }] }]}>
              <Text style={styles.teacherMainEmoji}>{selectedTeacher.avatar}</Text>
              {isPlaying && <View style={[styles.speakingWave, { backgroundColor: selectedTeacher.color }]} />}
            </Animated.View>
            <Text style={[styles.teacherNameLabel, { color: selectedTeacher.color }]}>{selectedTeacher.name}</Text>
            <Text style={styles.teacherStatus}>{isPlaying ? "Speaking..." : "Ready"}</Text>
          </Animated.View>
        </View>

        <View style={styles.progressSection}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { backgroundColor: sectionColor, width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }]} />
          </View>
        </View>

        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={handleRestart}><Text style={styles.controlEmoji}>⏮️</Text></TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={handlePrevious}><Text style={styles.controlEmoji}>⏪</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.playBtn, { backgroundColor: sectionColor }]} onPress={handlePlay}>
            <Text style={styles.playEmoji}>{isPlaying ? "⏸️" : "▶️"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={handleNext}><Text style={styles.controlEmoji}>⏩</Text></TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={function() { setShowSpeedMenu(!showSpeedMenu); }}>
            <Text style={styles.speedText}>{playbackSpeed}x</Text>
          </TouchableOpacity>
        </View>

        {/* Speed Menu */}
        {showSpeedMenu && (
          <View style={styles.speedMenu}>
            <View style={styles.speedMenuHeader}>
              <Text style={styles.speedMenuTitle}>⚡ Playback Speed</Text>
              <TouchableOpacity onPress={function() { setShowSpeedMenu(false); }}>
                <Text style={styles.speedMenuClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.speedOptions}>
              {SPEED_OPTIONS.map(function(option) {
                var isSelected = playbackSpeed === option.value;
                return (
                  <TouchableOpacity 
                    key={option.value} 
                    style={[styles.speedOption, isSelected && { backgroundColor: sectionColor + "30", borderColor: sectionColor }]}
                    onPress={function() { 
                      setPlaybackSpeed(option.value); 
                      setShowSpeedMenu(false);
                      // If playing, restart current section with new speed
                      if (isPlaying) {
                        Speech.stop();
                        if (currentSectionIndex < 0) {
                          playIntroduction();
                        } else {
                          playSection(currentSectionIndex);
                        }
                      }
                    }}
                  >
                    <Text style={[styles.speedOptionText, isSelected && { color: sectionColor, fontWeight: "700" }]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.autoAdvanceRow}>
              <Text style={styles.autoAdvanceLabel}>Auto-advance sections</Text>
              <TouchableOpacity 
                style={[styles.autoAdvanceToggle, autoAdvance && { backgroundColor: sectionColor }]}
                onPress={function() { setAutoAdvance(!autoAdvance); }}
              >
                <Text style={styles.autoAdvanceToggleText}>{autoAdvance ? "ON" : "OFF"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.tabsRow}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === "video" && { borderBottomColor: sectionColor }]} onPress={function() { setActiveTab("video"); }}>
          <Text style={[styles.tabLabel, activeTab === "video" && { color: sectionColor }]}>📺 Current</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === "sections" && { borderBottomColor:  sectionColor }]} onPress={function() { setActiveTab("sections"); }}>
          <Text style={[styles.tabLabel, activeTab === "sections" && { color: sectionColor }]}>📑 Sections</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === "notes" && { borderBottomColor:  sectionColor }]} onPress={function() { setActiveTab("notes"); }}>
          <Text style={[styles.tabLabel, activeTab === "notes" && { color: sectionColor }]}>📝 Notes</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.bottomContent}>
        {activeTab === "video" && currentSection && (
          <View style={[styles.contentCard, { borderLeftColor: sectionColor }]}>
            <Text style={[styles.cardHeading, { color: sectionColor }]}>{currentSection.title}</Text>
            <Text style={styles.cardNarration}>{currentSection.narration}</Text>
            {currentSection.keyPoints && currentSection.keyPoints.length > 0 && (
              <View style={styles.keyPointsBox}>
                <Text style={styles.keyPointsHeading}>📌 Key Points</Text>
                {currentSection.keyPoints.map(function(pt, i) {
                  return <Text key={i} style={styles.keyPointLine}>• {pt}</Text>;
                })}
              </View>
            )}
          </View>
        )}

        {activeTab === "sections" && (
          <View style={styles.sectionsList}>
            {sections.map(function(sec, idx) {
              var isActive = currentSectionIndex === idx;
              var isDone = currentSectionIndex > idx;
              var secColor = getSectionColor(idx);
              return (
                <TouchableOpacity key={idx} style={[styles.sectionItem, isActive && { borderLeftColor: secColor, backgroundColor: secColor + "15" }]} onPress={function() { Speech.stop(); setCurrentSectionIndex(idx); if (isPlaying) playSection(idx); }}>
                  <View style={[styles.sectionNumCircle, { backgroundColor: isActive ? secColor :  isDone ? "#4CAF50" : colors.border }]}>
                    <Text style={styles.sectionNumText}>{isDone ? "✓" : idx + 1}</Text>
                  </View>
                  <View style={styles.sectionItemInfo}>
                    <Text style={[styles.sectionItemTitle, isActive && { color: secColor }]}>{sec.title}</Text>
                    <Text style={styles.sectionItemTime}>{sec.timestamp || "0:00"}</Text>
                  </View>
                  {isActive && isPlaying && <Text style={styles.nowPlayingIcon}>🔊</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {activeTab === "notes" && (
          <View style={styles.notesArea}>
            <View style={styles.noteBox}>
              <Text style={styles.noteBoxTitle}>📚 Lesson Introduction</Text>
              <Text style={styles.noteBoxText}>{videoScript.introduction || "Welcome to this lesson."}</Text>
            </View>
            {videoScript.tables && videoScript.tables.length > 0 && (
              <View style={styles.noteBox}>
                <Text style={styles.noteBoxTitle}>📊 Tables Covered</Text>
                {videoScript.tables.map(function(tbl, i) {
                  return <Text key={i} style={styles.noteListItem}>• {tbl.title || "Table " + (i + 1)} (Page {tbl.pageNumber})</Text>;
                })}
              </View>
            )}
            {videoScript.images && videoScript.images.length > 0 && (
              <View style={styles.noteBox}>
                <Text style={styles.noteBoxTitle}>🖼️ Diagrams & Figures</Text>
                {videoScript.images.slice(0, 6).map(function(img, i) {
                  return <Text key={i} style={styles.noteListItem}>• {img.type}:  {img.description}</Text>;
                })}
              </View>
            )}
            <View style={styles.noteBox}>
              <Text style={styles.noteBoxTitle}>🎯 Conclusion</Text>
              <Text style={styles.noteBoxText}>{videoScript.conclusion || "Thank you for completing this lesson."}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

var styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d1117" },
  header:  { flexDirection: "row", alignItems: "center", paddingTop: 50, paddingBottom: 12, paddingHorizontal: 16 },
  headerBackButton: { padding: 8 },
  headerBackText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  headerTitle: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "bold", textAlign: "center" },
  headerSpacer: { width: 60 },
  teacherSelectContainer: { flex: 1, backgroundColor: "#0d1117", padding: 24, paddingTop: 60 },
  backButtonTop: { marginBottom: 20 },
  backButtonText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  selectTitle: { fontSize: 28, fontWeight: "bold", color: "#fff", textAlign: "center", marginBottom: 8 },
  selectSubtitle: { fontSize: 14, color: "#8b949e", textAlign: "center", marginBottom: 30 },
  teacherGrid:  { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  teacherOption: { width: "48%", backgroundColor: "#161b22", borderRadius: 16, padding: 20, alignItems: "center", marginBottom: 16, borderWidth: 2, borderColor: "#30363d" },
  teacherAvatarCircle: { width: 70, height: 70, borderRadius: 35, justifyContent: "center", alignItems: "center", borderWidth: 2, marginBottom: 12 },
  teacherAvatarEmoji: { fontSize: 36 },
  teacherOptionName:  { fontSize: 18, fontWeight: "bold", color: "#fff", marginBottom: 4 },
  teacherOptionGender: { fontSize:  12 },
  selectedIndicator: { position: "absolute", top: 10, right: 10, width:  24, height: 24, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  selectedCheck: { color: "#fff", fontWeight: "bold" },
  startLessonButton: { borderRadius: 12, padding: 18, alignItems: "center", marginTop:  20 },
  startLessonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  loadingContainer: { flex: 1, justifyContent:  "center", alignItems: "center", backgroundColor: "#0d1117", padding: 30 },
  loadingEmoji: { fontSize: 80, marginBottom: 24 },
  loadingTitle:  { fontSize: 24, fontWeight: "bold", color: "#fff", marginBottom: 24 },
  progressBarBg: { width: "80%", height: 8, backgroundColor: "#30363d", borderRadius: 4, marginBottom: 16 },
  progressBarFill: { height: "100%", borderRadius: 4 },
  loadingMessage: { fontSize: 16, color: "#8b949e", textAlign: "center" },
  errorText: { fontSize: 18, color: "#f85149", marginBottom: 20 },
  retryButton:  { backgroundColor: colors.primary, paddingHorizontal: 30, paddingVertical: 12, borderRadius: 8 },
  retryButtonText:  { color: "#fff", fontSize:  16, fontWeight: "600" },
  videoArea: { backgroundColor: "#161b22", paddingBottom: 12 },
  mainContent: { flexDirection: "row", padding: 16, gap: 12 },
  slideContainer: { flex: 1 },
  sectionBadge: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 12 },
  sectionBadgeText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  currentSectionTitle: { fontSize: 15, fontWeight: "bold", textAlign: "center", marginTop: 10 },
  visualCard: { backgroundColor: "#21262d", borderRadius: 12, padding: 20, alignItems: "center", justifyContent: "center", minHeight: 140, borderWidth: 2 },
  welcomeEmoji: { fontSize: 48, marginBottom: 12 },
  welcomeText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  tableScroll: { maxHeight: 150 },
  tableCard: { backgroundColor: "#21262d", borderRadius: 12, padding: 12, borderWidth: 2 },
  tableTitle: { fontSize: 14, fontWeight: "bold", marginBottom: 8 },
  tableHeaderRow: { flexDirection: "row", borderRadius: 6 },
  tableHeaderCell: { padding: 8, minWidth: 80, color: "#fff", fontWeight: "bold", fontSize: 11, textAlign: "center" },
  tableDataRow: { flexDirection: "row" },
  tableDataCell: { padding: 8, minWidth: 80, color: "#c9d1d9", fontSize: 11, textAlign: "center" },
  imageCard: { backgroundColor: "#21262d", borderRadius: 12, padding: 8, borderWidth: 2 },
  slideImage: { width: "100%", height: 160, borderRadius: 8 },
  slidePageRef: { position: "absolute", bottom: 12, right: 12, backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, color: "#fff", fontSize: 10 },
  pointsCard: { backgroundColor: "#21262d", borderRadius: 12, padding: 16, borderWidth: 2 },
  pointRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  pointBullet: { width: 24, height: 24, borderRadius: 12, justifyContent: "center", alignItems: "center", marginRight: 10 },
  pointNumber: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  pointText: { flex: 1, color: "#c9d1d9", fontSize: 13, lineHeight: 20 },
  teacherArea: { alignItems: "center", width: 90 },
  teacherCircle: { width: 75, height: 75, borderRadius: 38, backgroundColor: "#21262d", justifyContent: "center", alignItems: "center", borderWidth: 3 },
  teacherMainEmoji: { fontSize: 40 },
  speakingWave: { position: "absolute", bottom: -4, width: 30, height: 4, borderRadius: 2 },
  teacherNameLabel: { marginTop: 8, fontSize: 14, fontWeight: "bold" },
  teacherStatus: { fontSize: 11, color: "#8b949e" },
  progressSection: { paddingHorizontal: 16, marginBottom: 12 },
  progressTrack: { height: 4, backgroundColor: "#30363d", borderRadius: 2 },
  progressFill: { height: "100%", borderRadius: 2 },
  controlsRow:  { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 14, paddingHorizontal: 16 },
  controlBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#21262d", justifyContent: "center", alignItems: "center" },
  controlEmoji: { fontSize: 22 },
  speedText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  playBtn: { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center" },
  playEmoji: { fontSize: 28 },
  speedMenu: { backgroundColor: "#21262d", marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 16 },
  speedMenuHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  speedMenuTitle: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  speedMenuClose: { color: "#8b949e", fontSize: 18, padding: 4 },
  speedOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  speedOption: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#30363d", borderWidth: 2, borderColor: "#30363d" },
  speedOptionText: { color: "#c9d1d9", fontSize: 14, fontWeight: "600" },
  autoAdvanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#30363d" },
  autoAdvanceLabel: { color: "#c9d1d9", fontSize: 14 },
  autoAdvanceToggle: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, backgroundColor: "#30363d" },
  autoAdvanceToggleText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  optionBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 2, borderColor: '#30363d', backgroundColor: '#0d1117' },
  optionText: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
  tabsRow:  { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#30363d" },
  tabBtn: { flex: 1, padding: 14, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabLabel:  { fontSize: 13, color: "#8b949e" },
  bottomContent: { flex: 1 },
  contentCard: { margin: 16, backgroundColor: "#161b22", borderRadius: 12, padding: 16, borderLeftWidth: 4 },
  cardHeading: { fontSize: 18, fontWeight:  "bold", marginBottom: 12 },
  cardNarration: { fontSize: 15, color: "#c9d1d9", lineHeight: 24 },
  keyPointsBox: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#30363d" },
  keyPointsHeading:  { fontSize: 14, fontWeight: "bold", color: "#fff", marginBottom: 10 },
  keyPointLine:  { fontSize: 14, color: "#8b949e", marginBottom: 6, paddingLeft: 8 },
  sectionsList: { padding: 16 },
  sectionItem: { flexDirection: "row", alignItems: "center", backgroundColor: "#161b22", borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: "transparent" },
  sectionNumCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: "center", alignItems: "center", marginRight: 12 },
  sectionNumText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  sectionItemInfo: { flex: 1 },
  sectionItemTitle: { fontSize:  15, fontWeight: "600", color: "#c9d1d9" },
  sectionItemTime: { fontSize: 12, color: "#8b949e" },
  nowPlayingIcon: { fontSize: 20 },
  notesArea: { padding: 16 },
  noteBox: { backgroundColor: "#161b22", borderRadius: 12, padding: 16, marginBottom:  12 },
  noteBoxTitle: { fontSize: 16, fontWeight: "bold", color: "#fff", marginBottom: 10 },
  noteBoxText:  { fontSize: 14, color: "#c9d1d9", lineHeight: 22 },
  noteListItem: { fontSize: 14, color: "#8b949e", marginBottom: 6 },
});

export default VideoScreen;
