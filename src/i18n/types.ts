/**
 * i18n 类型定义
 */

/** 支持的语言 */
export type Locale = 'zh-CN' | 'en-US';

/** 翻译键值对 */
export type TranslationKeys = {
  // 通用
  'common.confirm': string;
  'common.cancel': string;
  'common.save': string;
  'common.delete': string;
  'common.loading': string;
  'common.error': string;
  'common.success': string;
  'common.retry': string;
  'common.close': string;
  'common.or': string;
  'common.preview': string;
  'common.copy': string;

  // 导航
  'nav.chat': string;
  'nav.workflow': string;
  'nav.browser': string;
  'nav.skill': string;
  'nav.settings': string;
  'nav.newChat': string;
  'nav.sessions': string;
  'nav.noSessions': string;

  // 设置页面
  'settings.title': string;
  'settings.apiConfig': string;
  'settings.apiProvider': string;
  'settings.apiKey': string;
  'settings.apiKeyPlaceholder': string;
  'settings.model': string;
  'settings.language': string;
  'settings.languageDescription': string;
  'settings.theme': string;
  'settings.workingDir': string;
  'settings.saveSettings': string;
  'settings.tokenStats': string;
  'settings.tokenStatsDescription': string;

  // 聊天页面
  'chat.inputPlaceholder': string;
  'chat.send': string;
  'chat.stop': string;
  'chat.thinking': string;
  'chat.aiThinking': string;
  'chat.tokenUsage': string;
  'chat.newSession': string;
  'chat.sessionTokenUsage': string;
  'chat.input': string;
  'chat.output': string;
  'chat.total': string;
  'chat.noMessages': string;
  'chat.startConversation': string;

  // 工具执行
  'tool.executing': string;
  'tool.completed': string;
  'tool.failed': string;
  'tool.permissionRequired': string;
  'tool.allow': string;
  'tool.deny': string;
  'tool.allowExecution': string;
  'tool.executionFailed': string;

  // 错误消息
  'error.apiKeyMissing': string;
  'error.networkError': string;
  'error.timeout': string;
  'error.unknown': string;
  'error.messageHistoryEmpty': string;
  'error.noApiConfig': string;

  // 权限模式
  'permission.standard': string;
  'permission.bypass': string;
  'permission.autoEdits': string;
  'permission.planOnly': string;
  'permission.description': string;

  // 时间
  'time.justNow': string;
  'time.minutesAgo': string;
  'time.hoursAgo': string;
  'time.yesterday': string;

  // Token 统计
  'token.daily': string;
  'token.monthly': string;
  'token.byModel': string;
  'token.selectMonth': string;
  'token.noData': string;
  'token.input': string;
  'token.output': string;
  'token.total': string;

  // Session
  'session.bindWorkDir': string;
  'session.unbindWorkDir': string;
  'session.workDirBound': string;
  'session.noWorkDir': string;
  'session.deleteSession': string;
  'session.renameSession': string;
};
