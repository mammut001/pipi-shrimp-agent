export type BootstrapStep =
  | 'goal'
  | 'papers'
  | 'baselines'
  | 'metrics'
  | 'scaffold'
  | 'ready';

export interface PaperReference {
  source: 'pdf' | 'url' | 'arxiv' | 'manual';
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  filePath?: string;
  originalUrl?: string;
  abstract?: string;
  citationKey?: string;
}

export interface ReportedMetric {
  name: string;
  value: number;
  unit?: string;
}

export interface ExtractedBaseline {
  name: string;
  paper?: PaperReference;
  task: string;
  dataset: string;
  reportedMetrics: ReportedMetric[];
  method: {
    summary: string;
    keyHyperparams?: Record<string, string | number>;
  };
  reproducibility: {
    hasOfficialCode: boolean;
    repoUrl?: string;
    notes?: string;
  };
}

export type ScaffoldTemplateId = 'python-ml-baseline' | 'node-eval-harness';

export type ConversationalTemplateId =
  | 'reproduce-paper'
  | 'beat-baseline'
  | 'ablation'
  | 'from-scratch'
  | 'reproduce_paper'
  | 'beat_baseline'
  | 'from_scratch';

export interface ScaffoldPlan {
  templateId: ScaffoldTemplateId;
  workDir: string;
  language: 'python' | 'node' | 'rust' | 'mixed';
  entryCommand: string;
  vars: Record<string, string | number | boolean>;
  files: Array<{ path: string; purpose: string }>;
}

export interface BootstrapPlan {
  researchGoal: string;
  successCriteria: string;
  primaryMetric: string;
  secondaryMetrics: string[];
  papers: PaperReference[];
  baselines: ExtractedBaseline[];
  scaffold: ScaffoldPlan;
  gitInitialized: boolean;
  initialCommitSha?: string;
  conversationalTemplateId: ConversationalTemplateId;
}

export interface AutoResearchBootstrapResult {
  status: 'ready' | 'needs_user_confirmation' | 'failed';
  plan: BootstrapPlan;
  warnings: string[];
  unresolvedQuestions: string[];
  createdAt: string;
  schemaVersion: 1;
}

export interface BootstrapStartHandoff {
  workDir: string;
  successCriteria: string;
  primaryMetric: string;
  bootstrapCreatedAt: string;
  bootstrapKind: 'conversational';
}

export interface ScaffoldTemplateFile {
  output: string;
  source: string;
  purpose: string;
}

export interface ScaffoldTemplateManifest {
  templateId: ScaffoldTemplateId;
  language: ScaffoldPlan['language'];
  entryCommand: string;
  requiredVars: string[];
  files: ScaffoldTemplateFile[];
}