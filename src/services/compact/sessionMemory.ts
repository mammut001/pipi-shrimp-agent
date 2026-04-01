/**
 * Session Memory 管理
 * 
 * 负责：
 * 1. 初始化 session-memory.md 文件
 * 2. 读取/写入 session memory 内容
 * 3. 触发 LLM 提取会话记忆
 * 
 * 源码参考:
 * - restored-src/src/services/SessionMemory/sessionMemory.ts
 * - restored-src/src/services/SessionMemory/sessionMemoryUtils.ts
 * - restored-src/src/services/SessionMemory/prompts.ts
 */

import { invoke } from '@tauri-apps/api/core';
import type { Message } from '../../types/chat';
import { getCompactConfig } from './config';
import { estimateMessagesTokens } from '../tokens/tokenEstimator';
import { callCompactLLM } from '../api/compactLLM';

// ============================================================================
// 常量
// ============================================================================

const SESSION_MEMORY_KEY = 'pipi-shrimp-session-memory';

export interface SessionMemoryState {
  /** Session Memory 文件是否已初始化 */
  initialized: boolean;
  /** 上次提取时的消息 ID（锚点） */
  last_summarized_message_id?: string;
  /** 上次提取时的 token 数 */
  last_extraction_token_count: number;
  /** 当前是否正在提取中 */
  extraction_in_progress: boolean;
  /** 上次提取时间戳 */
  last_extraction_at?: number;
}

function createInitialState(): SessionMemoryState {
  return {
    initialized: false,
    last_summarized_message_id: undefined,
    last_extraction_token_count: 0,
    extraction_in_progress: false,
    last_extraction_at: undefined,
  };
}

export function getSessionMemoryState(workDir: string): SessionMemoryState {
  try {
    const key = `${SESSION_MEMORY_KEY}:${workDir}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch { /* ignore */ }
  return createInitialState();
}

export function setSessionMemoryState(workDir: string, state: SessionMemoryState): void {
  const key = `${SESSION_MEMORY_KEY}:${workDir}`;
  localStorage.setItem(key, JSON.stringify(state));
}

// ============================================================================
// 文件初始化
// ============================================================================

export interface InitResult {
  path: string;
  is_new: boolean;
}

/**
 * 初始化 Session Memory 文件
 * 
 * 源码参考: setupSessionMemoryFile() 在 sessionMemory.ts
 */
export async function initSessionMemory(workDir?: string): Promise<InitResult> {
  const result = await invoke<InitResult>('init_session_memory', {
    workDir: workDir ?? null,
  });
  
  // 标记已初始化
  if (workDir) {
    const state = getSessionMemoryState(workDir);
    state.initialized = true;
    setSessionMemoryState(workDir, state);
  }
  
  return result;
}

// ============================================================================
// 文件读写
// ============================================================================

/**
 * 读取 Session Memory 内容
 * 
 * 源码参考: getSessionMemoryContent() 在 sessionMemoryUtils.ts
 */
export async function getSessionMemory(workDir?: string): Promise<string | null> {
  return invoke<string | null>('get_session_memory', {
    workDir: workDir ?? null,
  });
}

/**
 * 写入 Session Memory 内容
 * 
 * 源码参考: writeFile(memoryPath, content) 在 sessionMemory.ts
 */
export async function writeSessionMemory(content: string, workDir?: string): Promise<void> {
  await invoke('write_session_memory', {
    content,
    workDir: workDir ?? null,
  });
}

/**
 * 检查 Session Memory 是否为空（只有模板）
 */
export async function isSessionMemoryEmpty(workDir?: string): Promise<boolean> {
  return invoke<boolean>('is_session_memory_empty', {
    workDir: workDir ?? null,
  });
}

/**
 * 检查 Session Memory 是否存在
 */
export async function sessionMemoryExists(workDir?: string): Promise<boolean> {
  return invoke<boolean>('session_memory_exists', {
    workDir: workDir ?? null,
  });
}

/**
 * 获取 Session Memory 信息
 */
export async function getSessionMemoryInfo(workDir?: string): Promise<{
  path: string;
  content: string;
  tokens: number;
  is_empty: boolean;
  sections: string[];
} | null> {
  return invoke('get_session_memory_info', {
    workDir: workDir ?? null,
  });
}

/**
 * 估算 Session Memory 的 token 数
 */
export async function estimateSessionMemoryTokens(workDir?: string): Promise<number> {
  return invoke<number>('estimate_session_memory_tokens', {
    workDir: workDir ?? null,
  });
}

// ============================================================================
// 提取阈值判断
// ============================================================================

/**
 * 检查是否应该触发 Session Memory 提取
 * 
 * 源码参考: shouldExtractMemory() 在 sessionMemory.ts
 * 
 * 触发条件:
 * 1. 已达到初始化阈值（消息 token 数 > minimumMessageTokensToInit）
 * 2. 达到更新阈值（距上次提取增长 > minimumTokensBetweenUpdate）
 * 3. 或者没有工具调用在最后一轮（自然对话间隙）
 * 
 * 注意：pipi-shrimp-agent 不使用 fork agent，
 * 所以触发判断简化：token 达到阈值即可
 */
export async function shouldExtractSessionMemory(
  workDir: string,
  messages: { id: string; role: string; content: string }[],
  currentTokenCount: number,
): Promise<boolean> {
  const state = getSessionMemoryState(workDir);
  const config = getCompactConfig();
  
  // 如果还没初始化，检查是否达到初始化阈值
  if (!state.initialized) {
    // pipi-shrimp-agent: 使用 sm_auto_threshold_tokens 作为初始化阈值
    if (currentTokenCount < config.sm_auto_threshold_tokens) {
      return false;
    }
    // 标记已初始化
    state.initialized = true;
    setSessionMemoryState(workDir, state);
  }
  
  // 检查 token 增长阈值
  const tokenGrowth = currentTokenCount - state.last_extraction_token_count;
  if (tokenGrowth < config.sm_auto_threshold_tokens) {
    return false;
  }
  
  // 检查最后一轮是否有工具调用（有工具调用时不提取）
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === 'user' && lastMessage.content.startsWith('__TOOL_RESULT__:')) {
    // 最后一轮是工具结果，说明刚执行完工具，还没到自然间隙
    // 但如果 token 增长足够多，仍可以提取
    return tokenGrowth >= config.sm_auto_threshold_tokens * 2;
  }
  
  return true;
}

// ============================================================================
// Session Memory 提取
// ============================================================================

/**
 * Session Memory 提取 Prompt
 * 
 * 源码参考: buildSessionMemoryUpdatePrompt() 在 prompts.ts
 * 
 * 指导 LLM 更新 session-memory.md 的各个 section
 */
function buildSessionMemoryUpdatePrompt(
  currentMemory: string,
  memoryPath: string,
): string {
  return `你是会话记忆助手。请从以下对话历史中提取关键信息，并更新会话记忆文件。

当前会话记忆文件内容：
${currentMemory}

文件路径：${memoryPath}

请分析对话历史，识别并更新以下 section：
1. **Session Title** — 用 5-10 个词概括本次对话的主题
2. **Current State** — 当前正在做什么，有什么待办
3. **Task specification** — 用户要求构建什么，设计决策
4. **Files and Functions** — 重要的文件及作用
5. **Workflow** — 常用命令顺序
6. **Errors & Corrections** — 遇到的错误及修复
7. **Learnings** — 什么方法效果好，什么不好
8. **Pending Tasks** — 还没完成的任务
9. **Worklog** — 工作步骤总结

请直接编辑文件 ${memoryPath}，保留原有的 section 标题结构，
只更新每个 section 下的内容。不要改变文件格式。

重要：
- 精确到文件名、函数名、代码行号
- 不要虚构信息，只写对话中实际出现的
- 简洁，信息密集
`;
}

/**
 * 调用 LLM 提取/更新 Session Memory
 * 
 * 源码参考: extractSessionMemory() 在 sessionMemory.ts
 * pipi-shrimp-agent 不使用 fork agent，直接调用 API
 */
export async function extractSessionMemory(
  workDir: string,
  messages: { id: string; role: string; content: string; tool_calls?: { name: string }[] }[],
): Promise<{ success: boolean; error?: string }> {
  const state = getSessionMemoryState(workDir);
  
  if (state.extraction_in_progress) {
    return { success: false, error: 'Extraction already in progress' };
  }
  
  state.extraction_in_progress = true;
  setSessionMemoryState(workDir, state);
  
  try {
    // 1. 初始化文件（如果不存在）
    const initResult = await initSessionMemory(workDir);
    
    // 2. 读取当前 memory 内容
    const currentMemory = await getSessionMemory(workDir) ?? '';
    
    // 3. 构建提取 prompt
    const prompt = buildSessionMemoryUpdatePrompt(
      currentMemory,
      initResult.path,
    );
    
    // 4. 调用 LLM 生成更新内容
    // 使用非流式 API 调用（send_claude_sdk_chat）
    const apiMessages: Message[] = [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      },
    ];
    
    const fullResponse = await callCompactLLM({
      messages: apiMessages,
    });
    
    // 5. 解析 LLM 响应，提取各 section 的更新内容
    // LLM 返回的是格式化后的完整文件内容，直接写入
    const updatedMemory = parseSessionMemoryUpdate(fullResponse, currentMemory);
    
    // 6. 写入文件
    await writeSessionMemory(updatedMemory, workDir);
    
    // 7. 更新状态
    const tokenCount = await estimateMessagesTokens(messages);
    state.extraction_in_progress = false;
    state.last_extraction_at = Date.now();
    state.last_summarized_message_id = messages[messages.length - 1]?.id;
    state.last_extraction_token_count = tokenCount;
    setSessionMemoryState(workDir, state);
    
    console.log('[SessionMemory] Extraction complete, path:', initResult.path);
    return { success: true };
    
  } catch (error) {
    state.extraction_in_progress = false;
    setSessionMemoryState(workDir, state);
    
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[SessionMemory] Extraction failed:', errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * 解析 LLM 响应，生成更新后的 session memory
 * 
 * 策略：
 * 1. 如果 LLM 返回完整的文件内容，直接使用
 * 2. 否则，追加到 currentMemory
 */
function parseSessionMemoryUpdate(
  llmResponse: string,
  currentMemory: string,
): string {
  // 去掉可能的思考标签
  let cleaned = llmResponse
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  
  // 如果响应看起来像完整的 session memory（包含多个 # 标题）
  const titleCount = (cleaned.match(/^# .+/gm) || []).length;
  if (titleCount >= 5) {
    // LLM 返回了完整内容
    return cleaned;
  }
  
  // 否则，只返回增量部分，追加到现有 memory
  // 在 Worklog section 追加
  if (currentMemory) {
    // 检查是否有 Worklog section
    const worklogMatch = currentMemory.match(/^# Worklog$/m);
    if (worklogMatch) {
      // 在 Worklog 后追加
      const lines = currentMemory.split('\n');
      const insertIdx = lines.findIndex(l => l.startsWith('# ') && l !== '# Worklog');
      if (insertIdx > 0) {
        const newLines = [
          ...lines.slice(0, insertIdx),
          '\n' + cleaned + '\n',
          ...lines.slice(insertIdx),
        ];
        return newLines.join('\n');
      }
    }
    return currentMemory + '\n\n' + cleaned;
  }
  
  return cleaned;
}

// ============================================================================
// 获取 Session Memory 内容（供 compact 注入用）
// ============================================================================

/**
 * 获取 Session Memory 的有效内容
 * 
 * 源码参考: getSessionMemoryContent() 在 sessionMemoryUtils.ts
 * 
 * 返回：
 * - null: 文件不存在
 * - '': 文件为空（只有模板）
 * - string: 有效内容
 */
export async function getEffectiveSessionMemory(workDir?: string): Promise<string | null> {
  const exists = await sessionMemoryExists(workDir);
  if (!exists) {
    return null;
  }
  
  const isEmpty = await isSessionMemoryEmpty(workDir);
  if (isEmpty) {
    return '';  // 模板，无有效内容
  }
  
  const content = await getSessionMemory(workDir);
  return content;
}
