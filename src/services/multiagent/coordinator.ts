/**
 * Coordinator Mode
 *
 * Turns the main thread into a coordinator that dispatches
 * multiple workers and aggregates their results.
 *
 * Based on Claude Code's src/coordinator/coordinatorMode.ts
 */

import { AgentContext } from './agentContext';
import { runAgentSync, SubagentResult } from './subagent';

export interface WorkerTask {
  id: string;
  name: string;
  description: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: SubagentResult;
}

export interface CoordinatorState {
  sessionId: string;
  parentContext: AgentContext;
  tasks: WorkerTask[];
  isComplete: boolean;
  finalResult?: string;
}

/**
 * Create a coordinator session.
 */
export function createCoordinator(
  sessionId: string,
  parentContext: AgentContext,
): CoordinatorState {
  return {
    sessionId,
    parentContext,
    tasks: [],
    isComplete: false,
  };
}

/**
 * Add a worker task to the coordinator.
 */
export function addWorkerTask(
  state: CoordinatorState,
  name: string,
  description: string,
  prompt: string,
): string {
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  state.tasks.push({
    id: taskId,
    name,
    description,
    prompt,
    status: 'pending',
  });
  return taskId;
}

/**
 * Run all worker tasks (with concurrency control).
 */
export async function runCoordinatorTasks(
  state: CoordinatorState,
  maxConcurrency: number = 3,
): Promise<CoordinatorState> {
  const pendingTasks = state.tasks.filter(t => t.status === 'pending');

  for (let i = 0; i < pendingTasks.length; i += maxConcurrency) {
    const batch = pendingTasks.slice(i, i + maxConcurrency);

    // Run batch in parallel
    const results = await Promise.all(
      batch.map(async (task) => {
        task.status = 'running';

        try {
          const result = await runAgentSync({
            name: task.name,
            prompt: task.prompt,
            description: task.description,
            sessionId: state.sessionId,
            parentContext: state.parentContext,
          });

          task.result = result;
          task.status = result.success ? 'completed' : 'failed';
        } catch (e) {
          task.status = 'failed';
          task.result = {
            agentId: task.id,
            content: '',
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }

        return task;
      })
    );

    // Update state
    for (const task of results) {
      const idx = state.tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        state.tasks[idx] = task;
      }
    }
  }

  // Aggregate results
  const completedTasks = state.tasks.filter(t => t.status === 'completed');
  const failedTasks = state.tasks.filter(t => t.status === 'failed');

  state.finalResult = `## Coordinator Summary

### Completed (${completedTasks.length})
${completedTasks.map(t => `- **${t.name}**: ${t.result?.content?.slice(0, 200)}...`).join('\n')}

### Failed (${failedTasks.length})
${failedTasks.map(t => `- **${t.name}**: ${t.result?.error || 'Unknown error'}`).join('\n')}
`;

  state.isComplete = true;
  return state;
}
