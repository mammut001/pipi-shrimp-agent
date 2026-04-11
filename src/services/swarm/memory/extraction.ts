/**
 * Swarm Memory Extraction
 *
 * Extracts memories from agent/team conversations after task completion.
 * Reuses the LLM-driven extraction pattern from autoExtraction.ts.
 */

import { invoke } from '@tauri-apps/api/core';
import {
  type ExtractedMemory,
  type ExtractionAgentResult,
  buildMemoryFrontmatter,
  buildMemoryFilename,
} from '../../memory/memoryTypes';
import { addMemoryIndexEntry } from '../../memory/memoryIndex';
import { scanMemoryFiles, formatMemoryManifest } from '../../memory/memoryScan';
import {
  buildExtractAutoOnlyPrompt,
  EXTRACTION_SYSTEM_PROMPT,
} from '../../memory/extractionPrompts';
import { useSettingsStore } from '@/store';
import type { TeamMemoryType } from '../types';
import {
  buildTeamMemoryFilename,
  buildTeamMemoryFrontmatter,
  TEAM_MEMORY_TYPE_DESCRIPTIONS,
} from './teamMemory';

// =============================================================================
// Agent Memory Extraction
// =============================================================================

/**
 * Extract memories from an agent's task output and save to agent memory.
 *
 * Called after an agent completes a task.
 * Reuses the existing auto-extraction LLM pipeline.
 */
export async function extractAgentMemory(
  agentMemoryDir: string,
  agentResponse: string,
  taskDescription?: string,
): Promise<string[]> {
  if (!agentResponse.trim()) return [];

  try {
    const existingFiles = await scanMemoryFiles(agentMemoryDir);
    const manifest = formatMemoryManifest(existingFiles);

    const conversationText = taskDescription
      ? `TASK: ${taskDescription}\n\nASSISTANT: ${agentResponse.slice(0, 4000)}`
      : `ASSISTANT: ${agentResponse.slice(0, 4000)}`;

    const userPrompt =
      buildExtractAutoOnlyPrompt(1, manifest, agentMemoryDir) +
      '\n\n---\n\n## Conversation to analyse\n\n' +
      conversationText;

    const apiConfig = useSettingsStore.getState().getActiveConfig();
    if (!apiConfig?.apiKey) return [];

    const response = await invoke<{ content: string }>('send_claude_sdk_chat_streaming', {
      messages: [{ role: 'user', content: userPrompt }],
      apiKey: apiConfig.apiKey,
      model: apiConfig.model,
      baseUrl: apiConfig.baseUrl || '',
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      noTools: true,
      browserConnected: false,
      sessionId: `swarm-agent-memory-${Date.now()}`,
    });

    let raw = response.content ?? '';
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1];

    let result: ExtractionAgentResult;
    try {
      result = JSON.parse(raw);
    } catch {
      return [];
    }

    const memories: ExtractedMemory[] = result.memories ?? [];
    if (memories.length === 0) return [];

    const savedPaths: string[] = [];

    for (const mem of memories) {
      if (!mem.title || !mem.content || !mem.type) continue;

      const filename = buildMemoryFilename(mem.type, mem.title);
      const filePath = `${agentMemoryDir}/topic-memories/${filename}`;
      const fileContent = `${buildMemoryFrontmatter(mem.type, mem.title)}${mem.content}\n`;

      try {
        await invoke('write_file', { path: filePath, content: fileContent });
        savedPaths.push(filePath);
      } catch (e) {
        console.error('[SwarmMemory] Failed to write agent memory file:', e);
        continue;
      }

      try {
        await addMemoryIndexEntry(agentMemoryDir, filename, mem.summary ?? mem.title);
      } catch (e) {
        console.error('[SwarmMemory] Failed to update agent memory index:', e);
      }
    }

    if (savedPaths.length > 0) {
      console.info(`[SwarmMemory] Agent saved ${savedPaths.length} memories`);
    }

    return savedPaths;
  } catch (e) {
    console.error('[SwarmMemory] Agent memory extraction failed:', e);
    return [];
  }
}

// =============================================================================
// Team Memory Extraction
// =============================================================================

/** System prompt for team memory extraction */
const TEAM_EXTRACTION_SYSTEM_PROMPT = `You are a team memory extraction assistant.
Your job is to analyse a team leader's output and persist important shared knowledge to the team's memory directory.
Return ONLY valid JSON — no markdown fences, no commentary.

Schema:
{
  "memories": [
    {
      "filename": "goal-mvp-launch.md",
      "type": "goal",
      "title": "MVP Launch Plan",
      "content": "## Background\\n...",
      "summary": "Launch plan targeting Q2 with core features"
    }
  ]
}

Valid types: goal, convention, context, decision.
If there is nothing worth saving, return: {"memories": []}`;

interface TeamMemoryEntry {
  filename: string;
  type: TeamMemoryType;
  title: string;
  content: string;
  summary: string;
}

/**
 * Extract memories from a team leader's output and save to team memory.
 *
 * Only called for the team leader, not for member agents.
 */
export async function extractTeamMemory(
  teamMemoryDir: string,
  leaderResponse: string,
  taskDescription?: string,
): Promise<string[]> {
  if (!leaderResponse.trim()) return [];

  try {
    const existingFiles = await scanMemoryFiles(teamMemoryDir);
    const manifest = formatMemoryManifest(existingFiles);

    const typeDescriptions = Object.entries(TEAM_MEMORY_TYPE_DESCRIPTIONS)
      .map(([name, meta]) => `- **${name}**: ${meta.description} (save when: ${meta.whenToSave})`)
      .join('\n');

    const conversationText = taskDescription
      ? `TASK: ${taskDescription}\n\nLEADER OUTPUT: ${leaderResponse.slice(0, 4000)}`
      : `LEADER OUTPUT: ${leaderResponse.slice(0, 4000)}`;

    const userPrompt = [
      'Analyze the team leader\'s output below and extract shared knowledge worth persisting.',
      '',
      '## Team Memory Types',
      typeDescriptions,
      '',
      manifest ? `## Existing memory files\n\n${manifest}\n\nCheck before creating duplicates.` : '',
      '',
      `## Memory directory: ${teamMemoryDir}`,
      '',
      '---',
      '',
      '## Content to analyse',
      '',
      conversationText,
    ].join('\n');

    const apiConfig = useSettingsStore.getState().getActiveConfig();
    if (!apiConfig?.apiKey) return [];

    const response = await invoke<{ content: string }>('send_claude_sdk_chat_streaming', {
      messages: [{ role: 'user', content: userPrompt }],
      apiKey: apiConfig.apiKey,
      model: apiConfig.model,
      baseUrl: apiConfig.baseUrl || '',
      systemPrompt: TEAM_EXTRACTION_SYSTEM_PROMPT,
      noTools: true,
      browserConnected: false,
      sessionId: `swarm-team-memory-${Date.now()}`,
    });

    let raw = response.content ?? '';
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1];

    let result: { memories: TeamMemoryEntry[] };
    try {
      result = JSON.parse(raw);
    } catch {
      return [];
    }

    const memories = result.memories ?? [];
    if (memories.length === 0) return [];

    const savedPaths: string[] = [];

    for (const mem of memories) {
      if (!mem.title || !mem.content || !mem.type) continue;

      const validTypes: TeamMemoryType[] = ['goal', 'convention', 'context', 'decision'];
      if (!validTypes.includes(mem.type)) continue;

      const filename = buildTeamMemoryFilename(mem.type, mem.title);
      const filePath = `${teamMemoryDir}/topic-memories/${filename}`;
      const fileContent = `${buildTeamMemoryFrontmatter(mem.type, mem.title)}${mem.content}\n`;

      try {
        await invoke('write_file', { path: filePath, content: fileContent });
        savedPaths.push(filePath);
      } catch (e) {
        console.error('[SwarmMemory] Failed to write team memory file:', e);
        continue;
      }

      try {
        await addMemoryIndexEntry(teamMemoryDir, filename, mem.summary ?? mem.title);
      } catch (e) {
        console.error('[SwarmMemory] Failed to update team memory index:', e);
      }
    }

    if (savedPaths.length > 0) {
      console.info(`[SwarmMemory] Team saved ${savedPaths.length} memories`);
    }

    return savedPaths;
  } catch (e) {
    console.error('[SwarmMemory] Team memory extraction failed:', e);
    return [];
  }
}
