import type { TaskStep } from '../types/ui';

export function createTaskStep(label: string, id: string = crypto.randomUUID()): TaskStep {
  return {
    id,
    label,
    status: 'pending',
  };
}

export function addOrReplaceTaskStep(steps: TaskStep[], label: string, id?: string): TaskStep[] {
  const step = createTaskStep(label, id);
  const existingIndex = steps.findIndex((candidate) => candidate.id === step.id);

  if (existingIndex === -1) {
    return [...steps, step];
  }

  return steps.map((candidate, index) => (
    index === existingIndex
      ? { ...candidate, label: step.label }
      : candidate
  ));
}

export function updateTaskStepStatus(
  steps: TaskStep[],
  id: string,
  status: TaskStep['status'],
  fallbackLabel = id,
): TaskStep[] {
  let found = false;
  const updated = steps.map((step) => {
    if (step.id !== id) {
      return step;
    }

    found = true;
    return { ...step, status };
  });

  if (found) {
    return updated;
  }

  return [...updated, { id, label: fallbackLabel, status }];
}

export function dedupeTaskSteps(steps: TaskStep[]): TaskStep[] {
  const seen = new Set<string>();
  const result: TaskStep[] = [];

  for (const step of steps) {
    if (seen.has(step.id)) {
      continue;
    }
    seen.add(step.id);
    result.push(step);
  }

  return result;
}

export function createToolTaskSteps(tools: Array<{ id: string; name: string }>): TaskStep[] {
  return dedupeTaskSteps(tools.map((tool) => createTaskStep(tool.name, tool.id)));
}
