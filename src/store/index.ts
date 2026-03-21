/**
 * Store index - Export all stores and types
 */

// Export all stores
export { useChatStore } from './chatStore';
export { useSettingsStore } from './settingsStore';
export { useUIStore } from './uiStore';
export { useWorkflowStore } from './workflowStore';

// Export chat types
export type {
  ChatState,
  Session,
  Message,
  Artifact,
  Project,
} from '../types/chat';

// Export settings types
export type {
  SettingsState,
  ApiConfig,
  TokenUsage,
  DailyTokenStats,
  ModelTokenStats,
} from '../types/settings';

export {
  DEFAULT_API_CONFIG,
  API_PROVIDERS,
  PROVIDER_MODELS,
  DEFAULT_WORKING_DIRECTORY,
} from '../types/settings';

// Export UI types
export type {
  UIState,
  PermissionRequest,
  Notification,
} from '../types/ui';

export {
  NOTIFICATION_TIMEOUT,
  NOTIFICATION_TYPES,
} from '../types/ui';

// Export workflow types
export type {
  WorkflowState,
  WorkflowAgent,
  WorkflowConnection,
  WorkflowRun,
  WorkflowRunAgentEntry,
  AgentExecutionConfig,
  OutputRoute,
  WorkflowAgentModel,
  AgentTemplate,
  ExecutionMode,
  RoundCondition,
  RouteCondition,
  ConnectionType,
} from '../types/workflow';

export {
  AGENT_TEMPLATES,
  DEFAULT_EXECUTION_CONFIG,
  AGENT_COLORS,
} from '../types/workflow';
