import { runAcceptanceCommands } from '../runAcceptance';

describe('runAcceptanceCommands', () => {
  it('marks missing workDir as blocked', async () => {
    const results = await runAcceptanceCommands([{ command: 'pnpm test' }], {});
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('blocked');
  });

  it('passes on exit code 0 and fails on non-zero', async () => {
    const executeBatch = jest.fn()
      .mockResolvedValueOnce({
        results: [{ id: 'acceptance-0', content: JSON.stringify({ stdout: 'ok', stderr: '', exit_code: 0 }), is_error: false }],
        totalExecutionTime: 1,
        errors: [],
      })
      .mockResolvedValueOnce({
        results: [{ id: 'acceptance-1', content: JSON.stringify({ stdout: '', stderr: 'boom', exit_code: 1 }), is_error: false }],
        totalExecutionTime: 1,
        errors: [],
      });
    const results = await runAcceptanceCommands([{ command: 'a' }, { command: 'b' }], {
      workDir: '/tmp/proj',
      executeBatch,
    });
    expect(results[0].status).toBe('pass');
    expect(results[1].status).toBe('failed');
  });

  it('treats policy-blocked tool errors as blocked', async () => {
    const executeBatch = jest.fn().mockResolvedValue({
      results: [{ id: 'acceptance-0', content: 'Error: blocked', is_error: true, error_message: 'blocked by policy' }],
      totalExecutionTime: 1,
      errors: [],
    });
    const results = await runAcceptanceCommands([{ command: 'pnpm test' }], {
      workDir: '/tmp/proj',
      executeBatch,
    });
    expect(results[0].status).toBe('blocked');
  });
});
