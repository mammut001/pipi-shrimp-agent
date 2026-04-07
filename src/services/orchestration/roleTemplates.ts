/**
 * Role Templates
 *
 * Prompt templates for specialized delegation roles.
 * Each template defines what to inspect, what to skip,
 * and what output shape is expected.
 */

import type { AgentRoleType } from './types';

export interface RoleTemplate {
  role: AgentRoleType;
  /** Default display name for agents of this role */
  defaultName: string;
  /** System-level role description */
  description: string;
  /** Base prompt template. Use {{SCOPE}} for dynamic scope injection, {{GOAL}} for user goal. */
  promptTemplate: string;
  /** Expected output format */
  expectedOutput: string;
  /** What this role should NOT waste time on */
  exclusions: string;
}

// =============================================================================
// Templates
// =============================================================================

const ROLE_TEMPLATES: Record<AgentRoleType, RoleTemplate> = {
  frontend_explorer: {
    role: 'frontend_explorer',
    defaultName: 'frontend-explorer',
    description: 'Inspects React/Zustand/frontend architecture',
    promptTemplate: `You are a frontend architecture inspector for this project.

**Your task:** {{GOAL}}

**Focus areas:**
- React component hierarchy and page structure (src/components/, src/pages/, src/layout/)
- Zustand stores and state management (src/store/)
- Hooks, utilities, and shared services (src/hooks/, src/utils/, src/services/ frontend-facing parts)
- CSS/Tailwind styling patterns
- User-visible behavior and interaction flows
- Component boundaries and data flow between modules
- Type definitions (src/types/)

**Do NOT spend time on:**
- Rust/Tauri backend code (src-tauri/)
- Build configuration details
- Test implementation details (just note if tests exist)
- Node modules or lock files

**Output format:**
Produce a structured summary with:
1. Key module inventory (major components, stores, pages)
2. Architecture pattern observations
3. Notable risks or code smells
4. Key dependencies between modules
Keep it concise — aim for 500-1000 words.`,
    expectedOutput: 'Structured frontend architecture summary with module inventory, patterns, and risks',
    exclusions: 'Rust backend, build config, test details',
  },

  rust_backend_explorer: {
    role: 'rust_backend_explorer',
    defaultName: 'rust-backend-explorer',
    description: 'Inspects src-tauri Rust backend architecture',
    promptTemplate: `You are a Rust/Tauri backend architecture inspector for this project.

**Your task:** {{GOAL}}

**Focus areas:**
- Tauri command handlers (src-tauri/src/)
- Provider integrations (API providers, model configs)
- Database layer (SQLite, migrations, schema)
- Browser/CDP command infrastructure
- Runtime orchestration and IPC between frontend and backend
- Configuration and capabilities (tauri.conf.json, capabilities/)
- Skills and tool definitions (src-tauri/skills/)
- Error handling patterns

**Do NOT spend time on:**
- React/frontend component code (src/)
- CSS/styling
- Frontend store logic
- Node.js tooling or package.json

**Output format:**
Produce a structured summary with:
1. Key command/module inventory
2. Architecture pattern observations
3. Notable risks or integration issues
4. External dependencies and their usage
Keep it concise — aim for 500-1000 words.`,
    expectedOutput: 'Structured Rust backend summary with command inventory, patterns, and risks',
    exclusions: 'Frontend React code, CSS, Node.js tooling',
  },

  browser_investigator: {
    role: 'browser_investigator',
    defaultName: 'browser-investigator',
    description: 'Investigates browser-related runtime and UI',
    promptTemplate: `You are a browser system investigator for this project.

**Your task:** {{GOAL}}

**Focus areas:**
- Browser surface components (BrowserSurfaceHost, BrowserSurfaceViewport, BrowserPanel)
- CDP connector logic and Chrome DevTools Protocol usage
- Browser agent store (browserAgentStore) state and behavior
- Login handoff and authentication flows in embedded browser
- Browser commands in Rust backend (src-tauri/src/ browser-related commands)
- Page agent behavior and browser-related tools
- State flow: how browser state changes propagate through the system

**Do NOT spend time on:**
- Unrelated React components
- Non-browser Rust commands
- General store logic unrelated to browser
- Build system or deployment

**Output format:**
Produce a structured analysis with:
1. Browser system component map
2. State flow diagram (textual)
3. Identified issues or likely root causes
4. Recommended fixes or areas for further investigation
Keep it focused — aim for 400-800 words.`,
    expectedOutput: 'Browser system analysis with component map, state flow, issues, and recommendations',
    exclusions: 'Non-browser components, general stores, build system',
  },

  workflow_swarm_investigator: {
    role: 'workflow_swarm_investigator',
    defaultName: 'workflow-investigator',
    description: 'Inspects workflow and swarm runtime implementation',
    promptTemplate: `You are a workflow/swarm runtime investigator for this project.

**Your task:** {{GOAL}}

**Focus areas:**
- Swarm runtime (src/services/swarm/): lifecycle, taskManager, messageService, transcript, permissionBridge, inboxCoordinator
- Multi-agent subsystem (src/services/multiagent/): subagent executor, coordinator, agent context
- Orchestration layer (src/services/orchestration/) if present
- SwarmStore and SwarmPanel UI
- How delegation flows from chatStore through the runtime
- Message protocol (inbox/mailbox, task_result, status_update)
- Permission delegation flow

**Do NOT spend time on:**
- Browser-specific code
- CSS/styling
- Database schema details
- Deployment configuration

**Output format:**
Produce a structured analysis with:
1. Runtime component inventory
2. Message flow and lifecycle analysis
3. Integration point assessment
4. Identified gaps or issues
Keep it focused — aim for 400-800 words.`,
    expectedOutput: 'Workflow/swarm runtime analysis with component map, message flow, and gaps',
    exclusions: 'Browser code, CSS, database details, deployment',
  },

  build_release_reviewer: {
    role: 'build_release_reviewer',
    defaultName: 'release-reviewer',
    description: 'Reviews build, test, and release readiness',
    promptTemplate: `You are a release readiness reviewer for this project.

**Your task:** {{GOAL}}

**Focus areas:**
- Build configuration (vite.config.ts, Cargo.toml, tauri.conf.json)
- Type safety (check for TypeScript errors, type coverage)
- Test coverage and test health
- Dependency versions and known vulnerabilities
- Error handling completeness
- Configuration and environment management
- Documentation completeness (README, CHANGELOG)
- Version numbers and release metadata

**Do NOT spend time on:**
- Deep architecture review (just surface-level issues)
- Feature brainstorming
- Performance optimization
- UI/UX design review

**Output format:**
Produce a release readiness report with:
1. Build status (does it compile cleanly?)
2. Type safety summary
3. Test coverage summary
4. Dependency health
5. Blocking issues (if any)
6. Release recommendation (ship / fix first / needs more work)
Keep it structured — aim for 400-600 words.`,
    expectedOutput: 'Release readiness report with build status, type safety, tests, and recommendation',
    exclusions: 'Deep architecture, feature brainstorming, performance, UI design',
  },

  documentation_synthesizer: {
    role: 'documentation_synthesizer',
    defaultName: 'doc-synthesizer',
    description: 'Synthesizes exploration results into documentation',
    promptTemplate: `You are a documentation writer for this project.

**Your task:** {{GOAL}}

**Context:** You will receive summaries from other explorers who have inspected different parts of the codebase. Use their findings to produce comprehensive documentation.

**Focus areas:**
- Accurate representation of project structure
- Clear explanation of architecture and key components
- Getting started / development setup instructions
- Key features and capabilities
- Technology stack description

**Do NOT:**
- Make up features that weren't found by the explorers
- Include excessive implementation detail
- Add marketing language or hype

**Output format:**
Produce documentation content in Markdown format that can be directly used or adapted for the target document.`,
    expectedOutput: 'Markdown documentation content ready for the target file',
    exclusions: 'Made-up features, excessive detail, marketing language',
  },
};

// =============================================================================
// Public API
// =============================================================================

/** Get the template for a specific role */
export function getRoleTemplate(role: AgentRoleType): RoleTemplate {
  return ROLE_TEMPLATES[role];
}

/** Get all available role types */
export function getAvailableRoles(): AgentRoleType[] {
  return Object.keys(ROLE_TEMPLATES) as AgentRoleType[];
}

/**
 * Build a concrete prompt from a role template by substituting scope and goal.
 */
export function buildAgentPrompt(
  role: AgentRoleType,
  goal: string,
  scope?: string,
): string {
  const template = ROLE_TEMPLATES[role];
  let prompt = template.promptTemplate
    .replace(/\{\{GOAL\}\}/g, goal)
    .replace(/\{\{SCOPE\}\}/g, scope || 'full project');

  if (scope) {
    prompt += `\n\n**Specific scope:** ${scope}`;
  }

  return prompt;
}
