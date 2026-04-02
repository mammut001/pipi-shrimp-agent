/**
 * Subagent Executor
 *
 * Runs a subagent with isolated context.
 * Supports sync (await result) and async (background) modes.
 *
 * Based on Claude Code's src/tools/AgentTool/runAgent.ts
 */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AgentContext, createChildContext, withAgentContext } from './agentContext';
import { useSettingsStore } from '@/store';

export interface SubagentOptions {
  name: string;
  prompt: string;
  description: string;
  sessionId: string;
  parentContext: AgentContext;
  runInBackground?: boolean;
  model?: string;
  subagentType?: string;
}

export interface SubagentResult {
  agentId: string;
  content: string;
  success: boolean;
  error?: string;
}

/**
 * Run a subagent synchronously (await result).
 */
export async function runAgentSync(options: SubagentOptions): Promise<SubagentResult> {
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const context = createChildContext(options.parentContext, {
    agentId,
    sessionId: options.sessionId,
    name: options.name,
  });

  return withAgentContext(context, async () => {
    try {
      const apiConfig = useSettingsStore.getState().getActiveConfig();
      if (!apiConfig?.apiKey) {
        return { agentId, content: '', success: false, error: 'No API key configured' };
      }

      // Build subagent system prompt
      const systemPrompt = buildSubagentPrompt(options);

      // Call the API with streaming
      const response = await invoke<any>('send_claude_sdk_chat_streaming', {
        messages: [{ role: 'user', content: options.prompt }],
        apiKey: apiConfig.apiKey,
        model: options.model || apiConfig.model,
        baseUrl: apiConfig.baseUrl || '',
        systemPrompt,
        browserConnected: false,
        sessionId: `${options.sessionId}-sub-${agentId}`,
      });

      return {
        agentId,
        content: response.content || '',
        success: true,
      };
    } catch (e) {
      return {
        agentId,
        content: '',
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

/**
 * Run a subagent in background (fire-and-forget with notification).
 */
export async function runAgentBackground(options: SubagentOptions): Promise<string> {
  const agentId = `agent-bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Fire-and-forget
  (async () => {
    try {
      const result = await runAgentSync({
        ...options,
        runInBackground: false,
      });

      // Emit completion event
      const window = getCurrentWindow();
      await window.emit('subagent-complete', {
        agentId,
        sessionId: options.sessionId,
        content: result.content,
        success: result.success,
        error: result.error,
      });
    } catch (e) {
      const window = getCurrentWindow();
      await window.emit('subagent-error', {
        agentId,
        sessionId: options.sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();

  return agentId;
}

/**
 * Build system prompt for a subagent.
 */
function buildSubagentPrompt(options: SubagentOptions): string {
  return `You are a specialized AI assistant working on a specific task.

## Your Role
${options.description}

## Task
${options.prompt}

## Instructions
1. Focus only on the task described above
2. Provide a complete, self-contained response
3. If you need to use tools, use them to complete the task
4. Summarize your findings or work at the end

## Context
Your working directory is: ${options.parentContext.workDir || 'not specified'}
`;
}
