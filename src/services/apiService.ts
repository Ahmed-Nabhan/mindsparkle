// Centralized API Service
// All backend calls go through here - update once, reflects everywhere

import axios from 'axios';
import { Alert } from 'react-native';
import Config from './config';
import { supabase } from './supabase';

// Maximum concurrent API calls - process 50 at a time for optimal speed
var MAX_CONCURRENT = 50;

// Helper: Process promises in batches of MAX_CONCURRENT for controlled parallelism
var processBatched = async function<T>(
  items: T[],
  processor: (item: T, index: number) => Promise<any>
): Promise<any[]> {
  var results: any[] = [];
  
  for (var i = 0; i < items.length; i += MAX_CONCURRENT) {
    var batch = items.slice(i, i + MAX_CONCURRENT);
    console.log(`Processing batch ${Math.floor(i / MAX_CONCURRENT) + 1}: items ${i + 1}-${Math.min(i + MAX_CONCURRENT, items.length)} of ${items.length}`);
    
    var batchPromises = batch.map(function(item, batchIndex) {
      return processor(item, i + batchIndex);
    });
    
    var batchResults = await Promise.all(batchPromises);
    results = results.concat(batchResults);
  }
  
  return results;
};

var apiClient = axios.create({
  timeout: Config.API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + Config.SUPABASE_ANON_KEY,
    'apikey': Config.SUPABASE_ANON_KEY,
  },
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});

// Cache the session to avoid repeated async calls
var cachedSession: { token: string; expiry: number } | null = null;

// Attach Supabase session token for auth-protected proxy
apiClient.interceptors.request.use(async function (config) {
  try {
    // Use cached token if still valid (with 60s buffer)
    const now = Date.now();
    if (cachedSession && cachedSession.expiry > now + 60000) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = 'Bearer ' + cachedSession.token;
      return config;
    }
    
    // Get fresh session
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    
    if (session?.access_token) {
      // Cache the token with expiry
      cachedSession = {
        token: session.access_token,
        expiry: session.expires_at ? session.expires_at * 1000 : now + 3600000,
      };
      config.headers = config.headers || {};
      config.headers['Authorization'] = 'Bearer ' + session.access_token;
    } else {
      // No session - try to get user directly as fallback
      const { data: userData } = await supabase.auth.getUser();
      console.warn('No session found, user:', userData?.user?.id || 'none');
    }
  } catch (err) {
    console.warn('Could not attach Supabase session token:', err);
  }
  return config;
});

// Handle API errors gracefully - show user-friendly message
var handleAPIError = function(error: any): void {
  var errorMessage = error?.message || error?.toString() || '';
  
  // Check if it's a quota/credit error (don't tell user about credits)
  if (
    errorMessage.includes('QUOTA_EXCEEDED') ||
    errorMessage.toLowerCase().includes('quota') ||
    errorMessage.toLowerCase().includes('insufficient') ||
    errorMessage.toLowerCase().includes('billing')
  ) {
    // Show generic message to user - don't mention credits
    Alert.alert(
      '🔧 Service Temporarily Unavailable',
      'Our AI service is experiencing high demand. Please try again in a few minutes.\n\nIf the problem persists, try again later.',
      [{ text: 'OK' }]
    );
  }
};

// Generic API call with error handling and retry
export var callApi = async function(action: string, data: any, retries: number = 2): Promise<any> {
  var lastError: any = null;
  
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`API Retry attempt ${attempt} for ${action}`);
        // Exponential backoff: 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
      
      console.log(`API Call: ${action}, data size: ${JSON.stringify(data).length} chars`);
      
      var response = await apiClient.post(Config.OPENAI_PROXY_URL, {
        action,
        ...data,
      });
      
      console.log(`API Response status: ${response.status}`);
      
      if (response.data.error) {
        console.error(`API Error: ${response.data.error}`);
        // Check if it's a credit error - show friendly message
        handleAPIError(response.data.error);
        throw new Error(response.data.error);
      }
      
      return response.data;
    } catch (error: any) {
      lastError = error;
      console.error('API call failed:', error?.message || error);
      console.error('Error details:', JSON.stringify(error?.response?.data || {}));
      
      // Don't retry on certain errors
      var status = error.response?.status;
      if (status === 401 || status === 403) {
        // Auth errors - don't retry
        break;
      }
      
      // Retry on rate limits or server errors
      if ((status === 429 || status >= 500) && attempt < retries) {
        console.log(`Will retry... (${retries - attempt} attempts left)`);
        continue;
      }
      
      // Check for API errors
      if (status === 429 || status === 402) {
        handleAPIError(error);
      }
    }
  }
  
  // All retries failed
  if (lastError?.response?.status >= 500) {
    Alert.alert(
      'Service error',
      'Our servers are temporarily busy. Please wait a moment and try again.',
      [{ text: 'OK' }]
    );
  } else if (lastError?.response?.status >= 400) {
    Alert.alert(
      'Request failed',
      'We could not process your request. Please try again.',
      [{ text: 'OK' }]
    );
  }
  throw lastError;
};

// Split content into chunks
var splitIntoChunks = function(content: string, maxSize: number): string[] {
  var chunks: string[] = [];
  var lines = content.split('\n');
  var currentChunk = '';
  
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (currentChunk.length + line.length > maxSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
};

// Summarize content - handles large documents by chunking
export var summarize = async function(
  content: string,
  options?: { chunkInfo?: string; isCombine?: boolean; includePageRefs?: boolean; imageUrls?: string[]; includeImages?: boolean; language?: 'en' | 'ar'; onChunkComplete?: (partialSummary: string, chunkNum: number, totalChunks: number) => void }
): Promise<string> {
  console.log('Summarizing content of length:', content.length, 'language:', options?.language || 'en');
  
  // VALIDATION: Check if content is sufficient to summarize
  if (!content || content.trim().length < 50) {
    console.warn('Content too short to summarize:', content?.length || 0, 'chars');
    // If we have images, we can still try vision API
    if (options?.imageUrls && options.imageUrls.length > 0) {
      console.log('Using images for summary since text is short');
    } else {
      return 'Unable to generate summary: Document content is too short or empty. Please ensure the document has extractable text.';
    }
  }
  
  // If content fits in one request, send it directly
  if (content.length <= Config.MAX_CONTENT_LENGTH) {
    // If images are provided and requested, include them for a richer multimodal summary
    var payload: any = {
      content: content,
      chunkInfo: options?.chunkInfo,
      isCombine: options?.isCombine,
      includePageRefs: options?.includePageRefs,
      language: options?.language || 'en',
    };
    if (options?.includeImages && options?.imageUrls && options.imageUrls.length > 0) {
      payload.imageUrls = options.imageUrls.slice(0, 20);
    }

    var response = await callApi('summarize', payload);
    return response.summary || '';
  }
  
  // For large content, summarize in chunks then combine
  console.log('Content too large, chunking...');
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  console.log('INSTANT SUMMARY: Processing', chunks.length, 'chunks (50 concurrent max)');
  
  // Track completed summaries for streaming updates
  var completedSummaries: { index: number; summary: string }[] = [];
  
  // Process chunks in batches of 50 for controlled parallelism
  var chunkSummaries = await processBatched(chunks, function(chunk, i) {
    var chunkPayload: any = {
      content: chunk,
      chunkInfo: 'Part ' + (i + 1) + ' of ' + chunks.length,
      includePageRefs: options?.includePageRefs,
      language: options?.language || 'en',
    };
    // Include images only in the first chunk
    if (i === 0 && options?.includeImages && options?.imageUrls) {
      chunkPayload.imageUrls = options.imageUrls.slice(0, 10);
    }
    return callApi('summarize', chunkPayload).then(function(response) {
      console.log('Completed chunk', i + 1, 'of', chunks.length);
      var result = { index: i, summary: response.summary || '' };
      
      // Stream update: notify as each chunk completes
      if (options?.onChunkComplete && result.summary) {
        completedSummaries.push(result);
        completedSummaries.sort(function(a, b) { return a.index - b.index; });
        var partialText = completedSummaries.map(function(r) { 
          return '## Part ' + (r.index + 1) + '\n' + r.summary; 
        }).join('\n\n---\n\n');
        options.onChunkComplete(partialText, completedSummaries.length, chunks.length);
      }
      
      return result;
    }).catch(function(err) {
      console.error('Chunk', i + 1, 'failed:', err.message);
      return { index: i, summary: '' };
    });
  });
  
  // Sort by index and extract summaries
  chunkSummaries.sort(function(a, b) { return a.index - b.index; });
  var summaryTexts = chunkSummaries
    .filter(function(r) { return r.summary.length > 0; })
    .map(function(r) { return '## Part ' + (r.index + 1) + '\n' + r.summary; });
  
  // SKIP COMBINE STEP - just return joined summaries for INSTANT results
  // The AI already created good summaries per chunk, no need to re-process
  return summaryTexts.join('\n\n---\n\n');
};

// Generate quiz questions - handles large content with PARALLEL processing (50 concurrent)
export var generateQuiz = async function(content: string, questionCount?: number): Promise<any[]> {
  var totalQuestions = questionCount || 10;
  
  // For small content, single request
  if (content.length <= Config.MAX_CONTENT_LENGTH) {
    var response = await callApi('quiz', {
      content: (content || '').substring(0, Config.MAX_CONTENT_LENGTH),
      questionCount: totalQuestions,
    });
    return response.questions || [];
  }
  
  // For large content, split and process in parallel (50 concurrent)
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  var questionsPerChunk = Math.max(3, Math.ceil(totalQuestions / chunks.length));
  console.log('INSTANT QUIZ: Processing', chunks.length, 'chunks (50 concurrent max), ~' + questionsPerChunk + ' questions each');
  
  var results = await processBatched(chunks, function(chunk, i) {
    return callApi('quiz', {
      content: chunk,
      questionCount: questionsPerChunk,
      chunkInfo: 'Part ' + (i + 1) + ' of ' + chunks.length,
    }).then(function(response) {
      console.log('Completed quiz chunk', i + 1);
      return { index: i, questions: response.questions || [] };
    }).catch(function(err) {
      console.error('Quiz chunk', i + 1, 'failed:', err.message);
      return { index: i, questions: [] };
    });
  });
  
  // Combine all questions and shuffle
  var allQuestions = results.flatMap(function(r: any) { return r.questions; });
  allQuestions = allQuestions.sort(function() { return Math.random() - 0.5; });
  
  // Return requested number of questions
  return allQuestions.slice(0, totalQuestions);
};

// Generate flashcards - handles large content with PARALLEL processing (50 concurrent)
export var generateFlashcards = async function(content: string, count?: number): Promise<any[]> {
  var totalCards = count || 20;
  
  // For small content, single request
  if (content.length <= Config.MAX_CONTENT_LENGTH) {
    var response = await callApi('flashcards', {
      content: (content || '').substring(0, Config.MAX_CONTENT_LENGTH),
    });
    return response.flashcards || [];
  }
  
  // For large content, split and process in parallel (50 concurrent)
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  var cardsPerChunk = Math.max(5, Math.ceil(totalCards / chunks.length));
  console.log('INSTANT FLASHCARDS: Processing', chunks.length, 'chunks (50 concurrent max)');
  
  var results = await processBatched(chunks, function(chunk, i) {
    return callApi('flashcards', {
      content: chunk,
      count: cardsPerChunk,
      chunkInfo: 'Part ' + (i + 1) + ' of ' + chunks.length,
    }).then(function(response) {
      console.log('Completed flashcard chunk', i + 1);
      return { index: i, flashcards: response.flashcards || [] };
    }).catch(function(err) {
      console.error('Flashcard chunk', i + 1, 'failed:', err.message);
      return { index: i, flashcards: [] };
    });
  });
  
  // Combine all flashcards
  var allCards = results.flatMap(function(r: any) { return r.flashcards; });
  return allCards.slice(0, totalCards);
};

// Generate interview questions - handles large content with PARALLEL processing (50 concurrent)
export var generateInterview = async function(content: string, questionCount?: number, questionType?: string): Promise<any[]> {
  var totalQuestions = questionCount || 10;
  
  // For small content, single request
  if (content.length <= Config.MAX_CONTENT_LENGTH) {
    var typeFilter = questionType === 'all' || !questionType ? '' : 'Focus on ' + questionType + ' questions.';
    var prompt = 'Based on this document content, generate ' + totalQuestions + ' interview questions. ' + typeFilter + '\n\nDocument content:\n' + content.substring(0, Config.MAX_CONTENT_LENGTH) + '\n\nReturn a JSON array with: [{"question":"...","type":"technical|conceptual|behavioral","sampleAnswer":"...","tips":["..."]}]';
    
    var response = await callApi('interview', { content: prompt, temperature: 0.3 });
    var responseText = response.response || response;
    var jsonMatch = typeof responseText === 'string' ? responseText.match(/\[[\s\S]*\]/) : null;
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  }
  
  // For large content, split and process in parallel (50 concurrent)
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  var questionsPerChunk = Math.max(2, Math.ceil(totalQuestions / chunks.length));
  console.log('INSTANT INTERVIEW: Processing', chunks.length, 'chunks (50 concurrent max)');
  
  var results = await processBatched(chunks, function(chunk, i) {
    var typeFilter = questionType === 'all' || !questionType ? '' : 'Focus on ' + questionType + ' questions.';
    var prompt = 'Based on this content, generate ' + questionsPerChunk + ' interview questions. ' + typeFilter + '\n\nContent:\n' + chunk + '\n\nReturn JSON: [{"question":"...","type":"...","sampleAnswer":"...","tips":["..."]}]';
    
    return callApi('interview', { content: prompt, temperature: 0.3 }).then(function(response) {
      console.log('Completed interview chunk', i + 1);
      var text = response.response || response;
      var match = typeof text === 'string' ? text.match(/\[[\s\S]*\]/) : null;
      var questions = match ? JSON.parse(match[0]) : [];
      return { index: i, questions: questions };
    }).catch(function(err) {
      console.error('Interview chunk', i + 1, 'failed:', err.message);
      return { index: i, questions: [] };
    });
  });
  
  // Combine all questions
  var allQuestions = results.flatMap(function(r: any) { return r.questions; });
  return allQuestions.slice(0, totalQuestions);
};

// Generate study guide - handles large content with PARALLEL processing
export var generateStudyGuide = async function(
  content: string, 
  imageUrls?: string[]
): Promise<{ structured?: any; text: string }> {
  // If content is very low but we have images, send images for vision analysis
  if (content.length < 500 && imageUrls && imageUrls.length > 0) {
    console.log('Using vision API with', imageUrls.length, 'images');
    var response = await callApi('studyGuide', {
      content: content,
      imageUrls: imageUrls.slice(0, 20), // Send up to 20 image URLs
    });
    return {
      structured: response.studyGuide || null,
      text: response.summary || JSON.stringify(response.studyGuide) || ''
    };
  }
  
  // Normal text-based processing
  if (content.length <= Config.MAX_CONTENT_LENGTH) {
    var response = await callApi('studyGuide', {
      content: content,
    });
    return {
      structured: response.studyGuide || null,
      text: response.summary || JSON.stringify(response.studyGuide) || ''
    };
  }
  
  // PARALLEL chunk processing for large documents (50 concurrent)
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  console.log('Study guide: processing', chunks.length, 'chunks (50 concurrent max)');
  
  // Process chunks in batches of 50
  var results = await processBatched(chunks, function(chunk, i) {
    return callApi('studyGuide', {
      content: chunk,
      chunkInfo: 'Part ' + (i + 1) + ' of ' + chunks.length,
    }).then(function(response) {
      return { index: i, text: response.summary || JSON.stringify(response.studyGuide) || '' };
    }).catch(function(err) {
      console.error('Study guide chunk', i + 1, 'failed:', err.message);
      return { index: i, text: '' };
    });
  });
  results.sort(function(a, b) { return a.index - b.index; });
  var allGuides = results.filter(function(r) { return r.text.length > 0; }).map(function(r) { return r.text; });
  
  return { structured: null, text: allGuides.join('\n\n---\n\n') };
};

// Generate video script with slides - uses smart sampling for large documents
export var generateVideoScript = async function(
  pages: { pageNum: number; text: string; imageUrl?: string }[],
  options?: { language?: 'en' | 'ar' | string; style?: string; useAnimations?: boolean }
): Promise<{
  introduction: string;
  sections: { 
    title: string; 
    narration: string; 
    pageRef: number;
    slideUrl?: string;
    keyPoints: string[];
    visualDirections?: string[];
  }[];
  conclusion: string;
}> {
  console.log('Generating video script for', pages.length, 'pages');
  
  // OPTIMIZATION: For large documents, sample key pages instead of processing all
  // This reduces a 350-page doc from 44 API calls to just 3-4 calls
  var MAX_VIDEO_PAGES = 24; // Max pages for video (creates ~8-12 sections)
  var sampled = pages;
  
  if (pages.length > MAX_VIDEO_PAGES) {
    console.log('Large document detected, sampling', MAX_VIDEO_PAGES, 'key pages from', pages.length);
    sampled = [];
    var step = Math.floor(pages.length / MAX_VIDEO_PAGES);
    
    // Always include first 3 pages (intro/TOC)
    sampled.push(...pages.slice(0, 3));
    
    // Sample evenly from the rest
    for (var i = 3; i < pages.length && sampled.length < MAX_VIDEO_PAGES - 2; i += step) {
      if (!sampled.find(function(p) { return p.pageNum === pages[i].pageNum; })) {
        sampled.push(pages[i]);
      }
    }
    
    // Always include last 2 pages (conclusion/summary)
    var lastPages = pages.slice(-2);
    lastPages.forEach(function(p) {
      if (!sampled.find(function(s) { return s.pageNum === p.pageNum; })) {
        sampled.push(p);
      }
    });
    
    // Sort by page number
    sampled.sort(function(a, b) { return a.pageNum - b.pageNum; });
    console.log('Sampled pages:', sampled.map(function(p) { return p.pageNum; }).join(', '));
  }
  
  // For small documents (<=8 pages), process in single request
  if (sampled.length <= 8) {
    var content = sampled.map(function(p) {
      return '=== PAGE ' + p.pageNum + ' ===\n' + (p.text || '');
    }).join('\n\n');
    
    var payload: any = {
      content: (content || '').substring(0, Config.MAX_CONTENT_LENGTH),
      pageCount: sampled.length,
      totalPages: pages[pages.length - 1]?.pageNum || pages.length,
      language: options?.language || 'en',
      style: options?.style || 'educational',
      useAnimations: options?.useAnimations === undefined ? true : !!options?.useAnimations,
    };

    var response = await callApi('videoWithSlides', payload);
    var script = response.videoScript || {
      introduction: 'Welcome to this lesson.',
      sections: [],
      conclusion: 'Thank you for learning with me.',
    };
    
    // Map slides to sections
    if (script.sections) {
      script.sections = script.sections.map(function(section: any) {
        var pageRef = section.pageRef || 1;
        var matchingPage = pages.find(function(p) { return p.pageNum === pageRef; });
        return { ...section, slideUrl: matchingPage?.imageUrl };
      });
    }
    return script;
  }
  
  // For medium documents (9-24 pages), split into chunks and process in parallel
  var PAGES_PER_CHUNK = 8;
  var chunks: { pageNum: number; text: string; imageUrl?: string }[][] = [];
  
  for (var i = 0; i < sampled.length; i += PAGES_PER_CHUNK) {
    chunks.push(sampled.slice(i, i + PAGES_PER_CHUNK));
  }
  
  console.log('VIDEO: Processing', chunks.length, 'chunks (max 3-4 API calls)');
  
  // Process chunks in parallel
  var allSections = await processBatched(chunks, function(chunk, chunkIndex) {
    var chunkContent = chunk.map(function(p) {
      return '=== PAGE ' + p.pageNum + ' ===\n' + (p.text || '');
    }).join('\n\n');
    
    var chunkPayload: any = {
      content: chunkContent,
      pageCount: chunk.length,
      totalPages: pages.length,
      chunkInfo: 'Part ' + (chunkIndex + 1) + ' of ' + chunks.length,
      language: options?.language || 'en',
      style: options?.style || 'educational',
      useAnimations: options?.useAnimations === undefined ? true : !!options?.useAnimations,
      isChunk: true,
    };
    
    return callApi('videoChunk', chunkPayload).then(function(response) {
      console.log('Completed video chunk', chunkIndex + 1);
      return { index: chunkIndex, sections: response.sections || [] };
    }).catch(function(err) {
      console.error('Video chunk', chunkIndex + 1, 'failed:', err.message);
      return { index: chunkIndex, sections: [] };
    });
  });
  
  // Sort by index and combine sections
  allSections.sort(function(a, b) { return a.index - b.index; });
  var combinedSections = allSections.flatMap(function(r) { return r.sections; });
  
  // Map slides to sections
  combinedSections = combinedSections.map(function(section: any) {
    var pageRef = section.pageRef || 1;
    var matchingPage = pages.find(function(p) { return p.pageNum === pageRef; });
    return { ...section, slideUrl: matchingPage?.imageUrl };
  });
  
  // SKIP intro/conclusion API call - use instant pre-written text
  // This saves ~3-5 seconds per video generation
  var langIsArabic = options?.language === 'ar';
  var introduction = langIsArabic 
    ? 'مرحباً بكم في هذا الدرس الشامل! سنتعلم معاً المفاهيم الأساسية من هذا المستند.'
    : 'Welcome to this comprehensive lesson! Let\'s explore the key concepts from this document together.';
  var conclusion = langIsArabic
    ? 'شكراً لكم على التعلم معي اليوم! أتمنى أن تكونوا قد استفدتم من هذا الدرس.'
    : 'Thank you for learning with me today! I hope you found this lesson helpful and informative.';
  
  return {
    introduction: introduction,
    sections: combinedSections,
    conclusion: conclusion,
  };
};

// Chat with document context
export var chat = async function(
  message: string,
  context?: string,
  history?: { role: string; content: string }[]
): Promise<string> {
  var response = await callApi('chat', {
    message: message,
    context: (context || '').substring(0, Config.MAX_CONTENT_LENGTH),
    history: history?.slice(-10), // Keep last 10 messages for context
  });
  return response.response || response.message || '';
};

// YouTube video search - finds educational videos based on document topic
export var searchYoutubeVideos = async function(
  query: string,
  options?: { language?: string; maxResults?: number }
): Promise<{
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  duration?: string;
}[]> {
  try {
    console.log(`Searching YouTube for: "${query}" in language: ${options?.language || 'en'}`);
    
    var response = await callApi('youtube_search', {
      query: query,
      language: options?.language || 'en',
      maxResults: options?.maxResults || 10,
    });
    
    if (response.videos && Array.isArray(response.videos)) {
      console.log(`Found ${response.videos.length} YouTube videos`);
      return response.videos;
    }
    
    return [];
  } catch (error: any) {
    console.error('YouTube search failed:', error?.message || error);
    throw new Error('Could not search YouTube videos. Please try again.');
  }
};

// Get YouTube video captions/subtitles
export var getYoutubeSubtitles = async function(
  videoId: string,
  language?: string
): Promise<{
  available: { code: string; name: string }[];
  captions?: { start: number; duration: number; text: string }[];
}> {
  try {
    var response = await callApi('youtube_captions', {
      videoId: videoId,
      language: language || 'en',
    });
    
    return {
      available: response.available || [],
      captions: response.captions || [],
    };
  } catch (error: any) {
    console.error('Could not get YouTube captions:', error?.message || error);
    return { available: [], captions: [] };
  }
};

export default {
  callApi,
  summarize,
  generateQuiz,
  generateStudyGuide,
  generateVideoScript,
  chat,
  searchYoutubeVideos,
  getYoutubeSubtitles,
};
