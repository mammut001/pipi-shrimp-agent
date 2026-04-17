/**
 * AutoResearch Chat Adapter — Bridges loopEngine's sendMessage interface
 * to the core QueryEngine (runChatTurn).
 *
 * Unlike chatStore.sendMessage which renders to UI and requires permission
 * flows, this adapter auto-executes all tools (the loop is autonomous)
 * and streams live output to the AutoResearch store.
 */

import { runChatTurn } from '@/core/QueryEngine';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store';
import { StreamingToolExecutor, partitionTools } from '@/services/StreamingToolExecutor';
import type { ToolCallParams } from '@/core/types';

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
    messageHistory.push({
      role: 'user',
      content: userMessage,
    });

    const store = useAutoResearchStore.getState();
    store.appendLiveOutput(`\n--- Iteration ${store.currentIteration} ---\n`);

    // Run the query engine
    const engine = runChatTurn(
      sessionId,
      [...messageHistory],
      systemPrompt,
      workDir,
    );

    let assistantText = '';
    const executor = new StreamingToolExecutor({ timeoutMs: 120_000 });

    for await (const event of engine) {
      switch (event.type) {
        case 'text_delta':
          assistantText += event.content;
          useAutoResearchStore.getState().appendLiveOutput(event.content);
          break;

        case 'reasoning_delta':
          // Stream reasoning to live output (dimmed in UI)
          useAutoResearchStore.getState().appendLiveOutput(`💭 ${event.content}`);
          break;

        case 'tool_batch_request': {
          const results = await executeToolBatch(
            event.tools,
            executor,
            sessionId,
            workDir,
          );
          event._resolveAll(results);
          break;
        }

        case 'tool_call_request': {
          // Single tool request (legacy path)
          const result = await executeSingleToolRequest(
            event.tool,
            executor,
            sessionId,
            workDir,
          );
          event._resolve(result);
          break;
        }

        case 'status_update':
          useAutoResearchStore.getState().appendLiveOutput(`[status] ${event.message}\n`);
          break;

        case 'error':
          throw event.error;

        case 'turn_complete':
          // Turn finished, break will happen naturally
          break;
      }
    }

    // Record assistant response in history for context continuity
    messageHistory.push({
      role: 'assistant',
      content: assistantText,
    });

    return assistantText;
  };
}

/**
 * Execute a batch of tool calls, auto-approving everything.
 * Logs tool names and results to live output.
 */
async function executeToolBatch(
  tools: ToolCallParams[],
  executor: StreamingToolExecutor,
  sessionId: string,
  workDir?: string,
): Promise<{ id: string; content: string }[]> {
  const store = useAutoResearchStore.getState();
  const toolNames = tools.map(t => t.name).join(', ');
  store.appendLiveOutput(`\n🔧 Tools: ${toolNames}\n`);

  const toolRequests = tools.map(t => {
    let parsedArgs: Record<string, any> = {};
    try { parsedArgs = JSON.parse(t.arguments); } catch { parsedArgs = {}; }
    return { id: t.id, name: t.name, arguments: parsedArgs };
  });

  const { concurrent, serial } = partitionTools(toolRequests);
  const allResults: { id: string; content: string }[] = [];

  // Execute concurrent (read-only) tools in parallel
  if (concurrent.length > 0) {
    try {
      const batchResult = await executor.executeBatch(concurrent, {
        sessionId,
        workDir,
      });
      for (const result of batchResult.results) {
        allResults.push({ id: result.id, content: result.content });
        logToolResult(result.id, concurrent.find(r => r.id === result.id)?.name ?? '?', result.content);
      }
    } catch (err) {
      for (const req of concurrent) {
        const errMsg = `Error: batch execution failed: ${err instanceof Error ? err.message : String(err)}`;
        allResults.push({ id: req.id, content: errMsg });
      }
    }
  }

  // Execute serial tools one-by-one (auto-approved — no permission UI)
  for (const req of serial) {
    try {
      const batchResult = await executor.executeBatch([req], {
        sessionId,
        workDir,
      });
      const result = batchResult.results[0];
      if (result) {
        allResults.push({ id: result.id, content: result.content });
        logToolResult(result.id, req.name, result.content);
      }
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`;
      allResults.push({ id: req.id, content: errMsg });
      logToolResult(req.id, req.name, errMsg);
    }
  }

  return allResults;
}

/**
 * Execute a single tool request (legacy code path).
 */
async function executeSingleToolRequest(
  tool: ToolCallParams,
  executor: StreamingToolExecutor,
  sessionId: string,
  workDir?: string,
): Promise<string> {
  let parsedArgs: Record<string, any> = {};
  try { parsedArgs = JSON.parse(tool.arguments); } catch { parsedArgs = {}; }

  logToolResult(tool.id, tool.name, '(executing...)');

  const batchResult = await executor.executeBatch(
    [{ id: tool.id, name: tool.name, arguments: parsedArgs }],
    { sessionId, workDir },
  );

  const result = batchResult.results[0]?.content ?? 'Error: no result';
  logToolResult(tool.id, tool.name, result);
  return result;
}

/**
 * Log a tool result summary to the AutoResearch live output.
 * Truncates long outputs to keep the panel readable.
 */
function logToolResult(_id: string, name: string, content: string) {
  const MAX_PREVIEW = 200;
  const preview = content.length > MAX_PREVIEW
    ? content.slice(0, MAX_PREVIEW) + '…'
    : content;
  useAutoResearchStore.getState().appendLiveOutput(`  → ${name}: ${preview}\n`);
}
