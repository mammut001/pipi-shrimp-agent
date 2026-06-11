/**
 * Workflow Types - Multi-agent workflow system type definitions
 */

import type { ProviderName } from '@/shared/providers';
import type { WorkflowVisionPolicy } from './vision';

// ============ Execution Config ============

export type ExecutionMode = 'single' | 'multi-round';

export type RoundCondition = 'untilComplete' | 'untilError' | 'fixed' | 'single';

export interface AgentExecutionConfig {
  mode: ExecutionMode;
  maxRounds?: number;
  roundCondition?: RoundCondition;
}

// ============ Agent Role ============

export type WorkflowAgentRole =
  | 'planner'
  | 'writer'
  | 'developer'
  | 'reviewer'
  | 'qa'
  | 'security'
  | 'devops'
  | 'goal-evaluator'
  | 'custom';

export type LegacyWorkflowAgentRole =
  | 'coder'
  | 'tester'
  | 'data-analyst'
  | 'translator';

export type AgentRole = WorkflowAgentRole | LegacyWorkflowAgentRole;

export interface RoleModelHint {
  role: WorkflowAgentRole;
  preferredProviders: ProviderName[];
  preferredModelKeywords: string[];
  reason: string;
}

// ============ Retry Policy ============

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  fallbackConfigIds?: string[];
}

export type AgentRetryPolicy = RetryPolicy;

// ============ Output Routes ============

export type RouteCondition = 'onComplete' | 'onError' | 'outputContains' | 'always';

export type RouteKeywordMode = 'includes' | 'regex';

export interface OutputRoute {
  id: string;
  condition: RouteCondition;
  keyword?: string;
  keywordMode?: RouteKeywordMode;
  targetAgentId: string;
}

// ============ Agent Node ============

export interface WorkflowAgentModel {
  configId?: string;
  provider?: ProviderName;
  modelId?: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface WorkflowAgent {
  id: string;
  name: string;
  soulPrompt?: string;
  task?: string;
  taskPrompt?: string;
  taskInstruction?: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  // Canvas agents also need an idle state before a run starts or after reset.
  status: 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  outputRoutes: OutputRoute[];
  execution: AgentExecutionConfig;
  model?: WorkflowAgentModel;
  inputFrom?: string | null;
  role?: AgentRole;
  retryPolicy?: RetryPolicy;
  notifyOnComplete?: string[];
  visionPolicy?: WorkflowVisionPolicy;
}

// ============ Connection ============

export type ConnectionType = 'sequential' | 'parallel';

export interface WorkflowConnection {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  condition: RouteCondition;
  keyword?: string;
  keywordMode?: RouteKeywordMode;
  type?: ConnectionType;
}

// ============ Goal Evaluation ============

export interface GoalEvaluationResult {
  iteration: number;
  reached: boolean;
  confidence: number;
  missingItems: string[];
  nextAgentIdHint?: string;
  reasoning: string;
  rawOutput?: string;
  timestamp: number;
}

export type WorkflowMarkerCode =
  | 'PASS'
  | 'REVIEW_REJECT'
  | 'TESTS_FAIL_CODE'
  | 'TESTS_FAIL_SPEC'
  | 'GOAL_NOT_REACHED';

// ============ Workflow Run (History) ============

export interface WorkflowRunAgentEntry {
  agentId: string;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  startTime?: number;
  endTime?: number;
  output?: string;
  iteration?: number;
  outputFilePath?: string;
  transcriptFilePath?: string;
  artifactBaseName?: string;
}

export interface WorkflowRun {
  id: string;
  title: string;
  projectGoal: string;
  successCriteria: string;
  bootstrapKind?: 'conversational' | 'manual';
  status: 'idle' | 'running' | 'completed' | 'completed-not-reached' | 'error' | 'stopped';
  startTime: number;
  endTime?: number;
  agents: WorkflowRunAgentEntry[];
  runDirectory?: string;
  sessionId?: string;
  currentIteration: number;
  goalEvaluations: GoalEvaluationResult[];
  reachedGoal: boolean;
}

// ============ Workflow Instance ============

export interface WorkflowInstance {
  id: string;
  name: string;
  projectGoal: string;
  successCriteria: string;
  goalEvaluatorAgentId: string | null;
  maxGoalIterations: number;
  agents: WorkflowAgent[];
  connections: WorkflowConnection[];
  workflowRuns: WorkflowRun[];
  activeRunId: string | null;
  dirtyAgentIds: string[];
  createdAt: number;
  updatedAt: number;
}

// ============ Global State ============

export interface WorkflowState {
  instances: WorkflowInstance[];
  currentInstanceId: string | null;
  isRunning: boolean;
  currentRunningAgentId: string | null;
  selectedRunId: string | null;
  selectedPreviewFile: string | null;
}

// ============ Agent Templates ============

export interface AgentTemplate {
  id: string;
  name: string;
  color: string;
  task: string;
  taskPrompt?: string;
  taskInstruction?: string;
  soulPrompt: string;
  execution: AgentExecutionConfig;
  allowedTools?: string[];
  recommendedRole?: WorkflowAgentRole;
  recommendedModelHints?: RoleModelHint[];
  requiredOutputMarkers?: WorkflowMarkerCode[];
}
