/**
 * AutoResearch Chat Adapter — Bridges loopEngine's sendMessage interface
 * to the core QueryEngine (runChatTurn).
 *
 * Unlike chatStore.sendMessage which renders to UI and requires permission
 * flows, this adapter auto-executes all tools (the loop is autonomous)
 * and streams live output to the AutoResearch store.
 */

import { useAutoResearchStore } from '@/store/autoresearchStore';
import {
  formatAgentConfigValidationError,
  getAgentConfigDiagnostics,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import { buildAutoResearchAgentErrorMessage } from './errors';
import { appendTargetText, writeTargetText } from './runDir';
import { getCurrentRunDir } from './terminalRunner';

let adapterSessionCounter = 0;

function truncateTranscriptResult(result: string, limit = 4000): string {
  if (result.length <= limit) {
    return result;
  }
  return `${result.slice(0, limit)}\n...[truncated ${result.length - limit} chars]`;
}

async function writeIterationTranscriptHeader(userMessage: string): Promise<void> {
  const state = useAutoResearchStore.getState();
  const runDir = getCurrentRunDir();
  if (!state.sshConfig || !runDir) {
    return;
  }

  await writeTargetText(
    state.sshConfig,
    runDir.transcriptPath,
    `# AutoResearch Iteration ${runDir.iter}\n\n## User Message\n${userMessage}\n`,
  );
}

async function appendIterationTranscript(section: string): Promise<void> {
  const state = useAutoResearchStore.getState();
  const runDir = getCurrentRunDir();
  if (!state.sshConfig || !runDir) {
    return;
  }

  await appendTargetText(state.sshConfig, runDir.transcriptPath, section);
}

/**
 * Create a sendMessage function suitable for startExperimentLoop().
 *
 * Each call to the returned function runs one full agent turn
 * (including multi-round tool loops) and returns the final
 * assistant text output.
 */
export function createAutoResearchSendMessage(
  workDir?: string,
  fixedAgentConfig?: ResolvedAgentConfig | null,
): (systemPrompt: string, userMessage: string) => Promise<string> {
  // Persistent message history across iterations within one loop session
  const messageHistory: any[] = [];

  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    const agentConfig = fixedAgentConfig ?? resolveActiveAgentConfig();
    const validationIssues = validateResolvedAgentConfig(agentConfig);
    if (validationIssues.length > 0) {
      throw new Error(formatAgentConfigValidationError(agentConfig, validationIssues));
    }

    // Each iteration gets a fresh session ID for the Rust backend
    adapterSessionCounter++;
    const sessionId = `autoresearch-${adapterSessionCounter}-${Date.now()}`;

    // Build messages for this iteration
    // We keep a sliding window to avoid unbounded growth
    const MAX_HISTORY = 20;
    if (messageHistory.length > MAX_HISTORY * 2) {
      messageHistory.splice(0, messageHistory.length - MAX_HISTORY);
    }

    // Add the user message for this iteration
    const turnMessages = [
      ...messageHistory,
      {
        role: 'user',
        content: userMessage,
      },
    ];

    messageHistory.push({
      role: 'user',
      content: userMessage,
    });

    const store = useAutoResearchStore.getState();
    store.appendLiveOutput(`\n--- Iteration ${store.currentIteration} ---\n`);
    await writeIterationTranscriptHeader(userMessage);

    console.info('[AutoResearch] Agent request', getAgentConfigDiagnostics(agentConfig!));

    let assistantText = '';
    try {
      const result = await runHeadlessAgentTurn({
        sessionId,
        initialMessages: turnMessages,
        systemPrompt,
        workDir,
        agentConfig: agentConfig!,
        onTextDelta: (chunk) => {
          useAutoResearchStore.getState().appendLiveOutput(chunk);
        },
        onReasoningDelta: (chunk) => {
          useAutoResearchStore.getState().appendLiveOutput(`💭 ${chunk}`);
        },
        onStatus: (message) => {
          useAutoResearchStore.getState().appendLiveOutput(`[status] ${message}\n`);
        },
        onToolSummary: (toolName, preview) => {
          useAutoResearchStore.getState().appendLiveOutput(`  → ${toolName}: ${preview}\n`);
        },
        onAssistantMessage: async (text) => {
          if (!text.trim()) {
            return;
          }
          await appendIterationTranscript(`\n## Assistant\n${text.trim()}\n`);
        },
        onToolCall: async (call) => {
          await appendIterationTranscript(
            `\n## Tool Call: ${call.name}\n\`\`\`json\n${call.arguments || '{}'}\n\`\`\`\n`,
          );
        },
        onToolResult: async (call) => {
          await appendIterationTranscript(
            `\n## Tool Result: ${call.name} (${call.durationMs}ms)\n\`\`\`text\n${truncateTranscriptResult(call.result)}\n\`\`\`\n`,
          );
        },
      });

      assistantText = result.finalText;
    } catch (error) {
      const diagnosticMessage = buildAutoResearchAgentErrorMessage({
        phase: 'agent_execution',
        config: agentConfig!,
        cwd: workDir,
        error,
      });
      console.error('[AutoResearch] Agent execution failed', {
        ...getAgentConfigDiagnostics(agentConfig!),
        cwd: workDir,
        diagnosticMessage,
      });
      throw new Error(diagnosticMessage);
    }

    // Record assistant response in history for context continuity
    messageHistory.push({
      role: 'assistant',
      content: assistantText,
    });

    return assistantText;
  };
}
