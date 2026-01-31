export type LogMeta = Record<string, unknown>;

/**
 * Stateless logging helper.
 * - Never logs request/response bodies.
 * - Never logs user content.
 * - Only metadata (route, timings, status, etc).
 */
export function logInfo(message: string, meta?: LogMeta) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", message, ...(meta ? { meta } : {}) }));
}

export function logWarn(message: string, meta?: LogMeta) {
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ level: "warn", message, ...(meta ? { meta } : {}) }));
}

export function logError(message: string, meta?: LogMeta) {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: "error", message, ...(meta ? { meta } : {}) }));
}
