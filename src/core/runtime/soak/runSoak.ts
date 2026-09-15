/**
 * Deterministic soak runner — loops Manual D–style dual-session scenario.
 *
 * Reuses Manual D product harness (#83) + SessionRuntime / ToolResultChannel
 * latches. Does not rewrite SessionRuntime / queryLoop; no Playwright; no OTel.
 *
 * Default path: A/B message histories come from the real Manual D harness
 * (product terminalize on A cancel + successful tool result on B) — not from
 * buildSoakScenarioHistories() synthetic fixtures. That helper remains for
 * isolated history-invariant unit tests only.
 */
import {
  getSessionHandle,
  getSessionRuntimeForTests,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../SessionRuntime';
import { getRuntimeTraceEvents } from '../RuntimeTraceSink';
import {
  runManualDProductHarness,
  harnessSessionEvents,
} from '../__tests__/manualDProductHarness';
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
  SoakIterationOptions,
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

/**
 * Scenario fixture histories for **isolated** orphan/terminalize unit tests.
 * NOT used by the default runSoakIteration path (that uses Manual D harness).
 *
 * A: cancelled mid-tool → dangling tool_call (orphan until terminalize).
 * B: successful tool path → tool_call + matching tool result (no orphans).
 */
export function buildSoakScenarioHistories(iteration: number): {
  historyA: Message[];
  historyB: Message[];
} {
  const tcA: ToolCall = {
    id: `tc-soak-a-${iteration}`,
    name: 'tool-a',
    arguments: '{}',
  };
  const tcB: ToolCall = {
    id: `tc-soak-b-${iteration}`,
    name: 'tool-b',
    arguments: '{}',
  };

  const userA = createMessage('user', `soak A iter=${iteration}`);
  userA.timestamp = iteration * 10;
  const assistantA = createMessage('assistant', 'calling tool-a');
  assistantA.timestamp = iteration * 10 + 1;
  assistantA.tool_calls = [tcA];

  const userB = createMessage('user', `soak B iter=${iteration}`);
  userB.timestamp = iteration * 10;
  const assistantB = createMessage('assistant', 'calling tool-b');
  assistantB.timestamp = iteration * 10 + 1;
  assistantB.tool_calls = [tcB];
  const resultB: Message = {
    id: `msg-soak-b-result-${iteration}`,
    role: 'user',
    content: `__TOOL_RESULT__:${tcB.id}:b-ok`,
    tool_call_id: tcB.id,
    timestamp: iteration * 10 + 2,
  };

  return {
    historyA: [userA, assistantA],
    historyB: [userB, assistantB, resultB],
  };
}

function historyHasCancelNotice(history: Message[]): boolean {
  return history.some((m) => (
    typeof m.content === 'string'
    && (/cancelled by user|interrupted before completion/i.test(m.content))
  ));
}

/**
 * Assert orphan / cancelled-as-success invariants on A/B message histories.
 *
 * Accepts either:
 * - Pre-terminalize A (orphans present) — unit-helper / injected fixtures
 * - Post-product-cancel A (scrubbed + cancel notice) — Manual D harness path
 *
 * Returns remaining orphan count on A after ensuring terminal shape (expect 0).
 */
export function assertSoakHistoryInvariants(
  historyA: Message[],
  historyB: Message[],
  failures: SoakAssertionFailure[],
  iteration: number,
): number {
  const orphansABefore = listOrphanToolCalls(historyA);
  const alreadyTerminal = orphansABefore.length === 0 && historyHasCancelNotice(historyA);

  let terminalizedA = {
    messages: historyA,
    notice: null as Message | null,
    changed: false,
  };
  let orphansAAfter = orphansABefore;

  if (alreadyTerminal) {
    // Harness / product Stop path already scrubbed + appended cancel notice.
    orphansAAfter = listOrphanToolCalls(historyA);
    terminalizedA = {
      messages: historyA,
      notice: historyA.find((m) => (
        typeof m.content === 'string'
        && (/cancelled by user|interrupted before completion/i.test(m.content))
      )) ?? null,
      changed: false,
    };
  } else if (orphansABefore.length === 0) {
    pushFail(
      failures,
      'no_orphan_tool_calls',
      'session A history expected orphan tool_calls after cancel, or a cancel/interrupted notice (none found)',
    );
  } else {
    const result = terminalizeInterruptedMessages(historyA, {
      kind: 'user_cancel',
      now: iteration,
    });
    terminalizedA = {
      messages: result.messages,
      notice: result.notice,
      changed: result.changed,
    };
    orphansAAfter = listOrphanToolCalls(result.messages);
  }

  if (orphansAAfter.length > 0) {
    pushFail(
      failures,
      'no_orphan_tool_calls',
      `session A orphan tool_calls remain after terminalize: ${orphansAAfter.map((o) => o.toolCall.id).join(',')}`,
    );
  }

  // Cancelled-as-success: notice must say cancelled, not a successful tool result.
  if (!terminalizedA.notice && orphansABefore.length > 0) {
    pushFail(
      failures,
      'no_cancelled_as_success',
      'session A terminalize produced no cancel notice despite orphans',
    );
  }
  if (!terminalizedA.notice && alreadyTerminal === false && orphansABefore.length === 0) {
    // already flagged missing orphans/notice above
  } else if (alreadyTerminal && !terminalizedA.notice) {
    pushFail(
      failures,
      'no_cancelled_as_success',
      'session A harness history missing cancel/interrupted notice',
    );
  }

  const noticeContent = terminalizedA.notice?.content ?? '';
  if (terminalizedA.notice && /tool result|completed successfully/i.test(noticeContent)) {
    pushFail(failures, 'no_cancelled_as_success', 'session A terminal notice looks like success');
  }
  if (
    terminalizedA.notice
    && !/cancelled by user|interrupted before completion/i.test(noticeContent)
  ) {
    pushFail(
      failures,
      'no_cancelled_as_success',
      `session A notice missing cancel/interrupted wording: ${noticeContent.slice(0, 120)}`,
    );
  }

  // If A history wrongly resolves cancelled tool as success (no orphans, no notice).
  if (orphansABefore.length === 0 && !alreadyTerminal) {
    const resolvedLikeSuccess = historyA.some(
      (m) => typeof m.tool_call_id === 'string' && m.tool_call_id.length > 0,
    );
    if (resolvedLikeSuccess) {
      pushFail(
        failures,
        'no_cancelled_as_success',
        'session A history resolves tool_calls as success after cancel (no orphans)',
      );
    }
  }

  // Late A discard must not appear in A history.
  if (historyA.some((m) => String(m.content).includes('late-a-should-discard'))) {
    pushFail(
      failures,
      'no_stale_replay_late_a_discarded',
      'session A history contains late discarded tool result content',
    );
  }

  // --- Session B (success): must have no orphans; must not need terminalize ---
  const orphansB = listOrphanToolCalls(historyB);
  if (orphansB.length > 0) {
    pushFail(
      failures,
      'no_orphan_tool_calls',
      `session B history has orphan tool_calls after success: ${orphansB.map((o) => o.toolCall.id).join(',')}`,
    );
  }
  const terminalizedB = terminalizeInterruptedMessages(historyB, {
    kind: 'user_cancel',
    now: iteration,
  });
  if (terminalizedB.changed || terminalizedB.notice) {
    pushFail(
      failures,
      'no_cross_session_cancel',
      'session B history required terminalize (unexpected orphans / cancel notice)',
    );
  }

  // B must show successful tool completion (not empty / not cancel-only).
  const bHasToolResult = historyB.some(
    (m) => typeof m.tool_call_id === 'string'
      && m.tool_call_id.length > 0
      && typeof m.content === 'string'
      && m.content.includes('__TOOL_RESULT__'),
  );
  if (!bHasToolResult) {
    pushFail(
      failures,
      'no_cross_session_cancel',
      'session B history missing successful tool completion (__TOOL_RESULT__)',
    );
  }

  return orphansAAfter.length;
}

/**
 * One Manual D–style iteration via the real product harness:
 * A/B wait → cancel A → B success → late A discarded → optional follow-up turn on A.
 *
 * Histories default to harness-produced (product terminalize / tool result).
 * Callers may still inject historyA/historyB for negative tests.
 *
 * On failure, leaves session runtimes live so the caller can dump diagnostics.
 * On success, releases both sessions for the next iteration.
 */
export async function runSoakIteration(
  iteration: number,
  sessionPrefix = 'soak',
  options: SoakIterationOptions = {},
): Promise<SoakIterationResult> {
  const sessionA = `${sessionPrefix}-a-${iteration}`;
  const sessionB = `${sessionPrefix}-b-${iteration}`;
  const failures: SoakAssertionFailure[] = [];
  const reqA = `soak-req-a-${iteration}`;
  const reqB = `soak-req-b-${iteration}`;

  let orphanCount = 0;
  let historyA: Message[] | undefined;
  let historyB: Message[] | undefined;
  let historySource: SoakIterationResult['historySource'];

  try {
    // Real Manual D / SessionRuntime product harness (not synthetic fixtures).
    const harness = await runManualDProductHarness({
      sessionA,
      sessionB,
      reqA,
      reqB,
      cancelReason: `Soak Stop A iter=${iteration}`,
      iteration,
      releaseOnSuccess: false,
      clearTrace: true,
    });

    historySource = harness.historySource;
    historyA = options.historyA ?? harness.historyA;
    historyB = options.historyB ?? harness.historyB;
    if (options.historyA || options.historyB) {
      historySource = 'injected';
    }

    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);
    const runtimeA = getSessionRuntimeForTests(sessionA)!;
    const turnA = harness.turnA;
    const turnB = harness.turnB;

    // --- Runtime latch / abort invariants from harness outcome ---
    if (harness.aWaitResolvedOk) {
      pushFail(
        failures,
        'no_cancelled_as_success',
        'A wait resolved successfully after cancel (cancelled-as-success)',
      );
    } else if (harness.aAbortName !== 'AbortError') {
      pushFail(
        failures,
        'no_cancelled_as_success',
        `A wait rejected with ${harness.aAbortName}, expected AbortError`,
      );
    }

    if (handleA.getState() !== 'terminal') {
      pushFail(
        failures,
        'no_cancelled_as_success',
        `A state after cancel: ${handleA.getState()} (expected terminal)`,
      );
    }

    if (harness.lateAAccepted) {
      pushFail(
        failures,
        'no_stale_replay_late_a_discarded',
        'late A submit returned true, expected false',
      );
    }

    if (!harness.bAccepted) {
      pushFail(
        failures,
        'no_cross_session_cancel',
        'B submit rejected after A cancel',
      );
    } else {
      const expected = [{ id: 'tool-b', content: 'b-ok' }];
      if (JSON.stringify(harness.bResults) !== JSON.stringify(expected)) {
        pushFail(
          failures,
          'no_cross_session_cancel',
          `B results mismatch: ${JSON.stringify(harness.bResults)}`,
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

    // Trace invariants (from harness events + live sink).
    const events = harness.events.length > 0 ? harness.events : getRuntimeTraceEvents();
    const aEvents = harnessSessionEvents(events, sessionA);
    const bEvents = harnessSessionEvents(events, sessionB);

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

    // Real harness-produced (or injected) A/B message-history checks.
    orphanCount = assertSoakHistoryInvariants(historyA, historyB, failures, iteration);

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
      historyA,
      historyB,
      historySource,
    };

    if (result.ok) {
      releaseSessionRuntimeForTests(sessionA);
      releaseSessionRuntimeForTests(sessionB);
    }

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
      historyA,
      historyB,
      historySource: historySource ?? 'manual_d_harness',
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
 * Run N soak iterations.
 * Default stopOnFailure=true: dump a failure bundle and stop on first failure.
 * When stopOnFailure=false: continue after failures, still recording each
 * failure + bundle; summary.ok is false if any iteration failed.
 */
export async function runSoak(options: RunSoakOptions = {}): Promise<SoakRunSummary> {
  const iterations = resolveSoakIterations(options.iterations);
  const stopOnFailure = options.stopOnFailure !== false;
  const sessionPrefix = options.sessionPrefix ?? 'soak';
  const runIteration = options.runIteration ?? runSoakIteration;
  const results: SoakIterationResult[] = [];
  let failedAt: number | undefined;
  let failureBundleDir: string | undefined;
  const failureBundleDirs: string[] = [];

  for (let i = 1; i <= iterations; i++) {
    const result = await runIteration(i, sessionPrefix);
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
      failureBundleDirs.push(bundle.dir);
      if (failedAt === undefined) {
        failedAt = i;
        failureBundleDir = bundle.dir;
      }
      if (stopOnFailure) {
        return {
          ok: false,
          iterationsRequested: iterations,
          iterationsCompleted: i,
          failedAt,
          failureBundleDir,
          failureBundleDirs,
          results,
        };
      }
      // stopOnFailure=false: keep going; failures/bundles already recorded.
    }
  }

  return {
    ok: failedAt === undefined,
    iterationsRequested: iterations,
    iterationsCompleted: iterations,
    failedAt,
    failureBundleDir,
    failureBundleDirs: failureBundleDirs.length > 0 ? failureBundleDirs : undefined,
    results,
  };
}
