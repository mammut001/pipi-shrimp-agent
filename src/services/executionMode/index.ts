/**
 * Barrel export for the execution-mode subsystem.
 */

export {
  EXECUTION_MODES,
  getDefaultExecutionMode,
  getExecutionMode,
  isExecutionModeId,
  listExecutionModes,
  type AllowedToolPolicy,
  type ApprovalPolicy,
  type ExecutionModeId,
  type ExecutionModeProfile,
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
