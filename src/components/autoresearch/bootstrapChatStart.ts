import { AUTORESEARCH_BOOTSTRAP_TEMPLATE } from '@/services/agents/templates/autoresearchBootstrap';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import { useBootstrapPlanStore } from '@/services/autoresearch/bootstrap/bootstrapPlanStore';
import {
  BOOTSTRAP_FINALIZE_NUDGE_ALLOWED_TOOLS,
  buildBootstrapFinalizeNudgeUserMessage,
  buildBootstrapSystemPromptWithFinalizeRequirement,
  shouldRunBootstrapFinalizeNudge,
} from '@/services/autoresearch/bootstrap/finalizeNudge';
import {
  HOST_SYNTHESIZED_BOOTSTRAP_FINALIZE_WARNING,
  synthesizeBootstrapFinalizeFromRecipe,
} from '@/services/autoresearch/bootstrap/synthesizeFinalize';
import { AutoResearchBootstrapResultSchema } from '@/services/autoresearch/bootstrap/schema';
import type { AutoResearchBootstrapResult } from '@/services/autoresearch/bootstrap/types';
import type { ConversationalTemplateOption } from '@/services/autoresearch/bootstrap/conversationalTemplates';
import type { SshConfig } from '@/store/autoresearchStore';
import { BOOTSTRAP_MISSING_FINALIZE_MESSAGE } from './bootstrapChatHelpers';
import type { Recipe } from './bootstrapRecipePrompt';

export interface BootstrapChatStartHost {
  isStreaming: boolean;
  recipe: Recipe;
  sshConfig?: SshConfig;
  importedFiles: Array<{ name: string; path: string }>;
  setReadyResult: (result: AutoResearchBootstrapResult | null) => void;
  lastCompiledPromptRef: { current: string | null };
  setError: (error: string | null) => void;
  setMissingFinalize: (missing: boolean) => void;
  setStoppedByUser: (stopped: boolean) => void;
  setHandoffSummary: (summary: string | null) => void;
  bootstrappedAtRef: { current: string | null };
  setHasStarted: (started: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  setAgentLogs: (updater: string | ((prev: string) => string)) => void;
  bootstrapAbortRef: { current: AbortController | null };
  noteTool: (name: string) => void;
  setWarnings: (warnings: string[]) => void;
  handleToolResult?: (name: string, result: string) => Promise<void> | void;
  markMetricsStep?: () => void;
}

export function applyQuickStartTemplateToRecipe(
  prev: Recipe,
  templateId: ConversationalTemplateOption['id'],
): Recipe {
  let taskType: Recipe['researchGoal']['taskType'] = 'reproduce_paper';
  let goalText = '';
  let folderName = 'bootstrap-project';
  let verifyCommands: string[] = ['pytest'];
  let baselineValue = '0.85';
  let successCriteria = 'Match or exceed the target baseline metric.';

  if (templateId === 'reproduce-paper') {
    taskType = 'reproduce_paper';
    goalText = 'I want to fully reproduce a paper. Please help me identify the paper claims, lock baselines, target primary metric, and construct scaffold files.';
    folderName = 'reproduce-project';
  } else if (templateId === 'beat-baseline') {
    taskType = 'beat_baseline';
    goalText = 'I want to exceed an existing baseline on a known task. Please propose improvements, keep evaluations fair, and setup experiment workspace.';
    folderName = 'baseline-project';
  } else if (templateId === 'ablation') {
    taskType = 'ablation';
    goalText = 'I want to conduct ablation studies on an existing model or method. Please help me isolate ablation parameters, verify metrics, and bootstrap scaffolding.';
    folderName = 'ablation-project';
    baselineValue = '';
    successCriteria = '';
  } else if (templateId === 'from-scratch') {
    taskType = 'from_scratch';
    goalText = 'I want to start a brand new AutoResearch project from scratch. Please propose a concrete research objective and scaffold the project workspace.';
    folderName = 'scratch-project';
    baselineValue = '';
    successCriteria = '';
  }

  return {
    ...prev,
    researchGoal: {
      taskType,
      goalText,
      source: 'template',
    },
    workspace: {
      ...prev.workspace,
      folderName,
    },
    verification: {
      commands: verifyCommands,
    },
    baselineAndMetric: {
      ...prev.baselineAndMetric,
      baselineValue,
      successCriteria,
    },
  };
}

async function defaultHandleToolResult(
  name: string,
  result: string,
  host: Pick<BootstrapChatStartHost, 'markMetricsStep' | 'setWarnings' | 'setReadyResult'>,
) {
  if (name === 'baseline_extract') {
    host.markMetricsStep?.();
    return;
  }

  if (name !== 'bootstrap_finalize') {
    return;
  }

  try {
    const parsed = AutoResearchBootstrapResultSchema.safeParse(JSON.parse(result));
    if (!parsed.success) {
      return;
    }
    host.setWarnings(parsed.data.warnings);
    host.setReadyResult(parsed.data);
  } catch {
    // Ignore malformed tool content and let the agent continue.
  }
}

export async function runBootstrapStart(
  compiledPrompt: string,
  host: BootstrapChatStartHost,
): Promise<void> {
  const {
    isStreaming,
    recipe,
    sshConfig,
    importedFiles,
    setReadyResult,
    lastCompiledPromptRef,
    setError,
    setMissingFinalize,
    setStoppedByUser,
    setHandoffSummary,
    bootstrappedAtRef,
    setHasStarted,
    setIsStreaming,
    setAgentLogs,
    bootstrapAbortRef,
    noteTool,
    setWarnings,
  } = host;

  if (isStreaming) {
    return;
  }

  useBootstrapPlanStore.getState().reset();
  setReadyResult(null);
  lastCompiledPromptRef.current = compiledPrompt;
  setError(null);
  setMissingFinalize(false);
  setStoppedByUser(false);
  setHandoffSummary(null);
  bootstrappedAtRef.current = null;
  setHasStarted(true);
  setIsStreaming(true);
  setAgentLogs(`[SYSTEM] Initializing AutoResearch Bootstrap Setup...\n`);

  bootstrapAbortRef.current = new AbortController();

  const workingFilesList = importedFiles.length > 0
    ? importedFiles.map((file) => `- ${file.name}: ${file.path}`).join('\n')
    : '';

  const contextFilesSection = workingFilesList
    ? `\n\n## Context Files / Literature & Reference Documents\n\nThe user has attached the following files as references:\n${workingFilesList}\n\nRules:\n- Use these files as references for the research target, code design, baseline, or paper details.\n- Read a file by its exact path using 'pdf_read' (for PDFs) or 'read_file' (for code/text files) before discussing its contents. Do not assume you know its contents. Do not invent details.`
    : '';

  const systemPrompt = buildBootstrapSystemPromptWithFinalizeRequirement(
    [
      AUTORESEARCH_BOOTSTRAP_TEMPLATE.soulPrompt,
      AUTORESEARCH_BOOTSTRAP_TEMPLATE.taskInstruction,
    ].filter(Boolean).join('\n\n') + contextFilesSection,
  );

  const initialMessages = [
    {
      role: 'user' as const,
      content: compiledPrompt,
    },
  ];

  const bootstrapWorkDir = recipe.workspace.workDir.trim()
    || sshConfig?.remoteWorkDir?.trim()
    || '/tmp';

  const runBootstrapTurn = async (
    messages: typeof initialMessages,
    label: string,
    allowedTools: string[] = AUTORESEARCH_BOOTSTRAP_TEMPLATE.allowedTools ?? [],
  ) => {
    setAgentLogs((prev) => prev + `[SYSTEM] ${label}\n\n`);
    await runHeadlessAgentTurn({
      sessionId: `autoresearch-bootstrap-${Date.now()}`,
      initialMessages: messages,
      systemPrompt,
      workDir: bootstrapWorkDir,
      allowedTools,
      toolExecutionSource: 'autoresearch_phase',
      permissionMode: 'bypass',
      executionMode: 'bypass',
      maxToolRounds: AUTORESEARCH_BOOTSTRAP_TEMPLATE.execution?.maxRounds,
      signal: bootstrapAbortRef.current!.signal,
      onTextDelta: (chunk) => {
        setAgentLogs((prev) => prev + chunk);
      },
      onStatus: (message) => {
        setAgentLogs((prev) => prev + `\n[STATUS] ${message}\n`);
      },
      onToolCall: async ({ name }) => {
        setAgentLogs((prev) => prev + `\n[TOOL CALL] Executing: ${name}\n`);
        noteTool(name);
      },
      onToolResult: async ({ name, result, durationMs }) => {
        setAgentLogs((prev) => prev + `[TOOL RESULT] Completed ${name} in ${durationMs}ms.\n`);
        if (host.handleToolResult) {
          await host.handleToolResult(name, result);
        } else {
          await defaultHandleToolResult(name, result, host);
        }
      },
    });
  };

  try {
    await runBootstrapTurn(
      initialMessages,
      'Spawning Headless Research Agent with custom prompt blocks...',
    );
    if (bootstrapAbortRef.current.signal.aborted) {
      return;
    }

    let ready = useBootstrapPlanStore.getState().readyResult;
    // Prefer a deterministic host finalize over a second LLM turn.
    // Oral "Ready" without bootstrap_finalize is a failure; synthesizing
    // from the recipe produces a real readyResult. Keep the nudge only
    // when the recipe has no usable workDir.
    if (shouldRunBootstrapFinalizeNudge(ready)) {
      const synthesized = synthesizeBootstrapFinalizeFromRecipe(
        recipe,
        recipe.workspace.workDir.trim() || sshConfig?.remoteWorkDir,
      );
      if (synthesized?.status === 'ready') {
        setWarnings(synthesized.warnings);
        setReadyResult(synthesized);
        noteTool('bootstrap_finalize');
        setAgentLogs(
          (prev) =>
            prev
            + `\n[SYSTEM] ${HOST_SYNTHESIZED_BOOTSTRAP_FINALIZE_WARNING}\n`,
        );
        ready = synthesized;
      } else {
        setAgentLogs(
          (prev) =>
            prev
            + '\n[SYSTEM] bootstrap_finalize missing after first turn — running finalize nudge turn...\n',
        );
        await runBootstrapTurn(
          [{ role: 'user', content: buildBootstrapFinalizeNudgeUserMessage(bootstrapWorkDir) }],
          'Finalize-nudge headless turn (must call bootstrap_finalize)...',
          [...BOOTSTRAP_FINALIZE_NUDGE_ALLOWED_TOOLS],
        );
        if (bootstrapAbortRef.current.signal.aborted) {
          return;
        }
        ready = useBootstrapPlanStore.getState().readyResult;
      }
    }

    if (shouldRunBootstrapFinalizeNudge(ready)) {
      const warnMsg = BOOTSTRAP_MISSING_FINALIZE_MESSAGE;
      setMissingFinalize(true);
      setError(
        `${warnMsg} Use “Retry bootstrap” to run again with the same recipe, `
        + 'or “Back to Recipe” to adjust goals/workspace, then start again.',
      );
      setAgentLogs(
        (prev) =>
          prev
          + `\n[WARNING] ${warnMsg}\n`
          + '[RECOVERY] Next steps: Retry bootstrap (same prompt) or Back to Recipe to edit setup.\n',
      );
    } else {
      setMissingFinalize(false);
      setAgentLogs((prev) => prev + `\n[SYSTEM] Headless Research Agent completed successfully.\n`);
    }
  } catch (runnerError) {
    if (bootstrapAbortRef.current?.signal.aborted) {
      return;
    }
    const errMsg = runnerError instanceof Error ? runnerError.message : String(runnerError);
    setMissingFinalize(false);
    setError(errMsg);
    setAgentLogs((prev) => prev + `\n[ERROR] Bootstrap execution error: ${errMsg}\n`);
  } finally {
    setIsStreaming(false);
  }
}
