import { describe, expect, it, jest } from '@jest/globals';

describe('workflow goal criteria persistence migration', () => {
  it('hydrates legacy V2 string criteria into canonical arrays and writes them back', async () => {
    localStorage.clear();
    jest.resetModules();

    localStorage.setItem('pipi-workflow-v2', JSON.stringify({
      currentInstanceId: 'legacy',
      instances: [{
        id: 'legacy',
        name: 'Legacy Workflow',
        projectGoal: 'Ship the feature',
        successCriteria: '- tests pass\n• docs updated',
        goalEvaluatorAgentId: null,
        maxGoalIterations: 5,
        agents: [],
        connections: [],
        workflowRuns: [{
          id: 'legacy-run',
          title: 'Legacy run',
          projectGoal: 'Ship the feature',
          successCriteria: 'tests pass\ndocs updated',
          status: 'idle',
          startTime: 1,
          agents: [],
        }],
        activeRunId: null,
        dirtyAgentIds: [],
        createdAt: 1,
        updatedAt: 1,
      }],
    }));

    const { useWorkflowStore } = await import('../workflowStore');
    const instance = useWorkflowStore.getState().instances[0];

    expect(instance.successCriteria).toEqual(['tests pass', 'docs updated']);
    expect(instance.workflowRuns[0].successCriteria).toEqual(['tests pass', 'docs updated']);

    const persisted = JSON.parse(localStorage.getItem('pipi-workflow-v2') || '{}');
    expect(persisted.instances[0].successCriteria).toEqual(['tests pass', 'docs updated']);
    expect(persisted.instances[0].workflowRuns[0].successCriteria).toEqual(['tests pass', 'docs updated']);
  });
});
