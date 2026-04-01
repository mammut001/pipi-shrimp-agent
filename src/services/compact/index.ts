/**
 * Compact System - 统一导出
 * 
 * Layer 1: Microcompact
 * Layer 2: Session Memory Compact
 * Layer 3: Legacy Compact
 */

export { runMicrocompactCheck, resetMicrocompactState, resetMicrocompactForNewTurn } from './microCompact';
export { suppressCompactWarning, clearCompactWarningSuppression, isCompactWarningSuppressed } from './compactWarningState';
export { getMicrocompactState, setMicrocompactState, markMicrocompactDone } from './microCompactState';
export { getCompactConfig, setCompactConfig, isAutoCompactEnabled, getContextTokenStats } from './config';

// Layer 2
export { trySessionMemoryCompact, triggerSessionMemoryCompact } from './sessionMemoryCompact';

// Layer 3
export { 
  compactConversation, 
  triggerLegacyCompact,
  POST_COMPACT_MAX_FILES,
  POST_COMPACT_TOKEN_BUDGET,
  POST_COMPACT_MAX_TOKENS_PER_FILE,
} from './compact';
