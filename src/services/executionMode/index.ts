/**
 * Barrel export for the execution-mode subsystem.
 */

export {
  EXECUTION_MODES,
  getDefaultExecutionMode,
  getExecutionMode,
  isActiveExecutionModeId,
  isExecutionModeId,
  listExecutionModes,
  normalizeExecutionModeId,
  type ActiveExecutionModeId,
  type AllowedToolPolicy,
  type ApprovalPolicy,
  type ExecutionModeId,
  type ExecutionModeProfile,
  type LegacyExecutionModeId,
  type RiskLevel,
} from './registry';

export {
  getAllowedToolsForMode,
  isAdvancedMode,
  isDefaultMode,
  isToolAllowedForMode,
  isToolAllowedForProfile,
  modeRequiresWarning,
  resolvePermissionMode,
  resolveSessionExecutionModeId,
  executionModeFromPermissionMode,
  hydrateSessionModes,
} from './guards';

export { detectAskModeToolNeed, type AskModeToolNeed, type AskModeToolNeedReason } from './askModeToolNeed';
export {
  isAskModeToolFailureText,
  isGenericSafetyPolicyError,
  shouldOfferExecutionModeUpgrade,
} from './toolPolicyRecovery';
