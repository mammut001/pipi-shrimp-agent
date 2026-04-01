/**
 * Layer 1: Microcompact - 微压缩
 * 
 * 每轮自动检查并清理旧的工具结果
 * 
 * 源码参考:
 * - restored-src/src/services/compact/microCompact.ts
 *   microcompactMessages(), evaluateTimeBasedTrigger(), maybeTimeBasedMicrocompact()
 * - restored-src/src/services/compact/compactWarningState.ts
 */

import { invoke } from '@tauri-apps/api/core';
import type { MicrocompactUpdate } from '../../types/compact';
import { getCompactConfig } from './config';
import {
  getMicrocompactState,
  markMicrocompactDone,
  resetMicrocompactForNewTurn,
} from './microCompactState';
import { suppressCompactWarning, clearCompactWarningSuppression } from './compactWarningState';

// ============================================================================
// 核心触发函数
// ============================================================================

/**
 * 在每次 API 响应后调用，检查是否需要 microcompact
 * 
 * 这是 Layer 1 的唯一入口函数。
 * 在 chatStore.ts 的 streaming 完成后调用。
 * 
 * 触发路径:
 * 1. 时间触发: 距离上次 assistant 消息超过 micro_idle_minutes
 * 2. 计数触发: 未清除的工具结果数量超过 micro_max_tool_results
 * 
 * 源码参考: microcompactMessages() 在 microCompact.ts
 */
export async function runMicrocompactCheck(
  sessionId: string,
): Promise<{ did_compact: boolean; updates?: MicrocompactUpdate[] }> {
  // 每次新的 API 轮次开始时，清除 suppression 状态
  // 源码: clearCompactWarningSuppression() 在 microcompactMessages() 开头
  clearCompactWarningSuppression();

  const config = getCompactConfig();
  const state = getMicrocompactState();

  // 检查：是否已在本轮执行过
  // 源码: microCompact.ts 中的 has_microcompacted_this_turn 检查
  if (state.has_microcompacted_this_turn) {
    return { did_compact: false };
  }

  // ========== 触发路径 1：时间触发 ==========
  // 源码: evaluateTimeBasedTrigger() → maybeTimeBasedMicrocompact()
  // 如果距离上次 assistant 消息超过 micro_idle_minutes，清除旧工具结果
  const timeResult = await checkTimeBasedMicrocompact(sessionId, config);
  if (timeResult.triggered && timeResult.updates && timeResult.updates.length > 0) {
    markMicrocompactDone();
    suppressCompactWarning(); // 成功压缩后抑制警告
    return { did_compact: true, updates: timeResult.updates };
  }

  // ========== 触发路径 2：计数触发 ==========
  // pipi-shrimp-agent 扩展（Claude Code 原版无此逻辑）
  // 如果工具结果数量超过阈值，保留最近 N 个
  const countResult = await checkCountBasedMicrocompact(sessionId, config);
  if (countResult.triggered && countResult.updates && countResult.updates.length > 0) {
    markMicrocompactDone();
    suppressCompactWarning();
    return { did_compact: true, updates: countResult.updates };
  }

  return { did_compact: false };
}

// ============================================================================
// 时间触发检查
// ============================================================================

interface TimeTriggerResult {
  triggered: boolean;
  updates?: MicrocompactUpdate[];
}

/**
 * 时间触发的 microcompact
 * 
 * 触发条件:
 * - 当前时间 - 上次 assistant 消息时间 > micro_idle_minutes(60min)
 * - 且有至少 1 个工具结果可清除
 * 
 * 清除策略:
 * - 保留最近 micro_keep_recent_tool_results(10) 个
 * - 其余替换为 "[旧工具结果已清除]"
 * 
 * 源码参考: maybeTimeBasedMicrocompact() 在 microCompact.ts
 */
async function checkTimeBasedMicrocompact(
  sessionId: string,
  config: ReturnType<typeof getCompactConfig>,
): Promise<TimeTriggerResult> {
  const updates = await invoke<MicrocompactUpdate[]>('microcompact_clear_old_tool_results', {
    sessionId,
    keepCount: config.micro_keep_recent_tool_results,
    idleMinutes: config.micro_idle_minutes,
  });

  if (updates.length === 0) {
    return { triggered: false };
  }

  return { triggered: true, updates };
}

// ============================================================================
// 计数触发检查
// ============================================================================

interface CountTriggerResult {
  triggered: boolean;
  updates?: MicrocompactUpdate[];
}

/**
 * 计数触发的 microcompact（pipi-shrimp-agent 扩展）
 * 
 * 触发条件:
 * - 未清除的工具结果数量 > micro_max_tool_results(20)
 * 
 * 清除策略:
 * - 保留最近 micro_keep_recent_tool_results(10) 个
 * - 其余替换为 "[旧工具结果已清除]"
 */
async function checkCountBasedMicrocompact(
  sessionId: string,
  config: ReturnType<typeof getCompactConfig>,
): Promise<CountTriggerResult> {
  const updates = await invoke<MicrocompactUpdate[]>('microcompact_by_count', {
    sessionId,
    maxToolResults: config.micro_max_tool_results,
    keepCount: config.micro_keep_recent_tool_results,
  });

  if (updates.length === 0) {
    return { triggered: false };
  }

  return { triggered: true, updates };
}

// ============================================================================
// 状态管理
// ============================================================================

/**
 * 在新的 API 轮次开始时调用，重置 has_microcompacted_this_turn
 * 
 * 源码参考: resetMicrocompactState() 在 postCompactCleanup.ts
 * 注意：这只在 session 级别清除，页面刷新后通过 localStorage 恢复
 */
export { resetMicrocompactForNewTurn };

/**
 * 应用 microcompact 更新
 * 
 * 将 Rust 返回的更新应用到 Zustand store 和 SQLite
 * 1. 更新消息的 content
 * 2. 更新消息的 compact_metadata
 * 
 * 源码参考: applyMicrocompactUpdates() 在 microCompact.ts
 */
export async function applyMicrocompactUpdates(
  updates: MicrocompactUpdate[],
  _sessionId: string,
): Promise<void> {
  if (updates.length === 0) return;

  // 获取 chatStore
  const { useChatStore } = await import('../../store/chatStore');
  const store = useChatStore.getState();

  for (const update of updates) {
    // 1. 更新 SQLite（Rust 已更新，但确保一致性）
    try {
      await invoke('db_save_message', {
        message: {
          id: update.message_id,
          content: update.new_content,
        },
      });
    } catch (e) {
      console.warn('[applyMicrocompactUpdates] Failed to persist to DB:', e);
    }

    // 2. 更新 Zustand store 中的消息
    // 通过 updateMessageContent API 更新 content 和 metadata
    store.updateMessageContent?.(
      update.message_id,
      update.new_content,
      {
        compact_metadata: {
          tool_result_cleared: true,
          tool_result_cleared_at: update.cleared_at,
          estimated_tokens: 5, // [旧工具结果已清除] is very small
        },
      }
    );
  }

  console.log('[Microcompact] Applied', updates.length, 'updates');
}

/**
 * 重置 microcompact 状态（在 compaction 成功后调用）
 * 
 * 源码参考: resetMicrocompactState() 在 postCompactCleanup.ts
 */
export { resetMicrocompactState } from './microCompactState';
