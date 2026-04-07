/**
 * Delegation Planner
 *
 * Converts an IntentClassification into an executable DelegationPlan.
 * Decides which agents to spawn, their prompts, parallelism, and synthesis strategy.
 *
 * Rules are deterministic — no LLM planning loops.
 */

import type {
  IntentClassification,
  DelegationPlan,
  PlannedAgent,
  AgentRoleType,
} from './types';
import { buildAgentPrompt, getRoleTemplate } from './roleTemplates';

// =============================================================================
// Plan Builder
// =============================================================================

/**
 * Build a delegation plan from an intent classification.
 *
 * If classification says no delegation, returns a plan with `delegate: false`.
 */
export function buildDelegationPlan(
  classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (!classification.shouldDelegate) {
    return {
      id: planId,
      planType: classification.taskType,
      delegate: false,
      mainThreadResponsibility: 'Handle the full request directly',
      agents: [],
      maxParallelism: 1,
      synthesisStrategy: 'none',
      userMessage,
      createdAt: Date.now(),
    };
  }

  // Build plan based on task type
  switch (classification.taskType) {
    case 'repo_exploration':
      return buildRepoExplorationPlan(planId, classification, userMessage);

    case 'architecture_review':
      return buildArchitectureReviewPlan(planId, classification, userMessage);

    case 'documentation_update':
      return buildDocumentationUpdatePlan(planId, classification, userMessage);

    case 'bug_investigation':
      return buildBugInvestigationPlan(planId, classification, userMessage);

    case 'release_review':
      return buildReleaseReviewPlan(planId, classification, userMessage);

    case 'browser_investigation':
      return buildBrowserInvestigationPlan(planId, classification, userMessage);

    case 'workflow_swarm_investigation':
      return buildWorkflowInvestigationPlan(planId, classification, userMessage);

    default:
      // Should not reach here if classifier is correct, but fallback safely
      return {
        id: planId,
        planType: classification.taskType,
        delegate: false,
        mainThreadResponsibility: 'Handle directly',
        agents: [],
        maxParallelism: 1,
        synthesisStrategy: 'none',
        userMessage,
        createdAt: Date.now(),
      };
  }
}

// =============================================================================
// Plan Builders per Task Type
// =============================================================================

function buildRepoExplorationPlan(
  planId: string,
  _classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  const agents: PlannedAgent[] = [
    makeAgent('frontend_explorer', userMessage, 'src/ (React frontend)', 1),
    makeAgent('rust_backend_explorer', userMessage, 'src-tauri/ (Rust backend)', 1),
  ];

  return {
    id: planId,
    planType: 'repo_exploration',
    delegate: true,
    mainThreadResponsibility:
      'Synthesize the exploration results from both agents into a unified codebase overview. Address the user\'s original request using the gathered information.',
    agents,
    maxParallelism: 2,
    synthesisStrategy: 'merge_summaries',
    userMessage,
    createdAt: Date.now(),
  };
}

function buildArchitectureReviewPlan(
  planId: string,
  classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  const agents: PlannedAgent[] = [];
  const hints = classification.areaHints;

  // If specific areas mentioned, only spawn those
  if (hints.includes('frontend') || hints.length === 0) {
    agents.push(makeAgent('frontend_explorer', userMessage, 'Frontend architecture', 1));
  }
  if (hints.includes('rust_backend') || hints.length === 0) {
    agents.push(makeAgent('rust_backend_explorer', userMessage, 'Rust backend architecture', 1));
  }
  if (hints.includes('browser')) {
    agents.push(makeAgent('browser_investigator', userMessage, 'Browser subsystem', 1));
  }
  if (hints.includes('workflow') || hints.includes('swarm')) {
    agents.push(makeAgent('workflow_swarm_investigator', userMessage, 'Workflow/swarm subsystem', 1));
  }

  // If no agents were added (shouldn't happen but safety), add both defaults
  if (agents.length === 0) {
    agents.push(makeAgent('frontend_explorer', userMessage, 'Frontend architecture', 1));
    agents.push(makeAgent('rust_backend_explorer', userMessage, 'Rust backend architecture', 1));
  }

  // Cap at 3 agents
  const capped = agents.slice(0, 3);

  return {
    id: planId,
    planType: 'architecture_review',
    delegate: true,
    mainThreadResponsibility:
      'Synthesize architecture findings into a cohesive review. Highlight cross-cutting concerns, integration risks, and architectural recommendations.',
    agents: capped,
    maxParallelism: capped.length,
    synthesisStrategy: 'merge_summaries',
    userMessage,
    createdAt: Date.now(),
  };
}

function buildDocumentationUpdatePlan(
  planId: string,
  _classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  // For doc updates, explore first, then the main thread writes the docs
  const agents: PlannedAgent[] = [
    makeAgent('frontend_explorer', userMessage, 'Frontend structure for documentation', 1),
    makeAgent('rust_backend_explorer', userMessage, 'Backend structure for documentation', 1),
  ];

  return {
    id: planId,
    planType: 'documentation_update',
    delegate: true,
    mainThreadResponsibility:
      'Use the exploration results to write or update the target documentation. Produce the actual file content (e.g., README.md) based on the gathered information.',
    agents,
    maxParallelism: 2,
    synthesisStrategy: 'merge_summaries',
    userMessage,
    createdAt: Date.now(),
  };
}

function buildBugInvestigationPlan(
  planId: string,
  classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  const agents: PlannedAgent[] = [];
  const hints = classification.areaHints;

  // Spawn investigators based on which areas might be involved
  if (hints.includes('frontend')) {
    agents.push(makeAgent('frontend_explorer', userMessage, 'Frontend code related to the bug', 1));
  }
  if (hints.includes('rust_backend')) {
    agents.push(makeAgent('rust_backend_explorer', userMessage, 'Backend code related to the bug', 1));
  }
  if (hints.includes('browser')) {
    agents.push(makeAgent('browser_investigator', userMessage, 'Browser subsystem for bug clues', 1));
  }
  if (hints.includes('workflow') || hints.includes('swarm')) {
    agents.push(makeAgent('workflow_swarm_investigator', userMessage, 'Workflow/swarm for bug clues', 1));
  }

  // If broad scope but no specific area hints, spawn frontend + backend
  if (agents.length === 0) {
    agents.push(makeAgent('frontend_explorer', userMessage, 'Frontend investigation', 1));
    agents.push(makeAgent('rust_backend_explorer', userMessage, 'Backend investigation', 1));
  }

  const capped = agents.slice(0, 3);

  return {
    id: planId,
    planType: 'bug_investigation',
    delegate: true,
    mainThreadResponsibility:
      'Analyze findings from all investigators. Identify the most likely root cause and propose a fix.',
    agents: capped,
    maxParallelism: capped.length,
    synthesisStrategy: 'merge_summaries',
    userMessage,
    createdAt: Date.now(),
  };
}

function buildReleaseReviewPlan(
  planId: string,
  _classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  const agents: PlannedAgent[] = [
    makeAgent('build_release_reviewer', userMessage, 'Build system and release readiness', 1),
    makeAgent('frontend_explorer', userMessage, 'Frontend health for release review', 1),
    makeAgent('rust_backend_explorer', userMessage, 'Backend health for release review', 2),
  ];

  return {
    id: planId,
    planType: 'release_review',
    delegate: true,
    mainThreadResponsibility:
      'Compile a final release readiness assessment. Make a clear ship/no-ship recommendation with supporting evidence from all reviewers.',
    agents: agents.slice(0, 3),
    maxParallelism: 2,
    synthesisStrategy: 'merge_summaries',
    userMessage,
    createdAt: Date.now(),
  };
}

function buildBrowserInvestigationPlan(
  planId: string,
  classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  const agents: PlannedAgent[] = [
    makeAgent('browser_investigator', userMessage, 'Browser subsystem', 1),
  ];

  // Add backend investigator if backend is also hinted
  if (classification.areaHints.includes('rust_backend')) {
    agents.push(makeAgent('rust_backend_explorer', userMessage, 'Browser-related backend commands', 1));
  }

  return {
    id: planId,
    planType: 'browser_investigation',
    delegate: true,
    mainThreadResponsibility:
      'Synthesize browser investigation findings. Identify root causes and provide actionable recommendations.',
    agents,
    maxParallelism: agents.length,
    synthesisStrategy: agents.length > 1 ? 'merge_summaries' : 'none',
    userMessage,
    createdAt: Date.now(),
  };
}

function buildWorkflowInvestigationPlan(
  planId: string,
  _classification: IntentClassification,
  userMessage: string,
): DelegationPlan {
  const agents: PlannedAgent[] = [
    makeAgent('workflow_swarm_investigator', userMessage, 'Workflow and swarm runtime', 1),
  ];

  return {
    id: planId,
    planType: 'workflow_swarm_investigation',
    delegate: true,
    mainThreadResponsibility:
      'Analyze workflow investigation results and provide recommendations.',
    agents,
    maxParallelism: 1,
    synthesisStrategy: 'none',
    userMessage,
    createdAt: Date.now(),
  };
}

// =============================================================================
// Agent Factory
// =============================================================================

function makeAgent(
  role: AgentRoleType,
  userGoal: string,
  scope: string,
  priority: number,
): PlannedAgent {
  const template = getRoleTemplate(role);
  return {
    name: template.defaultName,
    role,
    prompt: buildAgentPrompt(role, userGoal, scope),
    scope,
    expectedOutput: template.expectedOutput,
    priority,
  };
}

// =============================================================================
// Utilities
// =============================================================================

/** Short human-readable summary of a delegation plan (shown once in chat) */
export function describePlan(plan: DelegationPlan): string {
  if (!plan.delegate) {
    return 'I\'ll handle this directly.';
  }

  const agentNames = plan.agents.map((a) => getRoleTemplate(a.role).defaultName);
  const nameList = agentNames.length === 1
    ? agentNames[0]
    : agentNames.slice(0, -1).join(', ') + ' and ' + agentNames[agentNames.length - 1];

  return `Looking into this with ${nameList}. I'll synthesize their findings once done.`;
}
