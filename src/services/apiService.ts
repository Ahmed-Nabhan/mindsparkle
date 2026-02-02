// Centralized API Service
// All backend calls go through here - update once, reflects everywhere

import axios from 'axios';
import { Alert } from 'react-native';
import Config from './config';
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Maximum concurrent API calls - process 50 at a time for optimal speed
var MAX_CONCURRENT = 50;

var errorToString = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  try {
    return typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
};

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

async function getSessionAccessToken(): Promise<string | null> {
  try {
    const now = Date.now();
    if (cachedSession && cachedSession.expiry > now + 60000) {
      return cachedSession.token;
    }

    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (session?.access_token) {
      cachedSession = {
        token: session.access_token,
        expiry: session.expires_at ? session.expires_at * 1000 : now + 3600000,
      };
      return session.access_token;
    }
  } catch {
    // ignore
  }
  return null;
}

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

  // The openai-proxy Edge Function validates the user's JWT for nearly all actions.
  // Avoid confusing "Invalid JWT" errors on fresh installs by failing fast.
  const guestAllowedActions = new Set(['test', 'chatMind', 'listAgents', 'chatMindMemory']);
  if (!guestAllowedActions.has(action)) {
    const token = await getSessionAccessToken();
    if (!token) {
      throw new Error('Please sign in to use AI features.');
    }
  }
  
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`API Retry attempt ${attempt} for ${action}`);
        // Exponential backoff: 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
      
      let dataSize = -1;
      try {
        dataSize = JSON.stringify(data).length;
      } catch {
        // Ignore sizing failures (should be rare)
      }
      console.log(`API Call: ${action}, data size: ${dataSize} chars`);
      
      var response = await apiClient.post(Config.OPENAI_PROXY_URL, {
        action,
        ...data,
      });
      
      console.log(`API Response status: ${response.status}`);
      
      // Normalize backend error shapes:
      // - { error: string }
      // - { code: number, message: string }
      if (response.data?.error) {
        console.error(`API Error: ${response.data.error}`);
        handleAPIError(response.data.error);
        throw new Error(response.data.error);
      }
      if (typeof response.data?.code === 'number' && response.data?.message && response.data.code >= 400) {
        console.error(`API Error: ${response.data.code} ${response.data.message}`);
        handleAPIError(response.data.message);
        throw new Error(response.data.message);
      }
      
      return response.data;
    } catch (error: any) {
      const respData = error?.response?.data;
      const serverMsg = typeof respData?.message === 'string' && respData.message.trim().length > 0
        ? respData.message
        : (typeof respData?.error === 'string' && respData.error.trim().length > 0 ? respData.error : null);

      if (serverMsg) {
        const wrapped: any = new Error(serverMsg);
        wrapped.response = error?.response;
        wrapped.status = error?.response?.status;
        lastError = wrapped;
      } else {
        lastError = error;
      }

      console.error('API call failed:', serverMsg || error?.message || error);
      console.error('Error details:', JSON.stringify(respData || {}));
      
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

    // If a single line exceeds maxSize, split it to avoid oversized chunks
    if (line.length > maxSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      for (var j = 0; j < line.length; j += maxSize) {
        chunks.push(line.slice(j, j + maxSize));
      }
      continue;
    }

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

export var summarizeModule = async function(
  content: string,
  params: { title: string; source?: { pageStart?: number; pageEnd?: number; inputChars?: number }; language?: 'en' | 'ar' }
): Promise<any> {
  const res = await callApi('summarizeModule', {
    content,
    title: params.title,
    source: params.source,
    language: params.language || 'en',
  });
  return res?.module;
};

// Generate quiz questions - handles large content with PARALLEL processing (50 concurrent)
export var generateQuiz = async function(content: string, questionCount?: number, focusTopics?: string[]): Promise<any[]> {
  var totalQuestions = questionCount || 10;
  
  // For small content, single request
  if (content.length <= Config.MAX_CONTENT_LENGTH) {
    var response = await callApi('quiz', {
      content: (content || '').substring(0, Config.MAX_CONTENT_LENGTH),
      count: totalQuestions,
      focusTopics: Array.isArray(focusTopics) && focusTopics.length > 0 ? focusTopics : undefined,
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
      count: questionsPerChunk,
      chunkInfo: 'Part ' + (i + 1) + ' of ' + chunks.length,
      focusTopics: Array.isArray(focusTopics) && focusTopics.length > 0 ? focusTopics : undefined,
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
    // New format: edge function may return { questions: [...] }
    if (response && response.questions && Array.isArray(response.questions) && response.questions.length > 0) {
      return response.questions;
    }

    var responseText = response.response || response;
    var jsonMatch = typeof responseText === 'string' ? responseText.match(/\[[\s\S]*\]/) : null;
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.error('Interview parse error:', err);
      }
    }

    // If we didn't get a JSON array, try to parse line-based output as a fallback
    const tryParseLines = (text: string) => {
      if (!text || typeof text !== 'string') return [] as any[];
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const items: any[] = [];
      let currentQ: any = null;
      for (const line of lines) {
        // Matches patterns like "1. What is..." or "- Question: ..."
        const m = line.match(/^\s*(?:\d+\.|-|•)?\s*(?:Q\:|Question\:)?\s*(.+)\?*$/i);
        if (m && m[1]) {
          if (currentQ) items.push(currentQ);
          currentQ = { question: m[1].trim(), type: 'conceptual', sampleAnswer: '', tips: [] };
        } else if (currentQ && line.length > 20 && !currentQ.sampleAnswer) {
          currentQ.sampleAnswer = line;
        } else if (currentQ && line.startsWith('-')) {
          currentQ.tips = currentQ.tips || [];
          currentQ.tips.push(line.replace(/^-\s*/, ''));
        }
      }
      if (currentQ) items.push(currentQ);
      return items;
    };

    try {
      const parsedFromLines = tryParseLines(responseText);
      if (parsedFromLines && parsedFromLines.length > 0) return parsedFromLines;
    } catch (err) {
      console.warn('Interview fallback line-parse failed:', err);
    }

    // Fallback: try a combined direct interview request without the wrapper prompt
    try {
      console.warn('Interview: primary response empty/invalid, attempting fallback combined request');
      const fallback = await callApi('interview', { content: content.substring(0, Config.MAX_CONTENT_LENGTH), count: totalQuestions, temperature: 0.35 });
      if (fallback && (fallback as any).questions && Array.isArray((fallback as any).questions) && (fallback as any).questions.length > 0) {
        return (fallback as any).questions;
      }
      if (Array.isArray(fallback) && fallback.length > 0) return fallback;
      const fallbackText = (fallback as any).response || fallback;
      const fbMatch = typeof fallbackText === 'string' ? fallbackText.match(/\[[\s\S]*\]/) : null;
      if (fbMatch) return JSON.parse(fbMatch[0]);
    } catch (err) {
      console.error('Interview fallback failed:', errorToString(err));
    }

    return [];
  }
  
  // For large content, split and process in parallel (50 concurrent)
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  var questionsPerChunk = Math.max(2, Math.ceil(totalQuestions / chunks.length));
  console.log('INSTANT INTERVIEW: Processing', chunks.length, 'chunks (50 concurrent max)');
  
  var results = await processBatched(chunks, function(chunk, i) {
    var typeFilter = questionType === 'all' || !questionType ? '' : 'Focus on ' + questionType + ' questions.';
    return callApi('interview', { content: chunk, count: questionsPerChunk, temperature: 0.3 }).then(function(response) {
      console.log('Completed interview chunk', i + 1);
      try {
        // New format: response.questions array
        if (response.questions && Array.isArray(response.questions)) {
          return { index: i, questions: response.questions };
        }
        // Legacy format fallback
        var text = response.response || response;
        var match = typeof text === 'string' ? text.match(/\[[\s\S]*\]/) : null;
        var questions = match ? JSON.parse(match[0]) : [];
        return { index: i, questions: questions };
      } catch (parseErr) {
        console.error('Interview chunk', i + 1, 'parse error:', errorToString(parseErr));
        return { index: i, questions: [] };
      }
    }).catch(function(err) {
      console.error('Interview chunk', i + 1, 'failed:', errorToString(err));
      return { index: i, questions: [] };
    });
  });
  
  // Combine all questions
  var allQuestions = results.flatMap(function(r: any) { return r.questions; });
  // If chunked generation returned nothing, try fallback combined request
  if (!allQuestions || allQuestions.length === 0) {
    console.warn('Interview: chunked generation returned no questions, attempting fallback combined request');
    try {
      const fallback = await callApi('interview', { content: content.substring(0, Config.MAX_CONTENT_LENGTH), count: totalQuestions, temperature: 0.35 });
      if (Array.isArray(fallback) && fallback.length > 0) return fallback.slice(0, totalQuestions);
      const fallbackText = fallback.response || fallback;
      const fbMatch = typeof fallbackText === 'string' ? fallbackText.match(/\[[\s\S]*\]/) : null;
      if (fbMatch) return JSON.parse(fbMatch[0]).slice(0, totalQuestions);
    } catch (err) {
      console.error('Interview fallback failed:', errorToString(err));
    }
  }

  return allQuestions.slice(0, totalQuestions);
};

// Generate a study plan table (topic + hours)
export var generateStudyPlan = async function(content: string, options?: { language?: 'en' | 'ar' }): Promise<{ plan: { topic: string; hours: number }[] }> {
  var language = options?.language || 'en';
  var response = await callApi('studyPlan', {
    content: (content || '').substring(0, Config.MAX_CONTENT_LENGTH),
    language,
  });
  return { plan: response.plan || [] };
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
    // If the response is empty or too short, attempt a stronger combined request
    // Backend returns { guide: ... } but we also check for summary/studyGuide for backward compat
    var text = response.guide || response.summary || (typeof response.studyGuide === 'string' ? response.studyGuide : JSON.stringify(response.studyGuide)) || '';
    
    if (!text || text === 'null' || text.length < 50) {
      console.warn('StudyGuide: initial response too short, retrying with combined prompt');
      try {
        const retry = await callApi('studyGuide', {
          content: content,
          isCombine: true,
        });
        text = retry.guide || retry.summary || (typeof retry.studyGuide === 'string' ? retry.studyGuide : JSON.stringify(retry.studyGuide)) || text;
      } catch (err) {
        console.error('StudyGuide retry failed:', err);
      }
    }
    return {
      structured: response.studyGuide || null,
      text: text,
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
      var chunkText = response.guide || response.summary || (typeof response.studyGuide === 'string' ? response.studyGuide : JSON.stringify(response.studyGuide)) || '';
      return { index: i, text: chunkText };
    }).catch(function(err) {
      console.error('Study guide chunk', i + 1, 'failed:', err.message);
      return { index: i, text: '' };
    });
  });
  results.sort(function(a, b) { return a.index - b.index; });
  var allGuides = results.filter(function(r) { return r.text.length > 0; }).map(function(r) { return r.text; });
  
  // If chunking produced no useful output, try a combined fallback request
  if (allGuides.length === 0) {
    console.warn('Study guide: chunking returned no content, attempting fallback combined request');
    try {
      const fallbackResponse = await callApi('studyGuide', { content: content.substring(0, Config.MAX_CONTENT_LENGTH) });
      const fallbackText = fallbackResponse.guide || fallbackResponse.summary || (typeof fallbackResponse.studyGuide === 'string' ? fallbackResponse.studyGuide : JSON.stringify(fallbackResponse.studyGuide)) || '';
      if (fallbackText && fallbackText.length > 20) {
        return { structured: fallbackResponse.studyGuide || null, text: fallbackText };
      }
      // As a last attempt, call combine flag to force aggregation on server
      const finalAttempt = await callApi('studyGuide', { content: content.substring(0, Config.MAX_CONTENT_LENGTH), isCombine: true });
      const finalText = finalAttempt.guide || finalAttempt.summary || (typeof finalAttempt.studyGuide === 'string' ? finalAttempt.studyGuide : JSON.stringify(finalAttempt.studyGuide)) || '';
      if (finalText && finalText.length > 20) {
        return { structured: finalAttempt.studyGuide || null, text: finalText };
      }
    } catch (err) {
      console.error('Study guide fallback failed:', errorToString(err));
    }

    // Last resort: return helpful message
    return { structured: null, text: 'Unable to generate study guide for this document. Try reducing document size or re-uploading.' };
  }

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
const normalizeSseText = (raw: any): string => {
  const s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (!s) return '';
  if (!s.includes('data:')) return s;

  const out: string[] = [];
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.replace(/^data:\s*/, '');
    if (!payload || payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      const t = typeof obj?.text === 'string' ? obj.text : '';
      if (t) out.push(t);
    } catch {
      out.push(payload);
    }
  }

  return out.length > 0 ? out.join('') : s;
};

export var chat = async function(
  message: string,
  context?: string,
  history?: { role: string; content: string }[],
  agentId?: string
): Promise<string> {
  var response = await callApi('chat', {
    question: message,
    content: (context || '').substring(0, Config.MAX_CONTENT_LENGTH),
    history: history?.slice(-10), // Keep last 10 messages for context
    agentId: agentId,
  });

  if (typeof response === 'string') return normalizeSseText(response);
  const text = response?.response ?? response?.message ?? '';
  return normalizeSseText(text);
};

// Chat Mind (no document context) - separate backend action for isolation
export var chatMind = async function(
  message: string,
  history?: { role: string; content: string }[],
  agentId?: string,
  options?: { mode?: 'general' | 'study' | 'work' | 'health'; memoryEnabled?: boolean }
): Promise<string> {
  const guestId = await getGuestId();
  var response = await callApi('chatMind', {
    question: message,
    history: history?.slice(-10),
    agentId: agentId,
    guestId,
    chatMindMode: options?.mode,
    memory: {
      enabled: Boolean(options?.memoryEnabled),
    },
  });

  if (typeof response === 'string') return normalizeSseText(response);
  const text = response?.response ?? response?.message ?? '';
  return normalizeSseText(text);
};

// Document chat - separate backend action for isolation
export var docChat = async function(
  message: string,
  context?: string,
  history?: { role: string; content: string }[],
  agentId?: string
): Promise<string> {
  var response = await callApi('docChat', {
    question: message,
    content: (context || '').substring(0, Config.MAX_CONTENT_LENGTH),
    history: history?.slice(-10),
    agentId: agentId,
  });

  if (typeof response === 'string') return normalizeSseText(response);
  const text = response?.response ?? response?.message ?? '';
  return normalizeSseText(text);
};

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: Config.SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + Config.SUPABASE_ANON_KEY,
  };

  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }
  } catch {
    // Best-effort; fall back to anon.
  }

  return headers;
}

async function getGuestId(): Promise<string> {
  const key = 'guestId';
  try {
    const existing = await AsyncStorage.getItem(key);
    if (existing && existing.trim()) return existing;
    const created = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(key, created);
    return created;
  } catch {
    return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export var chatStream = async function(
  message: string,
  context: string | undefined,
  history: { role: string; content: string }[] | undefined,
  agentId: string | undefined,
  onDelta: (deltaText: string) => void,
  onDone?: () => void,
  onError?: (err: any) => void
): Promise<void> {
  return chatStreamWithAction(
    'chatStream',
    {
      question: message,
      content: (context || '').substring(0, Config.MAX_CONTENT_LENGTH),
      history: history?.slice(-10),
      agentId: agentId,
    },
    onDelta,
    onDone,
    onError
  );
};

async function chatStreamWithAction(
  action: string,
  body: any,
  onDelta: (deltaText: string) => void,
  onDone?: () => void,
  onError?: (err: any) => void
): Promise<void> {
  // Streaming endpoints are backed by openai-proxy. Allow guest for ChatMind.
  if (action !== 'test' && action !== 'chatMindStream') {
    const token = await getSessionAccessToken();
    if (!token) {
      const err: any = new Error('Please sign in to use AI chat.');
      err.status = 401;
      throw err;
    }
  }

  const headers = await buildAuthHeaders();
  const res = await fetch(Config.OPENAI_PROXY_URL, {
    method: 'POST',
    headers: {
      ...headers,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      action,
      ...body,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err: any = new Error(text || `chatStream failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }

  // Some runtimes (notably Expo Go) may not expose a streaming body.
  // In that case, parse the full SSE payload as text and emit deltas.
  if (!res.body) {
    const text = await res.text().catch(() => '');
    if (!text) {
      onDone?.();
      return;
    }

    let buffer = text;
    while (true) {
      const idxLF = buffer.indexOf('\n\n');
      const idxCRLF = buffer.indexOf('\r\n\r\n');
      const hasLF = idxLF !== -1;
      const hasCRLF = idxCRLF !== -1;
      if (!hasLF && !hasCRLF) break;

      const idx = hasLF && hasCRLF ? Math.min(idxLF, idxCRLF) : (hasLF ? idxLF : idxCRLF);
      const sepLen = idx === idxCRLF ? 4 : 2;

      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + sepLen);

      const lines = frame.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.replace(/^data:\s*/, '');
        if (!payload) continue;
        if (payload === '[DONE]') {
          onDone?.();
          return;
        }
        try {
          const obj = JSON.parse(payload);
          const delta = String(obj?.text || '');
          if (delta) onDelta(delta);
        } catch {
          onDelta(payload);
        }
      }
    }

    onDone?.();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE frames separated by blank line.
      while (true) {
        const idxLF = buffer.indexOf('\n\n');
        const idxCRLF = buffer.indexOf('\r\n\r\n');
        const hasLF = idxLF !== -1;
        const hasCRLF = idxCRLF !== -1;
        if (!hasLF && !hasCRLF) break;

        const idx = hasLF && hasCRLF ? Math.min(idxLF, idxCRLF) : (hasLF ? idxLF : idxCRLF);
        const sepLen = idx === idxCRLF ? 4 : 2;

        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + sepLen);

        const lines = frame.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.replace(/^data:\s*/, '');
          if (!payload) continue;

          if (payload === '[DONE]') {
            onDone?.();
            return;
          }

          try {
            const obj = JSON.parse(payload);
            const delta = String(obj?.text || '');
            if (delta) onDelta(delta);
          } catch {
            // If backend ever sends raw text.
            onDelta(payload);
          }
        }
      }
    }

    onDone?.();
  } catch (e: any) {
    onError?.(e);
    throw e;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
};

// Chat Mind streaming - separate backend action for isolation
export var chatMindStream = async function(
  message: string,
  _context: string | undefined,
  history: { role: string; content: string }[] | undefined,
  agentId: string | undefined,
  onDelta: (deltaText: string) => void,
  onDone?: () => void,
  onError?: (err: any) => void,
  options?: { mode?: 'general' | 'study' | 'work' | 'health'; memoryEnabled?: boolean }
): Promise<void> {
  const guestId = await getGuestId();
  return chatStreamWithAction(
    'chatMindStream',
    {
      question: message,
      history: history?.slice(-10),
      agentId: agentId,
      guestId,
      chatMindMode: options?.mode,
      memory: {
        enabled: Boolean(options?.memoryEnabled),
      },
    },
    onDelta,
    onDone,
    onError
  );
};

export var chatMindMemoryClear = async function(): Promise<void> {
  await callApi('chatMindMemory', { op: 'clear' });
};

// Doc chat streaming - separate backend action for isolation
export var docChatStream = async function(
  message: string,
  context: string | undefined,
  history: { role: string; content: string }[] | undefined,
  agentId: string | undefined,
  onDelta: (deltaText: string) => void,
  onDone?: () => void,
  onError?: (err: any) => void
): Promise<void> {
  return chatStreamWithAction(
    'docChatStream',
    {
      question: message,
      content: (context || '').substring(0, Config.MAX_CONTENT_LENGTH),
      history: history?.slice(-10),
      agentId: agentId,
    },
    onDelta,
    onDone,
    onError
  );
};

export var exportFile = async function(params: {
  kind: 'notes' | 'study_guide' | 'flashcards_csv' | 'quiz_json' | 'report';
  message?: string;
  context?: string;
  history?: { role: string; content: string }[];
  agentId?: string;
}): Promise<{ url: string; filename: string; mimeType: string }> {
  var response = await callApi('exportFile', {
    kind: params.kind,
    message: params.message,
    content: (params.context || '').substring(0, Config.MAX_CONTENT_LENGTH),
    history: params.history?.slice(-10),
    agentId: params.agentId,
  });

  if (!response?.url) throw new Error('Export failed: missing download url');
  return {
    url: String(response.url),
    filename: String(response.filename || 'export.txt'),
    mimeType: String(response.mimeType || 'text/plain'),
  };
};

// Fetch available chat agents (personas) from the backend
export var listAgents = async function(): Promise<{ id: string; name: string; description?: string }[]> {
  var response = await callApi('listAgents', {});
  return Array.isArray(response.agents) ? response.agents : [];
};

// Generate an image for a paged summary module (returns a data URL)
export var generateModuleImage = async function(
  title: string,
  bullets: string[],
  language?: 'en' | 'ar'
): Promise<string> {
  var response = await callApi('generateModuleImage', {
    title: title,
    bullets: Array.isArray(bullets) ? bullets.slice(0, 8) : [],
    language: language || 'en',
  });
  return response.imageDataUrl || '';
};

// Generate a general image from a prompt (returns a data URL)
export var generateImage = async function(
  prompt: string,
  options?: { imageMode?: 'default' | 'realism' | 'premium' }
): Promise<string> {
  var response = await callApi('generateImage', {
    prompt: String(prompt || '').slice(0, 1200),
    image_mode: options?.imageMode,
  });
  return response.imageDataUrl || '';
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
  summarizeModule,
  generateQuiz,
  generateStudyPlan,
  generateStudyGuide,
  generateVideoScript,
  chat,
  chatMind,
  docChat,
  chatStream,
  chatMindStream,
  chatMindMemoryClear,
  docChatStream,
  listAgents,
  generateModuleImage,
  generateImage,
  exportFile,
  searchYoutubeVideos,
  getYoutubeSubtitles,
};
