import { invoke } from '@tauri-apps/api/core';

import type { ImportedFile } from '@/types/settings';
import { useSettingsStore, useUIStore } from '@/store';
import { usePromptStore } from '@/store/promptStore';
import { buildShellProfilePromptContext } from '@/utils/windowsShellProfile';

interface ReadFileResult {
  content: string;
  path: string;
}

export interface BuildHeadlessSystemPromptInput {
  /** Workspace Folder for the headless run. */
  workDir?: string;
  /** Context Files attached to the headless run as references. */
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

  // `workingFilesList` is rendered into the "Context Files" section of the
  // default template. The variable name is kept for backwards compatibility
  // with custom prompt templates that still reference `{{workingFilesList}}`.
  const workingFilesList = workingFiles.length > 0
    ? workingFiles.map((file) => `- ${file.name}: ${file.path}`).join('\n')
    : '';

  const shellProfileContext = buildShellProfilePromptContext({
    selection: useSettingsStore.getState().windowsShellProfile,
    workDir,
  });

  const { buildPrompt } = await import('@/services/prompt/promptBuilder');
  const { systemPrompt } = buildPrompt(template?.sections || [], {
    agentInstructions: useUIStore.getState().agentInstructions,
    workDir: workDir || '',
    coreMdContent,
    workingFilesList,
    memoryContext,
    shellProfileLabel: shellProfileContext.shellProfileLabel,
    shellProfileGuidance: shellProfileContext.shellProfileGuidance,
    originalQuery,
    browserResult: '',
  });

  return systemPrompt;
}
