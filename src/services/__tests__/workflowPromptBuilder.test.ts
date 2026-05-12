import {
  buildDownstreamAgentPrompt,
  buildEntryAgentPrompt,
} from '../workflowPromptBuilder';
import type { WorkflowAgent } from '@/types/workflow';

function createAgent(overrides: Partial<WorkflowAgent> = {}): WorkflowAgent {
  return {
    id: overrides.id ?? 'agent-1',
    name: overrides.name ?? 'Developer',
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    role: overrides.role ?? 'developer',
    task: overrides.task ?? 'Implement the feature',
    taskPrompt: overrides.taskPrompt ?? 'Ship the implementation safely.',
    taskInstruction: overrides.taskInstruction ?? 'Focus on the missing items first.',
    ...overrides,
  };
}

describe('workflowPromptBuilder', () => {
  it('includes success criteria, previous evaluation reasoning, inbox, and marker instructions in entry prompts', () => {
    const prompt = buildEntryAgentPrompt({
      projectGoal: 'Ship workflow stabilization',
      successCriteria: 'Typecheck, tests, and lint pass',
      agent: createAgent(),
      iteration: 2,
      previousEvaluation: {
        iteration: 1,
        reached: false,
        confidence: 0.35,
        missingItems: ['Fix stale stream guard', 'Persist output artifacts'],
        reasoning: 'The workflow still loses output after refresh.',
        timestamp: 1,
      },
      inboxMessages: [{
        fromAgentId: 'reviewer',
        fromAgentName: 'Reviewer',
        summary: 'Double-check stop handling.',
        fullLength: 120,
        createdAt: 1,
      }],
    });

    expect(prompt).toContain('Ship workflow stabilization');
    expect(prompt).toContain('Typecheck, tests, and lint pass');
    expect(prompt).toContain('The workflow still loses output after refresh.');
    expect(prompt).toContain('Fix stale stream guard');
    expect(prompt).toContain('Double-check stop handling.');
    expect(prompt).toContain('[[WORKFLOW:PASS]]');
    expect(prompt).toContain('[[STATUS]]');
  });

  it('includes upstream outputs and inbox messages in downstream prompts', () => {
    const prompt = buildDownstreamAgentPrompt({
      projectGoal: 'Stabilize workflow schema',
      successCriteria: 'All workflow tests pass',
      agent: createAgent({ id: 'qa', name: 'QA', role: 'qa' }),
      upstreams: [{
        agent: createAgent({ id: 'developer', name: 'Developer', role: 'developer' }),
        output: 'Patched workflow store and canvas.',
      }],
      iteration: 1,
      inboxMessages: [{
        fromAgentId: 'reviewer',
        fromAgentName: 'Reviewer',
        summary: 'Validate graph cleanup behavior.',
        fullLength: 64,
        createdAt: 2,
      }],
    });

    expect(prompt).toContain('Patched workflow store and canvas.');
    expect(prompt).toContain('Validate graph cleanup behavior.');
    expect(prompt).toContain('All workflow tests pass');
  });
});