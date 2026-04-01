/**
 * Compact Warning State
 * 
 * 追踪 compact 警告是否应该被抑制
 * 
 * 源码参考: compactWarningState.ts
 * 
 * 逻辑:
 * - compact 成功后立即 suppress，抑制警告
 * - 下一次 microcompact 开始时 clear，重新允许警告
 * 
 * 这是因为 microcompact 后我们没有准确的 token 数，
 * 要等下一次 API 响应才能得到准确数字
 */

import { create } from 'zustand';

interface CompactWarningStore {
  suppressed: boolean;
  suppress: () => void;
  clear: () => void;
  get: () => boolean;
}

export const useCompactWarningStore = create<CompactWarningStore>((set, get) => ({
  suppressed: false,
  suppress: () => set({ suppressed: true }),
  clear: () => set({ suppressed: false }),
  get: () => get().suppressed,
}));

export function suppressCompactWarning(): void {
  useCompactWarningStore.getState().suppress();
}

export function clearCompactWarningSuppression(): void {
  useCompactWarningStore.getState().clear();
}

export function isCompactWarningSuppressed(): boolean {
  return useCompactWarningStore.getState().get();
}
