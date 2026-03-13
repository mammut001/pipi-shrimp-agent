/**
 * Store index - Export all stores and types
 */

// Export all stores
export { useChatStore } from './chatStore';
export { useSettingsStore } from './settingsStore';
export { useUIStore } from './uiStore';

// Export chat types
export type {
  ChatState,
  Session,
  Message,
  Artifact,
} from '../types/chat';

// Export settings types
export type {
  SettingsState,
  ApiConfig,
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
