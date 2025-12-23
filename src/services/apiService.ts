// Centralized API Service
// All backend calls go through here - update once, reflects everywhere

import axios from 'axios';
import Config from './config';

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

// Generic API call
export var callApi = async function(action: string, data: any): Promise<any> {
  var response = await apiClient.post(Config.SUPABASE_URL, {
    action,
    ...data,
  });
  
  if (response.data.error) {
    throw new Error(response.data.error);
  }
  
  return response.data;
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
  options?: { chunkInfo?: string; isCombine?: boolean; includePageRefs?: boolean }
): Promise<string> {
  console.log('Summarizing content of length:', content.length);
  
  // If content fits in one request, send it directly
  if (content.length <= Config.MAX_CONTENT_LENGTH) {
    var response = await callApi('summarize', {
      content: content,
      chunkInfo: options?.chunkInfo,
      isCombine: options?.isCombine,
      includePageRefs: options?.includePageRefs,
    });
    return response.summary || '';
  }
  
  // For large content, summarize in chunks then combine
  console.log('Content too large, chunking...');
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  console.log('Split into', chunks.length, 'chunks');
  
  var chunkSummaries: string[] = [];
  
  for (var i = 0; i < chunks.length; i++) {
    console.log('Processing chunk', i + 1, 'of', chunks.length);
    var chunkResponse = await callApi('summarize', {
      content: chunks[i],
      chunkInfo: 'Part ' + (i + 1) + ' of ' + chunks.length,
      includePageRefs: options?.includePageRefs,
    });
    if (chunkResponse.summary) {
      chunkSummaries.push('## Part ' + (i + 1) + '\n' + chunkResponse.summary);
    }
  }
  
  // If we have multiple chunk summaries, combine them
  if (chunkSummaries.length > 1) {
    console.log('Combining', chunkSummaries.length, 'chunk summaries...');
    var combinedContent = chunkSummaries.join('\n\n---\n\n');
    
    // Final combination pass to create coherent summary
    var combineResponse = await callApi('summarize', {
      content: combinedContent,
      isCombine: true,
      includePageRefs: options?.includePageRefs,
    });
    return combineResponse.summary || combinedContent;
  }
  
  return chunkSummaries[0] || '';
};

// Generate quiz questions - uses full content
export var generateQuiz = async function(content: string, questionCount?: number): Promise<any[]> {
  // For quiz, we want diverse questions from entire document
  // Send all content up to limit, AI will sample appropriately
  var response = await callApi('quiz', {
    content: (content || '').substring(0, Config.MAX_CONTENT_LENGTH),
    questionCount: questionCount || 10,
  });
  return response.questions || [];
};

// Generate study guide - handles large content and image-based documents
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
  
  // Chunk and combine for large documents
  var chunks = splitIntoChunks(content, Config.MAX_CHUNK_SIZE);
  var allGuides: string[] = [];
  
  for (var i = 0; i < chunks.length; i++) {
    var response = await callApi('studyGuide', {
      content: chunks[i],
    });
    if (response.summary || response.studyGuide) {
      allGuides.push(response.summary || JSON.stringify(response.studyGuide));
    }
  }
  
  return { structured: null, text: allGuides.join('\n\n---\n\n') };
};

// Generate video script with slides - covers entire document
export var generateVideoScript = async function(
  pages: { pageNum: number; text: string; imageUrl?: string }[]
): Promise<{
  introduction: string;
  sections: { 
    title: string; 
    narration: string; 
    pageRef: number;
    slideUrl?: string;
    keyPoints: string[];
  }[];
  conclusion: string;
}> {
  // Prepare content with page references
  var content = pages.map(function(p) {
    return '=== PAGE ' + p.pageNum + ' ===\n' + p.text;
  }).join('\n\n');
  
  console.log('Generating video script for', pages.length, 'pages');
  
  var response = await callApi('videoWithSlides', {
    content: (content || '').substring(0, Config.MAX_CONTENT_LENGTH),
    pageCount: pages.length,
    totalPages: pages[pages.length - 1]?.pageNum || pages.length,
  });
  
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
      return {
        ...section,
        slideUrl: matchingPage?.imageUrl,
      };
    });
  }
  
  return script;
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

export default {
  callApi,
  summarize,
  generateQuiz,
  generateStudyGuide,
  generateVideoScript,
  chat,
};
