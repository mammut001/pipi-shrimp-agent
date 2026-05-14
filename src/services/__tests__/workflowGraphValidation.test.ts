import { describe, expect, it } from '@jest/globals';
import type { WorkflowAgent, WorkflowConnection } from '@/types/workflow';
import { validateWorkflowGraph } from '../workflowGraphValidation';

function createAgent(overrides: Partial<WorkflowAgent> = {}): WorkflowAgent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Agent',
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    role: overrides.role ?? 'custom',
    notifyOnComplete: overrides.notifyOnComplete ?? [],
    ...overrides,
  };
}

function createConnection(overrides: Partial<WorkflowConnection> = {}): WorkflowConnection {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sourceAgentId: overrides.sourceAgentId ?? 'a',
    targetAgentId: overrides.targetAgentId ?? 'b',
    condition: overrides.condition ?? 'onComplete',
    keyword: overrides.keyword,
    keywordMode: overrides.keywordMode,
    type: overrides.type ?? 'sequential',
  };
}

describe('validateWorkflowGraph', () => {
  it('accepts a simple valid DAG', () => {
    const agents = [
      createAgent({ id: 'a', name: 'A' }),
      createAgent({ id: 'b', name: 'B' }),
      createAgent({ id: 'c', name: 'C' }),
    ];
    const connections = [
      createConnection({ id: 'ab', sourceAgentId: 'a', targetAgentId: 'b' }),
      createConnection({ id: 'bc', sourceAgentId: 'b', targetAgentId: 'c' }),
    ];

    expect(validateWorkflowGraph(agents, connections)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects self-loop connections', () => {
    const agents = [createAgent({ id: 'a', name: 'A' })];
    const result = validateWorkflowGraph(agents, [
      createConnection({ id: 'aa', sourceAgentId: 'a', targetAgentId: 'a' }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'self-loop', connectionIds: ['aa'] }),
    ]));
  });

  it('rejects connections whose target agent is missing', () => {
    const agents = [createAgent({ id: 'a', name: 'A' })];
    const result = validateWorkflowGraph(agents, [
      createConnection({ id: 'missing-target', sourceAgentId: 'a', targetAgentId: 'b' }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-target-agent', connectionIds: ['missing-target'] }),
    ]));
  });

  it('rejects invalid inputFrom references', () => {
    const agents = [
      createAgent({ id: 'a', name: 'A' }),
      createAgent({ id: 'b', name: 'B', inputFrom: 'missing' }),
    ];
    const result = validateWorkflowGraph(agents, []);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-input-from', agentIds: ['b'] }),
    ]));
  });

  it('rejects dangling output routes whose targets are missing', () => {
    const agents = [
      createAgent({
        id: 'a',
        name: 'A',
        outputRoutes: [{ id: 'route-1', condition: 'onComplete', targetAgentId: 'missing' }],
      }),
    ];
    const result = validateWorkflowGraph(agents, []);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'route-target-missing', agentIds: ['a'] }),
    ]));
  });

  it('rejects duplicate edges', () => {
    const agents = [createAgent({ id: 'a', name: 'A' }), createAgent({ id: 'b', name: 'B' })];
    const result = validateWorkflowGraph(agents, [
      createConnection({ id: 'ab-1', sourceAgentId: 'a', targetAgentId: 'b' }),
      createConnection({ id: 'ab-2', sourceAgentId: 'a', targetAgentId: 'b' }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-edge', connectionIds: ['ab-1', 'ab-2'] }),
    ]));
  });

  it('rejects cycles', () => {
    const agents = [
      createAgent({ id: 'a', name: 'A' }),
      createAgent({ id: 'b', name: 'B' }),
      createAgent({ id: 'c', name: 'C' }),
    ];
    const result = validateWorkflowGraph(agents, [
      createConnection({ id: 'ab', sourceAgentId: 'a', targetAgentId: 'b' }),
      createConnection({ id: 'bc', sourceAgentId: 'b', targetAgentId: 'c' }),
      createConnection({ id: 'ca', sourceAgentId: 'c', targetAgentId: 'a' }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cycle', agentIds: expect.arrayContaining(['a', 'b', 'c']) }),
    ]));
  });

  it('rejects ambiguous multi-predecessor inputs', () => {
    const agents = [
      createAgent({ id: 'a', name: 'A' }),
      createAgent({ id: 'b', name: 'B' }),
      createAgent({ id: 'c', name: 'C' }),
    ];
    const result = validateWorkflowGraph(agents, [
      createConnection({ id: 'ac', sourceAgentId: 'a', targetAgentId: 'c' }),
      createConnection({ id: 'bc', sourceAgentId: 'b', targetAgentId: 'c' }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ambiguous-input', agentIds: expect.arrayContaining(['c', 'a', 'b']) }),
    ]));
  });
});