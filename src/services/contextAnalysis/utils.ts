/**
 * Context Analysis - Utility Functions
 */

import type { Message } from '../../types/chat';

/** Keywords indicating a topic shift or new task (Chinese + English) */
const TOPIC_SHIFT_KEYWORDS = [
  // Chinese
  '好的', '那我们', '下一个', '接下来', '另外', '换个话题', '新问题',
  '好了', '完成了', '解决了', '搞定了', '下一步', '然后呢',
  // English
  'next', 'now let\'s', 'moving on', 'another question', 'new task',
  'by the way', 'actually', 'one more thing', 'also',
];

/** Keywords indicating task completion */
const TASK_COMPLETE_KEYWORDS = [
  // Chinese
  '完成', '解决', '搞定', '好了', '没问题', '可以了', '成功了',
  // English
  'done', 'finished', 'completed', 'solved', 'fixed', 'works now',
  'thank you', 'thanks', 'perfect', 'great',
];

/** Keywords strongly indicating the start of a task or user intent */
const TASK_START_KEYWORDS = [
  // Chinese
  '帮我', '请', '能否', '可以', '我要', '我想', '实现', '创建', '添加', '修改', '删除',
  // English
  'can you', 'could you', 'please', 'help me', 'implement', 'create',
  'add', 'fix', 'change', 'update', 'build', 'make',
];

/** Keywords indicating reasoning / explanation */
const REASONING_KEYWORDS = [
  'because', 'since', 'therefore', 'thus', 'hence', 'reason',
  '因为', '所以', '因此', '原因', '由于',
];

/** Keywords indicating a summary */
const SUMMARY_KEYWORDS = [
  'in summary', 'to summarize', 'in conclusion', 'to conclude', 'overall',
  '总结', '综上', '总的来说', '简而言之',
];

export function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function isTopicShiftKeyword(text: string): boolean {
  return containsKeyword(text, TOPIC_SHIFT_KEYWORDS);
}

export function isTaskCompleteKeyword(text: string): boolean {
  return containsKeyword(text, TASK_COMPLETE_KEYWORDS);
}

export function isTaskStartKeyword(text: string): boolean {
  return containsKeyword(text, TASK_START_KEYWORDS);
}

export function isReasoningText(text: string): boolean {
  return containsKeyword(text, REASONING_KEYWORDS);
}

export function isSummaryText(text: string): boolean {
  return containsKeyword(text, SUMMARY_KEYWORDS);
}

/** Count tool calls in a set of messages */
export function countToolCalls(messages: Message[]): number {
  return messages.reduce((acc, m) => acc + (m.tool_calls?.length ?? 0), 0);
}

/** Check whether a message references code/file artifacts */
export function hasCodeArtifact(msg: Message): boolean {
  if (msg.artifacts && msg.artifacts.length > 0) return true;
  // Heuristic: look for code fences
  return /```[\w]*\n/.test(msg.content);
}

/** Detect file-edit tool calls (str_replace, write_file, etc.) */
export function isFileEditToolCall(toolName: string): boolean {
  return /str_replace|write_file|create_file|edit_file|replace_string/i.test(toolName);
}

/** Count distinct file-edit tool calls across messages */
export function countFileEdits(messages: Message[]): number {
  let count = 0;
  for (const msg of messages) {
    for (const tc of msg.tool_calls ?? []) {
      if (isFileEditToolCall(tc.name)) count++;
    }
  }
  return count;
}

/** Count repeated edits to the same file path (proxy for iterative work) */
export function countRepeatFileEdits(messages: Message[]): number {
  const fileCounts = new Map<string, number>();
  for (const msg of messages) {
    for (const tc of msg.tool_calls ?? []) {
      if (!isFileEditToolCall(tc.name)) continue;
      try {
        const args = JSON.parse(tc.arguments);
        const path =
          args.path ?? args.file_path ?? args.filePath ?? args.target_file ?? '';
        if (path) {
          fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1);
        }
      } catch {
        // ignore parse errors
      }
    }
  }
  // Repeated = edited more than once
  return [...fileCounts.values()].filter((n) => n > 1).length;
}

export function getMessagePosition(
  index: number,
  total: number,
): 'early' | 'mid' | 'late' {
  const ratio = index / Math.max(total - 1, 1);
  if (ratio < 0.33) return 'early';
  if (ratio < 0.67) return 'mid';
  return 'late';
}
