/**
 * Chat execution mode registry.
 *
 * Product-facing modes are intentionally limited to three:
 *  - Ask: chat-only Q&A.
 *  - Plan: read-only investigation and planning.
 *  - Danger: full agent/tool surface with explicit destructive-action discipline.
 *
 * Historical `debug`, `agent`, and `bypass` ids remain accepted only as
 * compatibility aliases so persisted sessions can be hydrated safely. They are
 * never exposed in the composer dropdown.
 */

import type { PermissionMode } from '@/services/tools/toolExecutionPolicy';
import type { TranslationKeys } from '@/i18n/types';

export type ActiveExecutionModeId = 'ask' | 'plan' | 'danger';
export type LegacyExecutionModeId = 'debug' | 'agent' | 'bypass';
export type ExecutionModeId = ActiveExecutionModeId | LegacyExecutionModeId;

export type RiskLevel = 'safe' | 'moderate' | 'elevated' | 'dangerous';

/**
 * What kinds of tool calls the mode allows.
 * - 'none': no tools at all.
 * - 'plan': read-only workspace inspection.
 * - 'read-only'/'edit'/'shell': retained for compatibility with the guard layer.
 * - 'full': complete tool catalog; the PermissionMode still decides approvals.
 */
export type AllowedToolPolicy = 'none' | 'plan' | 'read-only' | 'edit' | 'shell' | 'full';

export type ApprovalPolicy =
  | 'always-ask'
  | 'ask-on-risky'
  | 'auto-safe-only'
  | 'auto-everything';

export interface ExecutionModeProfile {
  id: ActiveExecutionModeId;
  labelKey: keyof TranslationKeys;
  descriptionKey: keyof TranslationKeys;
  icon: 'plan' | 'bug' | 'agent' | 'bypass' | 'ask';
  riskLevel: RiskLevel;
  permissionMode: PermissionMode;
  /** Mode harness appended to the system prompt for every turn. */
  systemPromptSuffix: string;
  allowedToolPolicy: AllowedToolPolicy;
  approvalPolicy: ApprovalPolicy;
  isDefault: boolean;
  requiresWarning: boolean;
  isAdvanced: boolean;
  experimentalNoteKey?: keyof TranslationKeys;
}

const ASK_MODE_HARNESS = `# ASK HARNESS

You are in Ask mode for this turn.
- Answer the user's question directly and concisely using the conversation context you already have.
- No tools are available. Do not emit tool calls, XML tool tags, pseudo-tool syntax, or promises to inspect files later.
- If the request genuinely requires repository/file/browser/shell access, say so briefly and recommend Plan for read-only investigation or Danger for execution.`;

const PLAN_MODE_HARNESS = `# PLAN HARNESS

You are in Plan mode for this turn.
- Investigate with read-only tools only. Never create, edit, move, rename, delete, install, execute shell commands, or otherwise mutate state.
- Produce a decision-ready plan grounded in what you actually inspected: goal, current-state findings, ordered implementation steps, verification, rollback, and remaining risks.
- Before proposing deletion or replacement, identify references, dependents, persisted-data compatibility, and migration/rollback requirements. If the scope is ambiguous, call that ambiguity out explicitly.
- Do not claim that implementation or validation ran when it did not.`;

const DANGER_MODE_HARNESS = `# DANGER HARNESS

You are in Danger mode for this turn. You may use the full tool surface to complete the user's task end-to-end.
- Be proactive: inspect, implement, verify, and report concrete results instead of stopping at a plan.
- Destructive operations require a double-check before execution. First identify the exact targets, then check references/dependents and persisted-data compatibility, and finally verify the requested scope one more time immediately before delete/overwrite/reset/migration actions.
- Prefer reversible changes (branch, backup, move, deprecate, migration) over irreversible deletion when both satisfy the request.
- After mutations, verify the resulting state and surface anything not validated.
- "Danger" grants capability, not permission to ignore product safety, repository protections, user scope, or external authorization boundaries.`;

export const EXECUTION_MODES: readonly ExecutionModeProfile[] = Object.freeze([
  {
    id: 'ask',
    labelKey: 'executionMode.ask.label',
    descriptionKey: 'executionMode.ask.description',
    icon: 'ask',
    riskLevel: 'safe',
    permissionMode: 'plan-only',
    systemPromptSuffix: ASK_MODE_HARNESS,
    allowedToolPolicy: 'none',
    approvalPolicy: 'always-ask',
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
    systemPromptSuffix: PLAN_MODE_HARNESS,
    allowedToolPolicy: 'plan',
    approvalPolicy: 'always-ask',
    isDefault: false,
    requiresWarning: false,
    isAdvanced: false,
  },
  {
    id: 'danger',
    // Reuse the existing Bypass translation keys during the compatibility
    // window. The dropdown renders the product name "Danger" explicitly.
    labelKey: 'executionMode.bypass.label',
    descriptionKey: 'executionMode.bypass.description',
    icon: 'bypass',
    riskLevel: 'dangerous',
    // Full catalog, but keep the existing risky-action approval path instead
    // of silently inheriting legacy Bypass auto-approval semantics.
    permissionMode: 'auto-edits',
    systemPromptSuffix: DANGER_MODE_HARNESS,
    allowedToolPolicy: 'full',
    approvalPolicy: 'ask-on-risky',
    isDefault: false,
    requiresWarning: true,
    isAdvanced: false,
  },
]);

const MODE_INDEX: ReadonlyMap<ActiveExecutionModeId, ExecutionModeProfile> = new Map(
  EXECUTION_MODES.map((profile) => [profile.id, profile]),
);

const LEGACY_MODE_MIGRATION: Readonly<Record<LegacyExecutionModeId, ActiveExecutionModeId>> = Object.freeze({
  // Debug/Agent are intentionally reduced to read-only planning rather than
  // silently escalating old sessions into the new Danger capability.
  debug: 'plan',
  agent: 'plan',
  // Legacy Bypass was already the explicit high-risk mode.
  bypass: 'danger',
});

export function normalizeExecutionModeId(
  id: ExecutionModeId | string | null | undefined,
): ActiveExecutionModeId {
  if (id && MODE_INDEX.has(id as ActiveExecutionModeId)) {
    return id as ActiveExecutionModeId;
  }
  if (id === 'debug' || id === 'agent' || id === 'bypass') {
    return LEGACY_MODE_MIGRATION[id];
  }
  return getDefaultExecutionMode().id;
}

export function getExecutionMode(
  id: ExecutionModeId | string | null | undefined,
): ExecutionModeProfile {
  return MODE_INDEX.get(normalizeExecutionModeId(id)) ?? getDefaultExecutionMode();
}

export function getDefaultExecutionMode(): ExecutionModeProfile {
  const def = EXECUTION_MODES.find((profile) => profile.isDefault);
  return def ?? EXECUTION_MODES[0]!;
}

/** Accept active ids plus historical ids that can be migrated safely. */
export function isExecutionModeId(value: unknown): value is ExecutionModeId {
  return (
    typeof value === 'string' &&
    (MODE_INDEX.has(value as ActiveExecutionModeId) ||
      value === 'debug' ||
      value === 'agent' ||
      value === 'bypass')
  );
}

export function isActiveExecutionModeId(value: unknown): value is ActiveExecutionModeId {
  return typeof value === 'string' && MODE_INDEX.has(value as ActiveExecutionModeId);
}

export function listExecutionModes(): readonly ExecutionModeProfile[] {
  return EXECUTION_MODES;
}
