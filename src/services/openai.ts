import axios from 'axios';
import { OPENAI_API_PROXY_URL } from '@env';

/**
 * Generate summary for document content
 */
export const generateSummary = async (content: string): Promise<string> => {
  try {
    const response = await axios.post(
      OPENAI_API_PROXY_URL || 'https://your-edge-function.supabase.co/openai-proxy',
      {
        action: 'summarize',
        content,
      }
    );
    
    return response.data.summary;
  } catch (error) {
    console.error('Error generating summary:', error);
    throw new Error('Failed to generate summary');
  }
};

/**
 * Generate quiz questions from document content
 */
export const generateQuiz = async (content: string, questionCount: number = 5) => {
  try {
    const response = await axios.post(
      OPENAI_API_PROXY_URL || 'https://your-edge-function.supabase.co/openai-proxy',
      {
        action: 'quiz',
        content,
        questionCount,
      }
    );
    
    return response.data.questions;
  } catch (error) {
    console.error('Error generating quiz:', error);
    throw new Error('Failed to generate quiz');
  }
};

/**
 * Generate study guide from document content
 */
export const generateStudyGuide = async (content: string) => {
  try {
    const response = await axios.post(
      OPENAI_API_PROXY_URL || 'https://your-edge-function.supabase.co/openai-proxy',
      {
        action: 'study',
        content,
      }
    );
    
    return response.data.studyGuide;
  } catch (error) {
    console.error('Error generating study guide:', error);
    throw new Error('Failed to generate study guide');
  }
};

/**
 * Generate video script from document content
 */
export const generateVideoScript = async (content: string) => {
  try {
    const response = await axios.post(
      OPENAI_API_PROXY_URL || 'https://your-edge-function.supabase.co/openai-proxy',
      {
        action: 'video',
        content,
      }
    );
    
    return response.data.videoScript;
  } catch (error) {
    console.error('Error generating video script:', error);
    throw new Error('Failed to generate video script');
  }
};
