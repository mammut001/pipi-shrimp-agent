/**
 * Auto Memory Extraction — Main Implementation
 *
 * Automatically extracts long-term memories from conversations after
 * each turn that produces a final assistant response (no pending tool calls).
 *
 * Architecture:
 *   - Singleton state via module-level variables (closure-like pattern)
 *   - Fire-and-forget: does not block the main conversation loop
 *   - Throttle: skips extraction if fewer than TURNS_BETWEEN_EXTRACTIONS turns elapsed
 *   - Mutex: only one extraction runs at a time; excess calls are queued (max 1)
 *
 * Based on Claude Code's src/services/extractMemories/extractMemories.ts
 */

import { invoke } from '@tauri-apps/api/core';
import { getMemoryDir, ensureMemoryDirs, isAutoMemoryEnabled } from './memoryPaths';
import { addMemoryIndexEntry } from './memoryIndex';
import { scanMemoryFiles, formatMemoryManifest } from './memoryScan';
import { buildExtractAutoOnlyPrompt, EXTRACTION_SYSTEM_PROMPT } from './extractionPrompts';
import {
  type ExtractedMemory,
  type ExtractionAgentResult,
  buildMemoryFrontmatter,
  buildMemoryFilename,
} from './memoryTypes';
import {
  isAutoExtractionEnabled,
  MIN_NEW_MESSAGES_TO_EXTRACT,
  TURNS_BETWEEN_EXTRACTIONS,
} from './memoryConfig';
import { useSettingsStore } from '@/store';

// ============================================================================
// Module-level singleton state
// ============================================================================

/** Index of last message that was processed by extraction */
let lastProcessedMessageIndex: number = -1;

/** Whether an extraction is currently running */
let extractionInProgress = false;

/** Pending context stashed while extraction was in progress */
let pendingContext: ExtractionContext | undefined;

/** Turns elapsed since the last successful extraction */
let turnsSinceLastExtraction = 0;

// ============================================================================
// Context type
// ============================================================================

export interface ExtractionContext {
  /** All messages in the current session */
  messages: Array<{ role: string; content: string }>;
  /** Optional project root for calculating memory dir */
  projectRoot?: string;
  /**
   * Callback invoked after memories are saved so the main conversation
   * can display a notification.
   */
  onMemorySaved?: (paths: string[]) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function countNewMessages(messages: Array<{ role: string; content: string }>): number {
  const startIdx = lastProcessedMessageIndex + 1;
  return messages
    .slice(startIdx)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .length;
}

function buildConversationText(
  messages: Array<{ role: string; content: string }>,
  maxMessages: number,
): string {
  const startIdx = Math.max(0, lastProcessedMessageIndex + 1);
  const slice = messages
    .slice(startIdx)
    .filter(m => m.role === 'user' || m.role === 'assistant');

  return slice
    .slice(-maxMessages)
    .map(m => `${m.role.toUpperCase()}: ${(m.content ?? '').slice(0, 2000)}`)
    .join('\n\n');
}

// ============================================================================
// Core extraction logic
// ============================================================================

async function runExtraction(ctx: ExtractionContext, isTrailingRun = false): Promise<void> {
  const { messages, projectRoot, onMemorySaved } = ctx;

  // --- Throttle check ---
  if (!isTrailingRun) {
    turnsSinceLastExtraction++;
    if (turnsSinceLastExtraction < TURNS_BETWEEN_EXTRACTIONS) {
      return;
    }
  }
  turnsSinceLastExtraction = 0;

  // --- Message count gate ---
  const newCount = countNewMessages(messages);
  if (newCount < MIN_NEW_MESSAGES_TO_EXTRACT) {
    lastProcessedMessageIndex = messages.length - 1;
    return;
  }

  extractionInProgress = true;

  try {
    const memoryDir = await getMemoryDir(projectRoot);
    await ensureMemoryDirs(memoryDir);

    // Scan existing memories so the LLM can avoid duplicates
    const existingFiles = await scanMemoryFiles(memoryDir);
    const manifest = formatMemoryManifest(existingFiles);

    // Build the extraction prompt
    const conversationText = buildConversationText(messages, 40);
    if (!conversationText.trim()) return;

    const userPrompt =
      buildExtractAutoOnlyPrompt(newCount, manifest, memoryDir) +
      '\n\n---\n\n## Conversation to analyse\n\n' +
      conversationText;

    // Call the LLM (standalone, non-streaming request)
    const apiConfig = useSettingsStore.getState().getActiveConfig();
    if (!apiConfig?.apiKey) return;

    const response = await invoke<{ content: string }>('send_claude_sdk_chat_streaming', {
      messages: [{ role: 'user', content: userPrompt }],
      apiKey: apiConfig.apiKey,
      model: apiConfig.model,
      baseUrl: apiConfig.baseUrl || '',
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      noTools: true,
      browserConnected: false,
      sessionId: `memory-extraction-${Date.now()}`,
      apiFormat: apiConfig.apiFormat,
    });

    // Parse JSON result
    let raw = response.content ?? '';
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1];

    let result: ExtractionAgentResult;
    try {
      result = JSON.parse(raw);
    } catch {
      return;
    }

    const memories: ExtractedMemory[] = result.memories ?? [];
    if (memories.length === 0) return;

    const savedPaths: string[] = [];

    for (const mem of memories) {
      if (!mem.title || !mem.content || !mem.type) continue;

      const filename = buildMemoryFilename(mem.type, mem.title);
      const filePath = `${memoryDir}/${filename}`;
      const fileContent = `${buildMemoryFrontmatter(mem.type, mem.title)}${mem.content}\n`;

      try {
        await invoke('write_file', { path: filePath, content: fileContent });
        savedPaths.push(filePath);
      } catch (e) {
        console.error('[AutoMemory] Failed to write memory file:', filePath, e);
        continue;
      }

      try {
        await addMemoryIndexEntry(memoryDir, filename, mem.summary ?? mem.title);
      } catch (e) {
        console.error('[AutoMemory] Failed to update memory index:', e);
      }
    }

    // Advance cursor
    lastProcessedMessageIndex = messages.length - 1;

    if (savedPaths.length > 0) {
      onMemorySaved?.(savedPaths);
      console.info(`[AutoMemory] Saved ${savedPaths.length} memories:`, savedPaths);
    }
  } catch (e) {
    console.error('[AutoMemory] Extraction failed:', e);
  } finally {
    extractionInProgress = false;

    // If a context was queued while we ran, execute it as a trailing run
    if (pendingContext) {
      const pc = pendingContext;
      pendingContext = undefined;
      await runExtraction(pc, true);
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Trigger memory extraction after a turn completes.
 *
 * Fire-and-forget — returns immediately; extraction runs in the background.
 * Call this on every `turn_complete` event from QueryEngine.
 */
export function triggerMemoryExtraction(ctx: ExtractionContext): void {
  if (!isAutoExtractionEnabled() || !isAutoMemoryEnabled()) return;

  if (extractionInProgress) {
    pendingContext = ctx;
    return;
  }

  runExtraction(ctx).catch(e => {
    console.error('[AutoMemory] Background extraction error:', e);
  });
}

/**
 * Wait for any in-progress or pending extraction to finish.
 * Use before closing a session to avoid losing pending memories.
 */
export async function drainMemoryExtraction(timeoutMs = 10_000): Promise<void> {
  if (!extractionInProgress && !pendingContext) return;

  const deadline = Date.now() + timeoutMs;
  while ((extractionInProgress || pendingContext) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
  }
}

/**
 * Reset all extraction state (call when switching sessions).
 */
export function resetExtractionState(): void {
  lastProcessedMessageIndex = -1;
  extractionInProgress = false;
  pendingContext = undefined;
  turnsSinceLastExtraction = 0;
}

