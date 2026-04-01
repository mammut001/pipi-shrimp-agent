/**
 * Microcompact State Management
 * 
 * 源码参考:
 * - restored-src/src/services/compact/microCompact.ts
 *   (CACHED_MICROCOMPACT 相关状态管理)
 * - restored-src/src/services/compact/compactWarningState.ts
 */

import type { MicrocompactState } from '../../types/compact';

const STORAGE_KEY = 'pipi-shrimp-microcompact-state';

function createInitialState(): MicrocompactState {
  return {
    has_microcompacted_this_turn: false,
    last_microcompact_at: undefined,
    last_tool_result_clear_at: undefined,
  };
}

/**
 * 获取 microcompact 状态（从 localStorage 恢复）
 */
export function getMicrocompactState(): MicrocompactState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return createInitialState();
}

/**
 * 保存 microcompact 状态
 */
export function setMicrocompactState(state: MicrocompactState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * 标记 microcompact 已完成
 */
export function markMicrocompactDone(): void {
  const state = getMicrocompactState();
  setMicrocompactState({
    ...state,
    has_microcompacted_this_turn: true,
    last_microcompact_at: Date.now(),
    last_tool_result_clear_at: Date.now(),
  });
}

/**
 * 重置 microcompact 状态
 * 
 * 源码参考: resetMicrocompactState() 在 postCompactCleanup.ts
 * 在 compaction 成功后调用，清除所有状态
 */
export function resetMicrocompactState(): void {
  setMicrocompactState(createInitialState());
}

/**
 * 在新的 API 轮次开始时重置 has_microcompacted_this_turn
 * 
 * 源码参考: resetMicrocompactState() 在 postCompactCleanup.ts
 * 
 * 注意：这个在 Layer 1 层面不会自动调用，
 * 因为 microcompact 的目的是每轮检查一次就够了
 */
export function resetMicrocompactForNewTurn(): void {
  const state = getMicrocompactState();
  setMicrocompactState({
    ...state,
    has_microcompacted_this_turn: false,
  });
}
