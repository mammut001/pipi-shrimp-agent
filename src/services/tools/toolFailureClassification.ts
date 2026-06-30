import { isAskModeToolFailureText, type ExecutionModeId } from '@/services/executionMode';
import { isBrowserNotConnectedToolResult } from '@/services/browser/browserConnectionGate';

const TOOL_FAILURE_PREFIX = /^\s*(error|tool execution blocked|permission denied)/i;

interface StructuredToolFailurePayload {
  error?: unknown;
  error_kind?: unknown;
  message?: unknown;
  cause?: unknown;
}

function parseStructuredToolFailure(text: string): StructuredToolFailurePayload | null {
  try {
    const parsed = JSON.parse(text) as StructuredToolFailurePayload;
    return parsed?.error === true ? parsed : null;
  } catch {
    return null;
  }
}

function structuredFailureText(text: string): string {
  const parsed = parseStructuredToolFailure(text);
  if (!parsed) {
    return text;
  }
  const message = typeof parsed.message === 'string' ? parsed.message : '';
  const cause = typeof parsed.cause === 'string' ? parsed.cause : '';
  return `${message} ${cause}`.trim() || text;
}

const RECOVERABLE_OPERATIONAL_PATTERNS = [
  /\bnot found\b/i,
  /\bno such file\b/i,
  /\bno such directory\b/i,
  /\bENOENT\b/,
  /\bos error 2\b/i,
  /\bdoes not exist\b/i,
  /\bcannot find\b/i,
  /\binvalid tool arguments\b/i,
  /\binvalid arguments\b/i,
  /\bmissing ['"][\w-]+['"] argument\b/i,
  /\bfailed to parse\b/i,
] as const;

/** True when a tool result string represents a failure rather than success output. */
export function isToolFailureText(text: string): boolean {
  const trimmed = text.trim();
  return TOOL_FAILURE_PREFIX.test(trimmed) || parseStructuredToolFailure(trimmed) !== null;
}

function isStandalonePermissionDenied(text: string): boolean {
  const trimmed = text.trim();
  return /^error:\s*permission denied\.?$/i.test(trimmed)
    || /^error:\s*权限已拒绝\.?$/i.test(trimmed);
}

/** Policy, permission-mode, or lane violations that should not be retried via the model loop. */
export function isPolicyToolFailureText(text: string): boolean {
  if (!isToolFailureText(text)) {
    return false;
  }

  const structured = parseStructuredToolFailure(text);
  const inspectText = structured ? structuredFailureText(text) : text;

  if (isAskModeToolFailureText(inspectText)) {
    return true;
  }

  if (structured && typeof structured.error_kind === 'string') {
    if (structured.error_kind === 'permission_denied' || structured.error_kind === 'tool_disabled') {
      return true;
    }
  }

  const normalized = inspectText.toLowerCase();

  if (isStandalonePermissionDenied(inspectText)) {
    return true;
  }
  if (normalized.includes('tool execution blocked')) {
    return true;
  }
  if (normalized.includes('was rejected by backend policy')) {
    return true;
  }
  if (normalized.includes('outside the allowed tool lane')) {
    return true;
  }
  if (normalized.includes('not allowed for execution source')) {
    return true;
  }
  if (/\bnot allowed in \w+ mode\b/.test(normalized)) {
    return true;
  }
  if (/\bblocked:/.test(normalized)) {
    return true;
  }
  if (/tool\s+["'][^"']+["']\s+is disabled/i.test(inspectText)) {
    return true;
  }

  return false;
}

/**
 * Operational failures the model can usually recover from by trying a different path,
 * argument set, or exploration strategy.
 */
export function isRecoverableToolFailureText(text: string): boolean {
  if (!isToolFailureText(text)) {
    return false;
  }
  if (isPolicyToolFailureText(text) || isBrowserNotConnectedToolResult(text)) {
    return false;
  }
  if (RECOVERABLE_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(structuredFailureText(text)))) {
    return true;
  }
  // Default operational tool errors back to the model so it can adapt.
  return true;
}

/**
 * Only short-circuit a failed tool batch when every failure is a policy/infrastructure
 * block. Recoverable operational errors (e.g. missing README) should be fed back to
 * the model for self-correction.
 */
export function buildToolBatchFailureHint(executionModeId: ExecutionModeId | string): string {
  if (executionModeId === 'ask' || executionModeId === 'plan') {
    return '当前为问答/规划模式，部分工具会被拦截。请切换到智能体或绕过模式后重试。';
  }
  if (executionModeId === 'bypass' || executionModeId === 'agent' || executionModeId === 'debug') {
    return '工具执行被策略或权限规则拒绝。请检查路径、命令或项目文件夹范围后重试。';
  }
  return '工具执行被拒绝。请检查当前执行模式、路径或权限设置后重试。';
}

export function shouldShortCircuitFailedToolBatch(contents: string[]): boolean {
  if (contents.length === 0) {
    return false;
  }
  if (!contents.every(isToolFailureText)) {
    return false;
  }
  return contents.every((content) => (
    isPolicyToolFailureText(content) || isBrowserNotConnectedToolResult(content)
  ));
}