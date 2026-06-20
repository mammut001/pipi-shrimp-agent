import { parseToolResult } from '../chatAdapter';

describe('parseToolResult', () => {
  it('treats plain read_file content as success stdout', () => {
    const observed = parseToolResult({
      id: '1',
      name: 'read_file',
      result: 'import subprocess, sys\nprint("ok")\n',
      durationMs: 12,
    });

    expect(observed.stderr).toBeUndefined();
    expect(observed.stdout).toContain('import subprocess');
    expect(observed.exitCode).toBe(0);
  });

  it('treats write_file success text as stdout', () => {
    const observed = parseToolResult({
      id: '2',
      name: 'write_file',
      result: 'Successfully wrote 814 bytes to D:\\tmp\\hypothesis.md',
      durationMs: 8,
    });

    expect(observed.stderr).toBeUndefined();
    expect(observed.stdout).toContain('Successfully wrote 814 bytes');
    expect(observed.exitCode).toBe(0);
  });

  it('treats Error-prefixed tool output as failure stderr', () => {
    const observed = parseToolResult({
      id: '3',
      name: 'read_file',
      result: 'Error: Failed to read file missing.py: not found',
      durationMs: 4,
    });

    expect(observed.stderr).toContain('Error: Failed to read file');
    expect(observed.exitCode).toBe(1);
  });

  it('parses execute_command JSON payloads', () => {
    const observed = parseToolResult(
      {
        id: '4',
        name: 'execute_command',
        result: JSON.stringify({
          status: 'succeeded',
          stdout: 'fixture metric written\n',
          stderr: '',
          exit_code: 0,
        }),
        durationMs: 3000,
      },
      'python3 run_experiment.py',
    );

    expect(observed.stdout).toBe('fixture metric written\n');
    expect(observed.stderr).toBe('');
    expect(observed.exitCode).toBe(0);
    expect(observed.command).toBe('python3 run_experiment.py');
  });
});
