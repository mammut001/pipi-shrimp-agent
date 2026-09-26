import type { ToolRequest } from '../../services/StreamingToolExecutor';
import type { PostHookContext } from '../../services/tools/postToolUseHooks';
import { canAutoApproveTool, type PermissionMode } from '../../services/tools/toolExecutionPolicy';
import { detectBrowserIntent } from '../../services/browser/browserIntent';
import type { ChatState } from '../../types/chat';
import { markSessionToolStatus, markSessionToolRunning, resolveSessionTool } from './toolRuntimeState';
import type { ToolArtifactResult } from './chatArtifacts';
import { emitSessionToolTrace, emitSessionToolTerminal } from './chatToolTrace';
import { resolveToolStepStatus } from './chatToolStatus';
import { buildPermissionContext } from './chatToolPermission';
import type { ToolBatchExecutionDeps } from './chatToolExecution';

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

export async function executeConcurrentTools(
  concurrent: ToolRequest[],
  normalizedToolArgsById: Map<string, string>,
  activeSessionId: string,
  permissionMode: PermissionMode,
  executionModeId: string | undefined,
  workDir: string | null,
  get: () => ChatState,
  set: ChatSetState,
  deps: ToolBatchExecutionDeps,
  batchIdentity: { requestId?: string; turnId?: string } = {},
): Promise<ToolArtifactResult[]> {
  const uiStore = deps.uiStore.getState();
  const executableConcurrent: ToolRequest[] = [];
  const blockedResults: ToolArtifactResult[] = [];
  const sessionForIntent = get().sessions.find((s) => s.id === activeSessionId);
  const messagesForIntent = sessionForIntent?.messages || [];
  const lastUserMsgForIntent = messagesForIntent.length > 0
    ? [...messagesForIntent].reverse().find((m) => m.role === 'user')
    : undefined;
  const allowBrowserTools = lastUserMsgForIntent
    ? detectBrowserIntent(lastUserMsgForIntent.content)
    : false;
  const traceExtras = {
    ...(batchIdentity.requestId !== undefined ? { requestId: batchIdentity.requestId } : {}),
    ...(batchIdentity.turnId !== undefined ? { turnId: batchIdentity.turnId } : {}),
  };

  for (const req of concurrent) {
    markSessionToolRunning(activeSessionId, req.id, req.name, set, get);
    emitSessionToolTrace(activeSessionId, 'tool_requested', {
      toolCallId: req.id,
      ...traceExtras,
    });
    uiStore.updateTaskStep(req.id, 'validating');
    markSessionToolStatus(activeSessionId, req.id, req.name, 'validating', set, get);

    const hookResult = await deps.runPreToolUseHooks({
      toolName: req.name,
      toolArgs: normalizedToolArgsById.get(req.id) ?? JSON.stringify(req.arguments),
      workDir: workDir ?? undefined,
      permissionMode,
      executionMode: executionModeId,
      sessionId: activeSessionId,
      allowBrowserTools,
    });

    if (!hookResult.approved) {
      const message = hookResult.error || 'Tool execution blocked';

      uiStore.addNotification('error', message, activeSessionId);
      uiStore.updateTaskStep(req.id, 'failed');
      resolveSessionTool(
        activeSessionId,
        req.id,
        req.name,
        'failed',
        `Error: ${message}`,
        set,
        get,
      );
      blockedResults.push({
        id: req.id,
        content: `Error: ${message}`,
        toolName: req.name,
        toolArgs: normalizedToolArgsById.get(req.id) ?? '{}',
      });
      emitSessionToolTerminal(activeSessionId, req.id, 'failed', traceExtras);
      continue;
    }

    const effectiveArgs = hookResult.modifiedArgs ?? normalizedToolArgsById.get(req.id) ?? JSON.stringify(req.arguments);
    normalizedToolArgsById.set(req.id, effectiveArgs);
    try {
      executableConcurrent.push({
        id: req.id,
        name: req.name,
        arguments: JSON.parse(effectiveArgs) as Record<string, unknown>,
      });
    } catch {
      uiStore.addNotification('error', `Invalid tool arguments for ${req.name}`, activeSessionId);
      uiStore.updateTaskStep(req.id, 'failed');
      resolveSessionTool(
        activeSessionId,
        req.id,
        req.name,
        'failed',
        'Error: invalid tool arguments',
        set,
        get,
      );
      blockedResults.push({
        id: req.id,
        content: 'Error: invalid tool arguments',
        toolName: req.name,
        toolArgs: effectiveArgs,
      });
      emitSessionToolTerminal(activeSessionId, req.id, 'failed', traceExtras);
    }
  }

  if (executableConcurrent.length === 0) {
    return blockedResults;
  }

  for (const req of executableConcurrent) {
    emitSessionToolTrace(activeSessionId, 'tool_execution_started', {
      toolCallId: req.id,
      ...traceExtras,
    });
  }

  try {
    const batchResult = await deps.createExecutor().executeBatch(executableConcurrent, {
      sessionId: activeSessionId,
      workDir: workDir ?? undefined,
      source: 'assistant_tool_call',
      permissionMode,
      executionMode: executionModeId,
      browserIntent: allowBrowserTools,
      requestPermission: async (request) => {
        if (canAutoApproveTool(permissionMode, request.name, { browserIntent: allowBrowserTools })) {
          return true;
        }
        uiStore.updateTaskStep(request.id, 'awaiting_confirmation');
        markSessionToolStatus(activeSessionId, request.id, request.name, 'awaiting_confirmation', set, get);
        const approved = await uiStore.waitForPermission({
          id: request.id,
          name: request.name,
          arguments: request.arguments,
          ...buildPermissionContext(request.name, request.arguments, request.reason, request.workDir),
          approvalToken: request.approvalToken ?? null,
          sessionId: activeSessionId,
        });
        if (approved) {
          uiStore.updateTaskStep(request.id, 'approved');
          markSessionToolStatus(activeSessionId, request.id, request.name, 'approved', set, get);
        } else {
          uiStore.updateTaskStep(request.id, 'rejected');
          markSessionToolStatus(activeSessionId, request.id, request.name, 'rejected', set, get);
        }
        return approved;
      },
    });

    return [
      ...blockedResults,
      ...batchResult.results.map((result) => {
        const req = executableConcurrent.find((candidate) => candidate.id === result.id);
        if (req) {
          const finalStatus = resolveToolStepStatus(
            result.content,
            result.is_error,
            result.status ?? result.terminal_status ?? null,
          );
          resolveSessionTool(
            activeSessionId,
            result.id,
            req.name,
            finalStatus,
            result.content,
            set,
            get,
          );
          uiStore.updateTaskStep(result.id, finalStatus);
          emitSessionToolTerminal(activeSessionId, result.id, finalStatus, traceExtras);
        }
        if (req) {
          const postCtx: PostHookContext = {
            toolName: req.name,
            toolArgs: normalizedToolArgsById.get(result.id) ?? '{}',
            result: result.content,
            isError: result.is_error,
            sessionId: activeSessionId,
          };
          void deps.runPostToolUseHooks(postCtx).catch((error: unknown) => {
            console.warn('[PostToolUseHooks]', error);
          });
          deps.recordToolForReactiveCompact(activeSessionId, result.id, req.name, result.content);
        }

        return {
          id: result.id,
          content: result.content,
          toolName: req?.name,
          toolArgs: normalizedToolArgsById.get(result.id) ?? '{}',
        };
      }),
    ];
  } catch (error) {
    return [
      ...blockedResults,
      ...executableConcurrent.map((req) => {
        resolveSessionTool(
          activeSessionId,
          req.id,
          req.name,
          'failed',
          `Error: batch execution failed: ${error instanceof Error ? error.message : String(error)}`,
          set,
          get,
        );
        deps.uiStore.getState().updateTaskStep(req.id, 'failed');
        emitSessionToolTerminal(activeSessionId, req.id, 'failed', traceExtras);
        return {
          id: req.id,
          content: `Error: batch execution failed: ${error instanceof Error ? error.message : String(error)}`,
          toolName: req.name,
          toolArgs: normalizedToolArgsById.get(req.id) ?? '{}',
        };
      }),
    ];
  }
}
