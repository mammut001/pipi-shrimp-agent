import { Message } from '../types/chat';

/**
 * Context Analysis Utility
 * Analyzes conversation structure to determine intelligent compression strategies
 */

export interface ContextAnalysisResult {
  hasTopicChange: boolean;
  taskCompletionDetected: boolean;
  conversationDepth: number;
  recommendedStrategy: 'micro' | 'session' | 'legacy' | 'none';
  confidence: number;
}

export interface TopicChangeDetection {
  changed: boolean;
  oldTopic: string;
  newTopic: string;
  similarity: number;
}

export interface TaskCompletionDetection {
  completed: boolean;
  taskType: string;
  confidence: number;
}

/**
 * Analyze conversation context for compression strategy
 */
export function analyzeConversationContext(
  messages: Message[],
  recentMessages: Message[] = [],
  options: {
    topicSimilarityThreshold?: number;
    taskCompletionKeywords?: string[];
  } = {}
): ContextAnalysisResult {
  const {
    topicSimilarityThreshold = 0.3,
    taskCompletionKeywords = ['done', 'completed', 'finished', 'success', 'error resolved']
  } = options;

  // Detect topic changes
  const topicChange = detectTopicChange(messages, recentMessages, topicSimilarityThreshold);

  // Detect task completion
  const taskCompletion = detectTaskCompletion(messages, 5, taskCompletionKeywords);

  // Calculate conversation depth
  const depth = calculateConversationDepth(messages);

  // Determine recommended strategy
  const strategy = determineCompressionStrategy(topicChange, taskCompletion, depth);

  return {
    hasTopicChange: topicChange.changed,
    taskCompletionDetected: taskCompletion.completed,
    conversationDepth: depth,
    recommendedStrategy: strategy.strategy,
    confidence: strategy.confidence
  };
}

/**
 * Detect if topic has changed between message sets
 */
export function detectTopicChange(
  allMessages: Message[],
  recentMessages: Message[],
  threshold: number
): TopicChangeDetection {
  if (allMessages.length < 2) {
    return { changed: false, oldTopic: '', newTopic: '', similarity: 1 };
  }

  // Extract topics from message content using simple keyword analysis
  const oldTopic = extractTopic(allMessages.slice(0, -recentMessages.length));
  const newTopic = extractTopic(recentMessages);

  // Calculate similarity (simple Jaccard similarity for keywords)
  const similarity = calculateKeywordSimilarity(oldTopic.keywords, newTopic.keywords);

  return {
    changed: similarity < threshold,
    oldTopic: oldTopic.summary,
    newTopic: newTopic.summary,
    similarity
  };
}

/**
 * Detect if a task has been completed
 */
export function detectTaskCompletion(
  messages: Message[],
  recentCount: number = 5,
  keywords: string[] = ['done', 'completed', 'finished', 'success', 'error resolved']
): TaskCompletionDetection {
  const recentMessages = messages.slice(-recentCount); // Check last N messages
  const content = recentMessages.map(m => m.content).join(' ').toLowerCase();

  // Check for completion keywords
  const hasCompletionKeyword = keywords.some(keyword =>
    content.includes(keyword.toLowerCase())
  );

  // Check for success patterns
  const hasSuccessPattern = /✅|✔️|success|completed|finished/i.test(content);

  // Check for error resolution
  const hasErrorResolution = /error resolved|fixed|resolved/i.test(content);

  const completed = hasCompletionKeyword || hasSuccessPattern || hasErrorResolution;
  const confidence = completed ? 0.8 : 0.2;

  return {
    completed,
    taskType: completed ? 'general' : '',
    confidence
  };
}

/**
 * Calculate conversation depth (number of exchanges)
 */
export function calculateConversationDepth(messages: Message[]): number {
  return Math.floor(messages.length / 2); // Rough estimate: pairs of user/assistant messages
}

/**
 * Determine optimal compression strategy based on context
 */
function determineCompressionStrategy(
  topicChange: TopicChangeDetection,
  taskCompletion: TaskCompletionDetection,
  depth: number
): { strategy: 'micro' | 'session' | 'legacy' | 'none'; confidence: number } {
  if (topicChange.changed) {
    return { strategy: 'session', confidence: 0.9 }; // Topic change warrants session compression
  }

  if (taskCompletion.completed && depth > 10) {
    return { strategy: 'micro', confidence: 0.8 }; // Task completion with deep conversation
  }

  if (depth > 20) {
    return { strategy: 'legacy', confidence: 0.7 }; // Very long conversation
  }

  return { strategy: 'none', confidence: 0.5 }; // No compression needed
}

/**
 * Extract topic information from messages
 */
function extractTopic(messages: Message[]): { summary: string; keywords: string[] } {
  const content = messages.map(m => m.content).join(' ');
  const words = content.toLowerCase().split(/\s+/);

  // Simple keyword extraction (most frequent non-stop words)
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  const keywords = words
    .filter(word => word.length > 3 && !stopWords.includes(word))
    .reduce((acc, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const topKeywords = Object.entries(keywords)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([word]) => word);

  return {
    summary: topKeywords.join(' '),
    keywords: topKeywords
  };
}

/**
 * Calculate Jaccard similarity between two keyword sets
 */
function calculateKeywordSimilarity(keywords1: string[], keywords2: string[]): number {
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}