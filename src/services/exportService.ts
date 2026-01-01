// Export Service - Export summaries, flashcards, and quiz results
// Supports PDF, sharing, and clipboard

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';

export interface ExportOptions {
  format: 'pdf' | 'text' | 'markdown';
  includeTitle: boolean;
  includeDate: boolean;
  includeWatermark: boolean;
}

const DEFAULT_OPTIONS: ExportOptions = {
  format: 'pdf',
  includeTitle: true,
  includeDate: true,
  includeWatermark: true,
};

class ExportService {
  // Export summary as PDF
  async exportSummaryAsPdf(
    title: string,
    content: string,
    options: Partial<ExportOptions> = {}
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    const html = this.generateSummaryHtml(title, content, opts);
    const { uri } = await Print.printToFileAsync({ html });
    
    // Move to a more accessible location with a proper name
    const fileName = `${this.sanitizeFileName(title)}_summary.pdf`;
    const newUri = `${FileSystem.documentDirectory}${fileName}`;
    
    await FileSystem.moveAsync({
      from: uri,
      to: newUri,
    });

    return newUri;
  }

  // Export flashcards as PDF
  async exportFlashcardsAsPdf(
    deckTitle: string,
    flashcards: Array<{ front: string; back: string; category?: string }>,
    options: Partial<ExportOptions> = {}
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    const html = this.generateFlashcardsHtml(deckTitle, flashcards, opts);
    const { uri } = await Print.printToFileAsync({ html });
    
    const fileName = `${this.sanitizeFileName(deckTitle)}_flashcards.pdf`;
    const newUri = `${FileSystem.documentDirectory}${fileName}`;
    
    await FileSystem.moveAsync({
      from: uri,
      to: newUri,
    });

    return newUri;
  }

  // Export quiz results as PDF
  async exportQuizResultsAsPdf(
    quizTitle: string,
    results: {
      score: number;
      totalQuestions: number;
      questions: Array<{
        question: string;
        userAnswer: string;
        correctAnswer: string;
        isCorrect: boolean;
      }>;
    },
    options: Partial<ExportOptions> = {}
  ): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    const html = this.generateQuizResultsHtml(quizTitle, results, opts);
    const { uri } = await Print.printToFileAsync({ html });
    
    const fileName = `${this.sanitizeFileName(quizTitle)}_quiz_results.pdf`;
    const newUri = `${FileSystem.documentDirectory}${fileName}`;
    
    await FileSystem.moveAsync({
      from: uri,
      to: newUri,
    });

    return newUri;
  }

  // Share content via system share sheet
  async shareContent(
    content: string,
    title?: string
  ): Promise<boolean> {
    try {
      if (await Sharing.isAvailableAsync()) {
        // Create a temporary text file for sharing
        const fileName = `${title || 'mindsparkle_export'}.txt`;
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        
        await FileSystem.writeAsStringAsync(fileUri, content);
        
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/plain',
          dialogTitle: title || 'Share from MindSparkle',
        });
        
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error sharing content:', error);
      return false;
    }
  }

  // Share file via system share sheet
  async shareFile(fileUri: string, title?: string): Promise<boolean> {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          dialogTitle: title || 'Share from MindSparkle',
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error sharing file:', error);
      return false;
    }
  }

  // Copy text to clipboard
  async copyToClipboard(text: string): Promise<boolean> {
    try {
      await Clipboard.setStringAsync(text);
      return true;
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      return false;
    }
  }

  // Generate summary HTML
  private generateSummaryHtml(
    title: string,
    content: string,
    options: ExportOptions
  ): string {
    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Convert markdown to HTML
    const htmlContent = this.markdownToHtml(content);

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 40px;
            line-height: 1.6;
            color: #1F2937;
          }
          .header {
            border-bottom: 2px solid #1E3A8A;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          h1 {
            color: #1E3A8A;
            margin: 0;
            font-size: 24px;
          }
          .date {
            color: #6B7280;
            font-size: 14px;
            margin-top: 8px;
          }
          .content {
            font-size: 14px;
          }
          .content h2 {
            color: #1E3A8A;
            font-size: 18px;
            margin-top: 24px;
          }
          .content h3 {
            color: #374151;
            font-size: 16px;
          }
          .content ul, .content ol {
            padding-left: 24px;
          }
          .content li {
            margin-bottom: 8px;
          }
          .watermark {
            position: fixed;
            bottom: 20px;
            right: 20px;
            color: #D1D5DB;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        ${options.includeTitle ? `
          <div class="header">
            <h1>📚 ${title}</h1>
            ${options.includeDate ? `<div class="date">Generated on ${date}</div>` : ''}
          </div>
        ` : ''}
        <div class="content">
          ${htmlContent}
        </div>
        ${options.includeWatermark ? '<div class="watermark">Created with MindSparkle ✨</div>' : ''}
      </body>
      </html>
    `;
  }

  // Generate flashcards HTML
  private generateFlashcardsHtml(
    title: string,
    flashcards: Array<{ front: string; back: string; category?: string }>,
    options: ExportOptions
  ): string {
    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const cardsHtml = flashcards.map((card, index) => `
      <div class="card">
        <div class="card-number">#${index + 1}</div>
        ${card.category ? `<div class="category">${card.category}</div>` : ''}
        <div class="front">
          <strong>Q:</strong> ${card.front}
        </div>
        <div class="back">
          <strong>A:</strong> ${card.back}
        </div>
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 40px;
            color: #1F2937;
          }
          .header {
            border-bottom: 2px solid #1E3A8A;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          h1 {
            color: #1E3A8A;
            margin: 0;
            font-size: 24px;
          }
          .count {
            color: #6B7280;
            font-size: 14px;
            margin-top: 8px;
          }
          .card {
            border: 1px solid #E5E7EB;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
            page-break-inside: avoid;
          }
          .card-number {
            color: #9CA3AF;
            font-size: 12px;
            margin-bottom: 8px;
          }
          .category {
            display: inline-block;
            background: #EEF2FF;
            color: #4F46E5;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            margin-bottom: 8px;
          }
          .front {
            font-size: 14px;
            margin-bottom: 12px;
            padding-bottom: 12px;
            border-bottom: 1px dashed #E5E7EB;
          }
          .back {
            font-size: 14px;
            color: #374151;
          }
          .watermark {
            position: fixed;
            bottom: 20px;
            right: 20px;
            color: #D1D5DB;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        ${options.includeTitle ? `
          <div class="header">
            <h1>📇 ${title}</h1>
            <div class="count">${flashcards.length} flashcards</div>
            ${options.includeDate ? `<div class="count">Exported on ${date}</div>` : ''}
          </div>
        ` : ''}
        ${cardsHtml}
        ${options.includeWatermark ? '<div class="watermark">Created with MindSparkle ✨</div>' : ''}
      </body>
      </html>
    `;
  }

  // Generate quiz results HTML
  private generateQuizResultsHtml(
    title: string,
    results: {
      score: number;
      totalQuestions: number;
      questions: Array<{
        question: string;
        userAnswer: string;
        correctAnswer: string;
        isCorrect: boolean;
      }>;
    },
    options: ExportOptions
  ): string {
    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const percentage = Math.round((results.score / results.totalQuestions) * 100);

    const questionsHtml = results.questions.map((q, index) => `
      <div class="question ${q.isCorrect ? 'correct' : 'incorrect'}">
        <div class="q-number">Question ${index + 1}</div>
        <div class="q-text">${q.question}</div>
        <div class="answer">
          <span class="label">Your answer:</span> ${q.userAnswer}
          ${q.isCorrect ? '✓' : '✗'}
        </div>
        ${!q.isCorrect ? `
          <div class="correct-answer">
            <span class="label">Correct answer:</span> ${q.correctAnswer}
          </div>
        ` : ''}
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 40px;
            color: #1F2937;
          }
          .header {
            border-bottom: 2px solid #1E3A8A;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          h1 {
            color: #1E3A8A;
            margin: 0;
            font-size: 24px;
          }
          .score-box {
            background: #EEF2FF;
            padding: 20px;
            border-radius: 12px;
            text-align: center;
            margin-bottom: 30px;
          }
          .score {
            font-size: 48px;
            font-weight: bold;
            color: #1E3A8A;
          }
          .score-label {
            color: #6B7280;
            font-size: 14px;
          }
          .question {
            border: 1px solid #E5E7EB;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
            border-left: 4px solid;
          }
          .question.correct {
            border-left-color: #10B981;
            background: #ECFDF5;
          }
          .question.incorrect {
            border-left-color: #EF4444;
            background: #FEF2F2;
          }
          .q-number {
            font-size: 12px;
            color: #6B7280;
            margin-bottom: 8px;
          }
          .q-text {
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 12px;
          }
          .answer {
            font-size: 14px;
          }
          .label {
            color: #6B7280;
          }
          .correct-answer {
            font-size: 14px;
            color: #10B981;
            margin-top: 8px;
          }
          .watermark {
            position: fixed;
            bottom: 20px;
            right: 20px;
            color: #D1D5DB;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📝 Quiz Results: ${title}</h1>
          ${options.includeDate ? `<div style="color: #6B7280; margin-top: 8px;">${date}</div>` : ''}
        </div>
        <div class="score-box">
          <div class="score">${percentage}%</div>
          <div class="score-label">${results.score} of ${results.totalQuestions} correct</div>
        </div>
        ${questionsHtml}
        ${options.includeWatermark ? '<div class="watermark">Created with MindSparkle ✨</div>' : ''}
      </body>
      </html>
    `;
  }

  // Convert markdown to HTML
  private markdownToHtml(markdown: string): string {
    return markdown
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      // Lists
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
      // Newlines
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  // Sanitize filename
  private sanitizeFileName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
  }
}

export const exportService = new ExportService();
export default exportService;
