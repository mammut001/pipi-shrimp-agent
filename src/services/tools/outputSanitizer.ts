const MAX_TOOL_OUTPUT_LENGTH = 12_000;

const ANSI_ESCAPE_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const AUTH_HEADER_RE = /(authorization\s*:\s*)([^\r\n]+)/gi;
const BEARER_TOKEN_RE = /\bbearer\s+[a-z0-9._-]{8,}\b/gi;
const SECRET_ASSIGNMENT_RE = /(^|[\r\n])([A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*=).+/gi;
const API_KEY_RE = /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,})\b/g;
const URL_CREDENTIAL_RE = /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/gi;
const URL_TOKEN_RE = /([?&](?:token|key|api_key|access_token)=)([^&#\s]+)/gi;
const WINDOWS_HOME_RE = /[A-Z]:\\Users\\[^\\/\s]+/gi;

function sanitizeString(value: string): string {
  let sanitized = value
    .replace(ANSI_ESCAPE_RE, '')
    .replace(CONTROL_CHAR_RE, '')
    .replace(AUTH_HEADER_RE, '$1[redacted]')
    .replace(BEARER_TOKEN_RE, 'Bearer [redacted]')
    .replace(SECRET_ASSIGNMENT_RE, '$1$2[redacted]')
    .replace(API_KEY_RE, '[redacted]')
    .replace(URL_CREDENTIAL_RE, 'https://[redacted]@')
    .replace(URL_TOKEN_RE, '$1[redacted]')
    .replace(WINDOWS_HOME_RE, '~');

  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  if (home) {
    sanitized = sanitized.split(home).join('~');
  }

  return sanitized;
}

function sanitizeValue(value: unknown, redactSshIdentity: boolean, keyPath = ''): unknown {
  const key = keyPath.split('.').pop()?.toLowerCase() ?? '';

  if (typeof value === 'string') {
    if (redactSshIdentity && (key === 'host' || key === 'user' || key === 'username')) {
      return '[redacted]';
    }
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeValue(entry, redactSshIdentity, `${keyPath}[${index}]`));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, redactSshIdentity, keyPath ? `${keyPath}.${childKey}` : childKey),
      ]),
    );
  }

  return value;
}

function truncateString(value: string): { content: string; outputTruncated: boolean } {
  if (value.length <= MAX_TOOL_OUTPUT_LENGTH) {
    return { content: value, outputTruncated: false };
  }

  return {
    content: `${value.slice(0, MAX_TOOL_OUTPUT_LENGTH)}\n...[tool output truncated: ${value.length - MAX_TOOL_OUTPUT_LENGTH} more chars]`,
    outputTruncated: true,
  };
}

export interface SanitizedToolOutput {
  content: string;
  sanitized: boolean;
  outputTruncated: boolean;
  originalLength: number;
}

export function sanitizeToolExecutionContent(
  toolName: string,
  content: string,
): SanitizedToolOutput {
  const originalLength = content.length;
  const redactSshIdentity = toolName.startsWith('ssh_');
  const trimmed = content.trim();

  let sanitizedContent = sanitizeString(content);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      sanitizedContent = JSON.stringify(sanitizeValue(JSON.parse(content), redactSshIdentity));
    } catch {
      sanitizedContent = sanitizeString(content);
    }
  }

  const truncated = truncateString(sanitizedContent);
  return {
    content: truncated.content,
    sanitized: sanitizedContent !== content,
    outputTruncated: truncated.outputTruncated,
    originalLength,
  };
}
