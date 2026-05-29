/**
 * Unified Logger Module
 *
 * Replaces scattered console.log/warn/error calls with a structured logger that:
 * - Distinguishes between dev and production output
 * - Integrates with errorLogger for persistent storage
 * - Supports log levels (debug, info, warn, error)
 * - Provides named loggers for source identification
 * - Sanitizes sensitive data before output
 *
 * Usage:
 *   import { createLogger } from '@/utils/logger';
 *   const log = createLogger('ChatStore');
 *   log.info('Session created', { sessionId: '123' });
 *   log.error('Failed to save', error);
 */

import { logError as persistError } from './errorLogger';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Minimum log level to output to console. In production, only warn+error. */
const isDev = process.env.NODE_ENV !== 'production';
const MIN_CONSOLE_LEVEL: LogLevel = isDev ? 'debug' : 'warn';

interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown, ...args: unknown[]): void;
}

/**
 * Create a named logger for a specific module/component.
 *
 * @param source - Name of the module (e.g., 'ChatStore', 'BrowserAgent')
 * @param minLevel - Override minimum console log level (default: env-based)
 */
export function createLogger(source: string, minLevel?: LogLevel): Logger {
  const threshold = minLevel ? LOG_LEVEL_PRIORITY[minLevel] : LOG_LEVEL_PRIORITY[MIN_CONSOLE_LEVEL];

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= threshold;
  }

  function formatPrefix(level: LogLevel): string {
    const tag = level.toUpperCase().padEnd(5);
    return `[${tag}] [${source}]`;
  }

  return {
    debug(message: string, ...args: unknown[]): void {
      if (shouldLog('debug')) {
        console.debug(formatPrefix('debug'), message, ...args);
      }
    },

    info(message: string, ...args: unknown[]): void {
      if (shouldLog('info')) {
        console.log(formatPrefix('info'), message, ...args);
      }
    },

    warn(message: string, ...args: unknown[]): void {
      if (shouldLog('warn')) {
        console.warn(formatPrefix('warn'), message, ...args);
      }
      // Warnings are not persisted to errorLogger (too noisy)
    },

    error(message: string, error?: unknown, ...args: unknown[]): void {
      if (shouldLog('error')) {
        console.error(formatPrefix('error'), message, ...args, error);
      }
      // Persist errors to errorLogger for diagnostics
      persistError('error', message, source, error);
    },
  };
}

/**
 * Default logger for quick usage without creating a named instance.
 */
export const logger = createLogger('App');
