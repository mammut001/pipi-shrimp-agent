import { invoke } from '@tauri-apps/api/core';

import type { ImportedFile } from '@/types/settings';
import { useUIStore } from '@/store';
import { usePromptStore } from '@/store/promptStore';

interface ReadFileResult {
  content: string;
  path: string;
}

export interface BuildHeadlessSystemPromptInput {
  workDir?: string;
  workingFiles?: ImportedFile[];
  originalQuery: string;
}

export async function buildHeadlessSystemPrompt(
  input: BuildHeadlessSystemPromptInput,
): Promise<string> {
  const { workDir, workingFiles = [], originalQuery } = input;
  const template = usePromptStore.getState().getActiveTemplate();
  let coreMdContent = '';
  let memoryContext = '';

  if (workDir) {
    try {
      const coreMdPath = `${workDir}/.pipi-shrimp/core.md`;
      const result = await invoke<ReadFileResult>('read_file', {
        path: coreMdPath,
        workDir,
      });
      coreMdContent = result?.content ?? '';
    } catch (error) {
      console.debug('[headless/systemPrompt] No core.md available:', error);
    }

    try {
      const { getMemoryDir, getTopicMemoriesDir } = await import('@/services/memory/memoryPaths');
      const { findRelevantMemories, buildMemoryContext } = await import('@/services/memory/relevantRecall');
      const memoryDir = await getMemoryDir(workDir);
      const topicDir = getTopicMemoriesDir(memoryDir);
      const relevantMemories = await findRelevantMemories(topicDir, originalQuery);
      if (relevantMemories.length > 0) {
        memoryContext = await buildMemoryContext(relevantMemories);
      }
    } catch (error) {
      console.debug('[headless/systemPrompt] Relevant memory recall failed:', error);
    }
  }

  const workingFilesList = workingFiles.length > 0
    ? workingFiles.map((file) => `- ${file.name}: ${file.path}`).join('\n')
    : '';

  const { buildPrompt } = await import('@/services/prompt/promptBuilder');
  const { systemPrompt } = buildPrompt(template?.sections || [], {
    agentInstructions: useUIStore.getState().agentInstructions,
    workDir: workDir || '',
    coreMdContent,
    workingFilesList,
    memoryContext,
    originalQuery,
    browserResult: '',
  });

  return systemPrompt;
}