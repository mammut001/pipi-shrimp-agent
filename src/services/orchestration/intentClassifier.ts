/**
 * Intent Classifier
 *
 * Lightweight deterministic classifier that analyzes user messages
 * and determines orchestration category, scope, and whether delegation
 * is warranted.
 *
 * This is rule-based by design — no LLM meta-planning.
 */

import type { IntentClassification, TaskType, ScopeEstimate, AreaHint } from './types';

// =============================================================================
// Pattern Definitions
// =============================================================================

/** Phrases indicating broad/whole-repo scope */
const BROAD_SCOPE_PATTERNS = [
  /\b(entire|whole|full|all)\s+(repo|codebase|project|code|source)/i,
  /\bread\s+(everything|all|the\s+code)/i,
  /\b(repo|codebase|project)\s*-?\s*wide/i,
  /\boverall\s+(architecture|structure|design)/i,
  /\bevery\s+(file|module|component|service)/i,
];

/** Area hint detectors: pattern → hint */
const AREA_PATTERNS: Array<{ patterns: RegExp[]; hint: AreaHint }> = [
  {
    hint: 'frontend',
    patterns: [
      /\b(frontend|front[\s-]?end|react|component|zustand|store|tsx|jsx|ui|css|tailwind|pages?|layout)/i,
    ],
  },
  {
    hint: 'rust_backend',
    patterns: [
      /\b(rust|tauri|src[\s-]?tauri|backend|cargo|commands?|provider|invoke)/i,
    ],
  },
  {
    hint: 'browser',
    patterns: [
      /\b(browser|webview|login|embedded\s*surface|page\s*agent|cdp|chrome|devtools|playwright)/i,
    ],
  },
  {
    hint: 'workflow',
    patterns: [
      /\b(workflow|swarm|subagent|coordinator|multi[\s-]?agent|delegation|orchestrat)/i,
    ],
  },
  {
    hint: 'swarm',
    patterns: [
      /\b(swarm|teammate|team\s*create|inbox|mailbox|task\s*manager)/i,
    ],
  },
  {
    hint: 'documentation',
    patterns: [
      /\b(readme|documentation|docs?|changelog|contributing|wiki)/i,
    ],
  },
  {
    hint: 'build_release',
    patterns: [
      /\b(release|ship|deploy|build|ci[\s/]?cd|pipeline|version|publish)/i,
    ],
  },
  {
    hint: 'database',
    patterns: [
      /\b(database|db|sqlite|sql|migration|schema|persist)/i,
    ],
  },
  {
    hint: 'api',
    patterns: [
      /\b(api|endpoint|rest|graphql|route|handler|middleware)/i,
    ],
  },
];

/** Goal patterns for classification */
const GOAL_PATTERNS: Array<{ patterns: RegExp[]; taskType: TaskType }> = [
  {
    taskType: 'documentation_update',
    patterns: [
      /\b(update|write|create|improve|fix)\s+(the\s+)?(readme|documentation|docs?)/i,
      /\b(readme|docs?)\s+(update|rewrite|overhaul)/i,
    ],
  },
  {
    taskType: 'bug_investigation',
    patterns: [
      /\b(find|investigate|debug|diagnose|trace|fix)\s+(the\s+)?(bug|error|issue|problem|crash|failure)/i,
      /\b(root\s*cause|why\s+(is|does|did|doesn't|doesn't))/i,
      /\bwhy\b.*(broken|stuck|fail|error|crash|wrong|not\s+work)/i,
      /\b(stuck|broken|not\s+working|doesn't\s+work)/i,
    ],
  },
  {
    taskType: 'release_review',
    patterns: [
      /\b(release\s+review|ready\s+to\s+(release|ship|deploy))/i,
      /\bcan\s+(i|we)\s+(release|ship|deploy)/i,
      /\b(pre[\s-]?release|release\s+check)/i,
    ],
  },
  {
    taskType: 'architecture_review',
    patterns: [
      /\b(review|analyze|inspect|audit|examine|assess)\s+(the\s+)?(architecture|structure|design|system|codebase|code)/i,
      /\b(architecture|structural)\s+(review|analysis|audit)/i,
    ],
  },
  {
    taskType: 'repo_exploration',
    patterns: [
      /\bread\s+(the\s+)?(whole|entire|full|all)/i,
      /\b(explore|scan|inventory|catalog|map)\s+(the\s+)?(code|repo|project|codebase)/i,
    ],
  },
  {
    taskType: 'browser_investigation',
    patterns: [
      /\b(browser|webview|login|page\s*agent)\s.*(issue|bug|problem|stuck|broken|error|investigate|review)/i,
      /\b(investigate|review|fix|debug)\s.*(browser|webview|login|embedded)/i,
    ],
  },
  {
    taskType: 'workflow_swarm_investigation',
    patterns: [
      /\b(workflow|swarm|multi[\s-]?agent)\s.*(issue|bug|problem|review|investigate|analyze)/i,
      /\b(investigate|review|analyze|debug)\s.*(workflow|swarm|subagent|coordinator)/i,
    ],
  },
];

// =============================================================================
// Suppression Guardrails
// =============================================================================

/** Minimum message length to even consider delegation — short messages are never complex enough */
const MIN_DELEGATION_LENGTH = 50;

/** Maximum word count for trivial messages that should never delegate */
const MAX_TRIVIAL_WORD_COUNT = 8;

/** Patterns for trivial/atomic tasks that should never be delegated */
const SUPPRESSION_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|yep|nope)\b/i,
  /\b(rename|translate|fix\s+typo|add\s+comment|remove\s+import|add\s+import)\b/i,
  /\b(format|lint|prettier|eslint\s+fix)\b/i,
  /\b(run|execute|start|stop|restart)\s+(the\s+)?(server|dev|build|test)/i,
  /\bwhat\s+(is|does|are)\b/i,    // definitional questions
  /\bhow\s+do\s+(I|you)\b/i,      // how-to questions
  /\bexplain\s/i,                  // explanation requests
  /\bshow\s+me\s/i,               // show-me requests
  /^(can|could|should|would|will|is|are|does|do)\s+(I|you|we|it|this)\b/i, // simple yes/no questions
  /\b(list|show|display)\s+(all|me|the)\s/i,  // list/show item requests
  /\b(check|verify)\s+(if|that|whether)\b/i,  // simple check requests
  /\b(add|remove|delete|insert|update|change)\s+(a\s+)?(line|word|comment|import|export|type|const|let|var)\b/i, // minor single edits
  /\bwhat\s+(does|is)\b.{0,30}\?/i, // short definitional questions
];

/** File path reference pattern — single-file tasks rarely need delegation */
const FILE_PATH_PATTERN = /(?:^|\s)((?:src|src-tauri|tests|docs|website|public|scripts)\/[\w/.-]+\.\w+)/;

/**
 * Check if a message should be suppressed from delegation regardless of patterns.
 * Returns a reason string if suppressed, null otherwise.
 */
function shouldSuppressDelegation(msg: string): string | null {
  // Too short
  if (msg.length < MIN_DELEGATION_LENGTH) {
    return `Message too short (${msg.length} chars < ${MIN_DELEGATION_LENGTH})`;
  }

  // Too few words
  const wordCount = msg.split(/\s+/).filter(Boolean).length;
  if (wordCount <= MAX_TRIVIAL_WORD_COUNT) {
    return `Too few words (${wordCount} ≤ ${MAX_TRIVIAL_WORD_COUNT})`;
  }

  // Matches a trivial/atomic task pattern
  for (const pattern of SUPPRESSION_PATTERNS) {
    if (pattern.test(msg)) {
      return `Matches suppression pattern: ${pattern.source}`;
    }
  }

  // Single-file reference without broad scope indicators
  const hasFilePath = FILE_PATH_PATTERN.test(msg);
  const hasBroadScope = BROAD_SCOPE_PATTERNS.some((p) => p.test(msg));
  if (hasFilePath && !hasBroadScope) {
    return 'Single-file task (file path detected, no broad scope)';
  }

  return null;
}

// =============================================================================
// Core Classifier
// =============================================================================

/**
 * Classify a user message into an orchestration intent.
 *
 * Returns the classification with task type, scope, delegation
 * recommendation, area hints, and confidence.
 */
export function classifyIntent(userMessage: string): IntentClassification {
  const msg = userMessage.trim();
  if (!msg) {
    return noDelegate('simple_single_agent_task', 'narrow', [], 'Empty message');
  }

  // 0. Early suppression guardrails — before any pattern matching
  const suppressionReason = shouldSuppressDelegation(msg);
  if (suppressionReason) {
    const areaHints = detectAreaHints(msg);
    return noDelegate('simple_single_agent_task', 'narrow', areaHints, suppressionReason);
  }

  // 1. Detect area hints
  const areaHints = detectAreaHints(msg);

  // 2. Check for broad scope
  const isBroadScope = BROAD_SCOPE_PATTERNS.some((p) => p.test(msg));

  // 3. Match goal patterns (first match wins, ordered by specificity)
  let matchedTaskType: TaskType | null = null;
  for (const goal of GOAL_PATTERNS) {
    if (goal.patterns.some((p) => p.test(msg))) {
      matchedTaskType = goal.taskType;
      break;
    }
  }

  // 4. Determine scope estimate
  const scope = estimateScope(msg, isBroadScope, areaHints);

  // 5. Build classification
  if (matchedTaskType) {
    return buildClassification(matchedTaskType, scope, areaHints, isBroadScope, msg);
  }

  // 6. Fallback: if broad scope detected but no specific goal, it's repo exploration
  if (isBroadScope) {
    return buildClassification('repo_exploration', 'broad', areaHints, true, msg);
  }

  // 7. Area-hint fallback only triggers delegation if scope is not narrow
  //    (prevents delegation on casual mentions of "browser" or "workflow")
  if (areaHints.includes('browser') && scope !== 'narrow') {
    return buildClassification('browser_investigation', scope, areaHints, false, msg);
  }
  if ((areaHints.includes('workflow') || areaHints.includes('swarm')) && scope !== 'narrow') {
    return buildClassification('workflow_swarm_investigation', scope, areaHints, false, msg);
  }

  // 8. Default: simple single-agent task
  return noDelegate('simple_single_agent_task', 'narrow', areaHints, 'No delegation-worthy patterns detected');
}

// =============================================================================
// Helpers
// =============================================================================

function detectAreaHints(msg: string): AreaHint[] {
  const hints: AreaHint[] = [];
  for (const { patterns, hint } of AREA_PATTERNS) {
    if (patterns.some((p) => p.test(msg))) {
      hints.push(hint);
    }
  }
  return hints;
}

function estimateScope(msg: string, isBroadScope: boolean, hints: AreaHint[]): ScopeEstimate {
  if (isBroadScope) return 'broad';
  // Only count as moderate when there are 3+ distinct area hints, or 2+ hints with explicit multi-area framing
  if (hints.length >= 3) return 'moderate';
  if (hints.length >= 2 && EXPLICIT_MULTI_AREA_PATTERN.test(msg)) return 'moderate';
  return 'narrow';
}

/** Pattern for messages explicitly framing a task as spanning multiple areas */
const EXPLICIT_MULTI_AREA_PATTERN = /\b(frontend\s+and|backend\s+and|both|across\s+(the\s+)?|full\s+stack|end[\.\s-]?to[\.\s-]?end)/i;

function buildClassification(
  taskType: TaskType,
  scope: ScopeEstimate,
  areaHints: AreaHint[],
  isBroadScope: boolean,
  _msg: string,
): IntentClassification {
  // Determine whether delegation is warranted
  const shouldDelegate = shouldDelegateForType(taskType, scope, areaHints, isBroadScope);

  // Confidence heuristic
  let confidence = 0.6;
  if (isBroadScope) confidence += 0.15;
  if (areaHints.length > 0) confidence += 0.1;
  if (areaHints.length >= 2) confidence += 0.1;
  confidence = Math.min(confidence, 0.95);

  const reasoning = buildReasoning(taskType, scope, areaHints, shouldDelegate);

  return { taskType, scope, shouldDelegate, areaHints, confidence, reasoning };
}

function shouldDelegateForType(
  taskType: TaskType,
  scope: ScopeEstimate,
  areaHints: AreaHint[],
  isBroadScope: boolean,
): boolean {
  switch (taskType) {
    case 'simple_single_agent_task':
      return false;

    case 'repo_exploration':
      // Only delegate when explicitly broad — not for casual "explore this file"
      return isBroadScope;

    case 'documentation_update':
      // Only delegate if repo-wide scope (need exploration to gather info)
      return isBroadScope;

    case 'architecture_review':
      // Delegate only if broad scope or 2+ distinct areas
      return isBroadScope || areaHints.length >= 2;

    case 'bug_investigation':
      // Only delegate if the investigation explicitly spans multiple areas AND describes
      // a non-trivial scope. Passive co-mention of area terms is not enough — the user
      // must describe a cross-area problem.
      return areaHints.length >= 2 && scope === 'moderate' || (isBroadScope && areaHints.length >= 2);

    case 'release_review':
      // Delegate for broad/moderate scope releases — not for simple "is it safe to release?" questions
      return scope !== 'narrow' || isBroadScope;

    case 'browser_investigation':
      // Delegate only if cross-area (browser + backend)
      return areaHints.includes('rust_backend') && areaHints.length >= 2;

    case 'workflow_swarm_investigation':
      // Only delegate when broad
      return scope === 'broad';

    default:
      return false;
  }
}

function buildReasoning(
  taskType: TaskType,
  scope: ScopeEstimate,
  areaHints: AreaHint[],
  shouldDelegate: boolean,
): string {
  const parts: string[] = [];
  parts.push(`Task type: ${taskType}`);
  parts.push(`Scope: ${scope}`);
  if (areaHints.length > 0) {
    parts.push(`Areas: ${areaHints.join(', ')}`);
  }
  parts.push(shouldDelegate ? 'Delegation recommended' : 'Single-agent execution');
  return parts.join('. ');
}

function noDelegate(
  taskType: TaskType,
  scope: ScopeEstimate,
  areaHints: AreaHint[],
  reasoning: string,
): IntentClassification {
  return {
    taskType,
    scope,
    shouldDelegate: false,
    areaHints,
    confidence: 0.8,
    reasoning,
  };
}
