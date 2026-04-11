/**
 * Memory Hooks
 *
 * Integrates auto-extraction with the QueryEngine turn lifecycle.
 *
 * Usage in Chat.tsx / wherever QueryEngine is consumed:
 *
 *   import { createMemoryHook } from '@/services/memory/memoryHooks';
 *
 *   const memoryHook = createMemoryHook({ projectRoot: workDir });
 *
 *   for await (const event of runChatTurn(...)) {
 *     if (event.type === 'turn_complete') {
 *       memoryHook.onTurnComplete(allMessages);
 *     }
 *   }
 */

import { triggerMemoryExtraction, type ExtractionContext } from './autoExtraction';

export interface MemoryHookOptions {
  /** Current project / workspace root directory */
  projectRoot?: string;
  /**
   * Called after memories are saved.
   * Use this to show a notification in the UI.
   */
  onMemorySaved?: (paths: string[]) => void;
}

export interface MemoryHook {
  /**
   * Call this whenever QueryEngine emits a `turn_complete` event.
   * Internally fire-and-forget; will not throw.
   */
  onTurnComplete(messages: Array<{ role: string; content: string }>): void;
}

/**
 * Create a memory hook bound to a specific session/project.
 * Create a new instance per chat session.
 */
export function createMemoryHook(options: MemoryHookOptions = {}): MemoryHook {
  return {
    onTurnComplete(messages) {
      const ctx: ExtractionContext = {
        messages,
        projectRoot: options.projectRoot,
        onMemorySaved: options.onMemorySaved,
      };
      triggerMemoryExtraction(ctx);
    },
  };
}
