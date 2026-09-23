import { describe, expect, it } from '@jest/globals';
import {
  buildPolicyErrorResult,
  buildStructuredToolError,
  contentBlocksToString,
  finalizeToolResult,
  isFrontendOnlyTool,
  sanitizeMcpServerName,
} from '@/services/streamingToolExecutorHelpers';

describe('streamingToolExecutorHelpers', () => {
  describe('contentBlocksToString', () => {
    it('joins text blocks and labels non-text content', () => {
      expect(contentBlocksToString([
        { type: 'text', text: 'hello' },
        { type: 'image', mime_type: 'image/png' },
        { type: 'resource', uri: 'file:///tmp/x' },
        { type: 'text', text: 'world' },
      ] as any)).toBe('hello\n[image: image/png]\n[resource: file:///tmp/x]\nworld');
    });

    it('skips empty / unknown block types', () => {
      expect(contentBlocksToString([
        { type: 'text', text: '' },
        { type: 'unknown' },
        { type: 'text', text: 'ok' },
      ] as any)).toBe('ok');
    });
  });

  describe('sanitizeMcpServerName', () => {
    it('mirrors toolNormalizer sanitize rules', () => {
      expect(sanitizeMcpServerName('My Server!')).toBe('My_Server_');
      expect(sanitizeMcpServerName('a-b_c.9')).toBe('a-b_c_9');
    });
  });

  describe('buildStructuredToolError', () => {
    it('serializes Error cause and optional path', () => {
      const raw = buildStructuredToolError('read_file', { path: '/tmp/a' }, new Error('boom'));
      const parsed = JSON.parse(raw);
      expect(parsed).toMatchObject({
        error: true,
        error_kind: 'transient_failure',
        message: 'boom',
        tool: 'read_file',
        path: '/tmp/a',
        cause: 'boom',
      });
    });

    it('honors fallback error kind and string errors', () => {
      const parsed = JSON.parse(buildStructuredToolError('x', {}, 'nope', 'tool_not_found'));
      expect(parsed.error_kind).toBe('tool_not_found');
      expect(parsed.cause).toBe('nope');
      expect(parsed.path).toBeUndefined();
    });
  });

  describe('buildPolicyErrorResult', () => {
    it('returns an is_error ToolResult with structured content', () => {
      const result = buildPolicyErrorResult(
        { id: 't1', name: 'write_file', arguments: { path: '/x' } },
        'Tool "write_file" is not allowed in this execution lane.',
        'tool_disabled',
      );
      expect(result.id).toBe('t1');
      expect(result.is_error).toBe(true);
      expect(result.execution_time_ms).toBe(0);
      expect(result.error_message).toContain('not allowed');
      const body = JSON.parse(result.content);
      expect(body.error_kind).toBe('tool_disabled');
      expect(body.tool).toBe('write_file');
    });
  });

  describe('finalizeToolResult', () => {
    it('sanitizes content and preserves error flags', () => {
      const result = finalizeToolResult('read_file', {
        id: 'r1',
        content: 'authorization: Bearer sk-ant-secret12345',
        is_error: false,
        error_message: undefined,
      });
      expect(result.id).toBe('r1');
      expect(result.is_error).toBe(false);
      expect(result.content).not.toContain('sk-ant-secret12345');
      expect(result.sanitized).toBe(true);
    });
  });

  describe('isFrontendOnlyTool', () => {
    it('treats mcp__ tools as frontend-only', () => {
      expect(isFrontendOnlyTool('mcp__server__tool')).toBe(true);
      expect(isFrontendOnlyTool('read_file')).toBe(false);
      expect(isFrontendOnlyTool('ssh_read_file')).toBe(false);
    });
  });
});
