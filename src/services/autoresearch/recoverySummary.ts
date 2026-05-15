import type {
  AutoResearchIterationRecord,
  AutoResearchRecoveryAction,
  AutoResearchRunRecord,
} from './history';

export interface AutoResearchRecoverySummary {
  tone: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  hint?: string;
  actions: AutoResearchRecoveryAction[];
  iteration?: number;
  mode: 'inspect_only' | 'cooldown' | 'manual_ack' | 'failed';
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function dedupeRecoveryActions(actions: AutoResearchRecoveryAction[] | undefined): AutoResearchRecoveryAction[] {
  if (!actions || actions.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.type}:${action.label || ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getLatestRecoveryIteration(run: AutoResearchRunRecord): AutoResearchIterationRecord | null {
  for (let index = run.iterations.length - 1; index >= 0; index -= 1) {
    const iteration = run.iterations[index];
    if (!iteration) {
      continue;
    }
    if ((iteration.recoveryActions?.length ?? 0) > 0 || safeString(iteration.error) || iteration.status === 'failed') {
      return iteration;
    }
  }
  return null;
}

function getDefaultMessage(run: AutoResearchRunRecord, latestIteration: AutoResearchIterationRecord | null): string | null {
  return safeString(run.reason)
    ?? safeString(run.summary)
    ?? safeString(latestIteration?.error)
    ?? safeString(latestIteration?.reflectionSummary)
    ?? safeString(latestIteration?.narrative);
}

export function buildAutoResearchRecoverySummary(run: AutoResearchRunRecord): AutoResearchRecoverySummary | null {
  const latestIteration = getLatestRecoveryIteration(run);
  const actions = dedupeRecoveryActions(latestIteration?.recoveryActions);
  const defaultMessage = getDefaultMessage(run, latestIteration);

  if (run.status === 'waiting_rate_limit') {
    return {
      tone: 'warn',
      title: 'Provider cooldown active',
      message: defaultMessage
        ?? 'Provider rate limited the run and AutoResearch is cooling down before retrying the same iteration.',
      hint: `Iteration ${latestIteration?.index ?? run.currentIteration || 1} will be retried automatically after cooldown unless you stop the run.`,
      actions,
      iteration: latestIteration?.index ?? run.currentIteration,
      mode: 'cooldown',
    };
  }

  if (run.status === 'reflection_failed') {
    return {
      tone: 'error',
      title: 'Recovery acknowledgement required',
      message: defaultMessage ?? 'Reflection did not produce a safe continuation decision.',
      hint: 'Inspect the failed iteration and artifacts before starting a new run. AutoResearch keeps this run locked until you acknowledge the recovery boundary.',
      actions,
      iteration: latestIteration?.index ?? run.currentIteration,
      mode: 'manual_ack',
    };
  }

  if (run.status === 'interrupted') {
    const resumeHint = run.resumeToken?.resumable
      ? 'Use Resume Run to replay the pending iteration from the saved workspace.'
      : 'Execution will not auto-resume; start a new run to continue from the saved workspace.';

    return {
      tone: 'warn',
      title: 'Inspect-only recovery snapshot',
      message: defaultMessage ?? 'Run interrupted after app restart.',
      hint: `Iterations, artifacts, and the live output excerpt were restored for inspection. ${resumeHint}`,
      actions,
      iteration: latestIteration?.index ?? run.currentIteration,
      mode: 'inspect_only',
    };
  }

  if (run.status === 'failed' && (defaultMessage || actions.length > 0)) {
    return {
      tone: 'error',
      title: 'Recovery context available',
      message: defaultMessage ?? 'The run stopped after a failed iteration.',
      hint: 'Inspect the failed iteration before retrying with a new run.',
      actions,
      iteration: latestIteration?.index ?? run.currentIteration,
      mode: 'failed',
    };
  }

  return null;
}

export default buildAutoResearchRecoverySummary;