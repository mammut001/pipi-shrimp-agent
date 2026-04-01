/**
 * Context Compression System - Type Definitions
 * 
 * Layer 1: Microcompact (每轮自动清理工具结果)
 * Layer 2: Session Memory Compact (基于会话记忆的压缩)
 * Layer 3: Legacy Compact (完整 LLM 摘要压缩)
 */

import type { Message } from './chat';

// ========== Microcompact ==========

/**
 * 单条消息的压缩元数据
 */
export interface MessageCompactMetadata {
  /** 这条消息的工具结果是否被 microcompact 清除 */
  tool_result_cleared?: boolean;
  /** 工具结果被清除的时间戳（毫秒） */
  tool_result_cleared_at?: number;
  /** 该消息关联的 compact boundary UUID */
  compact_boundary_id?: string;
  /** 消息的估算 token 数 */
  estimated_tokens?: number;
  /** 这条消息是否是压缩摘要消息 */
  is_compact_summary?: boolean;
  /** 压缩类型 */
  compact_type?: 'auto' | 'manual' | 'session_memory';
}

/**
 * 扩展后的 Message 类型（增加 optional compact_metadata）
 */
export interface CompactibleMessage extends Message {
  compact_metadata?: MessageCompactMetadata;
}

/**
 * Microcompact 更新结果（Rust 返回给前端）
 */
export interface MicrocompactUpdate {
  message_id: string;
  old_content: string;
  new_content: string;
  cleared_at: number;      // Unix timestamp (秒)
  tool_call_id: string | null;
}

// ========== Token 统计 ==========

export interface ContextTokenStats {
  current_tokens: number;
  warning_threshold: number;
  blocking_threshold: number;
  sm_threshold: number;
  legacy_threshold: number;
  user_tokens: number;
  assistant_tokens: number;
  message_count: number;
}

// ========== Microcompact State ==========

export interface MicrocompactState {
  /** 是否在当前轮次已执行过 microcompact */
  has_microcompacted_this_turn: boolean;
  /** 上次 microcompact 时间戳 */
  last_microcompact_at?: number;
  /** 上次清除工具结果的时间戳 */
  last_tool_result_clear_at?: number;
}

// ========== Compact Warning State ==========

export interface CompactWarningStore {
  suppressed: boolean;
  suppress: () => void;
  clear: () => void;
}

// ========== Auto-Compact Config ==========

export interface AutoCompactConfig {
  /** 微压缩：超过多少个工具结果后触发 */
  micro_max_tool_results: number;
  /** 微压缩：保留最近多少个工具结果 */
  micro_keep_recent_tool_results: number;
  /** 微压缩：空闲多少分钟后触发 */
  micro_idle_minutes: number;
  
  /** Session Memory：自动压缩阈值（token） */
  sm_auto_threshold_tokens: number;
  /** Session Memory：最少保留 token 数 */
  sm_min_keep_tokens: number;
  /** Session Memory：最多保留 token 数 */
  sm_max_keep_tokens: number;
  
  /** Legacy：自动压缩阈值（token） */
  legacy_auto_threshold_tokens: number;
  /** Legacy：保留尾部多少 token */
  legacy_keep_tokens: number;
  
  /** 警告阈值 buffer（距离 legacy threshold 的距离） */
  warning_buffer_tokens: number;
  /** 断路器：最大连续失败次数 */
  max_consecutive_failures: number;
}

export const DEFAULT_AUTO_COMPACT_CONFIG: AutoCompactConfig = {
  micro_max_tool_results: 20,
  micro_keep_recent_tool_results: 10,
  micro_idle_minutes: 60,
  
  sm_auto_threshold_tokens: 80_000,
  sm_min_keep_tokens: 10_000,
  sm_max_keep_tokens: 40_000,
  
  legacy_auto_threshold_tokens: 120_000,
  legacy_keep_tokens: 30_000,
  
  warning_buffer_tokens: 20_000,
  max_consecutive_failures: 3,
};
