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
  isAdvancedMode,
  isDefaultMode,
  isToolAllowedForMode,
  isToolAllowedForProfile,
  modeRequiresWarning,
  resolvePermissionMode,
} from './guards';
