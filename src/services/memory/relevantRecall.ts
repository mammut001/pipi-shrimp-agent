/**
 * Relevant Memory Recall
 *
 * Selects the most relevant memory files for the current query.
 * Uses a lightweight LLM to choose at most MAX_RELEVANT_MEMORIES files.
 *
 * Based on Claude Code's src/memdir/findRelevantMemories.ts
 */

import { scanTopicMemories, TopicMemory } from './topicMemory';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/store';

const MAX_RELEVANT_MEMORIES = 5;

/**
 * Find relevant memory files based on current conversation context.
 *
 * Algorithm:
 * 1. Scan available memory files (headers only)
 * 2. Filter out already surfaced files
 * 3. If few enough, return all
 * 4. Otherwise, use lightweight LLM to select relevant ones
 * 5. Return at most MAX_RELEVANT_MEMORIES files
 */
export async function findRelevantMemories(
  topicDir: string,
  currentQuery: string,
  alreadySurfaced: Set<string> = new Set(),
  recentTools: string[] = [],
): Promise<TopicMemory[]> {
  // 1. Scan available memories
  const allMemories = await scanTopicMemories(topicDir);
  if (allMemories.length === 0) return [];

  // 2. Filter out already surfaced memories
  const candidates = allMemories.filter(m => !alreadySurfaced.has(m.filename));
  if (candidates.length === 0) return [];

  // 3. If few enough, return all
  if (candidates.length <= MAX_RELEVANT_MEMORIES) {
    return candidates.slice(0, MAX_RELEVANT_MEMORIES);
  }

  // 4. Use lightweight LLM to select relevant memories
  const manifest = candidates.map(m =>
    `- ${m.filename}: ${m.title} (${m.category}, ${m.date})`
  ).join('\n');

  const prompt = `Given the following user query and available memory files, select the most relevant memory files (at most ${MAX_RELEVANT_MEMORIES}).

User Query: ${currentQuery}

Available Memories:
${manifest}

Recent Tools Used: ${recentTools.join(', ') || 'None'}

Return only the filenames of the selected memories, one per line. Do not include explanations.`;

  try {
    const apiConfig = useSettingsStore.getState().getActiveConfig();
    if (!apiConfig?.apiKey) {
      // Fallback: return most recent memories
      return candidates.slice(0, MAX_RELEVANT_MEMORIES);
    }

    const response = await invoke<any>('send_claude_sdk_chat_streaming', {
      messages: [{ role: 'user', content: prompt }],
      apiKey: apiConfig.apiKey,
      model: apiConfig.model,
      baseUrl: apiConfig.baseUrl || '',
      systemPrompt: 'You are a memory selector. Return only filenames.',
      browserConnected: false,
      sessionId: 'memory-recall',
    });

    const selectedNames = (response.content || '')
      .split('\n')
      .map((line: string) => line.trim().replace(/[-*•]/g, '').trim())
      .filter(Boolean);

    // Map selected names back to memory objects
    const selected = candidates.filter((m: TopicMemory) =>
      selectedNames.some((name: string) => m.filename.includes(name) || name.includes(m.filename))
    );

    return selected.slice(0, MAX_RELEVANT_MEMORIES);
  } catch (e) {
    console.warn('Relevant memory recall failed, falling back to recent files:', e);
    // Fallback: return most recent memories
    return candidates.slice(0, MAX_RELEVANT_MEMORIES);
  }
}

/**
 * Build memory content for injection into system prompt.
 * Reads the full content of selected memory files.
 */
export async function buildMemoryContext(
  relevantMemories: TopicMemory[],
): Promise<string> {
  if (relevantMemories.length === 0) return '';

  let content = '\n\n## Relevant Project Memories\n\n';

  for (const memory of relevantMemories) {
    try {
      const { readTopicMemory } = await import('./topicMemory');
      const fullContent = await readTopicMemory(memory.path);
      content += `### ${memory.title}\n\n${fullContent}\n\n`;
    } catch {
      content += `### ${memory.title}\n\n[Failed to load]\n\n`;
    }
  }

  return content;
}
