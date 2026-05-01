import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  addOrReplaceTaskStep,
  createTaskStep,
  createToolTaskSteps,
  dedupeTaskSteps,
  updateTaskStepStatus,
} from '../taskLifecycle';

describe('taskLifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates pending task steps', () => {
    jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('task-id');

    expect(createTaskStep('Read file')).toEqual({
      id: 'task-id',
      label: 'Read file',
      status: 'pending',
    });
  });

  it('adds new task steps and replaces duplicate labels without duplicating IDs', () => {
    const first = addOrReplaceTaskStep([], 'Read file', 'tool-1');
    const second = addOrReplaceTaskStep(first, 'Read config', 'tool-1');

    expect(second).toEqual([{ id: 'tool-1', label: 'Read config', status: 'pending' }]);
  });

  it('upserts missing task steps on status updates', () => {
    expect(updateTaskStepStatus([], 'tool-1', 'running', 'Read file')).toEqual([
      { id: 'tool-1', label: 'Read file', status: 'running' },
    ]);
  });

  it('deduplicates task steps by first occurrence', () => {
    expect(dedupeTaskSteps([
      { id: 'tool-1', label: 'Read file', status: 'pending' },
      { id: 'tool-1', label: 'Read again', status: 'running' },
      { id: 'tool-2', label: 'Write file', status: 'pending' },
    ])).toEqual([
      { id: 'tool-1', label: 'Read file', status: 'pending' },
      { id: 'tool-2', label: 'Write file', status: 'pending' },
    ]);
  });

  it('creates tool task steps from a tool batch', () => {
    expect(createToolTaskSteps([
      { id: 'tool-1', name: 'read_file' },
      { id: 'tool-2', name: 'write_file' },
    ])).toEqual([
      { id: 'tool-1', label: 'read_file', status: 'pending' },
      { id: 'tool-2', label: 'write_file', status: 'pending' },
    ]);
  });
});
