import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { WebFetchInputSchema, WebFetchTool } from '../WebFetchTool';
import type { ToolContext } from '../../base/Tool';

const mockInvoke = jest.mocked(invoke);
const context = {} as ToolContext;

describe('WebFetchTool SSRF protection', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('validates URL input before execution', () => {
    expect(WebFetchInputSchema.safeParse({
      url: 'https://example.com',
      prompt: 'Summarize the page',
    }).success).toBe(true);
    expect(WebFetchInputSchema.safeParse({
      url: 'not a URL',
      prompt: 'Summarize the page',
    }).success).toBe(false);
  });

  it('blocks loopback and cloud metadata addresses before invoking native fetch', async () => {
    for (const url of [
      'http://127.0.0.1:3000/admin',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const result = await new WebFetchTool().execute(
        { url, prompt: 'Read the page' },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Blocked:/);
      expect(mockInvoke).not.toHaveBeenCalled();
    }
  });
});
