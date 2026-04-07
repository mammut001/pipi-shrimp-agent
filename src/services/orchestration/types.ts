/**
 * Auto Orchestration Types
 *
 * Types for the demand-driven delegation planner that sits above the swarm runtime.
 * The planner analyzes user intent, decides whether to delegate, builds a plan,
 * and hands results back for synthesis.
 */

// =============================================================================
// Intent Classification
// =============================================================================

/** High-level task categories the planner can recognize */
export type TaskType =
  | 'repo_exploration'
  | 'architecture_review'
  | 'bug_investigation'
  | 'release_review'
  | 'documentation_update'
  | 'browser_investigation'
  | 'workflow_swarm_investigation'
  | 'simple_single_agent_task';

/** Scope estimate for the task */
export type ScopeEstimate = 'narrow' | 'moderate' | 'broad';

/** Result of intent classification */
export interface IntentClassification {
  taskType: TaskType;
  scope: ScopeEstimate;
  /** Whether parallel delegation is recommended */
  shouldDelegate: boolean;
  /** Detected area hints from the user message */
  areaHints: AreaHint[];
  /** Confidence in the classification (0–1) */
  confidence: number;
  /** Why the classifier chose this classification */
  reasoning: string;
}

/** Recognized domain areas in the codebase */
export type AreaHint =
  | 'frontend'
  | 'rust_backend'
  | 'browser'
  | 'workflow'
  | 'swarm'
  | 'documentation'
  | 'build_release'
  | 'database'
  | 'api';

// =============================================================================
// Delegation Plan
// =============================================================================

/** The executable delegation plan produced by the planner */
export interface DelegationPlan {
  /** Unique plan ID */
  id: string;
  /** What type of plan this is */
  planType: TaskType;
  /** Whether we should actually delegate (may be false for simple tasks) */
  delegate: boolean;
  /** What the main thread should do after delegation completes */
  mainThreadResponsibility: string;
  /** Agents to spawn */
  agents: PlannedAgent[];
  /** Max agents to run concurrently */
  maxParallelism: number;
  /** How to combine sub-results */
  synthesisStrategy: SynthesisStrategy;
  /** Original user message that triggered this plan */
  userMessage: string;
  /** Timestamp */
  createdAt: number;
}

/** An agent the planner wants to spawn */
export interface PlannedAgent {
  /** Display name for this agent */
  name: string;
  /** Role template to use */
  role: AgentRoleType;
  /** The prompt this agent will execute */
  prompt: string;
  /** What areas of the codebase this agent should focus on */
  scope: string;
  /** What output we expect from this agent */
  expectedOutput: string;
  /** Execution priority (lower = higher priority); agents with same priority run in parallel */
  priority: number;
}

/** Supported agent role types */
export type AgentRoleType =
  | 'frontend_explorer'
  | 'rust_backend_explorer'
  | 'browser_investigator'
  | 'workflow_swarm_investigator'
  | 'build_release_reviewer'
  | 'documentation_synthesizer';

/** How to combine delegated results */
export type SynthesisStrategy =
  | 'merge_summaries'     // Combine all summaries into one cohesive answer
  | 'sequential_refine'   // Each result feeds into the next
  | 'best_of'             // Pick the most relevant result
  | 'none';               // Single agent, no synthesis needed

// =============================================================================
// Result Collection
// =============================================================================

/** Status of a delegation execution */
export type DelegationStatus = 'running' | 'completed' | 'partial_failure' | 'failed';

/** Collected result from one delegated agent */
export interface AgentResult {
  /** The planned agent this result corresponds to */
  agentName: string;
  role: AgentRoleType;
  /** What area this agent focused on */
  scope: string;
  /** The swarm runtime agent ID */
  runtimeAgentId: string;
  /** The swarm runtime task ID */
  runtimeTaskId: string;
  /** Whether this agent succeeded */
  success: boolean;
  /** The agent's output content */
  content: string;
  /** Error message if failed */
  error?: string;
  /** When this result was received */
  completedAt: number;
}

/** Full delegation execution result */
export interface DelegationResult {
  /** The plan that was executed */
  planId: string;
  /** Overall status */
  status: DelegationStatus;
  /** Individual agent results */
  agentResults: AgentResult[];
  /** Synthesis-ready summary of all results */
  synthesisInput: string;
  /** When execution started */
  startedAt: number;
  /** When all agents completed */
  completedAt?: number;
}
