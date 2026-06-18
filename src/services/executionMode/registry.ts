/**
 * Chat execution mode registry.
 *
 * Single source of truth for the 5-mode composer dropdown.
 * Each mode describes:
 *  - its user-facing label / icon / description
 *  - its risk level (drives visual treatment + Bypass warning gate)
 *  - the underlying PermissionMode it maps to for tool execution
 *  - the system-prompt suffix it injects
 *  - the approval / confirmation policy
 *  - the allowed tool policy
 *  - whether it is the default and whether it requires an extra warning gate
 *
 * Bypass is intentionally NOT the default. Bypass is visually separated and
 * requires an explicit confirmation in the dropdown.
 */

import type { PermissionMode } from '@/services/tools/toolExecutionPolicy';
import type { TranslationKeys } from '@/i18n/types';

export type ExecutionModeId =
  | 'ask'
  | 'plan'
  | 'debug'
  | 'agent'
  | 'bypass';

export type RiskLevel = 'safe' | 'moderate' | 'elevated' | 'dangerous';

/**
 * What kinds of tool calls the mode allows.
 * - 'none': no tools at all (chat only, like Ask mode)
 * - 'plan': read-only inspection of the bound workspace — Plan mode.
 *   The exact tool list lives in `PLAN_MODE_ALLOWED_TOOLS` so the
 *   registry, the model-facing tool catalog, and the chat engine
 *   `allowedTools` filter stay in sync. Plan-document persistence
 *   is an app-side post-turn action (see `PLAN_MODE_SYSTEM_PROMPT`),
 *   NOT a model-callable tool.
 * - 'read-only': only read tools
 * - 'edit': read + write tools, but no shell/browser
 * - 'shell': read + write + shell
 * - 'full': read + write + shell + browser + mcp + ssh
 */
export type AllowedToolPolicy = 'none' | 'plan' | 'read-only' | 'edit' | 'shell' | 'full';

export type ApprovalPolicy =
  | 'always-ask'        // every tool call requires explicit confirmation
  | 'ask-on-risky'      // safe tools auto-approve, risky tools confirm
  | 'auto-safe-only'    // only explicitly safe tools auto-approve (debug)
  | 'auto-everything';  // Bypass — auto-resolve all

export interface ExecutionModeProfile {
  /** Stable id, used as the enum value in the store and as an i18n key suffix. */
  id: ExecutionModeId;
  /** Localized label key. Resolved with t('executionMode.<id>.label') */
  labelKey: keyof TranslationKeys;
  /** Localized description key. Resolved with t('executionMode.<id>.description') */
  descriptionKey: keyof TranslationKeys;
  /** Visual icon name. The dropdown renders a switch on this. */
  icon: 'plan' | 'bug' | 'agent' | 'bypass' | 'ask';
  /** Risk level drives color, ordering, and warning gates. */
  riskLevel: RiskLevel;
  /** The PermissionMode that tool hooks will see. */
  permissionMode: PermissionMode;
  /** System prompt suffix that gets injected when the mode is active. */
  systemPromptSuffix: string;
  /** Which tools can run without extra confirmation in this mode. */
  allowedToolPolicy: AllowedToolPolicy;
  /** How to gate tool approval. */
  approvalPolicy: ApprovalPolicy;
  /** Whether this mode is the default for new sessions. */
  isDefault: boolean;
  /** Whether the dropdown must show a one-time warning before the user can pick it. */
  requiresWarning: boolean;
  /**
   * If true, the dropdown shows a clear visual separation (separator + label)
   * before this mode. Used to push Bypass to the bottom under an "Advanced" header.
   */
  isAdvanced: boolean;
  /**
   * Honest label shown next to the mode when some advertised behavior is not
   * fully wired yet. Reserved for future use; no current mode sets it.
   */
  experimentalNoteKey?: keyof TranslationKeys;
}

export const EXECUTION_MODES: readonly ExecutionModeProfile[] = Object.freeze([
  {
    id: 'ask',
    labelKey: 'executionMode.ask.label',
    descriptionKey: 'executionMode.ask.description',
    icon: 'ask',
    riskLevel: 'safe',
    // Ask is chat-only; we still map to 'plan-only' so the existing
    // PermissionMode path blocks tool execution before the
    // 5-mode outer guard runs.
    permissionMode: 'plan-only',
    systemPromptSuffix: '',
    allowedToolPolicy: 'none',
    approvalPolicy: 'always-ask',
    // Ask is the default for new chats — simple Q&A must never enter
    // Agent/Bypass tool loops.
    isDefault: true,
    requiresWarning: false,
    isAdvanced: false,
  },
  {
    id: 'plan',
    labelKey: 'executionMode.plan.label',
    descriptionKey: 'executionMode.plan.description',
    icon: 'plan',
    riskLevel: 'safe',
    permissionMode: 'plan-only',
    systemPromptSuffix: '', // appended separately via PLAN_MODE_SYSTEM_PROMPT
    // Plan mode is read-only inspection only — no write/edit/shell/browser/
    // mcp/agent tools, and no `save_plan_doc` (the Rust tool registry
    // does not implement it; plan-doc persistence is an app-side
    // post-turn action in `chatActions.sendMessage`).
    allowedToolPolicy: 'plan',
    approvalPolicy: 'always-ask',
    isDefault: false,
    requiresWarning: false,
    isAdvanced: false,
  },
  {
    id: 'debug',
    labelKey: 'executionMode.debug.label',
    descriptionKey: 'executionMode.debug.description',
    icon: 'bug',
    riskLevel: 'moderate',
    // Use auto-edits: read + write tools auto-approve, but shell/browser/mcp still ask.
    permissionMode: 'auto-edits',
    systemPromptSuffix: '',
    allowedToolPolicy: 'edit',
    approvalPolicy: 'auto-safe-only',
    isDefault: false,
    requiresWarning: false,
    isAdvanced: false,
  },
  {
    id: 'agent',
    labelKey: 'executionMode.agent.label',
    descriptionKey: 'executionMode.agent.description',
    icon: 'agent',
    riskLevel: 'elevated',
    // 'auto-edits' is the closest existing behavior to a normal autonomous
    // agent: edit tools auto-approve, destructive commands still ask.
    permissionMode: 'auto-edits',
    systemPromptSuffix: '',
    allowedToolPolicy: 'shell',
    approvalPolicy: 'ask-on-risky',
    isDefault: false,
    requiresWarning: false,
    isAdvanced: false,
  },
  {
    id: 'bypass',
    labelKey: 'executionMode.bypass.label',
    descriptionKey: 'executionMode.bypass.description',
    icon: 'bypass',
    riskLevel: 'dangerous',
    permissionMode: 'bypass',
    systemPromptSuffix: '',
    allowedToolPolicy: 'full',
    approvalPolicy: 'auto-everything',
    isDefault: false,
    requiresWarning: true,
    isAdvanced: true,
  },
]);

const MODE_INDEX: ReadonlyMap<ExecutionModeId, ExecutionModeProfile> = new Map(
  EXECUTION_MODES.map((profile) => [profile.id, profile]),
);

export function getExecutionMode(id: ExecutionModeId | string | null | undefined): ExecutionModeProfile {
  if (id && typeof id === 'string') {
    const known = MODE_INDEX.get(id as ExecutionModeId);
    if (known) return known;
  }
  return getDefaultExecutionMode();
}

export function getDefaultExecutionMode(): ExecutionModeProfile {
  // The registry explicitly marks isDefault=true; fall back to the first entry
  // if the flag is missing (defensive — should never happen in practice).
  const def = EXECUTION_MODES.find((profile) => profile.isDefault);
  return def ?? EXECUTION_MODES[0]!;
}

export function isExecutionModeId(value: unknown): value is ExecutionModeId {
  return typeof value === 'string' && MODE_INDEX.has(value as ExecutionModeId);
}

export function listExecutionModes(): readonly ExecutionModeProfile[] {
  return EXECUTION_MODES;
}
