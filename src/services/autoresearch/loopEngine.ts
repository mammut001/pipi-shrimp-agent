/**
 * AutoResearch Loop Engine — Autonomous experiment cycle state machine.
 *
 * Drives iterative experiments by:
 * 1. Building a system prompt from session.md + experiment history
 * 2. Sending it through the existing QueryEngine (runChatTurn)
 * 3. Parsing the Agent's actions (tool calls for ssh_exec, etc.)
 * 4. Logging results and deciding whether to continue
 *
 * The loop does NOT directly execute SSH commands — it delegates to the
 * Agent which uses the registered ssh_exec / ssh_upload_file / ssh_read_file
 * tools through the normal tool_call pipeline.
 */

import { invoke } from '@tauri-apps/api/core';
import { useAutoResearchStore, type ExperimentEntry, type SshConfig } from '@/store/autoresearchStore';
import { logExperiment } from './expLogger';
import { rollback, isRemoteClean } from './rollback';
import { createNotifier } from './notifier';

// ============== System prompt builder ==============

function buildSystemPrompt(
  sessionContent: string,
  experimentHistory: ExperimentEntry[],
  sshConfig: SshConfig,
): string {
  const recentHistory = experimentHistory.slice(-5);
  const historyBlock = recentHistory.length > 0
    ? recentHistory.map(e =>
        `- Exp #${e.iteration}: ${e.hypothesis} → ${e.status}${e.metricValue !== null ? ` (${e.metricValue})` : ''}${e.failReason ? ` [${e.failReason}]` : ''}`
      ).join('\n')
    : 'No experiments run yet.';

  return `# AutoResearch Agent — System Prompt

## Role
You are an autonomous machine learning research agent running inside Pipi-Shrimp Agent.
Your job is to run a fully automated experiment loop on a remote VPS via SSH, guided by the user's research session file.
You operate without human intervention between iterations. You think step-by-step, act through tools, and maintain a rigorous experiment log.

## Environment
- **Local machine**: macOS (Pipi-Shrimp Agent client)
- **Remote machine**: VPS accessible via SSH
- **SSH Config**: host=${sshConfig.host}, user=${sshConfig.user}, keyPath=${sshConfig.keyPath}, port=${sshConfig.port}, remoteWorkDir=${sshConfig.remoteWorkDir}
- **Available tools**: ssh_exec, ssh_upload_file, ssh_read_file, file_write, file_read, Bash

## Session File Content
${sessionContent}

## Recent Experiment History (last 5)
${historyBlock}

## Instructions for THIS Iteration

Execute exactly ONE experiment cycle:

### Step 1 — Read Context
Read the current training code from VPS: use ssh_read_file to read the main training script.
Identify the current best metric from the history above.

### Step 2 — Generate Hypothesis
Based on the session goal, current code, and past results, generate ONE concrete hypothesis.
Write your reasoning clearly: what you observed, what you're changing, why you expect improvement.
Do NOT repeat failed experiments unless you have a new reason.

### Step 3 — Apply Code Change
Generate the modified file content. Use ssh_upload_file or ssh_exec to apply the change.
Before uploading, verify the baseline is clean with: ssh_exec("git status --porcelain")
After uploading, verify the diff with: ssh_exec("git diff")

### Step 4 — Run Experiment
Execute the training script. Use ssh_exec with the training command from the session file.
Wrap with timeout to prevent hanging.

### Step 5 — Parse Result
Read the training output. Extract the evaluation metric.
Report the result clearly in this format:
EXPERIMENT_RESULT: metric_value=<number> status=<IMPROVED|NOT_IMPROVED|FAILED> hypothesis="<one line>"

If the experiment failed (crash, NaN, timeout), report:
EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="<reason>" hypothesis="<one line>"

### Step 6 — Commit or Rollback
If improved: git add -A && git commit
If not improved or failed: git checkout -- . && git clean -fd

## Hard Rules
- Never modify dataset loading or tokenizer unless session file permits it
- Never exceed the max training time from session file
- Always revert failed experiments before finishing
- Be concise in tool calls, detailed in reasoning
`;
}

// ============== Result parser ==============

interface ParsedResult {
  metricValue: number | null;
  status: 'IMPROVED' | 'NOT_IMPROVED' | 'FAILED';
  hypothesis: string;
  failReason?: string;
}

/**
 * Parse the EXPERIMENT_RESULT line from the Agent's output.
 */
function parseExperimentResult(agentOutput: string): ParsedResult | null {
  const match = agentOutput.match(
    /EXPERIMENT_RESULT:\s*metric_value=(\S+)\s+status=(\S+)(?:\s+fail_reason="([^"]*)")?\s+hypothesis="([^"]*)"/
  );
  if (!match) return null;

  const rawMetric = match[1];
  const metricValue = rawMetric === 'null' ? null : parseFloat(rawMetric);
  const status = match[2] as ParsedResult['status'];
  const failReason = match[3] || undefined;
  const hypothesis = match[4];

  return { metricValue, status, hypothesis, failReason };
}

// ============== Loop controller ==============

/**
 * Start the autonomous experiment loop.
 *
 * This is the main entry point — call from the UI or store action.
 * It runs until stopped, max iterations reached, or 3 consecutive failures.
 *
 * @param sendMessage - Function to send a message through the chat system
 *                      (typically chatStore.sendMessage or a wrapper that
 *                       feeds into QueryEngine).
 */
export async function startExperimentLoop(
  sendMessage: (systemPrompt: string, userMessage: string) => Promise<string>,
): Promise<void> {
  const store = useAutoResearchStore.getState();

  if (!store.sshConfig) {
    useAutoResearchStore.getState().setError('SSH config not set');
    return;
  }

  const notifier = createNotifier(store.telegramConfig);

  // Read session file
  let sessionContent: string;
  try {
    const result = await invoke<{ stdout?: string; exit_code?: number }>('execute_bash', {
      command: `cat ${store.sessionFilePath.replace('~', '$HOME')}`,
      timeoutSecs: 10,
    });
    if ((result.exit_code ?? 0) !== 0 || !result.stdout) {
      useAutoResearchStore.getState().setError(
        `Cannot read session file at ${store.sessionFilePath}. Please create it first.`
      );
      return;
    }
    sessionContent = result.stdout;
  } catch (e) {
    useAutoResearchStore.getState().setError(`Failed to read session file: ${e}`);
    return;
  }

  // Verify remote is clean before starting
  try {
    const clean = await isRemoteClean(store.sshConfig);
    if (!clean) {
      // Auto-rollback to start fresh
      await rollback(store.sshConfig);
    }
  } catch (e) {
    useAutoResearchStore.getState().setError(`Cannot connect to VPS: ${e}`);
    return;
  }

  // ---- Main loop ----
  while (true) {
    const state = useAutoResearchStore.getState();

    // Check stop conditions
    if (state.loopState === 'stopped' || state.loopState === 'error') break;
    if (state.currentIteration >= state.maxIterations) {
      await notifier.onLoopStopped('Max iterations reached', state);
      useAutoResearchStore.getState().setLoopState('stopped');
      break;
    }
    if (state.consecutiveFailures >= 3) {
      await notifier.onLoopStopped('3 consecutive failures', state);
      useAutoResearchStore.getState().setLoopState('stopped');
      break;
    }

    // Handle pause — spin until resumed or stopped
    if (state.loopState === 'paused') {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // Increment iteration
    useAutoResearchStore.getState().incrementIteration();
    const iteration = useAutoResearchStore.getState().currentIteration;
    const startTime = Date.now();

    useAutoResearchStore.getState().setLiveOutput('');

    // Build prompt for this iteration
    const systemPrompt = buildSystemPrompt(
      sessionContent,
      useAutoResearchStore.getState().experiments,
      store.sshConfig,
    );

    const userMessage = `Run experiment iteration #${iteration}. Follow the instructions exactly.`;

    // Execute one iteration through the Agent
    let agentOutput: string;
    try {
      agentOutput = await sendMessage(systemPrompt, userMessage);
    } catch (e) {
      // Agent execution failed
      const entry: ExperimentEntry = {
        iteration,
        hypothesis: 'Agent execution error',
        change: 'N/A',
        metricValue: null,
        status: 'FAILED',
        failReason: String(e),
        reasoning: 'The Agent failed to complete the iteration.',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
      useAutoResearchStore.getState().addExperiment(entry);
      useAutoResearchStore.getState().incrementConsecutiveFailures();
      await logExperiment(entry, useAutoResearchStore.getState());
      await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
      continue;
    }

    // Parse the result from Agent output
    const parsed = parseExperimentResult(agentOutput);
    if (!parsed) {
      // Could not parse — treat as failed
      const entry: ExperimentEntry = {
        iteration,
        hypothesis: 'Unparseable result',
        change: 'See agent output',
        metricValue: null,
        status: 'FAILED',
        failReason: 'Could not parse EXPERIMENT_RESULT from agent output',
        reasoning: agentOutput.slice(-500),
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
      useAutoResearchStore.getState().addExperiment(entry);
      useAutoResearchStore.getState().incrementConsecutiveFailures();

      // Ensure rollback
      try { await rollback(store.sshConfig); } catch { /* best effort */ }

      await logExperiment(entry, useAutoResearchStore.getState());
      await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
      continue;
    }

    // Build experiment entry
    const entry: ExperimentEntry = {
      iteration,
      hypothesis: parsed.hypothesis,
      change: 'Applied via Agent tool calls',
      metricValue: parsed.metricValue,
      status: parsed.status,
      failReason: parsed.failReason,
      reasoning: '',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    useAutoResearchStore.getState().addExperiment(entry);

    if (parsed.status === 'IMPROVED' && parsed.metricValue !== null) {
      useAutoResearchStore.getState().updateBestMetric(parsed.metricValue);
      useAutoResearchStore.getState().resetConsecutiveFailures();
    } else if (parsed.status === 'FAILED') {
      useAutoResearchStore.getState().incrementConsecutiveFailures();
    } else {
      // NOT_IMPROVED resets consecutive failure counter (it's not a crash)
      useAutoResearchStore.getState().resetConsecutiveFailures();
    }

    // Log
    await logExperiment(entry, useAutoResearchStore.getState());

    // Notify
    await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());

    // Trend report every N iterations
    const trendInterval = useAutoResearchStore.getState().telegramConfig.trendReportInterval;
    if (iteration % trendInterval === 0) {
      const experiments = useAutoResearchStore.getState().experiments;
      const recent = experiments.slice(-trendInterval);
      const improved = recent.filter(e => e.status === 'IMPROVED').length;
      const failed = recent.filter(e => e.status === 'FAILED').length;
      const report = [
        `最近 ${trendInterval} 轮: ${improved} improved, ${failed} failed, ${trendInterval - improved - failed} not improved`,
        `当前最佳: ${useAutoResearchStore.getState().bestMetric ?? 'N/A'}`,
      ].join('\n');
      await notifier.onTrendReport(report, useAutoResearchStore.getState());
    }

    // Print one-line summary to live output
    const icon = parsed.status === 'IMPROVED' ? '✅' : parsed.status === 'FAILED' ? '❌' : '➖';
    const summary = `[Exp ${iteration}] ${parsed.hypothesis} → ${parsed.status} ${icon} (${parsed.metricValue ?? 'N/A'})`;
    useAutoResearchStore.getState().appendLiveOutput(summary + '\n');
  }
}

/**
 * Stop the experiment loop gracefully.
 * The loop will finish the current iteration and then exit.
 */
export function stopExperimentLoop(): void {
  useAutoResearchStore.getState().setLoopState('stopped');
}

/**
 * Pause the experiment loop. Resume with resumeExperimentLoop().
 */
export function pauseExperimentLoop(): void {
  useAutoResearchStore.getState().setLoopState('paused');
}

/**
 * Resume a paused experiment loop.
 */
export function resumeExperimentLoop(): void {
  const state = useAutoResearchStore.getState();
  if (state.loopState === 'paused') {
    useAutoResearchStore.getState().setLoopState('running');
  }
}
