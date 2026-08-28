import { z } from 'zod';
import type {
  AutoResearchBootstrapResult,
  BootstrapPlan,
  ExtractedBaseline,
  PaperReference,
  ReportedMetric,
  ScaffoldPlan,
  ScaffoldTemplateManifest,
  BootstrapStartHandoff,
} from './types';

export const PaperReferenceSchema: z.ZodType<PaperReference> = z.object({
  source: z.enum(['pdf', 'url', 'arxiv', 'manual']),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).optional(),
  year: z.number().int().positive().optional(),
  venue: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  originalUrl: z.string().min(1).optional(),
  abstract: z.string().min(1).optional(),
  citationKey: z.string().min(1).optional(),
}).strict();

export const ReportedMetricSchema: z.ZodType<ReportedMetric> = z.object({
  name: z.string().min(1),
  value: z.number().nonnegative(),
  unit: z.string().min(1).optional(),
}).strict();

export const ExtractedBaselineSchema: z.ZodType<ExtractedBaseline> = z.object({
  name: z.string().min(1),
  paper: PaperReferenceSchema.optional(),
  task: z.string().min(1),
  dataset: z.string().min(1),
  reportedMetrics: z.array(ReportedMetricSchema),
  method: z.object({
    summary: z.string().min(1),
    keyHyperparams: z.record(z.union([z.string(), z.number()])).optional(),
  }).strict(),
  reproducibility: z.object({
    hasOfficialCode: z.boolean(),
    repoUrl: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  }).strict(),
}).strict();

export const ScaffoldPlanFileSchema = z.object({
  path: z.string().min(1),
  purpose: z.string().min(1),
}).strict();

export const ScaffoldPlanSchema: z.ZodType<ScaffoldPlan> = z.object({
  templateId: z.enum(['python-ml-baseline', 'node-eval-harness']),
  workDir: z.string().min(1),
  language: z.enum(['python', 'node', 'rust', 'mixed']),
  entryCommand: z.string().min(1),
  vars: z.record(z.union([z.string(), z.number(), z.boolean()])),
  files: z.array(ScaffoldPlanFileSchema),
}).strict();

export const BootstrapPlanSchema: z.ZodType<BootstrapPlan> = z.object({
  researchGoal: z.string().min(1),
  successCriteria: z.string().min(1),
  primaryMetric: z.string().min(1),
  secondaryMetrics: z.array(z.string().min(1)),
  papers: z.array(PaperReferenceSchema),
  baselines: z.array(ExtractedBaselineSchema).min(1),
  scaffold: ScaffoldPlanSchema,
  gitInitialized: z.boolean(),
  initialCommitSha: z.string().min(1).optional(),
  conversationalTemplateId: z.enum(['reproduce-paper', 'beat-baseline', 'ablation', 'from-scratch']),
}).strict();

export const AutoResearchBootstrapResultSchema: z.ZodType<AutoResearchBootstrapResult> = z.object({
  status: z.enum(['ready', 'needs_user_confirmation', 'failed']),
  plan: BootstrapPlanSchema,
  warnings: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  createdAt: z.string().datetime({ offset: true }),
  schemaVersion: z.literal(1),
}).strict();

export const BootstrapStartHandoffSchema: z.ZodType<BootstrapStartHandoff> = z.object({
  workDir: z.string().min(1),
  successCriteria: z.string().min(1),
  primaryMetric: z.string().min(1),
  bootstrapCreatedAt: z.string().datetime({ offset: true }),
  bootstrapKind: z.literal('conversational'),
}).strict();

export const ScaffoldTemplateManifestSchema: z.ZodType<ScaffoldTemplateManifest> = z.object({
  templateId: z.enum(['python-ml-baseline', 'node-eval-harness']),
  language: z.enum(['python', 'node', 'rust', 'mixed']),
  entryCommand: z.string().min(1),
  requiredVars: z.array(z.string().min(1)),
  files: z.array(z.object({
    output: z.string().min(1),
    source: z.string().min(1),
    purpose: z.string().min(1),
  }).strict()),
}).strict();