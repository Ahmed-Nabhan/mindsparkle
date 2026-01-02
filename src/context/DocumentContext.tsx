/**
 * Document Context for MindSparkle
 * 
 * Provides global state management for:
 * - Current document being viewed/processed
 * - Extracted document content (text, images, tables, equations)
 * - Teacher/learning settings (voice, speed, language)
 * - Processing state (loading, messages)
 * - AI Processing status (real-time updates from documentIntelligenceService)
 * - Sync status (real-time updates from cloudSyncService)
 * - Network connectivity state
 * - Real-time Supabase subscriptions for instant UI updates
 * 
 * ARCHITECTURE:
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │                    DocumentContext Flow                                  │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │                                                                           │
 * │  ┌─────────────────┐     ┌──────────────────────────────────────────┐    │
 * │  │ DocumentContext │<────│ Supabase Realtime (PostgreSQL Changes)   │    │
 * │  │                 │     │  - documents table: INSERT/UPDATE/DELETE │    │
 * │  │                 │     │  - document_analysis: processing status  │    │
 * │  │                 │     │  - ai_summaries: generated content       │    │
 * │  │                 │     └──────────────────────────────────────────┘    │
 * │  │                 │     ┌──────────────────────────────────────────┐    │
 * │  │                 │<────│ cloudSyncService (sync updates)          │    │
 * │  │                 │     └──────────────────────────────────────────┘    │
 * │  │                 │     ┌──────────────────────────────────────────┐    │
 * │  │                 │<────│ documentIntelligenceService (AI)         │    │
 * │  │                 │     │  - Processing status events              │    │
 * │  │                 │     │  - Vendor detection results              │    │
 * │  │                 │     │  - Generated summaries/quizzes           │    │
 * │  └────────┬────────┘     └──────────────────────────────────────────┘    │
 * │           │                                                               │
 * │           │ Provider                                                      │
 * │           ▼                                                               │
 * │  ┌───────────────────────────────────────────────────────────────────┐   │
 * │  │                     UI Components                                  │   │
 * │  │  ┌─────────┐  ┌────────────┐  ┌─────────┐  ┌─────────────────┐    │   │
 * │  │  │HomeScreen│  │UploadScreen│  │QuizScreen│  │DocumentActions │    │   │
 * │  │  └─────────┘  └────────────┘  └─────────┘  └─────────────────┘    │   │
 * │  └───────────────────────────────────────────────────────────────────┘   │
 * └──────────────────────────────────────────────────────────────────────────┘
 * 
 * REAL-TIME SUBSCRIPTIONS:
 * - documents: Instant updates when documents are added, modified, or deleted
 * - document_analysis: Real-time AI processing status updates
 * - ai_summaries: Instant notification when new summaries are generated
 * 
 * AI PROCESSING STATUS:
 * - Shows progress bar during document analysis
 * - Displays current processing mode (summary, quiz, etc.)
 * - Shows multi-pass progress for complex content
 * - Displays vendor detection results (Cisco, AWS, etc.)
 * 
 * SYNC STATUS DISPLAY:
 * - Shows sync indicator in navigation/header
 * - Displays pending changes count
 * - Shows last sync time
 * - Displays conflicts requiring attention
 * - Network status indicator (online/offline)
 * 
 * @module context/DocumentContext
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { Document } from '../types/document';
import { 
  cloudSyncService, 
  onSyncStatusChange, 
  SyncStatus,
  SyncConflict 
} from '../services/cloudSyncService';
import {
  onProcessingStatusChange,
  processDocumentFull,
  getStoredAnalysis,
  getAllStoredSummaries,
  getStoredKnowledgeGraph,
  ProcessingStatus,
  StoredDocumentAnalysis,
  StoredAISummary,
  StoredKnowledgeGraph,
} from '../services/documentIntelligenceService';
import { supabase } from '../services/supabase';
import * as Network from 'expo-network';
import type { EventSubscription } from 'expo-modules-core';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Image content extracted from document
 */
interface ImageContent {
  url: string;
  caption: string;
  pageNumber: number;
}

/**
 * Table content extracted from document
 */
interface TableContent {
  headers: string[];
  rows: string[][];
  caption: string;
  pageNumber: number;
}

/**
 * Structured content extracted from document
 * Includes text, images, tables, equations, logos, diagrams
 */
interface ExtractedContent {
  text: string;
  images: ImageContent[];
  tables: TableContent[];
  equations: string[];
  logos: ImageContent[];
  diagrams: ImageContent[];
}

/**
 * Teacher/learning settings for audio and presentation
 */
interface TeacherSettings {
  gender: 'male' | 'female';
  voiceSpeed: number;
  language: string;
}

/**
 * Default teacher settings
 */
const DEFAULT_TEACHER_SETTINGS: TeacherSettings = {
  gender: 'male',
  voiceSpeed: 1,
  language: 'en-US',
};

/**
 * Default sync status
 */
const DEFAULT_SYNC_STATUS: SyncStatus = {
  lastSyncTime: null,
  isSyncing: false,
  isOnline: true,
  pendingChanges: 0,
  syncError: null,
  syncProgress: 0,
  currentOperation: null,
  conflicts: [],
};

/**
 * Default AI processing status
 */
const DEFAULT_AI_PROCESSING_STATUS: ProcessingStatus = {
  status: 'idle',
  progress: 0,
  message: '',
};

/**
 * Context value interface
 * Defines all state and methods available via useDocumentContext hook
 */
interface DocumentContextType {
  // Document state
  currentDocument: Document | null;
  extractedContent: ExtractedContent | null;
  teacherSettings: TeacherSettings;
  
  // Processing state
  isProcessing: boolean;
  processingMessage: string;
  
  // AI Processing state (from documentIntelligenceService)
  aiProcessingStatus: ProcessingStatus;
  documentAnalysis: StoredDocumentAnalysis | null;
  documentSummaries: StoredAISummary[];
  documentKnowledgeGraph: StoredKnowledgeGraph | null;
  
  // Sync state (from cloudSyncService)
  syncStatus: SyncStatus;
  isOnline: boolean;
  
  // Real-time subscription state
  isRealtimeConnected: boolean;
  
  // Document methods
  setCurrentDocument: (doc: Document | null) => void;
  setExtractedContent: (content: ExtractedContent | null) => void;
  setTeacherSettings: (settings: TeacherSettings) => void;
  setIsProcessing: (loading: boolean) => void;
  setProcessingMessage: (msg: string) => void;
  clearDocument: () => void;
  
  // AI Processing methods
  processDocument: (
    documentId: string,
    content: string,
    userId: string,
    modes?: ('summary' | 'study' | 'quiz' | 'flashcards' | 'labs' | 'interview' | 'video')[],
    language?: 'en' | 'ar'
  ) => Promise<boolean>;
  loadStoredAIData: (documentId: string) => Promise<void>;
  
  // Real-time subscription methods
  subscribeToDocument: (documentId: string) => void;
  unsubscribeFromDocument: () => void;
  
  // Sync methods
  triggerSync: () => Promise<boolean>;
  resolveConflict: (conflict: SyncConflict, resolution: 'local' | 'cloud') => Promise<void>;
  clearSyncQueue: () => Promise<void>;
}

// ============================================
// CONTEXT CREATION
// ============================================

/**
 * Document Context
 * Default value is undefined - we check for this in the hook
 */
const DocumentContext = createContext<DocumentContextType | undefined>(undefined);

// ============================================
// PROVIDER COMPONENT
// ============================================

/**
 * DocumentProvider - Wraps app with document context
 * 
 * Features:
 * - Manages current document state
 * - Subscribes to sync status updates from cloudSyncService
 * - Monitors network connectivity via NetInfo
 * - Provides sync control methods to UI
 * 
 * @param children - Child components to wrap
 * 
 * @example
 * <DocumentProvider>
 *   <App />
 * </DocumentProvider>
 */
export function DocumentProvider({ children }: { children: ReactNode }) {
  // ========================================
  // STATE
  // ========================================
  
  // Document state
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [extractedContent, setExtractedContent] = useState<ExtractedContent | null>(null);
  const [teacherSettings, setTeacherSettings] = useState<TeacherSettings>(DEFAULT_TEACHER_SETTINGS);
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  
  // AI Processing state - mirrors documentIntelligenceService status
  const [aiProcessingStatus, setAiProcessingStatus] = useState<ProcessingStatus>(DEFAULT_AI_PROCESSING_STATUS);
  const [documentAnalysis, setDocumentAnalysis] = useState<StoredDocumentAnalysis | null>(null);
  const [documentSummaries, setDocumentSummaries] = useState<StoredAISummary[]>([]);
  const [documentKnowledgeGraph, setDocumentKnowledgeGraph] = useState<StoredKnowledgeGraph | null>(null);
  
  // Sync state - mirrors cloudSyncService status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(DEFAULT_SYNC_STATUS);
  const [isOnline, setIsOnline] = useState(true);
  
  // Real-time subscription state
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [subscribedDocumentId, setSubscribedDocumentId] = useState<string | null>(null);
  
  // Refs for cleanup
  const syncUnsubscribeRef = useRef<(() => void) | null>(null);
  const aiProcessingUnsubscribeRef = useRef<(() => void) | null>(null);
  const netInfoUnsubscribeRef = useRef<EventSubscription | null>(null);
  
  // Supabase Realtime channel refs - stored for cleanup on unmount
  const documentsChannelRef = useRef<RealtimeChannel | null>(null);
  const documentSpecificChannelRef = useRef<RealtimeChannel | null>(null);

  // ========================================
  // SYNC STATUS SUBSCRIPTION
  // ========================================
  
  /**
   * Subscribe to sync status changes from cloudSyncService
   * Updates local state whenever sync status changes
   * This allows UI components to react to sync events in real-time
   */
  useEffect(() => {
    console.log('[DocumentContext] Setting up sync status subscription');
    
    // Subscribe to sync status updates from cloudSyncService
    syncUnsubscribeRef.current = onSyncStatusChange((status: SyncStatus) => {
      console.log('[DocumentContext] Sync status update:', {
        isSyncing: status.isSyncing,
        pendingChanges: status.pendingChanges,
        progress: status.syncProgress,
        isOnline: status.isOnline,
        operation: status.currentOperation,
      });
      setSyncStatus(status);
      setIsOnline(status.isOnline);
    });

    // Get initial sync status from service
    const initialStatus = cloudSyncService.getStatus();
    setSyncStatus(initialStatus);
    setIsOnline(initialStatus.isOnline);
    
    // Cleanup on unmount
    return () => {
      if (syncUnsubscribeRef.current) {
        console.log('[DocumentContext] Cleaning up sync status subscription');
        syncUnsubscribeRef.current();
      }
    };
  }, []);

  // ========================================
  // AI PROCESSING STATUS SUBSCRIPTION
  // ========================================

  /**
   * Subscribe to AI processing status changes from documentIntelligenceService
   * Updates local state whenever AI processing status changes
   * This allows UI to show real-time progress of document analysis
   * 
   * STATUS FLOW:
   * idle → analyzing → processing → validating → storing → complete
   *                                                   └─→ error
   */
  useEffect(() => {
    console.log('[DocumentContext] Setting up AI processing status subscription');
    
    // Subscribe to AI processing status updates
    aiProcessingUnsubscribeRef.current = onProcessingStatusChange((status: ProcessingStatus) => {
      console.log('[DocumentContext] AI Processing status update:', {
        status: status.status,
        progress: status.progress,
        message: status.message,
        currentMode: status.currentMode,
        currentPass: status.currentPass,
      });
      
      // Update local state
      setAiProcessingStatus(status);
      
      // Update general processing flag for UI indicators
      const isActive = ['analyzing', 'processing', 'validating', 'storing'].includes(status.status);
      setIsProcessing(isActive);
      setProcessingMessage(status.message);
    });

    // Cleanup on unmount
    return () => {
      if (aiProcessingUnsubscribeRef.current) {
        console.log('[DocumentContext] Cleaning up AI processing subscription');
        aiProcessingUnsubscribeRef.current();
      }
    };
  }, []);

  // ========================================
  // NETWORK MONITORING
  // ========================================
  
  /**
   * Monitor network connectivity
   * Provides backup to cloudSyncService's internal monitoring
   * Ensures UI always has accurate online/offline state
   */
  useEffect(() => {
    console.log('[DocumentContext] Setting up network monitoring');
    
    netInfoUnsubscribeRef.current = Network.addNetworkStateListener((state: Network.NetworkState) => {
      const nowOnline = state.isConnected ?? false;
      setIsOnline(nowOnline);
      console.log(`[DocumentContext] Network state: ${nowOnline ? 'ONLINE' : 'OFFLINE'}`);
    });

    // Check initial network state
    Network.getNetworkStateAsync().then((state) => {
      setIsOnline(state.isConnected ?? false);
    });

    // Cleanup on unmount
    return () => {
      if (netInfoUnsubscribeRef.current) {
        console.log('[DocumentContext] Cleaning up network monitoring');
        netInfoUnsubscribeRef.current.remove();
      }
    };
  }, []);

  // ========================================
  // SUPABASE REALTIME SUBSCRIPTIONS
  // ========================================

  /**
   * Subscribe to Supabase Realtime for documents table changes
   * This provides instant UI updates when:
   * - New documents are uploaded
   * - Document metadata is updated (title, summary)
   * - Documents are deleted
   * 
   * REALTIME ARCHITECTURE:
   * ┌─────────────────────────────────────────────────────────────┐
   * │                  Supabase Realtime Flow                     │
   * ├─────────────────────────────────────────────────────────────┤
   * │                                                              │
   * │  ┌──────────────┐     ┌───────────────────────────────────┐ │
   * │  │ PostgreSQL   │────>│ Realtime Server (WebSocket)       │ │
   * │  │  - documents │     │  - Broadcasts INSERT/UPDATE/DELETE│ │
   * │  │  - analysis  │     └───────────────┬───────────────────┘ │
   * │  │  - summaries │                     │                     │
   * │  └──────────────┘                     ▼                     │
   * │                          ┌───────────────────────────────┐  │
   * │                          │ DocumentContext               │  │
   * │                          │  - Updates currentDocument    │  │
   * │                          │  - Updates documentAnalysis   │  │
   * │                          │  - Updates documentSummaries  │  │
   * │                          └───────────────────────────────┘  │
   * └─────────────────────────────────────────────────────────────┘
   * 
   * IMPORTANT: Cleanup on unmount to prevent memory leaks
   */
  useEffect(() => {
    console.log('[DocumentContext] Setting up Supabase Realtime subscriptions');

    // Create channel for global documents changes
    // This channel listens to all document changes for the current user
    documentsChannelRef.current = supabase
      .channel('documents-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'documents',
        },
        (payload: RealtimePostgresChangesPayload<{ [key: string]: any }>) => {
          console.log('[DocumentContext] Realtime documents change:', payload.eventType);
          
          // Handle different event types
          switch (payload.eventType) {
            case 'INSERT':
              // New document added - could trigger refresh of document list
              console.log('[DocumentContext] New document inserted:', payload.new?.id);
              break;
              
            case 'UPDATE':
              // Document updated - check if it's the current document
              const updatedDoc = payload.new;
              if (currentDocument && updatedDoc?.id === currentDocument.id) {
                console.log('[DocumentContext] Current document updated, refreshing...');
                // Update current document with new data
                setCurrentDocument(prev => prev ? {
                  ...prev,
                  title: updatedDoc.title || prev.title,
                  summary: updatedDoc.summary || prev.summary,
                  content: updatedDoc.content || prev.content,
                  updatedAt: updatedDoc.updated_at ? new Date(updatedDoc.updated_at) : prev.updatedAt,
                } : null);
              }
              break;
              
            case 'DELETE':
              // Document deleted - clear if it's the current document
              const deletedId = payload.old?.id;
              if (currentDocument && deletedId === currentDocument.id) {
                console.log('[DocumentContext] Current document deleted, clearing...');
                clearDocument();
              }
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log('[DocumentContext] Documents channel status:', status);
        setIsRealtimeConnected(status === 'SUBSCRIBED');
      });

    // Cleanup function - CRITICAL for preventing memory leaks
    return () => {
      console.log('[DocumentContext] Cleaning up Realtime subscriptions');
      if (documentsChannelRef.current) {
        supabase.removeChannel(documentsChannelRef.current);
        documentsChannelRef.current = null;
      }
      setIsRealtimeConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDocument?.id]);

  /**
   * Subscribe to specific document changes (analysis and summaries)
   * Called when viewing a specific document to get real-time updates
   * on AI processing status and generated content
   * 
   * @param documentId - The document ID to subscribe to
   */
  const subscribeToDocument = useCallback((documentId: string) => {
    console.log('[DocumentContext] Subscribing to document:', documentId);
    
    // Unsubscribe from previous document if any
    if (documentSpecificChannelRef.current) {
      supabase.removeChannel(documentSpecificChannelRef.current);
    }

    setSubscribedDocumentId(documentId);

    // Create channel for document-specific changes
    // Listens to document_analysis and ai_summaries for this document
    documentSpecificChannelRef.current = supabase
      .channel(`document-${documentId}`)
      // Listen to document_analysis changes (AI processing status)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'document_analysis',
          filter: `document_id=eq.${documentId}`,
        },
        async (payload: RealtimePostgresChangesPayload<{ [key: string]: any }>) => {
          console.log('[DocumentContext] Analysis update:', payload.eventType);
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const analysis = payload.new;
            // Update document analysis state with new data
            setDocumentAnalysis({
              id: analysis.id,
              documentId: analysis.document_id,
              vendorId: analysis.vendor_id,
              vendorName: analysis.vendor_name,
              vendorConfidence: analysis.vendor_confidence,
              certificationDetected: analysis.certification_detected,
              complexity: analysis.complexity,
              hasCliCommands: analysis.has_cli_commands,
              hasConfigBlocks: analysis.has_config_blocks,
              contentLength: analysis.content_length,
              aiModel: analysis.ai_model,
              tokensUsed: analysis.tokens_used,
              suggestedModes: analysis.suggested_modes || [],
              processingStatus: analysis.processing_status,
              processingProgress: analysis.processing_progress,
              processedAt: analysis.processed_at ? new Date(analysis.processed_at) : null,
            });

            // Update processing message if still processing
            if (analysis.processing_status === 'processing') {
              setProcessingMessage(analysis.processing_message || 'Processing...');
              setIsProcessing(true);
            } else if (analysis.processing_status === 'complete') {
              setProcessingMessage('Processing complete!');
              setIsProcessing(false);
            }
          }
        }
      )
      // Listen to ai_summaries changes (generated content)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_summaries',
          filter: `document_id=eq.${documentId}`,
        },
        async (payload: RealtimePostgresChangesPayload<{ [key: string]: any }>) => {
          console.log('[DocumentContext] Summary update:', payload.eventType);
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const summary = payload.new;
            // Add or update summary in state
            setDocumentSummaries(prev => {
              const existing = prev.findIndex(
                s => s.summaryType === summary.summary_type && s.language === summary.language
              );
              
              const newSummary: StoredAISummary = {
                id: summary.id,
                documentId: summary.document_id,
                summaryType: summary.summary_type,
                language: summary.language,
                content: summary.content,
                validationPassed: summary.validation_passed,
                validationScore: summary.validation_score,
                correctionsMAde: summary.corrections_made,
                aiModel: summary.ai_model,
                tokensUsed: summary.tokens_used,
                processingTimeMs: summary.processing_time_ms,
                passesCompleted: summary.passes_completed,
              };
              
              if (existing >= 0) {
                // Update existing summary
                const updated = [...prev];
                updated[existing] = newSummary;
                return updated;
              } else {
                // Add new summary
                return [...prev, newSummary];
              }
            });
          }
        }
      )
      // Listen to knowledge_graphs changes
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'knowledge_graphs',
          filter: `document_id=eq.${documentId}`,
        },
        async (payload: RealtimePostgresChangesPayload<{ [key: string]: any }>) => {
          console.log('[DocumentContext] Knowledge graph update:', payload.eventType);
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const graph = payload.new;
            setDocumentKnowledgeGraph({
              id: graph.id,
              documentId: graph.document_id,
              nodes: graph.nodes || [],
              edges: graph.edges || [],
              rootNodes: graph.root_nodes || [],
              nodeCount: graph.node_count,
              edgeCount: graph.edge_count,
              maxDepth: graph.max_depth,
              learningPaths: graph.learning_paths || [],
              conceptClusters: graph.concept_clusters || [],
            });
          }
        }
      )
      .subscribe((status) => {
        console.log(`[DocumentContext] Document ${documentId} channel status:`, status);
      });
  }, []);

  /**
   * Unsubscribe from document-specific changes
   * Called when navigating away from a document
   * CRITICAL: Prevents memory leaks by cleaning up channel
   */
  const unsubscribeFromDocument = useCallback(() => {
    console.log('[DocumentContext] Unsubscribing from document');
    
    if (documentSpecificChannelRef.current) {
      supabase.removeChannel(documentSpecificChannelRef.current);
      documentSpecificChannelRef.current = null;
    }
    setSubscribedDocumentId(null);
  }, []);

  // ========================================
  // DOCUMENT METHODS
  // ========================================

  /**
   * Clear current document and related state
   * Called when user navigates away from document
   * Also unsubscribes from document-specific realtime updates
   */
  const clearDocument = useCallback(() => {
    // Unsubscribe from document-specific realtime channel
    if (documentSpecificChannelRef.current) {
      supabase.removeChannel(documentSpecificChannelRef.current);
      documentSpecificChannelRef.current = null;
    }
    setSubscribedDocumentId(null);
    
    // Clear all document state
    setCurrentDocument(null);
    setExtractedContent(null);
    setProcessingMessage('');
    // Also clear AI processing data
    setDocumentAnalysis(null);
    setDocumentSummaries([]);
    setDocumentKnowledgeGraph(null);
    setAiProcessingStatus(DEFAULT_AI_PROCESSING_STATUS);
  }, []);

  // ========================================
  // AI PROCESSING METHODS
  // ========================================

  /**
   * Process document through full AI pipeline
   * Triggers vendor detection, multi-pass processing, and storage
   * 
   * @param documentId - Supabase document UUID
   * @param content - Document text content
   * @param userId - User's ID for storage
   * @param modes - Processing modes (default: summary, quiz, flashcards)
   * @param language - Output language (en/ar)
   * @returns Success status
   * 
   * PROCESSING FLOW:
   * 1. Calls processDocumentFull from documentIntelligenceService
   * 2. Service broadcasts status updates via onProcessingStatusChange
   * 3. This context receives updates and updates local state
   * 4. UI components react to state changes
   * 5. On completion, stores results and updates document summaries
   */
  const processDocument = useCallback(async (
    documentId: string,
    content: string,
    userId: string,
    modes: ('summary' | 'study' | 'quiz' | 'flashcards' | 'labs' | 'interview' | 'video')[] = ['summary', 'quiz', 'flashcards'],
    language: 'en' | 'ar' = 'en'
  ): Promise<boolean> => {
    console.log('[DocumentContext] Starting document processing:', documentId);
    
    try {
      // Call the full processing pipeline
      const result = await processDocumentFull(
        documentId,
        content,
        userId,
        modes,
        language,
        // Progress callback for custom handling (optional)
        (status) => {
          // Status updates come through the subscription
          // This callback can be used for additional custom logic
          console.log('[DocumentContext] Progress callback:', status.progress);
        }
      );

      if (result.success) {
        // Update local state with stored results
        if (result.analysis) {
          setDocumentAnalysis(result.analysis);
        }
        if (result.summaries && result.summaries.length > 0) {
          setDocumentSummaries(result.summaries);
        }
        if (result.knowledgeGraph) {
          setDocumentKnowledgeGraph(result.knowledgeGraph);
        }

        console.log('[DocumentContext] Processing complete, data stored');
        return true;
      } else {
        console.error('[DocumentContext] Processing failed:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[DocumentContext] Processing error:', error);
      return false;
    }
  }, []);

  /**
   * Load stored AI data for a document
   * Called when viewing a previously processed document
   * 
   * @param documentId - Supabase document UUID
   */
  const loadStoredAIData = useCallback(async (documentId: string): Promise<void> => {
    console.log('[DocumentContext] Loading stored AI data for:', documentId);
    
    try {
      // Load all AI data in parallel
      const [analysis, summaries, graph] = await Promise.all([
        getStoredAnalysis(documentId),
        getAllStoredSummaries(documentId),
        getStoredKnowledgeGraph(documentId),
      ]);

      if (analysis) {
        setDocumentAnalysis(analysis);
        console.log('[DocumentContext] Loaded analysis:', analysis.vendorName);
      }

      if (summaries && summaries.length > 0) {
        setDocumentSummaries(summaries);
        console.log('[DocumentContext] Loaded summaries:', summaries.length);
      }

      if (graph) {
        setDocumentKnowledgeGraph(graph);
        console.log('[DocumentContext] Loaded knowledge graph:', graph.nodeCount, 'nodes');
      }
    } catch (error) {
      console.error('[DocumentContext] Failed to load AI data:', error);
    }
  }, []);

  // ========================================
  // SYNC METHODS
  // ========================================

  /**
   * Trigger manual sync
   * Called from settings screen or pull-to-refresh
   * 
   * @returns Success status
   */
  const triggerSync = useCallback(async (): Promise<boolean> => {
    console.log('[DocumentContext] Manual sync triggered');
    
    if (!isOnline) {
      console.log('[DocumentContext] Cannot sync - offline');
      return false;
    }

    try {
      const success = await cloudSyncService.manualSync();
      return success;
    } catch (error) {
      console.error('[DocumentContext] Manual sync failed:', error);
      return false;
    }
  }, [isOnline]);

  /**
   * Resolve a sync conflict
   * Called from conflict resolution UI
   * 
   * @param conflict - The conflict to resolve
   * @param resolution - How to resolve ('local' keeps local, 'cloud' keeps cloud)
   */
  const handleResolveConflict = useCallback(async (
    conflict: SyncConflict,
    resolution: 'local' | 'cloud'
  ): Promise<void> => {
    console.log('[DocumentContext] Resolving conflict:', conflict.id, 'with:', resolution);
    await cloudSyncService.resolveConflict(conflict, resolution);
  }, []);

  /**
   * Clear the pending sync queue
   * Called when user wants to discard pending changes
   */
  const handleClearSyncQueue = useCallback(async (): Promise<void> => {
    console.log('[DocumentContext] Clearing sync queue');
    await cloudSyncService.clearSyncQueue();
  }, []);

  // ========================================
  // CONTEXT VALUE
  // ========================================

  const value: DocumentContextType = {
    // Document state
    currentDocument,
    extractedContent,
    teacherSettings,
    
    // Processing state
    isProcessing,
    processingMessage,
    
    // AI Processing state
    aiProcessingStatus,
    documentAnalysis,
    documentSummaries,
    documentKnowledgeGraph,
    
    // Sync state
    syncStatus,
    isOnline,
    
    // Real-time subscription state
    isRealtimeConnected,
    
    // Document methods
    setCurrentDocument,
    setExtractedContent,
    setTeacherSettings,
    setIsProcessing,
    setProcessingMessage,
    clearDocument,
    
    // AI Processing methods
    processDocument,
    loadStoredAIData,
    
    // Real-time subscription methods
    subscribeToDocument,
    unsubscribeFromDocument,
    
    // Sync methods
    triggerSync,
    resolveConflict: handleResolveConflict,
    clearSyncQueue: handleClearSyncQueue,
  };

  return (
    <DocumentContext.Provider value={value}>
      {children}
    </DocumentContext.Provider>
  );
}

// ============================================
// HOOK EXPORT
// ============================================

/**
 * useDocumentContext - Hook to access document context
 * 
 * @returns Document context value
 * @throws Error if used outside DocumentProvider
 * 
 * @example
 * const {
 *   currentDocument,
 *   aiProcessingStatus,
 *   documentAnalysis,
 *   documentSummaries,
 *   syncStatus,
 *   isOnline,
 *   processDocument,
 *   triggerSync
 * } = useDocumentContext();
 * 
 * // Start AI processing after upload
 * const handleUpload = async (doc: Document, content: string, userId: string) => {
 *   await processDocument(doc.id, content, userId, ['summary', 'quiz']);
 * };
 * 
 * // Show AI processing progress
 * if (aiProcessingStatus.status !== 'idle') {
 *   return (
 *     <ProcessingOverlay
 *       progress={aiProcessingStatus.progress}
 *       message={aiProcessingStatus.message}
 *       currentMode={aiProcessingStatus.currentMode}
 *     />
 *   );
 * }
 * 
 * // Display vendor detection
 * {documentAnalysis?.vendorDetected && (
 *   <VendorBadge vendor={documentAnalysis.vendorName} />
 * )}
 * 
 * // Access generated summaries
 * const summary = documentSummaries.find(s => s.summaryType === 'summary');
 * const quiz = documentSummaries.find(s => s.summaryType === 'quiz');
 * 
 * // Check sync status in UI
 * if (syncStatus.isSyncing) {
 *   return <SyncingIndicator progress={syncStatus.syncProgress} />;
 * }
 * 
 * // Show pending changes badge
 * {syncStatus.pendingChanges > 0 && (
 *   <Badge count={syncStatus.pendingChanges} />
 * )}
 * 
 * // Offline indicator
 * {!isOnline && <OfflineBanner />}
 * 
 * // Display conflicts needing attention
 * {syncStatus.conflicts.length > 0 && (
 *   <ConflictAlert 
 *     conflicts={syncStatus.conflicts}
 *     onResolve={resolveConflict}
 *   />
 * )}
 */
export function useDocumentContext(): DocumentContextType {
  const context = useContext(DocumentContext);
  
  if (context === undefined) {
    throw new Error('useDocumentContext must be used within a DocumentProvider');
  }
  
  return context;
}

// Legacy alias for backward compatibility
export const useDocument = useDocumentContext;

export default DocumentContext;
