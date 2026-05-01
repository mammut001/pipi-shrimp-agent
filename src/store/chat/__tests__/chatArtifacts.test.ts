import { describe, expect, it, jest } from '@jest/globals';
import { registerArtifactsFromToolResults } from '../chatArtifacts';

describe('chatArtifacts', () => {
  it('forwards tool metadata to artifact detection', async () => {
    const detectAndRegisterArtifacts = jest.fn();

    await registerArtifactsFromToolResults(
      async () => ({ detectAndRegisterArtifacts }),
      'assistant-message',
      [{ id: 'tool-1', content: 'created /work/out.svg', toolName: 'write_file', toolArgs: '{"path":"out.svg"}' }],
      '/work',
    );

    expect(detectAndRegisterArtifacts).toHaveBeenCalledWith({
      messageId: 'assistant-message',
      toolName: 'write_file',
      toolArgs: '{"path":"out.svg"}',
      toolResultText: 'created /work/out.svg',
      workDir: '/work',
    });
  });

  it('uses safe defaults when a tool result is partially structured', async () => {
    const detectAndRegisterArtifacts = jest.fn();

    await registerArtifactsFromToolResults(
      async () => ({ detectAndRegisterArtifacts }),
      'assistant-message',
      [{ id: 'tool-1', content: 'ok' }],
      null,
    );

    expect(detectAndRegisterArtifacts).toHaveBeenCalledWith({
      messageId: 'assistant-message',
      toolName: '',
      toolArgs: '',
      toolResultText: 'ok',
      workDir: undefined,
    });
  });
});
