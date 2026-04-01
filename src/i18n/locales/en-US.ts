/**
 * English Translation
 */

import type { TranslationKeys } from '../types';

const enUS: TranslationKeys = {
  // Common
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.loading': 'Loading...',
  'common.error': 'Error',
  'common.success': 'Success',
  'common.retry': 'Retry',
  'common.close': 'Close',
  'common.or': 'or',
  'common.preview': 'Preview',
  'common.copy': 'Copy',

  // Navigation
  'nav.chat': 'Chat',
  'nav.workflow': 'Workflow',
  'nav.browser': 'Browser',
  'nav.skill': 'Skill',
  'nav.settings': 'Settings',
  'nav.newChat': 'New Chat',
  'nav.sessions': 'Sessions',
  'nav.noSessions': 'No sessions yet',

  // Settings page
  'settings.title': 'Settings',
  'settings.apiConfig': 'API Configuration',
  'settings.apiProvider': 'API Provider',
  'settings.apiKey': 'API Key',
  'settings.apiKeyPlaceholder': 'Enter your API key',
  'settings.model': 'Model',
  'settings.language': 'Language',
  'settings.languageDescription': 'Select interface language',
  'settings.theme': 'Theme',
  'settings.workingDir': 'Working Directory',
  'settings.saveSettings': 'Save Settings',
  'settings.tokenStats': 'Token Usage Statistics',
  'settings.tokenStatsDescription': 'View your API token consumption',

  // Chat page
  'chat.inputPlaceholder': 'Type a message...',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.thinking': 'Thinking...',
  'chat.aiThinking': 'AI is thinking...',
  'chat.tokenUsage': 'Token Usage',
  'chat.newSession': 'New Chat',
  'chat.sessionTokenUsage': 'This session',
  'chat.input': 'Input',
  'chat.output': 'Output',
  'chat.total': 'Total',
  'chat.noMessages': 'No messages yet',
  'chat.startConversation': 'Start a conversation',

  // Tool execution
  'tool.executing': 'Executing tool...',
  'tool.completed': 'Completed',
  'tool.failed': 'Failed',
  'tool.permissionRequired': 'Permission Required',
  'tool.allow': 'Allow',
  'tool.deny': 'Deny',
  'tool.allowExecution': 'Allow Execution',
  'tool.executionFailed': 'Execution Failed',

  // Error messages
  'error.apiKeyMissing': 'Please add an API key in Settings',
  'error.networkError': 'Network error, please check your connection',
  'error.timeout': 'Request timeout, please retry',
  'error.unknown': 'Unknown error',
  'error.messageHistoryEmpty': 'Message history is empty, cannot continue conversation',
  'error.noApiConfig': 'No API configuration found, please add an API key in Settings',

  // Permission modes
  'permission.standard': 'Standard',
  'permission.bypass': 'Bypass',
  'permission.autoEdits': 'Auto Edits',
  'permission.planOnly': 'Plan Only',
  'permission.description': 'Select AI execution permission mode',

  // Time
  'time.justNow': 'Just now',
  'time.minutesAgo': 'minutes ago',
  'time.hoursAgo': 'hours ago',
  'time.yesterday': 'Yesterday',

  // Token statistics
  'token.daily': 'Daily',
  'token.monthly': 'Monthly',
  'token.byModel': 'By Model',
  'token.selectMonth': 'Select Month',
  'token.noData': 'No data yet',
  'token.input': 'Input',
  'token.output': 'Output',
  'token.total': 'Total',
  'token.cost': 'Cost',
  'token.estimatedCost': 'Estimated cost',
  'token.totalCost': 'Total cost',

  // Session
  'session.bindWorkDir': 'Bind Work Directory',
  'session.unbindWorkDir': 'Unbind Work Directory',
  'session.workDirBound': 'Work directory bound',
  'session.noWorkDir': 'No work directory',
  'session.deleteSession': 'Delete Session',
  'session.renameSession': 'Rename Session',
};

export default enUS;
