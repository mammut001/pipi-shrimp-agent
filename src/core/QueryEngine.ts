import type { EngineEvent } from './types';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { getSessionHandle } from './runtime/SessionRuntime';
import type { RunChatTurnOptions } from './runtime/queryLoop';

export { buildExhaustedMalformedToolCallError } from './runtime/queryLoop';
export type { RunChatTurnOptions } from './runtime/queryLoop';

/**
 * Compatibility facade for existing callers.
 *
 * The loop is now owned by SessionRuntime. Chat, headless, workflow and
 * AutoResearch may keep calling runChatTurn while they migrate to SessionHandle;
 * they are clients of the shared runtime rather than owners of a private loop.
 */
export function runChatTurn(
  sessionId: string,
  initialMessages: any[],
  systemPrompt: string,
  projectRoot?: string,
  allowBrowserTools: boolean = false,
  requestConfig?: ResolvedAgentConfig,
  options?: RunChatTurnOptions,
  pipiOutputDir?: string,
): AsyncGenerator<EngineEvent, void, unknown> {
  return getSessionHandle(sessionId).runTurn({
    initialMessages,
    systemPrompt,
    projectRoot,
    allowBrowserTools,
    requestConfig,
    options,
    pipiOutputDir,
  });
}
