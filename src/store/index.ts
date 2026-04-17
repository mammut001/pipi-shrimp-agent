/**
 * Store index - Export all stores and types
 */

// Export all stores
export { useChatStore } from './chatStore';
export { useSettingsStore } from './settingsStore';
export { useUIStore } from './uiStore';
export { useWorkflowStore } from './workflowStore';
export { useBrowserAgentStore } from './browserAgentStore';
export { useCdpStore } from './cdpStore';
export { useSwarmStore } from './swarmStore';
export {
  useTelegramStore,
  useTelegramState,
  useTelegramMessages,
  useTelegramConnected,
  useTelegramConnecting,
  useTelegramBotInfo,
  useTelegramError,
  useRecentTelegramMessages,
  useTelegramChats,
} from './telegramStore';

// Export skill store
export { useSkillStore } from './skillStore';

// Export artifacts store
export { useArtifactsStore } from './artifactsStore';
export type { ArtifactItem, ArtifactFileType } from './artifactsStore';
export type { SkillInfo } from './skillStore';

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
  ModelPricing,
  BudgetSettings,
} from '../types/settings';

export {
  DEFAULT_API_CONFIG,
  API_PROVIDERS,
  PROVIDER_MODELS,
  DEFAULT_MODEL_PRICING,
  DEFAULT_BUDGET_SETTINGS,
} from '../types/settings';

// Re-export registry for direct access
export {
  PROVIDER_REGISTRY,
  getProvider,
  getProviderNames,
  getProviderDefaultModelIds,
  getProviderDefaultBaseUrl,
  getProviderDefaultApiFormat,
  resolvePricing,
} from '../shared/providers';
export type { ProviderName, ProviderDef } from '../shared/providers';

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

// Export Telegram types
export type {
  TelegramConnectionStatus,
  TelegramUser,
  TelegramChat,
  TelegramMessageEntity,
  TelegramMessage,
  TelegramBotInfo,
  TelegramUpdate,
  TelegramState,
  TelegramConfig,
} from '../types/telegram';
