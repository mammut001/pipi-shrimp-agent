/**
 * Deterministic soak runner — loops Manual D–style dual-session scenario.
 *
 * Reuses Manual D barriers + SessionRuntime / ToolResultChannel latches.
 * Does not rewrite SessionRuntime / queryLoop; no Playwright; no OTel.
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
import { createManualDBarrier, awaitCondition } from '../__tests__/manualDBarrier';
import {
  listOrphanToolCalls,
  terminalizeInterruptedMessages,
} from '../../../store/chat/scrubDanglingToolCalls';
import { createMessage } from '../../../types/chat';
import type { Message, ToolCall } from '../../../types/chat';
import { writeSoakFailureBundle } from './failureBundle';
import type {
  RunSoakOptions,
  SoakAssertionFailure,
  SoakIterationResult,
  SoakRunSummary,
} from './types';

function pushFail(
  failures: SoakAssertionFailure[],
  invariant: SoakAssertionFailure['invariant'],
  message: string,
): void {
  failures.push({ invariant, message });
}

/** History with a dangling tool_call (pre-terminalize) for orphan invariant. */
function buildOrphanHistory(): Message[] {
  const user = createMessage('user', 'run tools');
  const assistant = createMessage('assistant', 'sure');
  const toolCall: ToolCall = {
    id: 'tc-soak-orphan',
    name: 'tool-a',
    arguments: '{}',
  };
  assistant.tool_calls = [toolCall];
  return [user, assistant];
}

/**
 * One Manual D–style iteration:
 * A/B wait → cancel A → B success → late A discarded → optional follow-up turn on A.
 *
 * On failure, leaves session runtimes live so the caller can dump diagnostics.
 * On success, releases both sessions for the next iteration.
 */
export async function runSoakIteration(
  iteration: number,
  sessionPrefix = 'soak',
): Promise<SoakIterationResult> {
  const sessionA = `${sessionPrefix}-a-${iteration}`;
  const sessionB = `${sessionPrefix}-b-${iteration}`;
  const failures: SoakAssertionFailure[] = [];
  const reqA = `soak-req-a-${iteration}`;
  const reqB = `soak-req-b-${iteration}`;

  releaseSessionRuntimeForTests(sessionA);
  releaseSessionRuntimeForTests(sessionB);
  clearRuntimeTraceSink();

  let orphanCount = 0;

  try {
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

    const waitAPromise = (async () => {
      await gateA.wait();
      return runtimeA.getToolResultChannel().waitFor(
        reqA,
        ['tool-a'],
        { turnId: turnA },
      );
    })();
    const waitBPromise = (async () => {
      await gateB.wait();
      return runtimeB.getToolResultChannel().waitFor(
        reqB,
        ['tool-b'],
        { turnId: turnB },
      );
    })();

    if (handleA.getState() !== 'waiting_tool' || handleB.getState() !== 'waiting_tool') {
      pushFail(
        failures,
        'scenario',
        `expected both waiting_tool; A=${handleA.getState()} B=${handleB.getState()}`,
      );
    }

    gateA.release();
    gateB.release();
    await awaitCondition(
      () => runtimeA.getToolResultChannel().listPendingRequestIds().includes(reqA)
        && runtimeB.getToolResultChannel().listPendingRequestIds().includes(reqB),
      'both channels pending',
    );

    // Cancel A while B is still waiting.
    handleA.cancelActiveTurn(`Soak Stop A iter=${iteration}`);

    if (handleA.isTurnActive(turnA)) {
      pushFail(failures, 'no_cross_session_cancel', 'A turn still active after cancel');
    }
    if (handleA.getState() !== 'terminal') {
      pushFail(
        failures,
        'no_cancelled_as_success',
        `A state after cancel: ${handleA.getState()} (expected terminal)`,
      );
    }
    if (!handleB.isTurnActive(turnB) || handleB.getState() !== 'waiting_tool') {
      pushFail(
        failures,
        'no_cross_session_cancel',
        `B disrupted after A cancel: active=${handleB.isTurnActive(turnB)} state=${handleB.getState()}`,
      );
    }

    try {
      await waitAPromise;
      pushFail(
        failures,
        'no_cancelled_as_success',
        'A wait resolved successfully after cancel (cancelled-as-success)',
      );
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err
        ? String((err as { name: unknown }).name)
        : undefined;
      if (name !== 'AbortError') {
        pushFail(
          failures,
          'no_cancelled_as_success',
          `A wait rejected with ${name}, expected AbortError`,
        );
      }
    }

    // Late A must discard only — no stale replay.
    const lateA = submitSessionToolResults(
      sessionA,
      reqA,
      [{ id: 'tool-a', content: 'late-a-should-discard' }],
      turnA,
    );
    if (lateA !== false) {
      pushFail(
        failures,
        'no_stale_replay_late_a_discarded',
        `late A submit returned ${lateA}, expected false`,
      );
    }

    // Release B — must succeed independently (no cross-session cancel).
    const bAccepted = submitSessionToolResults(
      sessionB,
      reqB,
      [{ id: 'tool-b', content: 'b-ok' }],
      turnB,
    );
    if (bAccepted !== true) {
      pushFail(
        failures,
        'no_cross_session_cancel',
        `B submit rejected (${bAccepted}) after A cancel`,
      );
    }

    let bResults: unknown;
    try {
      bResults = await waitBPromise;
    } catch (err) {
      pushFail(
        failures,
        'no_cross_session_cancel',
        `B wait rejected after A cancel: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (bAccepted && bResults !== undefined) {
      const expected = [{ id: 'tool-b', content: 'b-ok' }];
      if (JSON.stringify(bResults) !== JSON.stringify(expected)) {
        pushFail(
          failures,
          'no_cross_session_cancel',
          `B results mismatch: ${JSON.stringify(bResults)}`,
        );
      }
      if (!handleB.isTurnActive(turnB)) {
        pushFail(
          failures,
          'no_cross_session_cancel',
          'B turn not active after successful tool results',
        );
      }
    }

    // Trace invariants.
    const events = getRuntimeTraceEvents();
    const aEvents = events.filter((e) => e.context.sessionId === sessionA);
    const bEvents = events.filter((e) => e.context.sessionId === sessionB);

    if (!aEvents.some((e) => e.type === 'turn_cancelling')) {
      pushFail(failures, 'scenario', 'A missing turn_cancelling trace');
    }
    if (!aEvents.some((e) => e.type === 'tool_cancelled')) {
      pushFail(failures, 'no_cancelled_as_success', 'A missing tool_cancelled trace');
    }
    if (!aEvents.some((e) => e.type === 'turn_terminal')) {
      pushFail(failures, 'scenario', 'A missing turn_terminal trace');
    }
    if (!aEvents.some((e) => (
      e.type === 'tool_result_discarded' && e.context.requestId === reqA
    ))) {
      pushFail(
        failures,
        'no_stale_replay_late_a_discarded',
        'A missing tool_result_discarded for late submit',
      );
    }
    if (bEvents.some((e) => e.type === 'tool_cancelled')) {
      pushFail(
        failures,
        'no_cross_session_cancel',
        'B has tool_cancelled (cross-session cancel)',
      );
    }
    if (bEvents.some((e) => e.type === 'turn_terminal')) {
      pushFail(failures, 'no_cross_session_cancel', 'B unexpectedly terminal');
    }

    // Orphan tool_calls in terminal histories (where applicable): dangling →
    // terminalize → none remain; cancelled must not look like success.
    const orphanHistory = buildOrphanHistory();
    const before = listOrphanToolCalls(orphanHistory);
    if (before.length === 0) {
      pushFail(failures, 'setup', 'expected synthetic orphan history to contain orphans');
    }
    const terminalized = terminalizeInterruptedMessages(orphanHistory, {
      kind: 'user_cancel',
      now: iteration,
    });
    const afterOrphans = listOrphanToolCalls(terminalized.messages);
    orphanCount = afterOrphans.length;
    if (afterOrphans.length > 0) {
      pushFail(
        failures,
        'no_orphan_tool_calls',
        `orphan tool_calls remain after terminalize: ${afterOrphans.map((o) => o.toolCall.id).join(',')}`,
      );
    }
    // Cancelled-as-success: notice must say cancelled, not a successful tool result.
    const noticeContent = terminalized.notice?.content ?? '';
    if (terminalized.notice && /tool result|completed successfully/i.test(noticeContent)) {
      pushFail(failures, 'no_cancelled_as_success', 'terminal notice looks like success');
    }

    // Optional follow-up / switch: new A turn after terminal; old turnId must not settle it.
    const followUpTurn = runtimeA.startTurn();
    runtimeA.markWaitingTool(followUpTurn);
    const followReq = `soak-follow-${iteration}`;
    const waitFollow = runtimeA.getToolResultChannel().waitFor(
      followReq,
      ['tool-f'],
      { turnId: followUpTurn },
    );
    const followState = handleA.getState();
    if (!handleA.isTurnActive(followUpTurn) || followState !== 'waiting_tool') {
      pushFail(
        failures,
        'no_stale_replay_late_a_discarded',
        `follow-up A bad state: active=${handleA.isTurnActive(followUpTurn)} state=${followState}`,
      );
    }
    // Stale: present cancelled turnA id against the new waiter — must discard.
    const staleReplay = submitSessionToolResults(
      sessionA,
      followReq,
      [{ id: 'tool-f', content: 'stale-old-turn' }],
      turnA,
    );
    if (staleReplay !== false) {
      pushFail(
        failures,
        'no_stale_replay_late_a_discarded',
        `stale replay with old turnId accepted (${staleReplay})`,
      );
    }
    // Correct submit for follow-up turn.
    const followAccepted = submitSessionToolResults(
      sessionA,
      followReq,
      [{ id: 'tool-f', content: 'follow-ok' }],
      followUpTurn,
    );
    if (followAccepted !== true) {
      pushFail(
        failures,
        'scenario',
        `follow-up submit rejected (${followAccepted})`,
      );
    } else {
      try {
        const followResults = await waitFollow;
        if (JSON.stringify(followResults) !== JSON.stringify([{ id: 'tool-f', content: 'follow-ok' }])) {
          pushFail(failures, 'scenario', `follow-up results mismatch: ${JSON.stringify(followResults)}`);
        }
      } catch (err) {
        pushFail(
          failures,
          'scenario',
          `follow-up wait failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const result: SoakIterationResult = {
      ok: failures.length === 0,
      iteration,
      sessionA,
      sessionB,
      failures,
      orphanCount,
    };

    if (result.ok) {
      releaseSessionRuntimeForTests(sessionA);
      releaseSessionRuntimeForTests(sessionB);
    }
    // On failure leave B (and possibly A follow-up) live for diagnostics dump.

    return result;
  } catch (err) {
    pushFail(
      failures,
      'setup',
      err instanceof Error ? err.message : String(err),
    );
    return {
      ok: false,
      iteration,
      sessionA,
      sessionB,
      failures,
      orphanCount,
    };
  }
}

/** Resolve iteration count: options.iterations > PIPI_SOAK_ITERS > default 50. */
export function resolveSoakIterations(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const raw = process.env.PIPI_SOAK_ITERS;
  if (raw !== undefined && raw !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return 50;
}

/**
 * Run N soak iterations. On first failure (default), dump a failure bundle and stop.
 */
export async function runSoak(options: RunSoakOptions = {}): Promise<SoakRunSummary> {
  const iterations = resolveSoakIterations(options.iterations);
  const stopOnFailure = options.stopOnFailure !== false;
  const sessionPrefix = options.sessionPrefix ?? 'soak';
  const results: SoakIterationResult[] = [];

  for (let i = 1; i <= iterations; i++) {
    const result = await runSoakIteration(i, sessionPrefix);
    results.push(result);
    if (!result.ok) {
      const bundle = writeSoakFailureBundle({
        artifactRoot: options.artifactRoot,
        iteration: result.iteration,
        sessionA: result.sessionA,
        sessionB: result.sessionB,
        failures: result.failures,
      });
      releaseSessionRuntimeForTests(result.sessionA);
      releaseSessionRuntimeForTests(result.sessionB);
      return {
        ok: false,
        iterationsRequested: iterations,
        iterationsCompleted: i,
        failedAt: i,
        failureBundleDir: bundle.dir,
        results,
      };
    }
  }

  return {
    ok: true,
    iterationsRequested: iterations,
    iterationsCompleted: iterations,
    results: stopOnFailure ? results : results,
  };
}
