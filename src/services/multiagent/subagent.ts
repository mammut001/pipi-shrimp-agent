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
import {
  COORDINATOR_SYSTEM_PROMPT,
  WORKER_SYSTEM_PROMPT_ADDENDUM,
  COORDINATOR_TOOL_GUIDANCE,
} from '../orchestration/coordinatorPrompt';

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
      const systemPrompt = await buildSubagentPrompt(options);

      // Call the API with streaming
      const response = await invoke<any>('send_claude_sdk_chat_streaming', {
        messages: [{ role: 'user', content: options.prompt }],
        apiKey: apiConfig.apiKey,
        model: options.model || apiConfig.model,
        baseUrl: apiConfig.baseUrl || '',
        systemPrompt,
        browserConnected: false,
        sessionId: `${options.sessionId}-sub-${agentId}`,
        apiFormat: apiConfig.apiFormat,
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
 * When invoked with a swarm-aware parentContext (has teamName), lifecycle
 * events are recorded in the new swarm runtime.
 */
export async function runAgentBackground(options: SubagentOptions): Promise<string> {
  const agentId = `agent-bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Resolve the swarm runtime agent ID if running in a swarm context
  const swarmAgentId = options.parentContext?.teamName
    ? options.parentContext.agentId
    : null;

  // Fire-and-forget
  (async () => {
    try {
      const result = await runAgentSync({
        ...options,
        runInBackground: false,
      });

      // Record result in swarm runtime if applicable
      if (swarmAgentId) {
        try {
          const swarm = await import('../swarm');
          const { onAgentFinished } = await import('../swarm/inboxCoordinator');
          swarm.recordAssistantOutput(swarmAgentId, result.content || '');
          const agent = swarm.getAgent(swarmAgentId);
          if (result.success) {
            swarm.completeAgent(swarmAgentId);
            if (agent?.currentTaskId) {
              swarm.completeTask(agent.currentTaskId, result.content?.slice(0, 500));
            }
          } else {
            swarm.failAgent(swarmAgentId, result.error);
            if (agent?.currentTaskId) {
              swarm.failTask(agent.currentTaskId, result.error);
            }
          }

          // Send task_result message to team leader so inbox polling fires task_result_received
          if (agent) {
            const team = swarm.getTeam(agent.teamId);
            if (team && team.leaderId !== swarmAgentId) {
              const msgContent = result.success
                ? (result.content || '')
                : `FAILED: ${result.error || 'Unknown error'}`;
              swarm.sendMessage({
                teamId: agent.teamId,
                fromAgentId: swarmAgentId,
                toAgentId: team.leaderId,
                messageType: 'task_result',
                content: msgContent,
                taskId: agent.currentTaskId ?? undefined,
              });
            }
          }

          // Stop inbox polling and process remaining messages
          onAgentFinished(swarmAgentId);

          // Extract agent memory after successful completion (fire-and-forget)
          if (result.success && result.content && agent) {
            swarm.getSwarmBaseDir().then(async baseDir => {
              await swarm.extractAgentMemory(
                `${baseDir}/swarm/${agent.teamId}/${swarmAgentId}/memory`,
                result.content,
                options.prompt,
              );
              // If leader, also extract team memory
              const team = swarm.getTeam(agent.teamId);
              if (team && team.leaderId === swarmAgentId) {
                await swarm.extractTeamMemory(
                  `${baseDir}/swarm/${agent.teamId}/team-memory`,
                  result.content,
                  options.prompt,
                );
              }
            }).catch((e: any) => console.warn('[Subagent] Memory extraction failed:', e));
          }

          if (agent?.sessionId) {
            swarm.reconcileRunForChatSession(agent.sessionId);
          }
        } catch (_e) {
          // Swarm runtime recording is best-effort
          console.warn('[Subagent] Failed to record swarm lifecycle:', _e);
        }
      }

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
      // Record failure in swarm runtime if applicable
      if (swarmAgentId) {
        try {
          const swarm = await import('../swarm');
          const { onAgentFinished } = await import('../swarm/inboxCoordinator');
          const errMsg = e instanceof Error ? e.message : String(e);
          swarm.failAgent(swarmAgentId, errMsg);
          const agent = swarm.getAgent(swarmAgentId);
          if (agent?.currentTaskId) {
            swarm.failTask(agent.currentTaskId, errMsg);
          }
          // Send failure task_result to leader so the delegation can resolve
          if (agent) {
            const team = swarm.getTeam(agent.teamId);
            if (team && team.leaderId !== swarmAgentId) {
              swarm.sendMessage({
                teamId: agent.teamId,
                fromAgentId: swarmAgentId,
                toAgentId: team.leaderId,
                messageType: 'task_result',
                content: `FAILED: ${errMsg}`,
                taskId: agent.currentTaskId ?? undefined,
              });
            }
          }
          // Stop inbox polling and process remaining messages
          onAgentFinished(swarmAgentId);
          if (agent?.sessionId) {
            swarm.reconcileRunForChatSession(agent.sessionId);
          }
        } catch (_) { /* best-effort */ }
      }

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
 * When running in a swarm context, injects agent + team memory prompts.
 *
 * @param options - Subagent options including subagentType to determine prompt template
 * @returns Built system prompt string
 */
async function buildSubagentPrompt(options: SubagentOptions): Promise<string> {
  const isWorker = options.subagentType === 'worker';
  const isCoordinator = options.subagentType === 'coordinator';

  let base: string;

  if (isCoordinator) {
    // Coordinator gets the full coordinator prompt
    base = `${COORDINATOR_SYSTEM_PROMPT}

${COORDINATOR_TOOL_GUIDANCE}

## Current Context

Working directory: ${options.parentContext.workDir || process.cwd()}
Session ID: ${options.sessionId}
Agent: ${options.name}
Role: Coordinator

## Assigned Task

${options.prompt}`;
  } else if (isWorker) {
    // Worker gets role-specific prompt + worker addendum
    base = `You are a specialized AI assistant working on a specific task.

${WORKER_SYSTEM_PROMPT_ADDENDUM}

## Your Assigned Task

**Description:** ${options.description}

**Prompt:**
${options.prompt}

## Context
Working directory: ${options.parentContext.workDir || process.cwd()}
Agent name: ${options.name}
`;
  } else {
    // Default prompt for generic subagents
    base = `You are a specialized AI assistant working on a specific task.

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
Working directory: ${options.parentContext.workDir || process.cwd()}
`;
  }

  // Inject swarm memory prompts if running in a swarm context
  if (options.parentContext?.teamName) {
    try {
      const swarm = await import('../swarm');
      const baseDir = await swarm.getSwarmBaseDir(options.parentContext.workDir);
      const agentId = options.parentContext.agentId;

      // Find the team to get the teamId
      const team = swarm.getTeamByName(options.parentContext.teamName);
      if (team) {
        if (isCoordinator) {
          // Coordinator gets team memory for context
          const teamMemoryPrompt = await swarm.buildTeamMemoryPrompt(
            `${baseDir}/swarm/${team.id}/team-memory`,
          );
          if (teamMemoryPrompt) {
            base += `\n\n---\n\n## Team Context\n\n${teamMemoryPrompt}`;
          }
        } else {
          // Agent Memory
          const agentMemoryPrompt = await swarm.buildAgentMemoryPrompt(
            `${baseDir}/swarm/${team.id}/${agentId}/memory`,
          );
          if (agentMemoryPrompt) {
            base += `\n\n---\n\n${agentMemoryPrompt}`;
          }

          // Team Memory (read-only for all team agents)
          const teamMemoryPrompt = await swarm.buildTeamMemoryPrompt(
            `${baseDir}/swarm/${team.id}/team-memory`,
          );
          if (teamMemoryPrompt) {
            base += `\n\n---\n\n${teamMemoryPrompt}`;
          }
        }
      }
    } catch (e) {
      console.warn('[Subagent] Failed to inject memory prompts:', e);
    }
  }

  return base;
}
