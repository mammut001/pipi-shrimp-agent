import { detectBrowserIntent } from '@/services/browser/browserIntent';

export type AskModeToolNeedReason = 'browser' | 'workspace' | 'general';

const ASK_MODE_TOOL_REQUEST_PATTERNS = [
  /\b(?:read|open|inspect|list|search|scan|summari[sz]e)\b/i,
  /(?:读取|查看|检查|列出|搜索|扫描|总结|概括)/,
];

const ASK_MODE_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|cargo|git|make|install|build|test)\b/i,
  /\b(?:run|execute)\s+\S+/i,
  /(?:运行|执行|编译|构建|测试|安装|部署)/,
];

export interface AskModeToolNeed {
  needed: boolean;
  reason: AskModeToolNeedReason;
}

/**
 * Detect whether a user message in Ask mode likely requires tools
 * (browser, workspace reads, shell, etc.) and should prompt a mode upgrade.
 */
export function detectAskModeToolNeed(input: string): AskModeToolNeed {
  const trimmed = input.trim();
  if (!trimmed) {
    return { needed: false, reason: 'general' };
  }

  if (detectBrowserIntent(trimmed)) {
    return { needed: true, reason: 'browser' };
  }

  if (ASK_MODE_TOOL_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { needed: true, reason: 'workspace' };
  }

  if (ASK_MODE_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { needed: true, reason: 'general' };
  }

  return { needed: false, reason: 'general' };
}
