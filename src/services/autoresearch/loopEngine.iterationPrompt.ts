/**
 * AutoResearch Loop Engine — iteration system prompt builder.
 *
 * Extracted from `loopEngine.iterationPhase.ts` as part of AG-02 PR2b
 * follow-up. Owns the prompt assembly for a single experiment iteration.
 */

import { type SshConfig } from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildShellProfilePromptContext } from '@/utils/windowsShellProfile';
import { describeTarget } from '@/utils/remoteExec';
import { type IterationMetrics } from './metricsStore';
import { type RunDir } from './runDir';
import { buildMultiRoundGuidance } from './iterationPrompt';
import { type AutoResearchEnvironmentSummary } from './preflight';
import { mapExperimentFileToCheckout } from './experimentPathRewrite';
import { formatAutoResearchToolCatalog, getAutoResearchToolProfile } from './toolCatalog';
import { formatAutoResearchToolLanes } from './toolLanes';
import { calculateBudgetReserve } from './loopEngine.iterationAbort';

export interface PromptInput {
  sessionContent: string;
  livingDoc: string;
  sshConfig: SshConfig;
  runDir: RunDir;
  environmentSummary: AutoResearchEnvironmentSummary;
  metricDirection: 'lower' | 'higher';
  metricName: string;
  maxIterations: number;
  iteration: number;
  previousMetrics: IterationMetrics[];
}

export function buildSystemPrompt({
  sessionContent,
  livingDoc,
  sshConfig,
  runDir,
  environmentSummary,
  metricDirection,
  metricName,
  maxIterations,
  iteration,
  previousMetrics,
}: PromptInput): string {
  // AUDIT-016 FIX: Calculate budget reserve dynamically based on maxIterations
  const budgetReserve = calculateBudgetReserve(maxIterations);
  const isLocal = sshConfig.mode === 'local';
  const toolProfile = getAutoResearchToolProfile(sshConfig);
  const allowedTools = formatAutoResearchToolCatalog(sshConfig);
  const toolLanes = formatAutoResearchToolLanes(sshConfig);
  const iterationCodeDir = runDir.codeDir;
  const iterationRunScript = mapExperimentFileToCheckout(
    environmentSummary.runScriptPath,
    environmentSummary.experimentDir,
    iterationCodeDir,
  );
  const iterationNotes = mapExperimentFileToCheckout(
    environmentSummary.notesPath,
    environmentSummary.experimentDir,
    iterationCodeDir,
  );
  const envLine = isLocal
    ? `Executing directly on the local machine. Tool sandbox: ${runDir.iterDir}. Experiment checkout: ${iterationCodeDir}.`
    : `Remote host via SSH — ${describeTarget(sshConfig)}.`;
  const shellProfileContext = isLocal
    ? buildShellProfilePromptContext({
        selection: useSettingsStore.getState().windowsShellProfile,
        workDir: sshConfig.remoteWorkDir,
      })
    : null;
  const toolCfgHint = isLocal
    ? `Use ${toolProfile.commandTool} for target-side commands with cwd="${iterationCodeDir}". Use ${toolProfile.readTool} for file reads, ${toolProfile.createDirectoryTool} for directory creation, and ${toolProfile.writeTool} for file writes.`
    : `Use ${toolProfile.commandTool} for target-side commands with mode="ssh", host="${sshConfig.host}", user="${sshConfig.user}", port=${sshConfig.port}, authMode="${sshConfig.authMode}"${sshConfig.authMode === 'key' ? `, keyPath="${sshConfig.keyPath}"` : ''}, remoteWorkDir="${sshConfig.remoteWorkDir}". Use ${toolProfile.readTool} for file reads. Use ${toolProfile.uploadTool} for remote file creation or replacement. Only set terminal=true when the command needs a PTY or live terminal output. Never ask for credentials.`;
  const inspectionScope = isLocal
    ? 'Read only the minimum files you need, and use only the local experiment tools listed above.'
    : 'Read only the minimum files you need, and use only the SSH experiment tools listed above.';
  const executionRequirement = isLocal
    ? `Run the experiment command through ${toolProfile.commandTool} with cwd set to ${iterationCodeDir}.`
    : `Run the experiment command through ${toolProfile.commandTool}. Use terminal=true only when the command needs a PTY or live terminal output; otherwise keep it false or omitted.`;
  const toolLaneGuard = isLocal
    ? 'Never call ssh_exec, ssh_read_file, or ssh_upload_file in this local run.'
    : 'Never call execute_command, read_file, write_file, or create_directory in this SSH run.';

  return `# AutoResearch Agent

## Role
You are running one autonomous experiment iteration inside Pipi-Shrimp AutoResearch.

## Environment
- Execution target: ${envLine}
- Tool config: ${toolCfgHint}
- Only permitted experiment tools for this run: ${allowedTools}
${shellProfileContext ? `- Active shell profile: ${shellProfileContext.shellProfileLabel}\n- ${shellProfileContext.shellProfileGuidance}` : ''}

## Phase Tool Lanes
${toolLanes}

## Environment Preflight
- Iteration experiment checkout (READ/WRITE HERE): ${iterationCodeDir}
- Original experiment directory (already snapshotted; do not read or write): ${environmentSummary.experimentDir}
- Git repository: ${environmentSummary.repoStatus} (${environmentSummary.dirtyFileCount} dirty files before this iteration)
- Preferred Python command: ${environmentSummary.preferredPythonCommand}
- Recommended run command: ${environmentSummary.recommendedRunCommand}
- Required files already confirmed: ${iterationRunScript}, ${iterationNotes}
- Workspace writable: ${environmentSummary.worktreeWritable ? 'yes' : 'no'}
- GPU telemetry: ${environmentSummary.gpuSummary || 'not checked'}

## Session File
${sessionContent}

## Multi-round strategy
${buildMultiRoundGuidance({
    iteration,
    maxIterations,
    metricName,
    direction: metricDirection,
    previous: previousMetrics,
  })}

## Living AutoResearch Notes
${livingDoc || 'No prior iterations recorded yet.'}

## Iteration Workspace
- Iteration directory: ${runDir.iterDir}
- Iteration code checkout: ${iterationCodeDir}
- Hypothesis file: ${runDir.hypothesisPath}
- Metrics file: ${runDir.metricsPath}
- Diff file: ${runDir.diffPath}

## WORKSPACE CONTRACT
- Your tool working directory is ${runDir.iterDir}. Use relative paths from there whenever possible.
- Per-iteration code lives in: ${iterationCodeDir} (already a clean git checkout)
- Modify run_experiment.py in ${iterationCodeDir} (for example: code/run_experiment.py), NOT in the original experiment dir
- Run the experiment from ${iterationCodeDir} using "${environmentSummary.recommendedRunCommand}". When calling execute_command, set cwd/work_dir to ${iterationCodeDir}.
- Write hypothesis.md and diff.patch into ${runDir.iterDir}/ (one level above code/)
- Write metrics.json to ${runDir.metricsPath}. If your experiment script naturally emits ./metrics.json from ${iterationCodeDir}, the host will also accept that location as a fallback.
- The host will diff ${iterationCodeDir} vs the parent run's baseline to produce diff.patch
- Do NOT touch the original experiment directory directly

## Requirements for this iteration
1. Do exactly one hypothesis/change/run/evaluate cycle.
2. Before making changes, do at most one batched inspection pass. ${inspectionScope}
3. Write a short hypothesis summary to ${runDir.hypothesisPath}.
4. ${executionRequirement}
5. Before finishing, write exactly one valid JSON object to ${runDir.metricsPath} with:
  {"schemaVersion":1,"sessionId":"${runDir.sessionId}","runId":"${runDir.sessionId}","iteration":${runDir.iter},"primaryMetric":"${metricName}","direction":"${metricDirection}","timestamp":"<ISO8601>","generator":"agent","metricName":"${metricName}","metricValue":<number|null>,"status":"IMPROVED|NOT_IMPROVED|FAILED","hypothesis":"<one line>","change":"<short summary>","reasoning":"<brief reasoning>","artifactPaths":["<optional path>"],"failReason":"<optional>","extra":{"<optional>":"<optional>"}}
6. If the metric is missing, the command crashes, or the run times out, still write the JSON object with status FAILED, metricValue null, and a concrete failReason.
7. Also emit a final fallback line as a deprecated backup only if the host cannot read metrics.json:
   EXPERIMENT_RESULT: metric_value=<number_or_null> status=<IMPROVED|NOT_IMPROVED|FAILED> hypothesis="<one line>"
   or
   EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="<reason>" hypothesis="<one line>"
8. Reserve the last ${budgetReserve} tool calls for reading metrics/logs, writing the final result, and cleanup. If you are near that reserve, stop exploring or modifying code and finalize.
9. Run the expensive experiment or training/evaluation command at most once in this iteration. If it fails, read logs or metrics and emit FAILED instead of patching and rerunning.
10. If the change is not improved or the run fails, revert your working tree before finishing.
11. ${toolLaneGuard}
12. Respect the phase tool lanes above. Once you move into PARSE_METRICS or DECIDE_NEXT, do not go back to editing code or rerunning the experiment in the same iteration.
13. Do not repeat dead ends from the living doc unless you have a materially different reason.
14. If you are still exploring after the first inspection pass, stop exploring and either run the experiment or emit a FAILED result with a concrete failReason.
15. Treat GPU thermal state as a safety constraint. If telemetry shows GPU temperature >= 85C, fan speed is unavailable/0 during a GPU-heavy run, or the target appears thermally unsafe, avoid escalating workload and write a FAILED result with failReason="thermal_guard" instead of pushing another run.
16. Do not change GPU fan speed, power limits, persistence mode, or other hardware controls unless the session file explicitly permits hardware control and the command is safe for the target.
`;
}
