/**
 * Token 估算工具
 * 
 * 提供前端 TypeScript 层的 token 估算
 * 源码参考: restored-src/src/services/tokenEstimation.ts
 */

/**
 * 估算文本 token 数
 * - ASCII/英文: ~4 字符/token
 * - CJK (中日韩): ~2 字符/token
 */
export function estimateTextTokens(text: string): number {
  let cjkChars = 0;
  let otherChars = 0;

  for (const c of text) {
    if (c.trim() === '') continue;
    const code = c.codePointAt(0)!;
    const isCjk =
      (0x4e00 <= code && code <= 0x9fff) ||
      (0x3400 <= code && code <= 0x4dbf) ||
      (0xf900 <= code && code <= 0xfaff) ||
      (0x3040 <= code && code <= 0x30ff) ||
      (0xac00 <= code && code <= 0xd7af) ||
      (0x20000 <= code && code <= 0x2a6df) ||
      (0xff00 <= code && code <= 0xffef);
    if (isCjk) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }

  return Math.ceil((otherChars / 4) + (cjkChars / 2));
}

/**
 * 估算消息数组的总 token 数
 * 
 * 源码参考: roughTokenCountEstimationForMessages() 在 tokenEstimation.ts
 */
export async function estimateMessagesTokens(
  messages: {
    role: string;
    content: string;
    tool_calls?: unknown[];
    reasoning?: string;
    token_usage?: BudgetUsageInput;
  }[],
): Promise<number> {
  let total = 0;

  for (const msg of messages) {
    // Real per-message usage (from the API) wins over the character
    // heuristic when available. cache_read still counts toward context
    // window per Anthropic docs, so tokenUsageToBudgetTokens returns the
    // full 4-bucket sum.
    if (msg.token_usage) {
      total += tokenUsageToBudgetTokens(msg.token_usage);
      continue;
    }
    const contentTokens = estimateTextTokens(msg.content || '');
    let effective = contentTokens;

    // tool_calls JSON
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const toolCallsJson = JSON.stringify(msg.tool_calls);
      effective += Math.ceil(estimateTextTokens(toolCallsJson) / 3);
    }

    // reasoning
    if (msg.reasoning) {
      effective += Math.ceil(estimateTextTokens(msg.reasoning) / 2);
    }

    // 已清除的工具结果
    if (msg.content?.includes('[旧工具结果已清除]')) {
      effective = 3;
    }

    total += effective;
  }

  // Claude Code 的 roughTokenCountEstimationForMessages 还乘以 4/3 padding
  return Math.ceil((total * 4) / 3);
}

/**
 * 估算单条消息的 token 数
 */
export function estimateMessageTokens(
  msg: {
    role: string;
    content: string;
    tool_calls?: unknown[];
    reasoning?: string;
    token_usage?: BudgetUsageInput;
  },
): number {
  if (msg.token_usage) {
    return tokenUsageToBudgetTokens(msg.token_usage);
  }
  let tokens = estimateTextTokens(msg.content || '');

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    const toolCallsJson = JSON.stringify(msg.tool_calls);
    tokens += Math.ceil(estimateTextTokens(toolCallsJson) / 3);
  }

  if (msg.reasoning) {
    tokens += Math.ceil(estimateTextTokens(msg.reasoning) / 2);
  }

  if (msg.content?.includes('[旧工具结果已清除]')) {
    return 3;
  }

  return Math.ceil(tokens * 1.33);
}


/**
 * Convert a real usage payload (post-API) into budget-weighted tokens.
 *
 * Anthropic's prompt cache counts toward the context window, so
 * cache_read + cache_create are both added to the budget. Use this when
 * you have a real usage snapshot and want to skip the character-heuristic
 * estimator entirely (more accurate, no re-counting).
 */
export interface BudgetUsageInput {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function tokenUsageToBudgetTokens(usage: BudgetUsageInput): number {
  const in_ = Math.max(0, usage.input_tokens || 0);
  const out = Math.max(0, usage.output_tokens || 0);
  const cr = Math.max(0, usage.cache_read_input_tokens || 0);
  const cc = Math.max(0, usage.cache_creation_input_tokens || 0);
  // All four buckets occupy context (cache_read per Anthropic docs).
  return in_ + out + cr + cc;
}
