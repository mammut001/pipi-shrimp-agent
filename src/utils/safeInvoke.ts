/**
 * safeInvoke - Safe wrapper for Tauri `invoke` calls
 *
 * Wraps `invoke` from `@tauri-apps/api/core` with:
 * - Error classification (network, timeout, permission, unknown)
 * - Configurable timeout
 * - Optional retry with backoff
 * - Silent mode (suppresses console.error)
 * - Automatic logging to errorLogger
 */

import { invoke } from '@tauri-apps/api/core';
import { logError } from './errorLogger';
import { extractErrorDetails } from './errorFormat';

/** Error classification for Tauri invoke failures */
export type InvokeErrorKind = 'network' | 'timeout' | 'permission' | 'validation' | 'unknown';

export interface SafeInvokeOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Number of retries on transient failures (default: 0) */
  retries?: number;
  /** Delay between retries in ms, doubles each retry (default: 1000) */
  retryDelayMs?: number;
  /** If true, suppresses console.error (default: false) */
  silent?: boolean;
  /** Source label for error logging (default: command name) */
  source?: string;
  /** If true, errors are not logged to errorLogger */
  skipLogging?: boolean;
}

export interface InvokeError extends Error {
  kind: InvokeErrorKind;
  command: string;
  originalError: unknown;
}

/**
 * Classify an error from a Tauri invoke call.
 */
function classifyError(error: unknown): InvokeErrorKind {
  const msg = extractErrorDetails(error).message;
  const lower = msg.toLowerCase();

  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) return 'network';
  if (lower.includes('permission') || lower.includes('denied') || lower.includes('forbidden')) return 'permission';
  if (lower.includes('invalid') || lower.includes('validation') || lower.includes('required')) return 'validation';
  return 'unknown';
}

/**
 * Wrap an error into an InvokeError with classification.
 */
function wrapError(command: string, original: unknown): InvokeError {
  const details = extractErrorDetails(original);
  const msg = details.message;
  const err = new Error(msg) as InvokeError;
  err.name = 'InvokeError';
  err.kind = classifyError(original);
  err.command = command;
  err.originalError = original;
  if (original instanceof Error && original.stack) {
    err.stack = original.stack;
  }
  return err;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invoke a Tauri command safely with timeout, retry, and error logging.
 *
 * @example
 * ```ts
 * const session = await safeInvoke<Session>('db_save_session', { session });
 * ```
 */
export async function safeInvoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
  options: SafeInvokeOptions = {},
): Promise<T> {
  const {
    timeoutMs = 30_000,
    retries = 0,
    retryDelayMs = 1000,
    silent = false,
    source = command,
    skipLogging = false,
  } = options;

  let lastError: InvokeError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Race the invoke against a timeout
      const result = await Promise.race([
        invoke<T>(command, args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`invoke '${command}' timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return result;
    } catch (rawError) {
      lastError = wrapError(command, rawError);

      if (!silent) {
        console.error(`[safeInvoke] ${command} failed (attempt ${attempt + 1}/${retries + 1}):`, rawError);
      }

      // Log to errorLogger (unless skipLogging)
      if (!skipLogging) {
        logError('error', lastError.message, source, lastError);
      }

      // Don't retry on validation or permission errors
      if (lastError.kind === 'validation' || lastError.kind === 'permission') {
        throw lastError;
      }

      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
      }
    }
  }

  // All retries exhausted
  throw lastError!;
}

/**
 * Invoke a Tauri command silently, returning null on failure instead of throwing.
 * Useful for non-critical calls where failure is acceptable.
 *
 * @example
 * ```ts
 * const result = await safeInvokeOrNull<string>('get_cached_value', { key });
 * if (result !== null) { ... }
 * ```
 */
export async function safeInvokeOrNull<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
  options: Omit<SafeInvokeOptions, 'silent'> = {},
): Promise<T | null> {
  try {
    return await safeInvoke<T>(command, args, { ...options, silent: true });
  } catch {
    return null;
  }
}
