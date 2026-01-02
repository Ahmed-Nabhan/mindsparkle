/**
 * Smart Document Processor
 * 
 * Features:
 * - Universal document extraction (PDF, PPTX, DOCX, TXT)
 * - Cisco-aware detection and specialized handling
 * - Strict grounding (AI uses ONLY document content)
 * - Fast processing with progress callbacks
 * - Local extraction (no cloud storage)
 */

import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';

// ============================================
// TYPES
// ============================================

export interface DocumentContent {
  type: 'pdf' | 'pptx' | 'docx' | 'txt' | 'unknown';
  isCisco: boolean;
  ciscoTopics: string[];
  totalPages: number;
  pages: PageContent[];
  metadata: DocumentMetadata;
  extractionQuality: 'excellent' | 'good' | 'partial' | 'failed';
}

export interface PageContent {
  pageNum: number;
  title?: string;
  headings: string[];
  paragraphs: string[];
  bulletPoints: string[];
  cliCommands: string[];  // For Cisco docs
  tables: TableData[];
  codeBlocks: string[];
  rawText: string;
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface DocumentMetadata {
  fileName: string;
  fileSize: number;
  extractedAt: Date;
  processingTimeMs: number;
}

// ============================================
// CISCO DETECTION
// ============================================

const CISCO_KEYWORDS = [
  'cisco', 'ios', 'ios-xe', 'nx-os', 'asa', 'firepower',
  'ccna', 'ccnp', 'ccie', 'ccent', 'devnet',
  'catalyst', 'nexus', 'meraki', 'webex', 'umbrella',
  'eigrp', 'ospf', 'bgp', 'hsrp', 'vrrp', 'glbp',
  'vlan', 'stp', 'rstp', 'pvst', 'vpc', 'vxlan',
  'acl', 'nat', 'pat', 'dhcp snooping', 'port-security',
  'router#', 'switch#', 'switch>', 'router>', 
  'configure terminal', 'show running-config', 'show ip route',
  'interface gigabitethernet', 'interface fastethernet',
  'aaa', 'tacacs', 'radius', 'dot1x',
  'ipsec', 'gre', 'dmvpn', 'sd-wan', 'aci',
  'ucs', 'intersight', 'dna center', 'ise',
  'packet tracer', 'netacad', 'networking academy'
];

const CISCO_CLI_PATTERNS = [
  /^[A-Za-z0-9_-]+[#>]\s*.+/gm,           // Router# or Switch>
  /^\s*(config|interface|router|line|vlan)\)?[#>]?\s*.+/gm,
  /^\s*(no\s+)?ip\s+(address|route|nat|access-list)/gm,
  /^\s*(no\s+)?switchport\s+(mode|access|trunk)/gm,
  /^\s*show\s+(ip|running|startup|interface|vlan)/gm,
  /^\s*(enable|disable|configure|exit|end)\s*$/gm,
  /^\s*hostname\s+\S+/gm,
  /^\s*(username|password|secret)\s+/gm,
];

export function detectCiscoContent(text: string): { isCisco: boolean; topics: string[]; confidence: number } {
  const lowerText = text.toLowerCase();
  const foundTopics: string[] = [];
  let score = 0;

  // Check keywords
  for (const keyword of CISCO_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundTopics.push(keyword);
      score += keyword.length > 4 ? 2 : 1; // Longer keywords = more specific
    }
  }

  // Check CLI patterns
  let cliMatches = 0;
  for (const pattern of CISCO_CLI_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      cliMatches += matches.length;
    }
  }
  if (cliMatches > 0) {
    score += Math.min(cliMatches * 3, 30); // Cap CLI score
    foundTopics.push('CLI Commands');
  }

  // Calculate confidence
  const confidence = Math.min(score / 50, 1); // Normalize to 0-1

  return {
    isCisco: confidence > 0.3 || foundTopics.length >= 3,
    topics: [...new Set(foundTopics)].slice(0, 10),
    confidence
  };
}

// ============================================
// TEXT EXTRACTION - PDF
// ============================================

export async function extractPdfText(
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<PageContent[]> {
  const startTime = Date.now();
  if (onProgress) onProgress(5, 'Reading PDF file...');

  try {
    // Read file as binary
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      throw new Error('File not found');
    }

    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (onProgress) onProgress(15, 'Parsing PDF structure...');

    // Convert base64 to binary string for parsing
    const binaryString = atob(base64);
    
    // Extract text using multiple methods
    const pages: PageContent[] = [];
    
    // Method 1: Extract text streams from PDF
    const textContent = extractTextFromPdfBinary(binaryString, onProgress);
    
    if (onProgress) onProgress(60, 'Processing extracted text...');

    // Parse into structured pages
    const rawPages = splitIntoPages(textContent);
    
    for (let i = 0; i < rawPages.length; i++) {
      const rawText = rawPages[i];
      pages.push(parsePageContent(rawText, i + 1));
      
      if (onProgress && i % 5 === 0) {
        onProgress(60 + (i / rawPages.length) * 30, `Processing page ${i + 1}/${rawPages.length}...`);
      }
    }

    if (onProgress) onProgress(95, 'Finalizing extraction...');

    console.log(`[SmartProcessor] PDF extraction completed in ${Date.now() - startTime}ms, ${pages.length} pages`);
    return pages;

  } catch (error: any) {
    console.error('[SmartProcessor] PDF extraction failed:', error);
    throw error;
  }
}

function extractTextFromPdfBinary(binary: string, onProgress?: (p: number, m: string) => void): string {
  const allTexts: string[] = [];
  
  // Find all text streams in PDF
  // Method 1: BT...ET blocks (text objects)
  const btEtPattern = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  while ((match = btEtPattern.exec(binary)) !== null) {
    const textBlock = match[1];
    // Extract text from Tj, TJ, ' operators
    const tjPattern = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjPattern.exec(textBlock)) !== null) {
      allTexts.push(decodeEscapedText(tjMatch[1]));
    }
    
    // TJ array format
    const tjArrayPattern = /\[((?:[^\[\]]|\[[^\]]*\])*)\]\s*TJ/g;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayPattern.exec(textBlock)) !== null) {
      const arrContent = tjArrMatch[1];
      const strPattern = /\(((?:[^()\\]|\\.)*)\)/g;
      let strMatch;
      while ((strMatch = strPattern.exec(arrContent)) !== null) {
        allTexts.push(decodeEscapedText(strMatch[1]));
      }
    }
  }

  // Method 2: Stream objects
  const streamPattern = /stream\s*([\s\S]*?)\s*endstream/g;
  while ((match = streamPattern.exec(binary)) !== null) {
    const streamContent = match[1];
    // Try to extract readable text
    const readable = streamContent.replace(/[^\x20-\x7E\n\r\t]/g, ' ');
    const words = readable.match(/[A-Za-z]{3,}/g);
    if (words && words.length > 5) {
      allTexts.push(readable);
    }
  }

  // Clean and join
  let fullText = allTexts.join(' ');
  
  // Clean up common PDF artifacts
  fullText = fullText
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E\n\r\t\u00A0-\u00FF\u0100-\u017F\u0600-\u06FF]/g, '')
    .trim();

  return fullText;
}

function decodeEscapedText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function splitIntoPages(text: string): string[] {
  // Try to split by page markers or estimate based on content
  const pageMarkers = text.split(/(?:page\s*\d+|\f|={5,}|-{5,})/gi);
  
  if (pageMarkers.length > 1) {
    return pageMarkers.filter(p => p.trim().length > 50);
  }
  
  // Estimate pages based on character count (~3000 chars per page)
  const pages: string[] = [];
  const charsPerPage = 3000;
  
  for (let i = 0; i < text.length; i += charsPerPage) {
    let endPos = Math.min(i + charsPerPage, text.length);
    
    // Try to break at paragraph
    const breakPos = text.lastIndexOf('\n\n', endPos);
    if (breakPos > i + charsPerPage / 2) {
      endPos = breakPos;
    }
    
    pages.push(text.slice(i, endPos).trim());
  }
  
  return pages.filter(p => p.length > 50);
}

// ============================================
// TEXT EXTRACTION - PPTX
// ============================================

export async function extractPptxText(
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<PageContent[]> {
  const startTime = Date.now();
  if (onProgress) onProgress(5, 'Reading PPTX file...');

  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (onProgress) onProgress(15, 'Unzipping PPTX...');

    // PPTX is a ZIP file
    const zip = new JSZip();
    await zip.loadAsync(base64, { base64: true });

    if (onProgress) onProgress(30, 'Extracting slides...');

    const pages: PageContent[] = [];
    const slideFiles: string[] = [];

    // Find all slide XML files
    zip.forEach((relativePath: string, _file: JSZip.JSZipObject) => {
      if (relativePath.match(/ppt\/slides\/slide\d+\.xml$/)) {
        slideFiles.push(relativePath);
      }
    });

    // Sort by slide number
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });

    // Extract text from each slide
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideXml = await zip.file(slideFile)?.async('string');
      
      if (slideXml) {
        const pageContent = parseSlideXml(slideXml, i + 1);
        pages.push(pageContent);
      }

      if (onProgress && i % 10 === 0) {
        onProgress(30 + (i / slideFiles.length) * 60, `Processing slide ${i + 1}/${slideFiles.length}...`);
      }
    }

    if (onProgress) onProgress(95, 'Finalizing extraction...');

    console.log(`[SmartProcessor] PPTX extraction completed in ${Date.now() - startTime}ms, ${pages.length} slides`);
    return pages;

  } catch (error: any) {
    console.error('[SmartProcessor] PPTX extraction failed:', error);
    throw error;
  }
}

function parseSlideXml(xml: string, slideNum: number): PageContent {
  const page: PageContent = {
    pageNum: slideNum,
    headings: [],
    paragraphs: [],
    bulletPoints: [],
    cliCommands: [],
    tables: [],
    codeBlocks: [],
    rawText: ''
  };

  // Extract all text content from XML
  // PowerPoint uses <a:t> tags for text
  const textPattern = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  const allTexts: string[] = [];
  let match;

  while ((match = textPattern.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) {
      allTexts.push(decodeXmlEntities(text));
    }
  }

  // Also check for <p:txBody> content
  const txBodyPattern = /<p:txBody>([\s\S]*?)<\/p:txBody>/g;
  while ((match = txBodyPattern.exec(xml)) !== null) {
    const bodyContent = match[1];
    const innerTexts = bodyContent.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
    if (innerTexts) {
      for (const t of innerTexts) {
        const textMatch = t.match(/<a:t[^>]*>([^<]*)<\/a:t>/);
        if (textMatch && textMatch[1].trim()) {
          // Already captured above
        }
      }
    }
  }

  // First text is usually the title
  if (allTexts.length > 0) {
    page.title = allTexts[0];
    page.headings.push(allTexts[0]);
  }

  // Rest are bullet points or paragraphs
  for (let i = 1; i < allTexts.length; i++) {
    const text = allTexts[i];
    
    // Check if it looks like a CLI command
    if (isCLICommand(text)) {
      page.cliCommands.push(text);
    } else if (text.length < 100) {
      page.bulletPoints.push(text);
    } else {
      page.paragraphs.push(text);
    }
  }

  page.rawText = allTexts.join('\n');
  return page;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)));
}

// ============================================
// TEXT EXTRACTION - DOCX
// ============================================

export async function extractDocxText(
  fileUri: string,
  onProgress?: (progress: number, message: string) => void
): Promise<PageContent[]> {
  const startTime = Date.now();
  if (onProgress) onProgress(5, 'Reading DOCX file...');

  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (onProgress) onProgress(15, 'Unzipping DOCX...');

    const zip = new JSZip();
    await zip.loadAsync(base64, { base64: true });

    if (onProgress) onProgress(30, 'Extracting document content...');

    // Main document content is in word/document.xml
    const documentXml = await zip.file('word/document.xml')?.async('string');
    
    if (!documentXml) {
      throw new Error('Invalid DOCX: document.xml not found');
    }

    if (onProgress) onProgress(50, 'Parsing document...');

    const pages = parseDocxXml(documentXml);

    if (onProgress) onProgress(95, 'Finalizing extraction...');

    console.log(`[SmartProcessor] DOCX extraction completed in ${Date.now() - startTime}ms`);
    return pages;

  } catch (error: any) {
    console.error('[SmartProcessor] DOCX extraction failed:', error);
    throw error;
  }
}

function parseDocxXml(xml: string): PageContent[] {
  const pages: PageContent[] = [];
  let currentPage: PageContent = createEmptyPage(1);

  // Extract paragraphs
  const paragraphPattern = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
  let match;
  let charCount = 0;
  const charsPerPage = 3000;

  while ((match = paragraphPattern.exec(xml)) !== null) {
    const paraContent = match[1];
    
    // Extract text from paragraph
    const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    const texts: string[] = [];
    let textMatch;
    
    while ((textMatch = textPattern.exec(paraContent)) !== null) {
      texts.push(textMatch[1]);
    }
    
    const paragraphText = texts.join('').trim();
    if (!paragraphText) continue;

    // Check for heading style
    const isHeading = paraContent.includes('w:pStyle') && 
                      (paraContent.includes('Heading') || paraContent.includes('Title'));

    if (isHeading) {
      currentPage.headings.push(paragraphText);
    } else if (isCLICommand(paragraphText)) {
      currentPage.cliCommands.push(paragraphText);
    } else if (paragraphText.length < 150 && paragraphText.match(/^[\•\-\*\d\.]/)) {
      currentPage.bulletPoints.push(paragraphText);
    } else {
      currentPage.paragraphs.push(paragraphText);
    }

    currentPage.rawText += paragraphText + '\n';
    charCount += paragraphText.length;

    // Start new page if needed
    if (charCount > charsPerPage) {
      pages.push(currentPage);
      currentPage = createEmptyPage(pages.length + 1);
      charCount = 0;
    }
  }

  // Don't forget the last page
  if (currentPage.rawText.trim()) {
    pages.push(currentPage);
  }

  return pages.length > 0 ? pages : [createEmptyPage(1)];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function createEmptyPage(pageNum: number): PageContent {
  return {
    pageNum,
    headings: [],
    paragraphs: [],
    bulletPoints: [],
    cliCommands: [],
    tables: [],
    codeBlocks: [],
    rawText: ''
  };
}

function parsePageContent(rawText: string, pageNum: number): PageContent {
  const page = createEmptyPage(pageNum);
  page.rawText = rawText;

  const lines = rawText.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect headings (ALL CAPS or ends with :)
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 100) {
      page.headings.push(trimmed);
    }
    // Detect CLI commands
    else if (isCLICommand(trimmed)) {
      page.cliCommands.push(trimmed);
    }
    // Detect bullet points
    else if (trimmed.match(/^[\•\-\*\◦\▪\►]\s/) || trimmed.match(/^\d+[\.\)]\s/)) {
      page.bulletPoints.push(trimmed.replace(/^[\•\-\*\◦\▪\►\d\.\)]+\s*/, ''));
    }
    // Detect code blocks
    else if (trimmed.match(/^[A-Z][a-z]+\([^)]*\)/) || trimmed.includes('{}') || trimmed.includes('();')) {
      page.codeBlocks.push(trimmed);
    }
    // Regular paragraph
    else if (trimmed.length > 20) {
      page.paragraphs.push(trimmed);
    }
  }

  return page;
}

function isCLICommand(text: string): boolean {
  const cliIndicators = [
    /^[A-Za-z0-9_-]+[#>]\s/,           // Router# or Switch>
    /^(config|interface|router|line|vlan)/i,
    /^(no\s+)?ip\s+(address|route|nat)/i,
    /^(no\s+)?switchport/i,
    /^show\s+(ip|running|startup)/i,
    /^(enable|disable|configure|exit|end)$/i,
    /^hostname\s+/i,
  ];

  return cliIndicators.some(pattern => pattern.test(text.trim()));
}

// ============================================
// MAIN PROCESSOR
// ============================================

export async function processDocument(
  fileUri: string,
  fileName: string,
  mimeType: string,
  onProgress?: (progress: number, message: string) => void
): Promise<DocumentContent> {
  const startTime = Date.now();
  
  // Determine document type
  let type: DocumentContent['type'] = 'unknown';
  if (mimeType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
    type = 'pdf';
  } else if (mimeType.includes('presentation') || fileName.toLowerCase().endsWith('.pptx')) {
    type = 'pptx';
  } else if (mimeType.includes('document') || fileName.toLowerCase().endsWith('.docx')) {
    type = 'docx';
  } else if (mimeType.includes('text') || fileName.toLowerCase().endsWith('.txt')) {
    type = 'txt';
  }

  if (onProgress) onProgress(0, `Processing ${type.toUpperCase()} document...`);

  // Extract text based on type
  let pages: PageContent[] = [];
  
  try {
    switch (type) {
      case 'pdf':
        pages = await extractPdfText(fileUri, onProgress);
        break;
      case 'pptx':
        pages = await extractPptxText(fileUri, onProgress);
        break;
      case 'docx':
        pages = await extractDocxText(fileUri, onProgress);
        break;
      case 'txt':
        const content = await FileSystem.readAsStringAsync(fileUri);
        pages = [parsePageContent(content, 1)];
        break;
      default:
        throw new Error(`Unsupported document type: ${mimeType}`);
    }
  } catch (error: any) {
    console.error('[SmartProcessor] Extraction failed:', error);
    pages = [createEmptyPage(1)];
  }

  // Combine all text for Cisco detection
  const allText = pages.map(p => p.rawText).join('\n');
  const ciscoDetection = detectCiscoContent(allText);

  // Calculate extraction quality
  let quality: DocumentContent['extractionQuality'] = 'failed';
  const totalChars = allText.length;
  const totalHeadings = pages.reduce((sum, p) => sum + p.headings.length, 0);
  const totalBullets = pages.reduce((sum, p) => sum + p.bulletPoints.length, 0);
  
  if (totalChars > 5000 && (totalHeadings > 5 || totalBullets > 10)) {
    quality = 'excellent';
  } else if (totalChars > 2000) {
    quality = 'good';
  } else if (totalChars > 500) {
    quality = 'partial';
  }

  const result: DocumentContent = {
    type,
    isCisco: ciscoDetection.isCisco,
    ciscoTopics: ciscoDetection.topics,
    totalPages: pages.length,
    pages,
    metadata: {
      fileName,
      fileSize: 0, // Will be set by caller
      extractedAt: new Date(),
      processingTimeMs: Date.now() - startTime
    },
    extractionQuality: quality
  };

  if (onProgress) onProgress(100, 'Extraction complete!');

  console.log(`[SmartProcessor] Document processed: ${type}, ${pages.length} pages, Cisco: ${ciscoDetection.isCisco}, Quality: ${quality}`);
  
  return result;
}

// ============================================
// AI PROMPT BUILDERS
// ============================================

export function buildCiscoPrompt(content: DocumentContent): string {
  return `You are analyzing a Cisco networking document. Follow these STRICT rules:

1. ONLY use information from the document provided
2. DO NOT add external knowledge or commands not in the document
3. If information is missing, say "Not specified in the document"
4. Preserve ALL CLI commands exactly as written
5. Maintain technical accuracy

Document Type: ${content.type.toUpperCase()}
Cisco Topics Detected: ${content.ciscoTopics.join(', ')}
Total Pages: ${content.totalPages}

DOCUMENT CONTENT:
${formatPagesForAI(content.pages)}

TASK: Create a comprehensive study summary that:
- Lists all CLI commands with explanations
- Summarizes key concepts
- Identifies important configurations
- Notes any security considerations
- Highlights exam-relevant topics

Remember: Only cite what's in the document. No external knowledge.`;
}

export function buildGeneralPrompt(content: DocumentContent): string {
  return `Analyze this ${content.type.toUpperCase()} document and create a comprehensive summary.

Document Info:
- Type: ${content.type}
- Pages: ${content.totalPages}
- Quality: ${content.extractionQuality}

DOCUMENT CONTENT:
${formatPagesForAI(content.pages)}

TASK: Create a smart study summary that includes:
1. Executive Overview (2-3 sentences)
2. Key Topics and Concepts
3. Important Details by Section
4. Key Takeaways
5. Study Questions

Make it engaging and easy to study from.`;
}

function formatPagesForAI(pages: PageContent[]): string {
  return pages.map(page => {
    let text = `\n=== PAGE ${page.pageNum} ===\n`;
    
    if (page.title) {
      text += `TITLE: ${page.title}\n`;
    }
    
    if (page.headings.length > 0) {
      text += `HEADINGS:\n${page.headings.map(h => `  - ${h}`).join('\n')}\n`;
    }
    
    if (page.cliCommands.length > 0) {
      text += `CLI COMMANDS:\n${page.cliCommands.map(c => `  > ${c}`).join('\n')}\n`;
    }
    
    if (page.bulletPoints.length > 0) {
      text += `KEY POINTS:\n${page.bulletPoints.map(b => `  • ${b}`).join('\n')}\n`;
    }
    
    if (page.paragraphs.length > 0) {
      text += `CONTENT:\n${page.paragraphs.join('\n')}\n`;
    }
    
    return text;
  }).join('\n');
}

export default {
  processDocument,
  detectCiscoContent,
  extractPdfText,
  extractPptxText,
  extractDocxText,
  buildCiscoPrompt,
  buildGeneralPrompt,
};
