/**
 * Manual D product harness (reusable from #83).
 *
 * Dual-session SessionRuntime + ToolResultChannel latches:
 * A cancelled mid-wait, B succeeds, late A discarded.
 *
 * Also produces A/B message histories via the product cancel/success path
 * (terminalizeInterruptedMessages on cancel; tool-result append on B success)
 * so soak / callers can assert real runtime-shaped histories — not synthetic
 * fixtures alone.
 *
 * ID invariant (GPT FIX-FIRST): for each tool, assistant `tool_calls[].id`
 * === channel `requestId` used by `waitFor` / `submitSessionToolResults`
 * === submitted `ToolExecutionResult.id` === history `__TOOL_RESULT__` /
 * `tool_call_id`. Single-tool harness uses reqA/reqB as that shared id.
 * `toolAId` / `toolBId` options are tool *names* only.
 */
import {
  getSessionHandle,
  getSessionRuntimeForTests,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../SessionRuntime';
import {
  clearRuntimeTraceSink,
  getRuntimeTraceEvents,
} from '../RuntimeTraceSink';
import type { RuntimeTraceEvent } from '../RuntimeTrace';
import { createMessage } from '../../../types/chat';
import type { Message, ToolCall } from '../../../types/chat';
import { terminalizeInterruptedMessages } from '../../../store/chat/scrubDanglingToolCalls';
import { createManualDBarrier, awaitCondition } from './manualDBarrier';

export type ManualDProductHarnessOptions = {
  sessionA: string;
  sessionB: string;
  reqA?: string;
  reqB?: string;
  /** Tool *name* for A (not the channel/tool-call id — that is reqA). */
  toolAId?: string;
  /** Tool *name* for B (not the channel/tool-call id — that is reqB). */
  toolBId?: string;
  cancelReason?: string;
  /** Seed for message ids / timestamps (soak iteration). */
  iteration?: number;
  /** When true (default), release session runtimes before returning on success. */
  releaseOnSuccess?: boolean;
  /** Clear the shared trace sink at start (default true). */
  clearTrace?: boolean;
};

export type ManualDProductHarnessResult = {
  sessionA: string;
  sessionB: string;
  turnA: string;
  turnB: string;
  reqA: string;
  reqB: string;
  toolCallIdA: string;
  toolCallIdB: string;
  lateAAccepted: boolean;
  bAccepted: boolean;
  bResults: unknown;
  aAbortName?: string;
  aWaitResolvedOk: boolean;
  /** Product-path histories (A terminalized after cancel; B with successful tool result). */
  historyA: Message[];
  historyB: Message[];
  historySource: 'manual_d_harness';
  events: RuntimeTraceEvent[];
};

/**
 * Mid-wait product shape: user + assistant with dangling tool_call
 * (what the store holds while SessionRuntime is waiting_tool).
 */
function midWaitHistory(
  label: string,
  toolCall: ToolCall,
  iteration: number,
  offset: number,
): Message[] {
  const user = createMessage('user', label);
  user.timestamp = iteration * 10 + offset;
  const assistant = createMessage('assistant', `calling ${toolCall.name}`);
  assistant.timestamp = iteration * 10 + offset + 1;
  assistant.tool_calls = [toolCall];
  return [user, assistant];
}

/**
 * Run Manual D dual-session product harness and return runtime + history outcomes.
 */
export async function runManualDProductHarness(
  options: ManualDProductHarnessOptions,
): Promise<ManualDProductHarnessResult> {
  const sessionA = options.sessionA;
  const sessionB = options.sessionB;
  const iteration = options.iteration ?? 0;
  const reqA = options.reqA ?? `manual-d-req-a-${iteration}`;
  const reqB = options.reqB ?? `manual-d-req-b-${iteration}`;
  // toolAId/toolBId options are tool *names* (product ToolCall.name).
  const toolNameA = options.toolAId ?? 'tool-a';
  const toolNameB = options.toolBId ?? 'tool-b';
  const cancelReason = options.cancelReason ?? 'Manual D Stop A';
  const releaseOnSuccess = options.releaseOnSuccess !== false;
  const clearTrace = options.clearTrace !== false;

  if (clearTrace) {
    clearRuntimeTraceSink();
  }
  releaseSessionRuntimeForTests(sessionA);
  releaseSessionRuntimeForTests(sessionB);

  const handleA = getSessionHandle(sessionA);
  const handleB = getSessionHandle(sessionB);
  const runtimeA = getSessionRuntimeForTests(sessionA)!;
  const runtimeB = getSessionRuntimeForTests(sessionB)!;

  const gateA = createManualDBarrier();
  const gateB = createManualDBarrier();

  const turnA = runtimeA.startTurn();
  const turnB = runtimeB.startTurn();
  runtimeA.markWaitingTool(turnA);
  runtimeB.markWaitingTool(turnB);

  // Unify tool-call id with channel requestId (single-tool batch).
  // History ownership / result pairing keys off this same id.
  const toolCallIdA = reqA;
  const toolCallIdB = reqB;
  const tcA: ToolCall = { id: toolCallIdA, name: toolNameA, arguments: '{}' };
  const tcB: ToolCall = { id: toolCallIdB, name: toolNameB, arguments: '{}' };

  // Product mid-wait store shape (dangling tool_calls while channel waits).
  let historyA = midWaitHistory(`harness A iter=${iteration}`, tcA, iteration, 0);
  let historyB = midWaitHistory(`harness B iter=${iteration}`, tcB, iteration, 0);

  const waitAPromise = (async () => {
    await gateA.wait();
    return runtimeA.getToolResultChannel().waitFor(
      reqA,
      [toolCallIdA],
      { turnId: turnA },
    );
  })();
  const waitBPromise = (async () => {
    await gateB.wait();
    return runtimeB.getToolResultChannel().waitFor(
      reqB,
      [toolCallIdB],
      { turnId: turnB },
    );
  })();

  if (handleA.getState() !== 'waiting_tool' || handleB.getState() !== 'waiting_tool') {
    throw new Error(
      `Manual D harness: expected both waiting_tool; A=${handleA.getState()} B=${handleB.getState()}`,
    );
  }

  gateA.release();
  gateB.release();
  await awaitCondition(
    () => runtimeA.getToolResultChannel().listPendingRequestIds().includes(reqA)
      && runtimeB.getToolResultChannel().listPendingRequestIds().includes(reqB),
    'both channels pending',
  );

  // Cancel A while B is still waiting — product Stop path on history.
  handleA.cancelActiveTurn(cancelReason);

  let aAbortName: string | undefined;
  let aWaitResolvedOk = false;
  try {
    await waitAPromise;
    aWaitResolvedOk = true;
  } catch (err) {
    aAbortName = err && typeof err === 'object' && 'name' in err
      ? String((err as { name: unknown }).name)
      : 'Error';
  }

  // Product stopGeneration equivalent: scrub orphans + durable cancel notice.
  const terminalizedA = terminalizeInterruptedMessages(historyA, {
    kind: 'user_cancel',
    now: iteration * 10 + 5,
  });
  historyA = terminalizedA.messages;

  // Late A must discard only — must NOT land in history.
  const lateContent = 'late-a-should-discard';
  const lateAAccepted = submitSessionToolResults(
    sessionA,
    reqA,
    [{ id: toolCallIdA, content: lateContent }],
    turnA,
  );
  if (lateAAccepted === true) {
    // Defensive: if runtime wrongly accepted, still do not treat as product history success.
    historyA = [
      ...historyA,
      {
        id: `msg-late-a-leak-${iteration}`,
        role: 'user',
        content: `__TOOL_RESULT__:${toolCallIdA}:${lateContent}`,
        tool_call_id: toolCallIdA,
        timestamp: iteration * 10 + 6,
      },
    ];
  }

  const bAccepted = submitSessionToolResults(
    sessionB,
    reqB,
    [{ id: toolCallIdB, content: 'b-ok' }],
    turnB,
  );

  let bResults: unknown;
  if (bAccepted) {
    bResults = await waitBPromise;
    const content = Array.isArray(bResults) && bResults[0] && typeof bResults[0] === 'object'
      && 'content' in (bResults[0] as object)
      ? String((bResults[0] as { content: unknown }).content)
      : 'b-ok';
    // Product success path: append matching tool result to B history.
    historyB = [
      ...historyB,
      {
        id: `msg-harness-b-result-${iteration}-${turnB}`,
        role: 'user',
        content: `__TOOL_RESULT__:${toolCallIdB}:${content}`,
        tool_call_id: toolCallIdB,
        timestamp: iteration * 10 + 2,
      },
    ];
  }

  const events = getRuntimeTraceEvents();

  const result: ManualDProductHarnessResult = {
    sessionA,
    sessionB,
    turnA,
    turnB,
    reqA,
    reqB,
    toolCallIdA,
    toolCallIdB,
    lateAAccepted: lateAAccepted === true,
    bAccepted: bAccepted === true,
    bResults,
    aAbortName,
    aWaitResolvedOk,
    historyA,
    historyB,
    historySource: 'manual_d_harness',
    events,
  };

  // Leave sessions live for soak follow-up / diagnostics unless asked to release.
  if (releaseOnSuccess) {
    // Caller may still need them — only release when explicitly requested true
    // and we are not the soak path. Soak passes releaseOnSuccess: false.
    releaseSessionRuntimeForTests(sessionA);
    releaseSessionRuntimeForTests(sessionB);
  }

  return result;
}

/** Trace helpers shared by harness tests / soak. */
export function harnessSessionEvents(
  events: RuntimeTraceEvent[],
  sessionId: string,
): RuntimeTraceEvent[] {
  return events.filter((e) => e.context.sessionId === sessionId);
}
