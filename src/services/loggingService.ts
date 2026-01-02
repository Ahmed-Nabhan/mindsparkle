/**
 * Logging Service - Production Ready
 * 
 * Centralized logging for all MindSparkle operations.
 * Logs are written to console (dev) and audit_logs table (production).
 * 
 * @module services/loggingService
 */

import { supabase } from './supabase';

// ============================================
// TYPES
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  action: string;
  entity?: {
    type: 'document' | 'user' | 'auth' | 'ai' | 'system';
    id?: string;
  };
  details?: Record<string, any>;
  userId?: string;
  timestamp?: Date;
  duration?: number;
}

interface AuditLogEntry {
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, any>;
}

// ============================================
// CONFIGURATION
// ============================================

const config = {
  // Only persist important logs
  persistLevels: ['warn', 'error'] as LogLevel[],
  // Actions that should always be persisted
  persistActions: [
    'upload',
    'delete',
    'login',
    'logout',
    'ai_request',
    'extraction',
  ],
  // Enable console logs in development
  consoleEnabled: __DEV__,
  // Enable audit log persistence
  auditEnabled: true,
};

// ============================================
// LOG BUFFER (for batching)
// ============================================

const logBuffer: AuditLogEntry[] = [];
let flushTimeout: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL = 5000; // 5 seconds
const MAX_BUFFER_SIZE = 10;

/**
 * Flush log buffer to database
 */
async function flushLogs() {
  if (logBuffer.length === 0) return;
  
  const logsToFlush = [...logBuffer];
  logBuffer.length = 0;
  
  try {
    await supabase.from('audit_logs').insert(logsToFlush);
  } catch (error) {
    // Silently fail - don't block app operations
    console.error('[LoggingService] Failed to flush logs:', error);
  }
}

/**
 * Schedule log flush
 */
function scheduleFlush() {
  if (flushTimeout) return;
  
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flushLogs();
  }, FLUSH_INTERVAL);
}

// ============================================
// LOGGING FUNCTIONS
// ============================================

/**
 * Main log function
 */
export function log(entry: LogEntry) {
  const timestamp = entry.timestamp || new Date();
  const prefix = `[${entry.entity?.type || 'app'}] [${entry.level.toUpperCase()}]`;
  
  // Console log (development)
  if (config.consoleEnabled) {
    const message = `${prefix} ${entry.action}`;
    
    switch (entry.level) {
      case 'error':
        console.error(message, entry.details);
        break;
      case 'warn':
        console.warn(message, entry.details);
        break;
      case 'debug':
        console.debug(message, entry.details);
        break;
      default:
        console.log(message, entry.details);
    }
  }
  
  // Check if should persist
  const shouldPersist = 
    config.auditEnabled && (
      config.persistLevels.includes(entry.level) ||
      config.persistActions.some(a => entry.action.includes(a))
    );
  
  if (shouldPersist) {
    const auditEntry: AuditLogEntry = {
      user_id: entry.userId || null,
      action: entry.action,
      entity_type: entry.entity?.type || 'system',
      entity_id: entry.entity?.id || null,
      details: {
        ...entry.details,
        level: entry.level,
        duration: entry.duration,
      },
    };
    
    logBuffer.push(auditEntry);
    
    // Flush immediately for errors
    if (entry.level === 'error' || logBuffer.length >= MAX_BUFFER_SIZE) {
      flushLogs();
    } else {
      scheduleFlush();
    }
  }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

export function logDebug(action: string, details?: Record<string, any>) {
  log({ level: 'debug', action, details });
}

export function logInfo(action: string, details?: Record<string, any>) {
  log({ level: 'info', action, details });
}

export function logWarn(action: string, details?: Record<string, any>) {
  log({ level: 'warn', action, details });
}

export function logError(action: string, error: any, details?: Record<string, any>) {
  log({
    level: 'error',
    action,
    details: {
      ...details,
      error: error?.message || String(error),
      stack: __DEV__ ? error?.stack : undefined,
    },
  });
}

// ============================================
// DOCUMENT LOGGING
// ============================================

export function logDocumentAction(
  action: string,
  documentId: string,
  userId?: string,
  details?: Record<string, any>
) {
  log({
    level: 'info',
    action: `document_${action}`,
    entity: { type: 'document', id: documentId },
    userId,
    details,
  });
}

export function logDocumentError(
  action: string,
  documentId: string,
  error: any,
  userId?: string
) {
  log({
    level: 'error',
    action: `document_${action}_failed`,
    entity: { type: 'document', id: documentId },
    userId,
    details: {
      error: error?.message || String(error),
    },
  });
}

// ============================================
// AI LOGGING
// ============================================

export function logAIRequest(
  mode: string,
  documentId: string,
  userId?: string,
  details?: Record<string, any>
) {
  log({
    level: 'info',
    action: `ai_request_${mode}`,
    entity: { type: 'ai', id: documentId },
    userId,
    details,
  });
}

export function logAIResponse(
  mode: string,
  documentId: string,
  duration: number,
  tokensUsed?: number,
  userId?: string
) {
  log({
    level: 'info',
    action: `ai_response_${mode}`,
    entity: { type: 'ai', id: documentId },
    userId,
    duration,
    details: { tokensUsed },
  });
}

export function logAIError(
  mode: string,
  documentId: string,
  error: any,
  userId?: string
) {
  log({
    level: 'error',
    action: `ai_error_${mode}`,
    entity: { type: 'ai', id: documentId },
    userId,
    details: {
      error: error?.message || String(error),
    },
  });
}

// ============================================
// AUTH LOGGING
// ============================================

export function logAuthEvent(
  action: 'login' | 'logout' | 'signup' | 'password_reset',
  userId?: string,
  details?: Record<string, any>
) {
  log({
    level: 'info',
    action: `auth_${action}`,
    entity: { type: 'auth', id: userId },
    userId,
    details,
  });
}

// ============================================
// PERFORMANCE LOGGING
// ============================================

export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

export function logPerformance(
  action: string,
  duration: number,
  details?: Record<string, any>
) {
  log({
    level: 'debug',
    action: `perf_${action}`,
    entity: { type: 'system' },
    duration,
    details,
  });
}

// ============================================
// EXPORTS
// ============================================

export default {
  log,
  logDebug,
  logInfo,
  logWarn,
  logError,
  logDocumentAction,
  logDocumentError,
  logAIRequest,
  logAIResponse,
  logAIError,
  logAuthEvent,
  logPerformance,
  startTimer,
};
