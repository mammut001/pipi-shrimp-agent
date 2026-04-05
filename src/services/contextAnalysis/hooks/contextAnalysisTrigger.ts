/**
 * Context Analysis - Trigger
 *
 * Call triggerContextAnalysis() after runChatTurn() completes.
 * It runs the engine and, if needed, kicks off the appropriate compact layer.
 */

import type { Message } from '../../../types/chat';
import type { CompressionStrategy } from '../types';
import { analyzeContext } from '../engine';
import { useContextAnalysisStore } from './store';

/**
 * Trigger context analysis for a completed chat turn.
 *
 * @param sessionId  The active session ID.
 * @param messages   All messages in the session.
 * @returns          The resolved CompressionStrategy, or null if skipped.
 */
export async function triggerContextAnalysis(
  sessionId: string,
  messages: Message[],
): Promise<CompressionStrategy | null> {
  const store = useContextAnalysisStore.getState();

  // Prevent re-entrant analysis
  if (store.isAnalyzing) return null;

  store.setAnalyzing(true);

  try {
    const strategy = await analyzeContext({
      messages,
      currentSessionId: sessionId,
      config: store.config,
    });

    store.setLastStrategy(strategy);

    if (strategy.should_compact) {
      await notifyCompressionSystem(strategy, sessionId, messages);
    }

    return strategy;
  } catch (e) {
    console.warn('[ContextAnalysis] Analysis failed:', e);
    return null;
  } finally {
    store.setAnalyzing(false);
  }
}

/**
 * Dispatch to the appropriate compact layer based on strategy.
 */
async function notifyCompressionSystem(
  strategy: CompressionStrategy,
  sessionId: string,
  _messages: Message[],
): Promise<void> {
  switch (strategy.compact_type) {
    case 'micro': {
      const { runMicrocompactCheck } = await import('../../compact/microCompact');
      await runMicrocompactCheck(sessionId);
      break;
    }
    case 'session': {
      const { trySessionMemoryCompact } = await import('../../compact/sessionMemoryCompact');
      // We don't hold the messages here to avoid duplication; the chatStore
      // re-reads from its state when it needs them.
      // Pass empty array as a no-op guard — the function will fetch messages
      // from Rust via the sessionId.
      await trySessionMemoryCompact(sessionId, _messages);
      break;
    }
    case 'legacy': {
      const { triggerLegacyCompact } = await import('../../compact/compact');
      await triggerLegacyCompact(sessionId, _messages);
      break;
    }
    default:
      break;
  }
}
