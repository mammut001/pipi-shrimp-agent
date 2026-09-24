import { describe, expect, it } from '@jest/globals';
import { parseToolCommand, parseToolResult } from '../chatAdapterHelpers';

describe('AutoResearch chat adapter tool result helpers', () => {
  it('extracts command text from valid arguments and rejects malformed JSON', () => {
    expect(parseToolCommand({ name: 'execute_command', arguments: '{"command":"python run.py"}' }))
      .toBe('python run.py');
    expect(parseToolCommand({ name: 'execute_command', arguments: '{' })).toBeUndefined();
  });

  it('parses structured command output and exit codes', () => {
    expect(parseToolResult({
      id: 'tool-1',
      name: 'execute_command',
      result: '{"stdout":"done","stderr":"","exitCode":0}',
      durationMs: 12,
    }, 'python run.py')).toEqual({
      tool: 'execute_command',
      command: 'python run.py',
      stdout: 'done',
      stderr: '',
      exitCode: 0,
    });
  });

  it('converts plain file tool responses into successful outcomes', () => {
    expect(parseToolResult({
      id: 'tool-2',
      name: 'write_file',
      result: 'Successfully wrote 10 bytes to /tmp/result.txt',
      durationMs: 4,
    })).toEqual({
      tool: 'write_file',
      command: undefined,
      stdout: 'Successfully wrote 10 bytes to /tmp/result.txt',
      stderr: undefined,
      exitCode: 0,
    });
  });

  it('preserves error envelopes as failed outcomes', () => {
    expect(parseToolResult({
      id: 'tool-3',
      name: 'execute_command',
      result: '{"error":true,"message":"command failed","exit_code":2}',
      durationMs: 5,
    })).toEqual({
      tool: 'execute_command',
      command: undefined,
      stdout: undefined,
      stderr: 'command failed',
      exitCode: 2,
    });
  });
});
