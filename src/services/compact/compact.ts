/**
 * Layer 3: Legacy Compact - 完整压缩
 * 
 * 当 Layer 1 (Microcompact) 和 Layer 2 (Session Memory) 不够用时，
 * 调用 LLM 生成完整摘要，替换所有旧消息。
 * 
 * 源码参考:
 * - restored-src/src/services/compact/compact.ts
 * - compactConversation(), streamCompactSummary()
 */

import { invoke } from '@tauri-apps/api/core';
import type { Message } from '../../types/chat';
import type { CompactibleMessage } from '../../types/compact';
import { getCompactConfig } from './config';
import { getCompactPrompt, getCompactUserSummaryMessage, formatCompactSummary } from './compactPrompt';
import { callCompactLLM } from '../api/compactLLM';
import { estimateMessagesTokens, estimateMessageTokens } from '../tokens/tokenEstimator';
import { resetMicrocompactState } from './microCompactState';

// ============================================================================
// 常量
// ============================================================================

/** 压缩后最多恢复的文件数 */
export const POST_COMPACT_MAX_FILES = 5;
/** 压缩后文件 token 预算上限 */
export const POST_COMPACT_TOKEN_BUDGET = 50_000;
/** 每个文件最多 token 数 */
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;
/** 最多保留的技能数 */
export const POST_COMPACT_MAX_SKILLS = 5;
/** 每个技能最多 token 数 */
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
/** 技能 token 预算上限 */
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;
/** PTL 重试最大次数 */
const MAX_PTL_RETRIES = 3;
/** PTL 重试标记 */
const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]';

// ============================================================================
// 错误类型
// ============================================================================

export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES = 'Not enough messages to compact.';
export const ERROR_MESSAGE_PROMPT_TOO_LONG = 'Conversation too long. 请重试或缩减对话。';
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE = 'Compaction interrupted. 请重试。';

// ============================================================================
// 核心：Legacy Compact
// ============================================================================

export interface LegacyCompactResult {
  success: boolean;
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
  messages_to_keep?: CompactibleMessage[];
  deleted_count?: number;
  attachments?: CompactAttachment[];
  error?: string;
  error_type?: 'not_enough_messages' | 'prompt_too_long' | 'api_error' | 'no_summary' | 'unknown';
}

/**
 * 执行 Legacy Compact
 * 
 * 流程：
 * 1. 检查消息数量
 * 2. 剥离图片（节省 token）
 * 3. 调用 LLM 生成摘要
 * 4. PTL Retry 机制（如果 API 返回 prompt too long）
 * 5. 创建 boundary + summary 消息
 * 6. 获取 post-compact attachments
 * 7. 更新数据库和 Zustand
 */
export async function compactConversation(
  sessionId: string,
  messages: Message[],
  options?: {
    isAutoCompact?: boolean;
    customInstructions?: string;
    suppressFollowUp?: boolean;
    workDir?: string;
  },
): Promise<LegacyCompactResult> {
  const {
    isAutoCompact = false,
    customInstructions,
    suppressFollowUp = true,
  } = options ?? {};

  // 1. 检查消息数量
  if (messages.length === 0) {
    return { success: false, error: ERROR_MESSAGE_NOT_ENOUGH_MESSAGES, error_type: 'not_enough_messages' };
  }

  try {
    const preCompactTokenCount = await estimateMessagesTokens(messages);
    console.log('[Legacy Compact] Starting:', { preCompactTokenCount, messageCount: messages.length });

    // 2. 剥离图片和文档（节省 token）
    const strippedMessages = stripImagesFromMessages(messages);

    // 3. 调用 LLM 生成摘要（带 PTL Retry）
    const summaryText = await callCompactWithPTLRetry(
      strippedMessages,
      getCompactPrompt(customInstructions),
      preCompactTokenCount,
    );

    if (!summaryText) {
      return { success: false, error: 'No summary generated', error_type: 'no_summary' };
    }

    // 4. 格式化摘要
    const formattedSummary = formatCompactSummary(summaryText);

    // 5. 计算保留范围
    const config = getCompactConfig();
    const keepIndex = calculateKeepIndex(messages, config.legacy_keep_tokens);
    const messagesToKeep = messages.slice(keepIndex);

    // 6. 构建 summary message
    const summaryMessage: CompactibleMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: getCompactUserSummaryMessage(formattedSummary, suppressFollowUp),
      timestamp: Date.now(),
    } as CompactibleMessage;

    // 7. 创建 boundary
    const boundary = await createCompactBoundary({
      sessionId,
      compactType: isAutoCompact ? 'auto' : 'manual',
      preCompactTokenCount: preCompactTokenCount,
      postCompactTokenCount: await estimateMessagesTokens([
        summaryMessage,
        ...messagesToKeep,
      ]),
      preservedSegment: {
        headUuid: messagesToKeep[0]?.id,
        anchorUuid: summaryMessage.id,
        tailUuid: messages[messages.length - 1]?.id,
      },
    });

    // 8. 删除被压缩的消息
    const messagesToDelete = messages.slice(0, keepIndex);
    const idsToDelete = messagesToDelete.map(m => m.id);
    if (idsToDelete.length > 0) {
      await invoke('delete_messages_by_ids', { messageIds: idsToDelete });
    }

    // 9. 保存 boundary 到数据库
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
        session_memory_path: null,
        preserved_segment: boundary.preserved_segment,
        pre_compact_discovered_tools: null,
      },
    });

    // 10. 获取 attachments
    const attachments = await buildPostCompactAttachments(messagesToKeep, options?.workDir);

    // 11. 计算最终 token 数（不含 attachments，它们会被单独计算）
    const postCompactTokenCount = await estimateMessagesTokens([
      summaryMessage,
      ...messagesToKeep,
    ]);

    // 12. 后清理
    await runPostCompactCleanup();

    console.log('[Legacy Compact] Success:', {
      pre: preCompactTokenCount,
      post: postCompactTokenCount,
      deleted: idsToDelete.length,
      kept: messagesToKeep.length,
      savings: Math.round((1 - postCompactTokenCount / preCompactTokenCount) * 100) + '%',
    });

    return {
      success: true,
      boundary_message: boundary,
      summary_message: summaryMessage,
      messages_to_keep: messagesToKeep as CompactibleMessage[],
      deleted_count: idsToDelete.length,
      attachments,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Legacy Compact] Error:', errMsg);

    let errorType: LegacyCompactResult['error_type'] = 'unknown';
    if (errMsg.includes('prompt') || errMsg.includes('too long') || errMsg.includes('context')) {
      errorType = 'prompt_too_long';
    } else if (errMsg.includes('aborted') || errMsg.includes('abort')) {
      errorType = 'api_error';
    }

    return { success: false, error: errMsg, error_type: errorType };
  }
}

// ============================================================================
// PTL (Prompt Too Long) Retry 机制
// ============================================================================

/**
 * 调用 LLM 生成摘要，带 PTL 重试机制
 * 
 * Claude Code 参考: compactConversation() 中的 PTL Retry 循环
 * 
 * 如果 API 返回 prompt too long 错误：
 * 1. 截断最旧的 20% 消息
 * 2. 重试（最多 MAX_PTL_RETRIES 次）
 */
async function callCompactWithPTLRetry(
  messages: Message[],
  prompt: string,
  _preCompactTokenCount: number,
): Promise<string | null> {
  let currentMessages = messages;
  let ptlAttempts = 0;

  for (;;) {
    try {
      // 构建摘要请求消息
      const apiMessages: Message[] = [
        ...currentMessages.slice(-50),  // 只发送最近 50 条（节省 token）
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        } as Message,
      ];

      const summaryText = await callCompactLLM({ messages: apiMessages });

      if (!summaryText?.trim()) {
        return null;
      }

      // 检查是否包含 PTL 错误前缀
      if (summaryText.includes('prompt') && summaryText.includes('too long')) {
        throw new Error('PROMPT_TOO_LONG');
      }

      return summaryText;

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      if (!errMsg.includes('PROMPT_TOO_LONG')) {
        throw error;  // 非 PTL 错误，直接抛出
      }

      ptlAttempts++;
      if (ptlAttempts > MAX_PTL_RETRIES) {
        console.error('[Legacy Compact] PTL: max retries exceeded');
        throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG);
      }

      // 截断最旧的 20% 消息重试
      const truncated = truncateHeadForPTLRetry(currentMessages);
      if (!truncated) {
        throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG);
      }

      console.log(`[Legacy Compact] PTL retry ${ptlAttempts}: ${currentMessages.length} → ${truncated.length} messages`);
      currentMessages = truncated;
    }
  }
}

// ============================================================================
// 消息截断
// ============================================================================

/**
 * 截断最旧的消息以在 PTL 时重试
 * 
 * Claude Code 参考: truncateHeadForPTLRetry() 在 compact.ts
 * 
 * 策略：
 * 1. 尝试解析 token gap
 * 2. 如果无法解析，丢弃最旧的 20%
 * 3. 如果第一个消息是 assistant，插入一个 user marker
 */
function truncateHeadForPTLRetry(messages: Message[]): Message[] | null {
  if (messages.length < 2) return null;

  // 简单策略：丢弃最旧的 20%
  const dropCount = Math.max(1, Math.floor(messages.length * 0.2));
  const sliced = messages.slice(dropCount);

  if (sliced.length < 1) return null;

  // 如果截断后第一条是 assistant（API 要求首条必须是 user），
  // 插入一个 synthetic marker
  if (sliced[0]?.role === 'assistant') {
    return [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: PTL_RETRY_MARKER,
        timestamp: Date.now(),
      } as Message,
      ...sliced,
    ];
  }

  return sliced;
}

// ============================================================================
// 图片剥离
// ============================================================================

/**
 * 剥离消息中的图片（节省 token）
 * 
 * Claude Code 参考: stripImagesFromMessages() 在 compact.ts
 * 
 * 图片对摘要无用，还会占用大量 token
 */
function stripImagesFromMessages(messages: Message[]): Message[] {
  return messages.map(msg => {
    // 只处理 user 消息（图片只在 user 消息中）
    if (msg.role !== 'user') return msg;

    let content = msg.content;

    // 检查是否包含 [image] 或图片 URL 标记
    // pipi-shrimp-agent 的图片可能以各种格式存储
    // 简化：只处理 "[图片]" 这样的文本标记
    if (content.includes('[图片]') || 
        content.includes('[image]') ||
        content.includes('[document]') ||
        content.includes('data:image/')) {
      // 替换为文本标记
      content = content
        .replace(/\[图片\]/g, '[图片已剥离]')
        .replace(/\[image\]/g, '[image]')
        .replace(/\[document\]/g, '[document]')
        // 剥离 base64 图片
        .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, '[图片内容已剥离]');
    }

    return { ...msg, content };
  });
}

// ============================================================================
// 保留范围计算
// ============================================================================

/**
 * 计算保留消息的起始索引
 * 
 * 策略：
 * 1. 从尾部保留 legacy_keep_tokens（默认 30K）
 * 2. 最少保留 5 条消息
 */
function calculateKeepIndex(messages: Message[], targetKeepTokens: number): number {
  let accumulated = 0;
  let startIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateMessageTokens(messages[i]);
    startIndex = i;
    if (accumulated >= targetKeepTokens) {
      break;
    }
  }

  // 至少保留 5 条
  return Math.min(startIndex, messages.length - 5);
}

// ============================================================================
// Compact Boundary 创建
// ============================================================================

interface CreateBoundaryOptions {
  sessionId: string;
  compactType: string;
  preCompactTokenCount: number;
  postCompactTokenCount: number;
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
    session_memory_path: null,
    preserved_segment: options.preservedSegment ? {
      head_uuid: options.preservedSegment.headUuid,
      anchor_uuid: options.preservedSegment.anchorUuid,
      tail_uuid: options.preservedSegment.tailUuid,
    } : null,
  };
}

// ============================================================================
// Post-Compact Attachments
// ============================================================================

export type CompactAttachment =
  | { type: 'file'; file_path: string; content: string; truncated?: boolean; tokens: number }
  | { type: 'session_memory'; content: string }
  | { type: 'text'; content: string };

/**
 * 构建 Post-Compact Attachments
 * 
 * Claude Code 参考: createPostCompactAttachments() 在 compact.ts
 * 
 * 包括：
 * - Session Memory（如果存在且非空）
 * - 最近读取的文件
 */
async function buildPostCompactAttachments(
  recentMessages: Message[],
  workDir?: string,
): Promise<CompactAttachment[]> {
  const attachments: CompactAttachment[] = [];
  let totalTokens = 0;

  // 1. Session Memory（如果存在）
  try {
    const smContent = await invoke<string | null>('get_session_memory', { workDir: workDir ?? null });
    if (smContent && smContent.trim().length > 100) {
      // 估算 SM token
      const smTokens = Math.ceil(smContent.length / 3);  // 粗估
      if (totalTokens + smTokens < POST_COMPACT_TOKEN_BUDGET) {
        attachments.push({ type: 'session_memory', content: smContent });
        totalTokens += smTokens;
      }
    }
  } catch { /* SM 不存在，跳过 */ }

  // 2. 最近读取的文件
  const recentFiles = extractRecentFilePaths(recentMessages);
  for (const filePath of recentFiles.slice(0, POST_COMPACT_MAX_FILES)) {
    if (totalTokens >= POST_COMPACT_TOKEN_BUDGET) break;

    try {
      const response = await invoke<{ content: string; path: string }>('read_file', {
        path: filePath,
        workDir: workDir ?? null,
      });

      if (!response || !response.content) continue;

      // 截断到每文件上限
      const fileContent = response.content;
      const maxChars = POST_COMPACT_MAX_TOKENS_PER_FILE * 3;
      const truncated = fileContent.length > maxChars;
      const truncatedContent = truncated ? fileContent.slice(0, maxChars) : fileContent;
      const tokens = Math.ceil(truncatedContent.length / 3);

      if (totalTokens + tokens > POST_COMPACT_TOKEN_BUDGET) break;

      attachments.push({
        type: 'file',
        file_path: filePath,
        content: truncatedContent,
        truncated,
        tokens,
      });
      totalTokens += tokens;
    } catch {
      // 文件不存在或读取失败，跳过
    }
  }

  return attachments;
}

/**
 * 从消息中提取最近读取的文件路径
 */
function extractRecentFilePaths(messages: Message[]): string[] {
  const paths: string[] = [];
  // 常见的文件路径正则
  const filePatterns = [
    // 相对路径
    /["']((?:src|lib|components|hooks|services|utils|pages|app|api|models|types|styles|assets|config|tests?|docs?|scripts|bin)\/[^\s"')]+(?:\.[a-zA-Z0-9]+)?)["']/g,
    // 绝对路径
    /(?:^|\s)((?:\/[a-zA-Z0-9._-]+)+(?:\.[a-zA-Z0-9]+)?)(?:\s|$)/gm,
  ];

  for (const msg of messages.slice(-20).reverse()) {
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(msg.content)) !== null) {
        const path = match[1] || match[0];
        if (path && !path.includes('node_modules') && !path.includes('.git')) {
          paths.push(path.trim());
        }
      }
    }
  }

  // 去重，保留顺序
  return [...new Set(paths)];
}

// ============================================================================
// 后清理
// ============================================================================

/**
 * 压缩后清理
 * 
 * Claude Code 参考: runPostCompactCleanup() 在 postCompactCleanup.ts
 */
async function runPostCompactCleanup(): Promise<void> {
  // 1. 重置 microcompact 状态
  resetMicrocompactState();
  console.log('[Legacy Compact] Cleanup complete');
}

// ============================================================================
// 手动触发
// ============================================================================

/**
 * 手动触发 Legacy Compact
 */
export async function triggerLegacyCompact(
  sessionId: string,
  messages: Message[],
  workDir?: string,
): Promise<LegacyCompactResult> {
  return compactConversation(sessionId, messages, {
    isAutoCompact: false,
    suppressFollowUp: true,
    workDir,
  });
}
