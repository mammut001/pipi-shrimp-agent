import type { SwarmTask } from '@/services/swarm/types';
import { useSwarmStore } from '@/store/swarmStore';
import { registerDiagnosticsTask } from '@/store/taskRegistryStore';

let cleanupTaskDiagnosticsWiring: (() => void) | null = null;

function mapSwarmTaskState(status: SwarmTask['status']) {
  switch (status) {
    case 'in_progress':
      return 'running' as const;
    case 'completed':
      return 'completed' as const;
    case 'failed':
      return 'failed' as const;
    case 'pending':
    case 'claimed':
    default:
      return 'created' as const;
  }
}

function syncSwarmTasks(tasks: SwarmTask[]): void {
  for (const task of tasks) {
    registerDiagnosticsTask({
      id: `swarm:${task.id}`,
      kind: 'swarm',
      source: `team:${task.teamId}`,
      createdAt: task.createdAt,
      state: mapSwarmTaskState(task.status),
      cancelable: false,
      title: task.description,
      detail: task.resultSummary,
      error: task.status === 'failed' ? task.resultSummary : undefined,
    });
  }
}

export function setupTaskDiagnosticsWiring(): () => void {
  if (cleanupTaskDiagnosticsWiring) {
    return cleanupTaskDiagnosticsWiring;
  }

  syncSwarmTasks(useSwarmStore.getState().tasks);

  const unsubscribeSwarm = useSwarmStore.subscribe((state, previousState) => {
    if (state.tasks !== previousState.tasks) {
      syncSwarmTasks(state.tasks);
    }
  });

  cleanupTaskDiagnosticsWiring = () => {
    unsubscribeSwarm();
    cleanupTaskDiagnosticsWiring = null;
  };

  return cleanupTaskDiagnosticsWiring;
}
