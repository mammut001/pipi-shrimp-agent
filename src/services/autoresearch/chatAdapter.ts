/**
 * AutoResearch Chat Adapter — Bridges loopEngine's sendMessage interface
 * to the core QueryEngine (runChatTurn).
 *
 * Unlike chatStore.sendMessage which renders to UI and requires permission
 * flows, this adapter auto-executes all tools (the loop is autonomous)
 * and streams live output to the AutoResearch store.
 */

import { useAutoResearchStore } from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';

let adapterSessionCounter = 0;

/**
 * Create a sendMessage function suitable for startExperimentLoop().
 *
 * Each call to the returned function runs one full agent turn
 * (including multi-round tool loops) and returns the final
 * assistant text output.
 */
export function createAutoResearchSendMessage(
  workDir?: string,
): (systemPrompt: string, userMessage: string) => Promise<string> {
  // Persistent message history across iterations within one loop session
  const messageHistory: any[] = [];

  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    const apiConfig = useSettingsStore.getState().getActiveConfig();
    if (!apiConfig?.apiKey) {
      throw new Error('API key not configured');
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

    const result = await runHeadlessAgentTurn({
      sessionId,
      initialMessages: turnMessages,
      systemPrompt,
      workDir,
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
    });

    const assistantText = result.finalText;

    // Record assistant response in history for context continuity
    messageHistory.push({
      role: 'assistant',
      content: assistantText,
    });

    return assistantText;
  };
}
