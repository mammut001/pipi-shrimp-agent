/**
 * Layer 2: Session Memory Compact
 * 
 * 当 Layer 1 (Microcompact) 不够用时，
 * 用 Session Memory 文件替代旧消息，保持上下文连续性。
 * 
 * 源码参考:
 * - restored-src/src/services/compact/sessionMemoryCompact.ts
 */

import { invoke } from '@tauri-apps/api/core';
import type { CompactibleMessage } from '../../types/compact';
import type { Message } from '../../types/chat';
import { getCompactConfig } from './config';
import {
  getSessionMemoryState,
  setSessionMemoryState,
  getEffectiveSessionMemory,
  initSessionMemory,
} from './sessionMemory';
import { estimateMessagesTokens, estimateMessageTokens } from '../tokens/tokenEstimator';

// ============================================================================
// 配置
// ============================================================================

export interface SessionMemoryCompactConfig {
  /** 最少保留 token 数 */
  minTokens: number;
  /** 最少保留含文本消息数 */
  minTextBlockMessages: number;
  /** 最多保留 token 数（硬上限） */
  maxTokens: number;
}

export const DEFAULT_SM_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
};

let smCompactConfig: SessionMemoryCompactConfig = { ...DEFAULT_SM_COMPACT_CONFIG };

export function getSMCompactConfig(): SessionMemoryCompactConfig {
  return { ...smCompactConfig };
}

export function setSMCompactConfig(config: Partial<SessionMemoryCompactConfig>): void {
  smCompactConfig = { ...smCompactConfig, ...config };
}

// ============================================================================
// 核心：Session Memory Compact
// ============================================================================

export interface CompactionResult {
  did_compact: boolean;
  boundary_message?: {
    id: string;
    content: string;
    subtype: string;
    compact_type: string;
    pre_compact_token_count: number;
    post_compact_token_count: number;
    created_at: number;
  };
  summary_message?: CompactibleMessage;
  deleted_count?: number;
  error?: string;
}

/**
 * 尝试执行 Session Memory Compact
 * 
 * 源码参考: trySessionMemoryCompaction() 在 compact.ts
 * 
 * 触发条件：
 * 1. autoCompactIfNeeded() 返回 true
 * 2. Session Memory 文件存在且非空
 * 
 * 流程：
 * 1. 检查 session memory 是否存在
 * 2. 计算保留消息的起始索引
 * 3. 构建 summary 消息（引用 session memory）
 * 4. 创建 boundary 消息
 * 5. 删除被压缩的旧消息
 */
export async function trySessionMemoryCompact(
  sessionId: string,
  messages: Message[],
  workDir?: string,
): Promise<CompactionResult> {
  const config = { ...smCompactConfig, ...getCompactConfig() };
  
  // 1. 检查 token 阈值
  const totalTokens = await estimateMessagesTokens(messages);
  if (totalTokens < config.sm_auto_threshold_tokens) {
    return { did_compact: false };
  }
  
  // 2. 检查 session memory 是否存在且非空
  const sessionMemoryContent = await getEffectiveSessionMemory(workDir);
  if (sessionMemoryContent === null) {
    console.log('[SM Compact] No session memory file, skipping');
    return { did_compact: false };
  }
  if (sessionMemoryContent === '') {
    console.log('[SM Compact] Session memory is empty, skipping');
    return { did_compact: false };
  }
  
  try {
    // 3. 计算保留消息的起始索引
    const keepIndex = calculateKeepIndex(messages, config);
    
    // 4. 构建 summary message
    const summaryMessage = buildSummaryMessage(sessionMemoryContent, workDir);
    
    // 5. 创建 boundary 消息
    const boundary = await createCompactBoundary({
      sessionId,
      compactType: 'session_memory',
      preCompactTokenCount: totalTokens,
      postCompactTokenCount: await estimateMessagesTokens([
        summaryMessage,
        ...messages.slice(keepIndex),
      ]),
      workDir,
      sessionMemoryPath: undefined,  // 会在 Rust 端获取
      preservedSegment: {
        headUuid: messages[keepIndex]?.id,
        anchorUuid: summaryMessage.id,
        tailUuid: messages[messages.length - 1]?.id,
      },
    });
    
    // 6. 获取被压缩消息的 IDs
    const messagesToDelete = messages.slice(0, keepIndex);
    const idsToDelete = messagesToDelete.map((m) => m.id);
    
    // 7. 删除被压缩的消息（SQLite）
    if (idsToDelete.length > 0) {
      await invoke('delete_messages_by_ids', { messageIds: idsToDelete });
    }
    
    // 8. 保存 boundary 消息到 SQLite
    await invoke('save_compact_boundary', {
      sessionId,
      boundary: {
        id: boundary.id,
        content: boundary.content,
        subtype: boundary.subtype,
        compact_type: boundary.compact_type,
        pre_compact_token_count: boundary.pre_compact_token_count,
        post_compact_token_count: boundary.post_compact_token_count,
        summary_version: boundary.summary_version,
        created_at: boundary.created_at,
        session_memory_path: boundary.session_memory_path,
        preserved_segment: boundary.preserved_segment,
        pre_compact_discovered_tools: null,
      },
    });
    
    // 9. 更新状态
    const state = workDir ? getSessionMemoryState(workDir) : null;
    if (state) {
      state.last_summarized_message_id = messages[messages.length - 1]?.id;
      if (workDir) setSessionMemoryState(workDir, state);
    }
    
    console.log('[SM Compact] Success:', {
      pre_tokens: totalTokens,
      post_tokens: boundary.post_compact_token_count,
      deleted_count: idsToDelete.length,
    });
    
    return {
      did_compact: true,
      boundary_message: boundary,
      summary_message: summaryMessage,
      deleted_count: idsToDelete.length,
    };
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[SM Compact] Error:', errMsg);
    return { did_compact: false, error: errMsg };
  }
}

/**
 * 计算保留消息的起始索引
 * 
 * 源码参考: calculateMessagesToKeepIndex() 在 sessionMemoryCompact.ts
 * 
 * 规则：
 * 1. 从 lastSummarizedMessageId 之后开始（增量压缩）
 * 2. 至少保留 minTokens 和 minTextBlockMessages
 * 3. 最多保留 maxTokens
 * 4. 不能切断 tool_use/tool_result 配对
 */
function calculateKeepIndex(
  messages: Message[],
  config: SessionMemoryCompactConfig,
): number {
  if (messages.length === 0) return 0;
  
  // 找到最后一个 boundary 的位置（floor）
  let boundaryFloor = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    // 检查是否是 boundary 消息
    const artifacts = (msg as any).artifacts;
    if (artifacts) {
      try {
        const parsed = typeof artifacts === 'string' ? JSON.parse(artifacts) : artifacts;
        if (parsed?.subtype === 'compact_boundary') {
          boundaryFloor = i + 1;
          break;
        }
      } catch { /* ignore */ }
    }
  }
  
  // 从尾部开始，保留到 token 限制
  let totalTokens = 0;
  let textBlockCount = 0;
  let startIndex = messages.length;
  
  for (let i = messages.length - 1; i >= boundaryFloor; i--) {
    const msg = messages[i];
    const msgTokens = estimateMessageTokens(msg);
    
    totalTokens += msgTokens;
    if (msg.content && !msg.content.startsWith('__TOOL_RESULT__:')) {
      textBlockCount++;
    }
    
    // 检查是否满足最低要求
    const meetsMin = totalTokens >= config.minTokens && textBlockCount >= config.minTextBlockMessages;
    
    if (meetsMin) {
      startIndex = i;
    }
    
    // 硬上限
    if (totalTokens >= config.maxTokens) {
      break;
    }
  }
  
  // 调整以不切断配对
  startIndex = adjustIndexToPreservePairs(messages, startIndex);
  
  // 确保不小于 boundaryFloor
  return Math.max(startIndex, boundaryFloor);
}

/**
 * 调整起始索引，确保不切断 tool_use/tool_result 配对
 * 
 * 源码参考: adjustIndexToPreserveAPIInvariants() 在 sessionMemoryCompact.ts
 */
function adjustIndexToPreservePairs(
  messages: Message[],
  proposedStart: number,
): number {
  if (proposedStart <= 0) return 0;
  
  // 检查 proposedStart 处是否是 user 工具结果
  // 如果是，继续往前包含对应的 assistant tool_use
  for (let i = proposedStart - 1; i >= Math.max(0, proposedStart - 3); i--) {
    const msg = messages[i];
    // 如果是 user 消息且包含工具结果，说明前面的 assistant 消息有 tool_use
    if (msg.role === 'user' && msg.content.startsWith('__TOOL_RESULT__:')) {
      proposedStart = i;
    }
  }
  
  return proposedStart;
}

// ============================================================================
// Summary Message 构建
// ============================================================================

/**
 * 构建 session memory summary message
 * 
 * 源码参考: getCompactUserSummaryMessage() 在 prompt.ts
 * 
 * 格式：
 * ```
 * 此会话正在从之前的对话中继续。以下是早期对话的摘要。
 * 
 * {sessionMemoryContent}
 * 
 * 最近的消息保持完整。
 * 
 * 请继续对话，不要询问用户任何问题。直接继续上次的工作。
 * ```
 */
function buildSummaryMessage(
  sessionMemoryContent: string,
  _workDir?: string,
): CompactibleMessage {
  const summaryText =
    `此会话正在从之前的对话中继续。以下是会话记忆摘要：\n\n` +
    `${sessionMemoryContent}\n\n` +
    `最近的消息保持完整。\n\n` +
    `请继续对话，不要询问用户任何问题。直接继续上次的工作。`;

  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: summaryText,
    timestamp: Date.now(),
    // @ts-ignore - compact_metadata 是扩展字段
    compact_metadata: {
      is_compact_summary: true,
      compact_type: 'session_memory',
    },
  };
}

// ============================================================================
// Compact Boundary 创建
// ============================================================================

interface CreateBoundaryOptions {
  sessionId: string;
  compactType: string;
  preCompactTokenCount: number;
  postCompactTokenCount: number;
  workDir?: string;
  sessionMemoryPath?: string | null;
  preservedSegment?: {
    headUuid: string;
    anchorUuid: string;
    tailUuid: string;
  };
}

async function createCompactBoundary(
  options: CreateBoundaryOptions,
): Promise<{
  id: string;
  content: string;
  subtype: string;
  compact_type: string;
  pre_compact_token_count: number;
  post_compact_token_count: number;
  summary_version: number;
  created_at: number;
  session_memory_path: string | null;
  preserved_segment: {
    head_uuid: string;
    anchor_uuid: string;
    tail_uuid: string;
  } | null;
}> {
  const now = Math.floor(Date.now() / 1000);
  
  // 获取 session memory 路径
  let memoryPath: string | null = null;
  if (options.sessionMemoryPath) {
    memoryPath = options.sessionMemoryPath;
  } else {
    try {
      memoryPath = await invoke<string>('get_session_memory_path', { workDir: options.workDir ?? null });
    } catch { /* ignore */ }
  }
  
  const compactTypeDisplay =
    options.compactType === 'session_memory' ? '会话记忆压缩' :
    options.compactType === 'auto' ? '自动压缩' : '手动压缩';
  
  const content =
    `[系统] 🗜️ ${compactTypeDisplay} 已完成。` +
    `压缩前约 ${options.preCompactTokenCount} tokens，` +
    `压缩后约 ${options.postCompactTokenCount} tokens。` +
    `早期对话已保存摘要，如需查看完整历史可读取会话记录。`;
  
  return {
    id: crypto.randomUUID(),
    content,
    subtype: 'compact_boundary',
    compact_type: options.compactType,
    pre_compact_token_count: options.preCompactTokenCount,
    post_compact_token_count: options.postCompactTokenCount,
    summary_version: now,
    created_at: now,
    session_memory_path: memoryPath,
    preserved_segment: options.preservedSegment ? {
      head_uuid: options.preservedSegment.headUuid,
      anchor_uuid: options.preservedSegment.anchorUuid,
      tail_uuid: options.preservedSegment.tailUuid,
    } : null,
  };
}

// ============================================================================
// 手动触发
// ============================================================================

/**
 * 手动触发 Session Memory Compact
 * 用于 /compact 命令
 */
export async function triggerSessionMemoryCompact(
  sessionId: string,
  messages: Message[],
  workDir?: string,
): Promise<CompactionResult> {
  // 确保 session memory 已初始化
  await initSessionMemory(workDir);
  
  return trySessionMemoryCompact(sessionId, messages, workDir);
}
