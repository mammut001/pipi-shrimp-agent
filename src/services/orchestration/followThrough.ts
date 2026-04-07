/**
 * Follow-Through Router
 *
 * After delegation and synthesis, determines what the main thread should do next.
 * Maps task types to concrete follow-through modes so the orchestration loop
 * doesn't stop at "agents ran" but continues into the user's actual goal.
 */

import type { DelegationPlan } from './types';

// =============================================================================
// Follow-Through Modes
// =============================================================================

/** What the main thread should do after synthesis */
export type FollowThroughMode =
  | 'answer_only'                        // Just present the synthesized answer
  | 'produce_review'                     // Produce a structured review document
  | 'produce_fix_plan'                   // Produce a fix/action plan
  | 'produce_readme_update'              // Produce actual README content
  | 'continue_with_main_thread_write_step'; // Continue into a write/implementation step

/** The resolved follow-through instruction for the main thread */
export interface FollowThroughInstruction {
  mode: FollowThroughMode;
  /** Short description of what the main thread should do */
  description: string;
  /** Prompt suffix to append to the synthesis message so the LLM produces the right output */
  promptGuidance: string;
}

// =============================================================================
// Router
// =============================================================================

/**
 * Determine the follow-through mode for a completed delegation.
 *
 * Analyzes the original task type and user message to decide
 * whether the main thread should just answer, produce a review,
 * propose fixes, write documentation, or continue into implementation.
 */
export function resolveFollowThrough(
  plan: DelegationPlan,
): FollowThroughInstruction {
  // Check user message for specific follow-through cues first
  const msgLower = plan.userMessage.toLowerCase();

  // Documentation write requests
  if (hasDocWriteIntent(msgLower)) {
    return {
      mode: 'produce_readme_update',
      description: 'Produce documentation content based on exploration results',
      promptGuidance: buildDocWriteGuidance(plan),
    };
  }

  // Fix/action plan requests
  if (hasFixIntent(msgLower)) {
    return {
      mode: 'produce_fix_plan',
      description: 'Produce a concrete fix plan based on investigation results',
      promptGuidance: buildFixPlanGuidance(plan),
    };
  }

  // Route by task type
  switch (plan.planType) {
    case 'repo_exploration':
      return {
        mode: 'answer_only',
        description: 'Present a unified codebase overview',
        promptGuidance: buildExplorationGuidance(plan),
      };

    case 'architecture_review':
      return {
        mode: 'produce_review',
        description: 'Produce a structured architecture review',
        promptGuidance: buildArchReviewGuidance(plan),
      };

    case 'bug_investigation':
      return {
        mode: 'produce_fix_plan',
        description: 'Identify root cause and propose fixes',
        promptGuidance: buildBugFixGuidance(plan),
      };

    case 'release_review':
      return {
        mode: 'produce_review',
        description: 'Produce a release readiness assessment',
        promptGuidance: buildReleaseReviewGuidance(plan),
      };

    case 'documentation_update':
      return {
        mode: 'produce_readme_update',
        description: 'Produce documentation content',
        promptGuidance: buildDocWriteGuidance(plan),
      };

    case 'browser_investigation':
      return {
        mode: 'produce_review',
        description: 'Produce a browser system analysis',
        promptGuidance: buildBrowserReviewGuidance(plan),
      };

    case 'workflow_swarm_investigation':
      return {
        mode: 'produce_review',
        description: 'Produce a workflow/swarm system analysis',
        promptGuidance: buildWorkflowReviewGuidance(plan),
      };

    default:
      return {
        mode: 'answer_only',
        description: 'Provide a comprehensive answer',
        promptGuidance: buildDefaultGuidance(plan),
      };
  }
}

// =============================================================================
// Intent Detection Helpers
// =============================================================================

function hasDocWriteIntent(msg: string): boolean {
  return /\b(update|write|create|rewrite|produce|generate)\s+(the\s+)?(readme|documentation|docs?|changelog)/i.test(msg);
}

function hasFixIntent(msg: string): boolean {
  return /\b(fix|propose\s+fix|action\s+plan|fix\s+plan|suggest\s+fix|how\s+to\s+fix)/i.test(msg);
}

// =============================================================================
// Guidance Builders
// =============================================================================

function buildFixPlanGuidance(plan: DelegationPlan): string {
  return `Based on the delegation results above, produce a **concrete fix plan** for: "${plan.userMessage}"

Your response should include:
1. **Problem Summary** — what needs to be fixed based on investigation findings
2. **Proposed Fixes** — specific, actionable changes ordered by priority
3. **Risk Assessment** — what could go wrong with each fix
4. **Verification Steps** — how to verify each fix works

Be specific — reference actual files, functions, and code patterns.`;
}

function buildExplorationGuidance(plan: DelegationPlan): string {
  return `Based on the delegation results above, produce a **unified codebase overview** that addresses the user's request: "${plan.userMessage}"

Your response should:
- Merge findings from all explorers into one cohesive narrative
- Highlight the most important architectural patterns and components
- Note any cross-cutting concerns between frontend and backend
- Be well-structured with clear sections
- Be comprehensive but not redundant — deduplicate overlapping findings

Do NOT just concatenate the agent outputs. Synthesize them into YOUR answer.`;
}

function buildArchReviewGuidance(plan: DelegationPlan): string {
  return `Based on the delegation results above, produce a **structured architecture review** addressing: "${plan.userMessage}"

Your review should include:
1. **Architecture Overview** — high-level system structure
2. **Key Components** — major modules/subsystems and their responsibilities
3. **Integration Points** — how components communicate and depend on each other
4. **Strengths** — good architectural decisions
5. **Risks & Concerns** — architectural issues, code smells, tech debt
6. **Recommendations** — specific suggestions for improvement

Merge insights from all reviewers. If reviewers disagree, note the disagreement.
Do NOT just list each agent's findings separately — produce one unified review.`;
}

function buildBugFixGuidance(plan: DelegationPlan): string {
  return `Based on the investigation results above, produce a **root cause analysis and fix plan** for: "${plan.userMessage}"

Your response should include:
1. **Root Cause** — the most likely cause of the issue based on all investigation results
2. **Evidence** — supporting findings from the investigators
3. **Fix Plan** — concrete steps to resolve the issue, ordered by priority
4. **Risk Assessment** — what could go wrong with the proposed fixes
5. **Verification** — how to verify the fix works

If investigators found different potential causes, rank them by likelihood.
Be specific — reference actual files, functions, and code patterns when possible.`;
}

function buildReleaseReviewGuidance(plan: DelegationPlan): string {
  return `Based on the review results above, produce a **release readiness assessment** for: "${plan.userMessage}"

Your assessment should include:
1. **Overall Recommendation** — Ship / Fix First / Needs More Work (bold and clear)
2. **Build Health** — compilation, type safety, test status
3. **Blocking Issues** — anything that must be fixed before release
4. **Risks** — non-blocking but concerning issues
5. **Subsystem Status** — brief status for each reviewed area
6. **Action Items** — prioritized list of things to do before/after release

Be decisive. Give a clear recommendation, not a wishy-washy "it depends."`;
}

function buildDocWriteGuidance(plan: DelegationPlan): string {
  return `Based on the exploration results above, **produce the actual documentation content** for: "${plan.userMessage}"

You should:
- Write production-ready Markdown content
- Include accurate project structure, tech stack, and architecture information
- Include setup/development instructions if applicable
- Be comprehensive but not verbose
- Use proper Markdown formatting with headers, lists, and code blocks

Output the documentation content directly — this should be usable as-is or with minimal editing.
If the user asked to update a specific file (e.g., README.md), produce content suitable for that file.`;
}

function buildBrowserReviewGuidance(plan: DelegationPlan): string {
  return `Based on the investigation results above, produce a **browser system analysis** for: "${plan.userMessage}"

Your analysis should include:
1. **System Overview** — browser subsystem components and their roles
2. **State Flow** — how browser state changes propagate through the system
3. **Identified Issues** — problems, bugs, or risks found
4. **Root Causes** — likely causes for any reported issues
5. **Recommendations** — specific fixes or improvements

Be specific about component names, state stores, and data flows.`;
}

function buildWorkflowReviewGuidance(plan: DelegationPlan): string {
  return `Based on the investigation results above, produce a **workflow/swarm system analysis** for: "${plan.userMessage}"

Your analysis should include:
1. **Runtime Overview** — components, lifecycle, message protocol
2. **Integration Points** — how the runtime connects to the rest of the app
3. **Identified Issues** — gaps, bugs, or missing functionality
4. **Recommendations** — specific improvements or fixes

Reference actual code patterns and files where relevant.`;
}

function buildDefaultGuidance(plan: DelegationPlan): string {
  return `Based on the delegation results above, provide a comprehensive response to: "${plan.userMessage}"

Synthesize all agent findings into one cohesive answer. Do not repeat information unnecessarily.`;
}
