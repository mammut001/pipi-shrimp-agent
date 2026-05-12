import { describe, expect, it } from '@jest/globals';
import {
  appendToolBudgetEntries,
  classifyToolBudgetEntry,
  createToolBudgetSummary,
} from '../toolBudget';

describe('toolBudget', () => {
  it('classifies the five supported tool budget categories', () => {
    expect(classifyToolBudgetEntry({
      name: 'write_file',
      content: '{"error":true,"error_kind":"tool_not_found","message":"Unknown tool"}',
    })).toBe('tool_not_found');

    expect(classifyToolBudgetEntry({
      name: 'glob_search',
      content: '{"error":true,"error_kind":"tool_disabled","message":"Tool disabled"}',
    })).toBe('tool_disabled');

    expect(classifyToolBudgetEntry({
      name: 'write_file',
      content: "Error: Missing 'path' argument for write_file",
    })).toBe('argument_invalid');

    expect(classifyToolBudgetEntry({
      name: 'write_file',
      content: '{"error":true,"error_kind":"access_denied","message":"Permission denied"}',
    })).toBe('transient_failure');

    expect(classifyToolBudgetEntry({
      name: 'read_file',
      content: '{"content":"ok","path":"/tmp/example.txt"}',
    })).toBe('successful_call');
  });

  it('charges budget according to the five categories', () => {
    const summary = appendToolBudgetEntries(createToolBudgetSummary(17), [
      {
        name: 'missing_tool',
        content: '{"error":true,"error_kind":"tool_not_found","message":"Unknown tool"}',
      },
      {
        name: 'glob_search',
        content: '{"error":true,"error_kind":"tool_disabled","message":"Tool disabled"}',
      },
      {
        name: 'write_file',
        content: "Error: Missing 'content' argument for write_file",
      },
      {
        name: 'write_file',
        content: '{"error":true,"error_kind":"io_error","message":"Temporary IO failure"}',
      },
      {
        name: 'read_file',
        content: '{"content":"ok","path":"/tmp/example.txt"}',
      },
    ]);

    expect(summary.toolBudgetUsedRaw).toBe(2);
    expect(summary.toolBudgetUsed).toBe(2);
    expect(summary.toolBudgetMax).toBe(17);
    expect(summary.failedCalls).toBe(4);
    expect(summary.successfulCalls).toBe(1);
    expect(summary.categoryCounts).toEqual({
      tool_not_found: 1,
      tool_disabled: 1,
      argument_invalid: 1,
      transient_failure: 1,
      successful_call: 1,
    });
  });

  it('rounds exposed budget usage up after summing fractional costs', () => {
    const summary = appendToolBudgetEntries(createToolBudgetSummary(17), [
      {
        name: 'write_file',
        content: "Error: Missing 'content' argument for write_file",
      },
    ]);

    expect(summary.toolBudgetUsedRaw).toBe(0.5);
    expect(summary.toolBudgetUsed).toBe(1);
  });
});
