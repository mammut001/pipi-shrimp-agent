/**
 * 中文翻译
 */

import type { TranslationKeys } from '../types';

const zhCN: TranslationKeys = {
  // 通用
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.delete': '删除',
  'common.loading': '加载中...',
  'common.error': '错误',
  'common.success': '成功',
  'common.retry': '重试',
  'common.close': '关闭',
  'common.or': '或',

  // 导航
  'nav.chat': '对话',
  'nav.workflow': '工作流',
  'nav.browser': '浏览器',
  'nav.skill': '技能',
  'nav.settings': '设置',
  'nav.newChat': '新建对话',
  'nav.sessions': '对话列表',
  'nav.noSessions': '暂无对话',

  // 设置页面
  'settings.title': '设置',
  'settings.apiConfig': 'API 配置',
  'settings.apiProvider': 'API 提供商',
  'settings.apiKey': 'API 密钥',
  'settings.apiKeyPlaceholder': '输入您的 API 密钥',
  'settings.model': '模型',
  'settings.language': '语言',
  'settings.languageDescription': '选择界面语言',
  'settings.theme': '主题',
  'settings.workingDir': '工作目录',
  'settings.saveSettings': '保存设置',
  'settings.tokenStats': 'Token 使用统计',
  'settings.tokenStatsDescription': '查看您的 API token 消耗情况',

  // 聊天页面
  'chat.inputPlaceholder': '输入消息...',
  'chat.send': '发送',
  'chat.stop': '停止',
  'chat.thinking': '思考中...',
  'chat.aiThinking': 'AI 正在思考...',
  'chat.tokenUsage': 'Token 使用量',
  'chat.newSession': '新建对话',
  'chat.sessionTokenUsage': '本次会话',
  'chat.input': '输入',
  'chat.output': '输出',
  'chat.total': '总计',
  'chat.noMessages': '暂无消息',
  'chat.startConversation': '开始对话吧',

  // 工具执行
  'tool.executing': '正在执行工具...',
  'tool.completed': '执行完成',
  'tool.failed': '执行失败',
  'tool.permissionRequired': '需要权限',
  'tool.allow': '允许',
  'tool.deny': '拒绝',
  'tool.allowExecution': '允许执行',
  'tool.executionFailed': '执行失败',

  // 错误消息
  'error.apiKeyMissing': '请在设置中添加 API 密钥',
  'error.networkError': '网络错误，请检查网络连接',
  'error.timeout': '请求超时，请重试',
  'error.unknown': '未知错误',
  'error.messageHistoryEmpty': '消息历史为空，无法继续对话',
  'error.noApiConfig': '未找到 API 配置，请在设置中添加 API 密钥',

  // 权限模式
  'permission.standard': '标准模式',
  'permission.bypass': '自动执行',
  'permission.autoEdits': '自动编辑',
  'permission.planOnly': '仅规划',
  'permission.description': '选择 AI 的执行权限模式',

  // 时间
  'time.justNow': '刚刚',
  'time.minutesAgo': '分钟前',
  'time.hoursAgo': '小时前',
  'time.yesterday': '昨天',

  // Token 统计
  'token.daily': '每日',
  'token.monthly': '月度',
  'token.byModel': '按模型',
  'token.selectMonth': '选择月份',
  'token.noData': '暂无数据',
  'token.input': '输入',
  'token.output': '输出',
  'token.total': '总计',

  // Session
  'session.bindWorkDir': '绑定工作目录',
  'session.unbindWorkDir': '解绑工作目录',
  'session.workDirBound': '已绑定工作目录',
  'session.noWorkDir': '未绑定工作目录',
  'session.deleteSession': '删除对话',
  'session.renameSession': '重命名对话',
};

export default zhCN;
