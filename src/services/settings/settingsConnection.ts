import type { TranslationKeys } from '@/i18n';
import type { ResolvedChatRequestDiagnostics } from '@/services/resolvedChatRequest';
import { extractErrorDetails } from '@/utils/errorFormat';

export type ConnectionErrorKind =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'model_not_found'
  | 'base_url'
  | 'unknown';

export type TranslateConnectionMessage = (key: keyof TranslationKeys) => string;

const fallbackMessages: Record<ConnectionErrorKind, string> = {
  network: '网络连接失败，请检查您的网络或代理设置。',
  timeout: '连接超时，请稍后重试。',
  auth: 'API 密钥无效或权限不足，请检查您的 API Key。',
  model_not_found: '模型不可用，可能已被禁用或不支持当前区域。',
  base_url: 'API 地址格式有误，请检查 Base URL 配置。',
  unknown: '连接失败，请稍后重试。',
};

const i18nKeys: Record<ConnectionErrorKind, keyof TranslationKeys> = {
  network: 'settings.testConnectionErrorNetwork',
  timeout: 'settings.testConnectionErrorTimeout',
  auth: 'settings.testConnectionErrorAuth',
  model_not_found: 'settings.testConnectionErrorModel',
  base_url: 'settings.testConnectionErrorBaseUrl',
  unknown: 'settings.testConnectionErrorUnknown',
};

export function classifyConnectionError(rawMessage: string): ConnectionErrorKind {
  const lower = rawMessage.toLowerCase();

  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('auth') || lower.includes('invalid api key') || lower.includes('incorrect api key')) return 'auth';
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('not available') || lower.includes('does not exist') || lower.includes('invalid'))) return 'model_not_found';
  if (lower.includes('base url') || lower.includes('baseurl') || lower.includes('url format') || lower.includes('invalid url')) return 'base_url';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection') || lower.includes('dns') || lower.includes('enotfound') || lower.includes('econnrefused')) return 'network';

  return 'unknown';
}

export function getConnectionErrorI18nKey(kind: ConnectionErrorKind): keyof TranslationKeys {
  return i18nKeys[kind];
}

export function getConnectionErrorMessage(
  kind: ConnectionErrorKind,
  translate?: TranslateConnectionMessage,
): string {
  if (translate) {
    return translate(getConnectionErrorI18nKey(kind));
  }

  return fallbackMessages[kind];
}

export function isAuthConnectionError(error: unknown): boolean {
  const details = extractErrorDetails(error);
  const probe = [details.httpCode, details.message].filter(Boolean).join(' ');
  return classifyConnectionError(probe) === 'auth';
}

export function buildConnectionFailureDetails(
  diagnostics: ResolvedChatRequestDiagnostics,
  error: unknown,
): string {
  const details = extractErrorDetails(error);
  const title = isAuthConnectionError(error)
    ? '认证失败：当前 API 配置未通过认证。'
    : '连接测试失败：当前 API 配置请求失败。';

  const lines = [
    title,
    `配置：${diagnostics.selectedConfigName}`,
    `Provider: ${diagnostics.selectedProvider}`,
    `Model: ${diagnostics.selectedModel}`,
    `API Format: ${diagnostics.apiFormat || 'auto'}`,
    `Endpoint Host: ${diagnostics.endpointHost ?? 'unknown'}`,
    `Authorization Header: ${diagnostics.authorizationHeaderPresent ? 'present' : 'missing'}`,
  ];

  if (details.httpCode) {
    lines.push(`HTTP: ${details.httpCode}`);
  }
  if (details.requestId) {
    lines.push(`Request ID: ${details.requestId}`);
  }
  lines.push(`Reason: ${details.message}`);

  return lines.join('\n');
}
