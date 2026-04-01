/**
 * Compact LLM API Helper
 * 
 * 用于压缩系统调用 LLM 生成摘要/会话记忆
 */

import { invoke } from '@tauri-apps/api/core';
import type { Message } from '../../types/chat';
import { useSettingsStore } from '../../store/settingsStore';

export interface CompactAPIOptions {
  /** 消息历史 */
  messages: Message[];
  /** 系统提示词 */
  systemPrompt?: string;
}

/**
 * 调用 LLM 生成压缩摘要或会话记忆
 * 
 * 使用 `send_claude_sdk_chat` (非流式) 调用
 * 
 * 注意：这是纯文本补全，不使用工具
 */
export async function callCompactLLM(
  options: CompactAPIOptions,
): Promise<string> {
  const { messages, systemPrompt = '' } = options;

  // 获取 API 配置
  const apiConfig = useSettingsStore.getState().getActiveConfig();
  if (!apiConfig?.apiKey) {
    throw new Error('No API configuration found. Please add an API key in Settings.');
  }

  // 转换消息格式
  // Rust send_claude_sdk_chat 期望 Vec<Message>
  const apiMessages = messages.map((m) => ({
    role: m.role === 'user' && m.content.startsWith('__TOOL_RESULT__:')
      ? 'user'
      : (m.role as 'user' | 'assistant' | 'system'),
    content: m.content,
    ...(m.tool_calls && m.tool_calls.length > 0
      ? {
          tool_calls: m.tool_calls.map((tc) => ({
            tool_call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        }
      : {}),
  }));

  // 调用 Rust 后端（非流式）
  const response = await invoke<{
    content: string;
    artifacts: Array<{ type: string; content: string; title?: string; language?: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
    tool_calls: Array<{ tool_call_id: string; name: string; arguments: string }>;
  }>('send_claude_sdk_chat', {
    messages: apiMessages,
    apiKey: apiConfig.apiKey,
    model: apiConfig.model,
    baseUrl: apiConfig.baseUrl || null,
    systemPrompt,
    browserConnected: false,
  });

  return response.content;
}
