/**
 * Auto Orchestration — barrel export
 *
 * Demand-driven delegation planner that sits above the swarm runtime.
 */

// Types
export type {
  TaskType,
  ScopeEstimate,
  IntentClassification,
  AreaHint,
  DelegationPlan,
  PlannedAgent,
  AgentRoleType,
  SynthesisStrategy,
  DelegationStatus,
  AgentResult,
  DelegationResult,
} from './types';

// Intent classification
export { classifyIntent } from './intentClassifier';

// Delegation planning
export { buildDelegationPlan, describePlan } from './delegationPlanner';

// Role templates
export { getRoleTemplate, getAvailableRoles, buildAgentPrompt } from './roleTemplates';

// Execution
export { runDelegationPlan } from './runDelegationPlan';

// Result collection
export {
  startCollecting,
  recordAgentResult,
  forceFinish,
  isActive as isDelegationActive,
  getProgress as getDelegationProgress,
  findDelegationForAgent,
} from './resultCollector';

// Synthesis
export { buildSynthesisPrompt, buildProgressMessage } from './synthesis';

// Follow-through
export type { FollowThroughMode, FollowThroughInstruction } from './followThrough';
export { resolveFollowThrough } from './followThrough';
