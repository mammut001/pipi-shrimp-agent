import type { AgentExecutionConfig, RetryPolicy } from '@/types/workflow';

export const DEFAULT_EXECUTION_CONFIG: AgentExecutionConfig = {
  mode: 'single',
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 1500,
};

export const DEFAULT_MAX_GOAL_ITERATIONS = 5;