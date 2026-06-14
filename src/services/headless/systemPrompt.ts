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
  /**
   * Project Folder for the headless run. Tools run commands and read /
   * write project files relative to this folder. May be omitted for
   * headless runs that only need to write outputs.
   */
  workDir?: string;
  /**
   * PiPi Output Folder for the headless run. App-owned root for
   * `.pipi-shrimp/`, generated docs, memory, and AutoResearch
   * artifacts. Defaults to the app-managed
   * `{Documents|HOME}/PiPi-Shrimp/chats/{session_id}/` when absent.
   */
  pipiOutputDir?: string;
  /** Context Files attached to the headless run as references. */
  workingFiles?: ImportedFile[];
  originalQuery: string;
}

export async function buildHeadlessSystemPrompt(
  input: BuildHeadlessSystemPromptInput,
): Promise<string> {
  const { workDir, pipiOutputDir, workingFiles = [], originalQuery } = input;
  const template = usePromptStore.getState().getActiveTemplate();
  let coreMdContent = '';
  let memoryContext = '';

  if (pipiOutputDir) {
    try {
      // Two-folder model: `core.md` lives in the PiPi Output Folder.
      const coreMdPath = `${pipiOutputDir}/core.md`;
      const result = await invoke<ReadFileResult>('read_file', {
        path: coreMdPath,
        workDir: pipiOutputDir,
      });
      coreMdContent = result?.content ?? '';
    } catch (error) {
      // Backwards compat: pre-v7 headless runs only had `workDir`
      // pointing at the user's repo, where `.pipi-shrimp/core.md`
      // lived. Try that as a fallback so memory survives the upgrade.
      if (workDir) {
        try {
          const legacyPath = `${workDir}/.pipi-shrimp/core.md`;
          const result = await invoke<ReadFileResult>('read_file', {
            path: legacyPath,
            workDir,
          });
          coreMdContent = result?.content ?? '';
        } catch (legacyError) {
          console.debug('[headless/systemPrompt] No core.md available:', legacyError);
        }
      } else {
        console.debug('[headless/systemPrompt] No core.md available:', error);
      }
    }

    try {
      const { getMemoryDir, getTopicMemoriesDir } = await import('@/services/memory/memoryPaths');
      const { findRelevantMemories, buildMemoryContext } = await import('@/services/memory/relevantRecall');
      const memoryDir = await getMemoryDir(workDir, pipiOutputDir);
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
    // Two-folder model: pass both folders so the prompt template can
    // describe the Project Folder (cwd for tools) and the PiPi Output
    // Folder (memory + core.md + generated docs) independently.
    workDir: workDir || '',
    pipiOutputDir: pipiOutputDir || '',
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
