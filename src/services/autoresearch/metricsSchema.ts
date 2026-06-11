import { z } from 'zod';

export type MetricsDirection = 'lower' | 'higher';
export type MetricsGenerator = 'agent' | 'loop_engine' | 'bootstrap';

export interface IterationMetrics {
  schemaVersion?: 1;
  runId?: string;
  primaryMetric?: string;
  direction?: MetricsDirection;
  timestamp?: string;
  generator?: MetricsGenerator;
  iteration: number;
  sessionId: string;
  metricName: string;
  metricValue: number | null;
  status: 'IMPROVED' | 'NOT_IMPROVED' | 'FAILED';
  failReason?: string;
  hypothesis: string;
  change?: string;
  reasoning?: string;
  artifactPaths?: string[];
  commitHash?: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  extra?: Record<string, number | string | boolean>;
  reflection?: {
    parserPath?: string | null;
    retryCount?: number;
    reason?: string;
  };
}

export interface MetricsArtifactPayload {
  schemaVersion?: 1;
  sessionId?: string;
  runId?: string;
  iteration?: number;
  primaryMetric?: string;
  direction?: MetricsDirection;
  timestamp?: string;
  generator?: MetricsGenerator;
  metricName: string;
  metricValue: number | null;
  status: 'IMPROVED' | 'NOT_IMPROVED' | 'FAILED';
  failReason?: string;
  hypothesis: string;
  change?: string;
  reasoning?: string;
  artifactPaths?: string[];
  extra?: Record<string, number | string | boolean>;
}

interface ParseMetricsArtifactOptions {
  expectedSessionId?: string;
  expectedRunId?: string;
  expectedIteration?: number;
  expectedMetricName?: string;
  expectedDirection?: MetricsDirection;
}

interface NormalizeMetricsRecordOptions {
  sessionId: string;
  direction: MetricsDirection;
  generator?: Exclude<MetricsGenerator, 'agent'>;
}

const StatusSchema = z.enum(['IMPROVED', 'NOT_IMPROVED', 'FAILED']);
const DirectionSchema = z.enum(['lower', 'higher']);
const GeneratorSchema = z.enum(['agent', 'loop_engine', 'bootstrap']);
const MetricsExtraValueSchema = z.union([z.number().finite(), z.string(), z.boolean()]);

const MetricsArtifactBaseObjectSchema = z.object({
  metricName: z.string().min(1),
  metricValue: z.number().finite().nullable(),
  status: StatusSchema,
  failReason: z.string().min(1).optional(),
  hypothesis: z.string().min(1),
  change: z.string().min(1).optional(),
  reasoning: z.string().min(1).optional(),
  artifactPaths: z.array(z.string().min(1)).optional(),
  extra: z.record(MetricsExtraValueSchema).optional(),
}).strict();

function validateBaseMetricsArtifact(
  value: z.infer<typeof MetricsArtifactBaseObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (value.status === 'FAILED' && !value.failReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failReason'],
      message: 'FAILED metrics artifacts must include a failReason.',
    });
  }

  if (value.status !== 'FAILED' && value.metricValue === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['metricValue'],
      message: 'metricValue may be null only when status is FAILED with a failReason.',
    });
  }
}

const MetricsArtifactBaseSchema = MetricsArtifactBaseObjectSchema.superRefine(validateBaseMetricsArtifact);

const AgentMetricsArtifactObjectSchema = MetricsArtifactBaseObjectSchema.extend({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  iteration: z.number().int().positive(),
  primaryMetric: z.string().min(1),
  direction: DirectionSchema,
  timestamp: z.string().datetime(),
  generator: z.literal('agent'),
}).strict();

type MetricsRunIdentity = {
  runId: string;
  sessionId: string;
  primaryMetric: string;
  metricName: string;
};

function validateMetricsRunIdentity(value: MetricsRunIdentity, ctx: z.RefinementCtx): void {
  if (value.runId !== value.sessionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runId'],
      message: 'Current AutoResearch uses sessionId as runId; runId must match sessionId for metrics artifacts.',
    });
  }
  if (value.primaryMetric !== value.metricName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryMetric'],
      message: 'primaryMetric must match metricName.',
    });
  }
}

function validateAgentMetricsArtifact(
  value: z.infer<typeof AgentMetricsArtifactObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  validateMetricsRunIdentity(value, ctx);
}

const AgentMetricsArtifactSchema = AgentMetricsArtifactObjectSchema
  .superRefine(validateBaseMetricsArtifact)
  .superRefine(validateAgentMetricsArtifact);

const PersistedIterationMetricsObjectSchema = MetricsArtifactBaseObjectSchema.extend({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  iteration: z.number().int().positive(),
  primaryMetric: z.string().min(1),
  direction: DirectionSchema,
  timestamp: z.string().datetime(),
  generator: z.enum(['loop_engine', 'bootstrap']),
  durationMs: z.number().nonnegative(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  commitHash: z.string().min(1).optional(),
  reflection: z.object({
    parserPath: z.string().min(1).nullable().optional(),
    retryCount: z.number().int().nonnegative().optional(),
    reason: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();

const PersistedIterationMetricsSchema = PersistedIterationMetricsObjectSchema
  .superRefine(validateBaseMetricsArtifact)
  .superRefine(validateMetricsRunIdentity)
  .superRefine((value, ctx) => {
  if (value.timestamp !== value.finishedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['timestamp'],
      message: 'timestamp must match finishedAt for persisted metrics records.',
    });
  }
});

const LegacyPersistedIterationMetricsSchema = MetricsArtifactBaseObjectSchema.extend({
  iteration: z.number().int().positive(),
  sessionId: z.string().min(1),
  commitHash: z.string().min(1).optional(),
  durationMs: z.number().nonnegative(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  reflection: z.object({
    parserPath: z.string().min(1).nullable().optional(),
    retryCount: z.number().int().nonnegative().optional(),
    reason: z.string().min(1).optional(),
  }).strict().optional(),
}).strict().superRefine(validateBaseMetricsArtifact);

function formatSchemaError(prefix: string, error: z.ZodError): string {
  const detail = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

  return detail ? `${prefix}: ${detail}` : prefix;
}

function validateExpectedFields(
  value: Pick<MetricsArtifactPayload, 'sessionId' | 'runId' | 'iteration' | 'metricName' | 'direction'>,
  options: ParseMetricsArtifactOptions,
): string | null {
  if (options.expectedSessionId && value.sessionId !== options.expectedSessionId) {
    return `Invalid metrics artifact: sessionId must be ${options.expectedSessionId}, received ${value.sessionId ?? '<missing>'}.`;
  }
  if (options.expectedRunId && value.runId !== options.expectedRunId) {
    const contractNote = options.expectedSessionId && options.expectedRunId === options.expectedSessionId
      ? ' Current AutoResearch uses sessionId as runId.'
      : '';
    return `Invalid metrics artifact: runId must be ${options.expectedRunId}, received ${value.runId ?? '<missing>'}.${contractNote}`;
  }
  if (typeof options.expectedIteration === 'number' && value.iteration !== options.expectedIteration) {
    return `Invalid metrics artifact: iteration must be ${options.expectedIteration}, received ${value.iteration ?? '<missing>'}.`;
  }
  if (options.expectedMetricName && value.metricName !== options.expectedMetricName) {
    return `Invalid metrics artifact: metricName must be ${options.expectedMetricName}, received ${value.metricName}.`;
  }
  if (options.expectedDirection && value.direction !== options.expectedDirection) {
    return `Invalid metrics artifact: direction must be ${options.expectedDirection}, received ${value.direction ?? '<missing>'}.`;
  }
  return null;
}

function hasSchemaFields(value: unknown): value is Record<string, unknown> {
  return value != null
    && typeof value === 'object'
    && (
      'schemaVersion' in value
      || 'runId' in value
      || 'primaryMetric' in value
      || 'generator' in value
    );
}

export function normalizeIterationMetricsRecord(
  input: IterationMetrics,
  options: NormalizeMetricsRecordOptions,
): IterationMetrics {
  const candidate = {
    schemaVersion: 1 as const,
    runId: input.runId ?? options.sessionId,
    primaryMetric: input.primaryMetric ?? input.metricName,
    direction: input.direction ?? options.direction,
    timestamp: input.timestamp ?? input.finishedAt,
    generator: input.generator ?? options.generator ?? 'loop_engine',
    ...input,
    sessionId: input.sessionId || options.sessionId,
  };

  const parsed = PersistedIterationMetricsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(formatSchemaError('Invalid iteration metrics record', parsed.error));
  }

  return parsed.data satisfies IterationMetrics;
}

export function serializeIterationMetricsRecord(record: IterationMetrics): string {
  return JSON.stringify(record);
}

export function parsePersistedIterationMetricsLine(
  line: string,
  options: {
    sessionId: string;
    direction?: MetricsDirection;
    source: string;
  },
): IterationMetrics {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(`${options.source}: invalid JSON (${error instanceof Error ? error.message : String(error)}).`);
  }

  const parsed = PersistedIterationMetricsSchema.safeParse(parsedJson);
  if (parsed.success) {
    const mismatch = validateExpectedFields(parsed.data, {
      expectedSessionId: options.sessionId,
      expectedRunId: options.sessionId,
    });
    if (mismatch) {
      throw new Error(`${options.source}: ${mismatch}`);
    }
    return parsed.data satisfies IterationMetrics;
  }

  const legacy = LegacyPersistedIterationMetricsSchema.safeParse(parsedJson);
  if (!legacy.success) {
    throw new Error(`${options.source}: ${formatSchemaError('invalid metrics artifact', parsed.error)}`);
  }

  return normalizeIterationMetricsRecord(legacy.data satisfies IterationMetrics, {
    sessionId: options.sessionId,
    direction: options.direction ?? 'lower',
    generator: 'loop_engine',
  });
}

export function parseMetricsArtifactPayload(
  value: unknown,
  options: ParseMetricsArtifactOptions = {},
): { value: MetricsArtifactPayload | null; error?: string } {
  if (hasSchemaFields(value)) {
    const persisted = PersistedIterationMetricsSchema.safeParse(value);
    if (persisted.success) {
      const mismatch = validateExpectedFields(persisted.data, options);
      return mismatch
        ? { value: null, error: mismatch }
        : { value: persisted.data satisfies MetricsArtifactPayload };
    }

    const artifact = AgentMetricsArtifactSchema.safeParse(value);
    if (artifact.success) {
      const mismatch = validateExpectedFields(artifact.data, options);
      return mismatch
        ? { value: null, error: mismatch }
        : { value: artifact.data satisfies MetricsArtifactPayload };
    }

    return {
      value: null,
      error: formatSchemaError('Invalid metrics artifact', persisted.error),
    };
  }

  const legacy = MetricsArtifactBaseSchema.safeParse(value);
  if (!legacy.success) {
    return {
      value: null,
      error: formatSchemaError('Invalid metrics artifact', legacy.error),
    };
  }

  return { value: legacy.data satisfies MetricsArtifactPayload };
}