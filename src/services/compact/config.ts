/**
 * Compact System - Configuration
 * 
 * Layer 1: Microcompact
 * 
 * 源码参考: restored-src/src/services/compact/compactWarningState.ts
 *          restored-src/src/services/compact/microCompact.ts (DEFAULT_*_CONFIG)
 */

import { invoke } from '@tauri-apps/api/core';
import type { AutoCompactConfig, ContextTokenStats } from '../../types/compact';
import { DEFAULT_AUTO_COMPACT_CONFIG } from '../../types/compact';

const CONFIG_KEY = 'pipi-shrimp-compact-config';

/**
 * 获取压缩配置（从 localStorage 恢复）
 */
export function getCompactConfig(): AutoCompactConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      return { ...DEFAULT_AUTO_COMPACT_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_AUTO_COMPACT_CONFIG;
}

export function setCompactConfig(config: Partial<AutoCompactConfig>): void {
  const current = getCompactConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
}

/**
 * 获取 auto compact 是否启用
 * 暂时始终启用，未来可从 settings 中控制
 */
export function isAutoCompactEnabled(): boolean {
  return true;
}

/**
 * 获取当前 token 统计（从 Rust 获取）
 */
export async function getContextTokenStats(sessionId: string): Promise<{
  current: number;
  warning: number;
  blocking: number;
  smThreshold: number;
  legacyThreshold: number;
  userTokens: number;
  assistantTokens: number;
  messageCount: number;
}> {
  const config = getCompactConfig();
  const stats = await invoke<ContextTokenStats>('get_session_token_stats', {
    sessionId,
    configJson: JSON.stringify(config),
  });
  return {
    current: stats.current_tokens,
    warning: stats.warning_threshold,
    blocking: stats.blocking_threshold,
    smThreshold: stats.sm_threshold,
    legacyThreshold: stats.legacy_threshold,
    userTokens: stats.user_tokens,
    assistantTokens: stats.assistant_tokens,
    messageCount: stats.message_count,
  };
}

/**
 * 获取最近的工具结果（调试用）
 */
export async function getRecentToolResults(
  sessionId: string,
  limit: number = 10,
): Promise<Array<{
  id: string;
  tool_call_id: string;
  is_cleared: boolean;
  preview: string;
  timestamp: number;
}>> {
  return invoke('get_recent_tool_results', { sessionId, limit });
}
