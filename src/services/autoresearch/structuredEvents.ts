import type {
  AutoResearchIterationRecord,
  AutoResearchRecoveryAction,
  AutoResearchRunEvent,
  AutoResearchRunPhase,
  AutoResearchRunRecord,
} from './history';

export const AUTORESEARCH_PHASE_ORDER: AutoResearchRunPhase[] = [
  'INIT',
  'READ_CONTEXT',
  'PLAN_HYPOTHESIS',
  'EDIT_CODE',
  'RUN_EXPERIMENT',
  'PARSE_METRICS',
  'REFLECT',
  'DECIDE_NEXT',
  'DONE',
  'FAILED',
];

export type AutoResearchTimelineFilter = 'summary' | 'all' | 'tool_calls' | 'errors' | 'metrics' | 'raw';

export type AutoResearchEventCardKind =
  | 'plan'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'provider_error'
  | 'reflection'
  | 'metrics'
  | 'file_change'
  | 'event';

export interface AutoResearchEvent {
  id: string;
  runId: string;
  iterationId?: string;
  phase?: AutoResearchRunPhase;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  type: string;
  summary: string;
  detail?: unknown;
  rawMessage: string;
  rawPhase: AutoResearchRunEvent['phase'];
  kind: AutoResearchEventCardKind;
  iteration: number | null;
  toolName?: string;
  durationMs?: number | null;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  isRaw?: boolean;
}

export interface AutoResearchPhaseStep {
  phase: AutoResearchRunPhase;
  state: 'completed' | 'current' | 'pending' | 'failed';
}

export interface AutoResearchIterationViewModel {
  id: string;
  iteration: number;
  status: AutoResearchIterationRecord['status'];
  phase: AutoResearchRunPhase;
  narrative: string;
  hypothesis: string | null;
  codeChangesSummary: string | null;
  executionCommand: string | null;
  exitCode: number | null;
  durationMs: number | null;
  parsedMetrics: Record<string, number | string | boolean | null>;
  artifacts: string[];
  reflectionSummary: string | null;
  failureReason: string | null;
  phaseSteps: AutoResearchPhaseStep[];
  recoveryActions: AutoResearchRecoveryAction[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLevel(level: AutoResearchRunEvent['level']): AutoResearchEvent['level'] {
  return level === 'warn' ? 'warning' : level;
}

function truncateText(value: string, maxChars = 220): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function firstMeaningfulLine(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) || value.trim();
}

function readMetadata(event: AutoResearchRunEvent): Record<string, unknown> {
  return isRecord(event.detail)
    ? event.detail
    : isRecord(event.metadata)
      ? event.metadata
      : {};
}

function readNumeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseIterationFromText(value: string): number | null {
  const match = value.match(/iteration\s+#?(\d+)/i) || value.match(/iter(?:ation)?\s*#?(\d+)/i);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1] || '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readIterationNumber(event: AutoResearchRunEvent): number | null {
  const metadata = readMetadata(event);
  const direct = readNumeric(metadata.iteration);
  if (direct !== null) {
    return direct;
  }
  return parseIterationFromText(event.summary || event.message || '');
}

function mapLegacyPhase(event: AutoResearchRunEvent): AutoResearchRunPhase | undefined {
  if (event.phase === 'preflight') {
    const message = `${event.summary || ''} ${event.message}`.toLowerCase();
    if (message.includes('environment') || message.includes('bootstrap') || message.includes('artifacts initialized')) {
      return 'READ_CONTEXT';
    }
    return 'INIT';
  }
  if (event.phase === 'agent_execution') {
    const message = `${event.summary || ''} ${event.message}`.toLowerCase();
    if (message.includes('reflection')) {
      return 'REFLECT';
    }
    if (message.includes('tool') || message.includes('command')) {
      return 'EDIT_CODE';
    }
    return 'PLAN_HYPOTHESIS';
  }
  if (event.phase === 'evaluation') {
    const message = `${event.summary || ''} ${event.message}`.toLowerCase();
    if (message.includes('metric')) {
      return 'PARSE_METRICS';
    }
    return 'RUN_EXPERIMENT';
  }
  if (event.phase === 'rate_limit') {
    return 'RUN_EXPERIMENT';
  }
  if (event.phase === 'reflection_parse_failed') {
    return 'REFLECT';
  }
  if (event.phase === 'system') {
    const message = `${event.summary || ''} ${event.message}`.toLowerCase();
    if (message.includes('completed') || message.includes('max iterations reached')) {
      return 'DONE';
    }
    if (message.includes('failed') || message.includes('error')) {
      return 'FAILED';
    }
    return 'INIT';
  }
  return undefined;
}

function normalizePhase(event: AutoResearchRunEvent): AutoResearchRunPhase | undefined {
  return event.phase === 'INIT'
    || event.phase === 'READ_CONTEXT'
    || event.phase === 'PLAN_HYPOTHESIS'
    || event.phase === 'EDIT_CODE'
    || event.phase === 'RUN_EXPERIMENT'
    || event.phase === 'PARSE_METRICS'
    || event.phase === 'REFLECT'
    || event.phase === 'DECIDE_NEXT'
    || event.phase === 'DONE'
    || event.phase === 'FAILED'
    ? event.phase
    : mapLegacyPhase(event);
}

function summarizeToolArguments(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const command = typeof parsed.command === 'string' ? parsed.command : null;
    const path = typeof parsed.path === 'string' ? parsed.path : null;
    const filePath = typeof parsed.filePath === 'string' ? parsed.filePath : null;
    const target = command || filePath || path;
    if (target) {
      return truncateText(target, 160);
    }
    return truncateText(JSON.stringify(parsed), 160);
  } catch {
    return truncateText(firstMeaningfulLine(input), 160);
  }
}

function classifyLegacyEvent(event: AutoResearchRunEvent): Pick<AutoResearchEvent, 'type' | 'kind' | 'summary' | 'toolName' | 'durationMs' | 'status' | 'isRaw'> {
  const metadata = readMetadata(event);
  const message = event.summary || event.message;
  const lower = message.toLowerCase();

  if (lower.includes('run initialized') || lower.includes('loop started')) {
    return { type: 'run_started', kind: 'event', summary: message, status: 'running' };
  }
  if (lower.includes('run completed') || lower.includes('max iterations reached')) {
    return { type: 'run_completed', kind: 'event', summary: message, status: 'completed' };
  }
  if (lower.includes('iteration') && lower.includes('started')) {
    return { type: 'iteration_started', kind: 'event', summary: message, status: 'running' };
  }
  if (lower.includes('completed with status')) {
    return {
      type: lower.includes('failed') ? 'iteration_failed' : 'iteration_completed',
      kind: lower.includes('failed') ? 'provider_error' : 'event',
      summary: message,
      status: lower.includes('failed') ? 'failed' : 'completed',
    };
  }
  if (lower.includes('reflection decision')) {
    return { type: 'reflection_generated', kind: 'reflection', summary: message };
  }
  if (lower.includes('api request failed') || lower.includes('provider rate limited') || lower.includes('rate limit')) {
    return { type: 'provider_error', kind: 'provider_error', summary: message, status: 'failed' };
  }
  if (lower.includes('metrics') || lower.includes('metric')) {
    return { type: 'metrics_parsed', kind: 'metrics', summary: message };
  }
  if (lower.includes('rollback')) {
    return { type: 'raw', kind: 'event', summary: message, isRaw: true };
  }
  if (lower.includes('tool budget')) {
    return { type: 'raw', kind: 'event', summary: message, isRaw: true };
  }
  if (lower.includes('reflection parse failed')) {
    return { type: 'provider_error', kind: 'provider_error', summary: message, status: 'failed' };
  }

  const command = typeof metadata.command === 'string' ? metadata.command : null;
  if (command) {
    return {
      type: 'experiment_command_started',
      kind: 'tool_call',
      summary: summarizeToolArguments(JSON.stringify({ command })) || message,
      durationMs: readNumeric(metadata.durationMs),
    };
  }

  return { type: 'raw', kind: 'event', summary: message, isRaw: true };
}

function classifyEvent(event: AutoResearchRunEvent): Pick<AutoResearchEvent, 'type' | 'kind' | 'summary' | 'toolName' | 'durationMs' | 'status' | 'isRaw'> {
  const metadata = readMetadata(event);

  if (!event.type) {
    return classifyLegacyEvent(event);
  }

  const summary = event.summary || event.message;
  switch (event.type) {
    case 'agent_plan':
      return { type: event.type, kind: 'plan', summary };
    case 'thinking':
      return { type: event.type, kind: 'thinking', summary, isRaw: true };
    case 'tool_call_started':
      return {
        type: event.type,
        kind: 'tool_call',
        summary: typeof metadata.parameterSummary === 'string'
          ? metadata.parameterSummary
          : summary,
        toolName: typeof metadata.toolName === 'string' ? metadata.toolName : undefined,
      };
    case 'tool_call_completed':
    case 'tool_call_failed':
      return {
        type: event.type,
        kind: 'tool_call',
        summary,
        toolName: typeof metadata.toolName === 'string' ? metadata.toolName : undefined,
        durationMs: readNumeric(metadata.durationMs),
        status: event.type === 'tool_call_failed' ? 'failed' : 'completed',
      };
    case 'tool_result':
      return {
        type: event.type,
        kind: 'tool_result',
        summary,
        toolName: typeof metadata.toolName === 'string' ? metadata.toolName : undefined,
        durationMs: readNumeric(metadata.durationMs),
        isRaw: true,
      };
    case 'provider_error':
      return { type: event.type, kind: 'provider_error', summary, status: 'failed' };
    case 'reflection_generated':
      return { type: event.type, kind: 'reflection', summary };
    case 'metrics_parsed':
      return { type: event.type, kind: 'metrics', summary };
    case 'file_changed':
      return { type: event.type, kind: 'file_change', summary };
    default:
      return {
        type: event.type,
        kind: event.type.includes('tool') ? 'tool_call' : 'event',
        summary,
        durationMs: readNumeric(metadata.durationMs),
        status: event.type.includes('failed') ? 'failed' : undefined,
      };
  }
}

export function buildAutoResearchStructuredEvents(run: AutoResearchRunRecord): AutoResearchEvent[] {
  return [...run.events]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .map((event) => {
      const classification = classifyEvent(event);
      const detail = event.detail ?? event.metadata;
      return {
        id: event.id,
        runId: event.runId,
        iterationId: event.iterationId,
        phase: normalizePhase(event),
        timestamp: event.timestamp,
        level: normalizeLevel(event.level),
        type: classification.type,
        summary: classification.summary,
        detail,
        rawMessage: event.message,
        rawPhase: event.phase,
        kind: classification.kind,
        iteration: readIterationNumber(event),
        toolName: classification.toolName,
        durationMs: classification.durationMs,
        status: classification.status,
        isRaw: classification.isRaw,
      } satisfies AutoResearchEvent;
    });
}

export function matchesTimelineFilter(event: AutoResearchEvent, filter: AutoResearchTimelineFilter): boolean {
  switch (filter) {
    case 'summary':
      return [
        'run_started',
        'run_completed',
        'run_status_changed',
        'iteration_started',
        'iteration_completed',
        'iteration_failed',
        'phase_started',
        'metrics_parsed',
        'reflection_generated',
        'provider_error',
      ].includes(event.type);
    case 'tool_calls':
      return event.kind === 'tool_call' || event.kind === 'tool_result' || event.kind === 'file_change';
    case 'errors':
      return event.level === 'error' || event.level === 'warning' || event.kind === 'provider_error';
    case 'metrics':
      return event.kind === 'metrics';
    case 'raw':
      return Boolean(event.isRaw);
    case 'all':
    default:
      return true;
  }
}

function formatMetricValue(value: number | string | boolean | null | undefined): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (value === null || value === undefined) {
    return 'N/A';
  }
  return String(value);
}

function buildPhaseSteps(currentPhase: AutoResearchRunPhase, status: AutoResearchIterationRecord['status']): AutoResearchPhaseStep[] {
  const terminalPhase = status === 'failed' ? 'FAILED' : status === 'completed' ? 'DONE' : currentPhase;
  const terminalIndex = AUTORESEARCH_PHASE_ORDER.indexOf(terminalPhase);

  return AUTORESEARCH_PHASE_ORDER.map((phase, index) => {
    if (status === 'failed' && phase === 'FAILED') {
      return { phase, state: 'failed' };
    }
    if (index < terminalIndex) {
      return { phase, state: 'completed' };
    }
    if (index === terminalIndex) {
      return { phase, state: status === 'failed' ? 'failed' : 'current' };
    }
    return { phase, state: 'pending' };
  });
}

function derivePhase(iteration: AutoResearchIterationRecord, run: AutoResearchRunRecord): AutoResearchRunPhase {
  if (iteration.phase) {
    return iteration.phase;
  }
  if (iteration.status === 'failed') {
    return 'FAILED';
  }
  if (iteration.status === 'completed') {
    return 'DONE';
  }
  if (run.currentIteration === iteration.index && run.currentPhase) {
    return run.currentPhase;
  }
  return iteration.status === 'pending' ? 'INIT' : 'READ_CONTEXT';
}

function buildNarrative(iteration: AutoResearchIterationRecord, run: AutoResearchRunRecord): string {
  if (iteration.narrative?.trim()) {
    return iteration.narrative.trim();
  }

  const hypothesis = iteration.hypothesis?.trim() || 'No hypothesis recorded.';
  const change = iteration.codeChangesSummary?.trim() || iteration.change?.trim() || 'No code changes summary recorded.';
  const outcome = iteration.status === 'failed'
    ? `Experiment failed${iteration.error ? `: ${iteration.error}` : '.'}`
    : iteration.metricValue !== null && iteration.metricValue !== undefined
      ? `Experiment completed with ${run.config.metric || 'metric'}=${formatMetricValue(iteration.metricValue)}.`
      : 'Experiment finished without a parsed metric.';
  const next = iteration.reflectionSummary?.trim() || iteration.reasoning?.trim() || 'No next-step reflection recorded.';

  return `${hypothesis} Changed: ${change}. ${outcome} Next: ${next}`;
}

function buildParsedMetrics(iteration: AutoResearchIterationRecord, run: AutoResearchRunRecord): Record<string, number | string | boolean | null> {
  const base = iteration.parsedMetrics ? { ...iteration.parsedMetrics } : {};
  if (!(run.config.metric in base)) {
    base[run.config.metric || 'metric'] = iteration.metricValue ?? null;
  }
  if (!('improvement' in base) && (typeof iteration.improvement === 'number' || iteration.improvement === null)) {
    base.improvement = iteration.improvement ?? null;
  }
  if (!('exitCode' in base) && (typeof iteration.exitCode === 'number' || iteration.exitCode === null)) {
    base.exitCode = iteration.exitCode ?? null;
  }
  return base;
}

function buildFallbackRecoveryActions(
  run: AutoResearchRunRecord,
  iteration: AutoResearchIterationRecord,
): AutoResearchRecoveryAction[] {
  const hasLogs = (iteration.artifactPaths ?? []).some((path) => /\.log$/i.test(path)) || Boolean(run.liveOutputExcerpt);

  return [
    {
      type: 'retry_failed_phase',
      supported: false,
      reason: 'Runtime does not expose phase retry yet.',
    },
    {
      type: 'retry_iteration',
      supported: false,
      reason: 'Runtime does not expose iteration retry yet.',
    },
    {
      type: 'switch_provider',
      supported: false,
      reason: 'Provider switching is not available from the run detail view.',
    },
    {
      type: 'open_raw_request_summary',
      supported: true,
      label: 'Open raw request summary',
    },
    {
      type: 'open_logs',
      supported: hasLogs,
      label: 'Open logs',
      reason: hasLogs ? undefined : 'No log artifact or live output is available for this iteration.',
    },
  ];
}

export function buildAutoResearchIterationViewModels(run: AutoResearchRunRecord): AutoResearchIterationViewModel[] {
  return [...run.iterations]
    .sort((left, right) => left.index - right.index)
    .map((iteration) => {
      const phase = derivePhase(iteration, run);
      return {
        id: iteration.id,
        iteration: iteration.index,
        status: iteration.status,
        phase,
        narrative: buildNarrative(iteration, run),
        hypothesis: iteration.hypothesis?.trim() || null,
        codeChangesSummary: iteration.codeChangesSummary?.trim() || iteration.change?.trim() || null,
        executionCommand: iteration.executionCommand?.trim() || null,
        exitCode: typeof iteration.exitCode === 'number' || iteration.exitCode === null ? iteration.exitCode ?? null : null,
        durationMs: typeof iteration.durationMs === 'number' || iteration.durationMs === null ? iteration.durationMs ?? null : null,
        parsedMetrics: buildParsedMetrics(iteration, run),
        artifacts: [...new Set(iteration.artifactPaths ?? [])],
        reflectionSummary: iteration.reflectionSummary?.trim() || iteration.reasoning?.trim() || null,
        failureReason: iteration.error?.trim() || null,
        phaseSteps: buildPhaseSteps(phase, iteration.status),
        recoveryActions: (iteration.recoveryActions?.length ? iteration.recoveryActions : buildFallbackRecoveryActions(run, iteration))
          .filter((action) => action.supported),
      } satisfies AutoResearchIterationViewModel;
    });
}

export function formatDurationMs(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 'N/A';
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  const seconds = Math.floor(value / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export function formatElapsedTime(run: AutoResearchRunRecord): string {
  const started = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const ended = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  if (started === null || Number.isNaN(started) || Number.isNaN(ended)) {
    return 'N/A';
  }
  return formatDurationMs(Math.max(0, ended - started));
}
