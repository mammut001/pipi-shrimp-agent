import type { SessionGoalRecord } from '@/types/sessionGoal';

export type GoalTurnIntent = 'goal_continue' | 'goal_related' | 'unrelated' | 'interrupt';

export interface ClassifyGoalTurnOptions {
  goalLoopContinuation?: boolean;
}

/**
 * Common math / general chit-chat / casual question patterns
 * that are definitely unrelated to background goals unless they explicitly mention goal terms.
 */
const UNRELATED_GENERAL_PATTERNS: RegExp[] = [
  /^\s*\d+\s*[\+\-\*\/÷×]\s*\d+\s*=?\s*(?:等于[几多少\?？]*)?\s*$/i, // e.g. 1+1等于几？
  /^\s*(?:你好|您好|hi|hello|hey|早安|午安|晚安|在吗|在么|哈喽|嗨)\s*[!！?？~～]*$/i,
  /^\s*(?:解释|说明|科普|介绍|什么是|简述|介绍下|聊聊)(?:一下|下)?(?:什么是|的含义|概念)?\s*(?:递归|闭包|红黑树|快速排序|动态规划|协程|线程|进程|死锁|gc|垃圾回收|原型链|作用域|http|tcp|udp|os|操作系统|算法|数据结构|机器学习|深度学习|大模型|llm|transformer|微积分|量子力学|相对论|天气|星座|历史|地理|常识)[\?？]?\s*$/i,
  /^\s*(?:今天|明天|后天)?天气(?:怎么样|如何|好吗)?[\?？]?\s*$/i,
  /^\s*(?:讲个笑话|唱首歌|写首诗|猜个谜语)[\?？]?\s*$/i,
];

/**
 * Explicit goal continuation phrases
 */
const EXPLICIT_CONTINUE_PATTERNS: RegExp[] = [
  /继续(?:推进)?(?:当前)?(?:会话)?(?:的)?(?:目标|任务)/i,
  /继续完成刚才的任务/i,
  /继续执行(?:目标|任务)?/i,
  /继续做(?:目标|任务)/i,
  /推进目标/i,
  /接着做(?:目标|任务)/i,
  /^\s*继续\s*$/i,
  /^\s*(?:continue|resume|proceed|keep going)\s*(?:with\s*)?(?:the\s*)?(?:goal|task)?\s*$/i,
];

/**
 * Explicit goal pause / interruption phrases
 */
const EXPLICIT_INTERRUPT_PATTERNS: RegExp[] = [
  /先别做目标/i,
  /先别管目标/i,
  /暂缓目标/i,
  /暂停目标/i,
  /别做目标了/i,
  /不要做目标/i,
  /先停下目标/i,
  /先别推进目标/i,
  /^\s*(?:pause|stop|hold|suspend)\s*(?:the\s*)?(?:goal|task)?\s*$/i,
];

/**
 * Extract meaningful semantic keywords/tokens from goal objective and criteria.
 */
function extractGoalKeywords(goal: SessionGoalRecord): string[] {
  const text = `${goal.objective} ${goal.successCriteria.join(' ')}`.toLowerCase();
  // Extract words / tokens >= 2 chars (ignoring very generic stop words)
  const tokens = text.match(/[\w\.\-]+|[\u4e00-\u9fa5]{2,}/g) || [];
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'make', 'into',
    '完成', '实现', '支持', '并且', '以及', '通过', '进行', '提供', '可以', '需要', '基于'
  ]);
  return Array.from(new Set(tokens.filter((t) => t.length >= 2 && !stopWords.has(t))));
}

/**
 * Classifies the intent of the current user turn in the presence of a persistent Session Goal.
 *
 * Deterministic rules:
 * 1. Automatic loop continuation -> 'goal_continue'
 * 2. Explicit continue command -> 'goal_continue'
 * 3. Explicit pause / interrupt command -> 'interrupt'
 * 4. General unrelated query (math, greetings, general knowledge) with no goal keywords -> 'unrelated'
 * 5. Goal keyword/entity overlap -> 'goal_related'
 * 6. Default: if no goal keywords match and user is asking a standalone question -> 'unrelated'
 */
export function classifyGoalTurnIntent(
  userMessage: string,
  goal: SessionGoalRecord | null | undefined,
  options?: ClassifyGoalTurnOptions,
): GoalTurnIntent {
  if (options?.goalLoopContinuation) {
    return 'goal_continue';
  }

  const trimmed = userMessage.trim();
  if (!trimmed) {
    return 'unrelated';
  }

  // 1. Explicit interruption
  if (EXPLICIT_INTERRUPT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'interrupt';
  }

  // 2. Explicit continuation
  if (EXPLICIT_CONTINUE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'goal_continue';
  }

  // If no goal exists or goal is idle, treated as normal turn (unrelated to any active goal)
  if (!goal?.objective?.trim() || goal.status === 'idle') {
    return 'unrelated';
  }

  // 3. Check general unrelated patterns (math, chit-chat, broad questions)
  if (UNRELATED_GENERAL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'unrelated';
  }

  // 4. Check keyword overlap with goal objective / criteria
  const goalKeywords = extractGoalKeywords(goal);
  const normalizedMessage = trimmed.toLowerCase();
  
  // Specific goal metadata inquiry or status query
  const goalMetaKeywords = ['目标', '进度', '完成了吗', '完成了么', '还差什么', '当前任务', 'goal', 'status', 'progress'];
  const hasGoalMeta = goalMetaKeywords.some((meta) => normalizedMessage.includes(meta));
  if (hasGoalMeta) {
    return 'goal_related';
  }

  // Check if any significant goal keyword is mentioned
  const hasKeywordOverlap = goalKeywords.some((keyword) => normalizedMessage.includes(keyword));
  if (hasKeywordOverlap) {
    return 'goal_related';
  }

  // 5. If there is no overlap with the goal, default to unrelated
  return 'unrelated';
}
