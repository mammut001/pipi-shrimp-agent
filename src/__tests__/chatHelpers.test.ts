/**
 * chatHelpers Tests - Pure utility functions for chat store
 */

import { describe, it, expect } from '@jest/globals';
import type { Message } from '../types/chat';
import {
  parseThinkContent,
  mergeReasoningParts,
  parseToolResultMessage,
  buildApiMessages,
  safeJsonParse,
  dbToSession,
  sessionToDb,
  messageToDb,
  dbToProject,
  projectToDb,
} from '../utils/chatHelpers';

// ─── parseThinkContent ───────────────────────────────────────────────────────

describe('parseThinkContent', () => {
  it('should extract reasoning from complete think blocks', () => {
    const input = '<think>Let me think about this.</think>Here is the answer.';
    const result = parseThinkContent(input);
    expect(result.content).toBe('Here is the answer.');
    expect(result.reasoning).toBe('Let me think about this.');
  });

  it('should handle multiple think blocks', () => {
    const input = '<think>First thought.</think><think>Second thought.</think>Final answer.';
    const result = parseThinkContent(input);
    expect(result.content).toBe('Final answer.');
    expect(result.reasoning).toBe('First thought.\n\nSecond thought.');
  });

  it('should handle content with no think tags', () => {
    const input = 'Just a plain message.';
    const result = parseThinkContent(input);
    expect(result.content).toBe('Just a plain message.');
    expect(result.reasoning).toBeUndefined();
  });

  it('should handle partial think tags (streaming)', () => {
    const input = '<think>Still thinking...';
    const result = parseThinkContent(input);
    expect(result.content).toBe('');
    expect(result.reasoning).toBeUndefined();
  });

  it('should strip orphaned closing think tags', () => {
    const input = 'Hello world</think>';
    const result = parseThinkContent(input);
    expect(result.content).toBe('Hello world');
  });

  it('should handle empty content', () => {
    const result = parseThinkContent('');
    expect(result.content).toBe('');
    expect(result.reasoning).toBeUndefined();
  });

  it('should handle think block with only whitespace', () => {
    const input = '<think>  </think>Hello';
    const result = parseThinkContent(input);
    expect(result.content).toBe('Hello');
    // Empty reasoning parts are filtered out by mergeReasoningParts
    expect(result.reasoning).toBeUndefined();
  });

  it('should de-duplicate identical think blocks', () => {
    const input = '<think>Same thought.</think><think>Same thought.</think>Answer.';
    const result = parseThinkContent(input);
    expect(result.reasoning).toBe('Same thought.');
  });
});

// ─── mergeReasoningParts ─────────────────────────────────────────────────────

describe('mergeReasoningParts', () => {
  it('should merge multiple parts with double newline', () => {
    const result = mergeReasoningParts('Part 1', 'Part 2', 'Part 3');
    expect(result).toBe('Part 1\n\nPart 2\n\nPart 3');
  });

  it('should filter out empty and undefined parts', () => {
    const result = mergeReasoningParts('Part 1', '', undefined, null, 'Part 2');
    expect(result).toBe('Part 1\n\nPart 2');
  });

  it('should return undefined for all empty parts', () => {
    const result = mergeReasoningParts('', undefined, null);
    expect(result).toBeUndefined();
  });

  it('should de-duplicate identical parts', () => {
    const result = mergeReasoningParts('Same', 'Same', 'Different');
    expect(result).toBe('Same\n\nDifferent');
  });

  it('should de-duplicate repeated paragraphs inside a single part', () => {
    const result = mergeReasoningParts('Plan A\n\nPlan B\n\nPlan A', 'Plan B');
    expect(result).toBe('Plan A\n\nPlan B');
  });

  it('should return undefined for no arguments', () => {
    const result = mergeReasoningParts();
    expect(result).toBeUndefined();
  });
});

// ─── parseToolResultMessage ──────────────────────────────────────────────────

describe('parseToolResultMessage', () => {
  it('should parse a valid tool result message', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'user',
      content: '__TOOL_RESULT__:call-123:{"status":"ok"}',
      timestamp: Date.now(),
    };
    const result = parseToolResultMessage(msg);
    expect(result).toEqual({
      toolCallId: 'call-123',
      result: '{"status":"ok"}',
    });
  });

  it('should return null for non-user messages', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: '__TOOL_RESULT__:call-123:result',
      timestamp: Date.now(),
    };
    expect(parseToolResultMessage(msg)).toBeNull();
  });

  it('should return null for non-tool-result content', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello, how are you?',
      timestamp: Date.now(),
    };
    expect(parseToolResultMessage(msg)).toBeNull();
  });

  it('should handle tool result with colon in content', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'user',
      content: '__TOOL_RESULT__:call-1:file:///path/to/file: more content',
      timestamp: Date.now(),
    };
    const result = parseToolResultMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.toolCallId).toBe('call-1');
    expect(result!.result).toBe('file:///path/to/file: more content');
  });
});

// ─── buildApiMessages ────────────────────────────────────────────────────────

describe('buildApiMessages', () => {
  it('should pass through simple user/assistant messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Hi there', timestamp: 2 },
    ];
    const result = buildApiMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  it('should pair tool_calls with their results', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Do something', timestamp: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '',
        timestamp: 2,
        tool_calls: [
          { id: 'tc-1', name: 'read_file', arguments: '{"path":"/tmp"}' },
        ],
      },
      {
        id: '3',
        role: 'user',
        content: '__TOOL_RESULT__:tc-1:file contents here',
        timestamp: 3,
      },
    ];
    const result = buildApiMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('assistant');
    expect(result[1].tool_calls).toHaveLength(1);
    expect(result[2].role).toBe('user');
    expect(result[2].content).toContain('__TOOL_RESULT__');
    expect(result[2].content).toContain('tc-1');
  });

  it('should keep assistant tool_calls when results are incomplete', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '',
        timestamp: 2,
        tool_calls: [
          { id: 'tc-1', name: 'read_file', arguments: '{}' },
          { id: 'tc-2', name: 'write_file', arguments: '{}' },
        ],
      },
      // Only one result for two tool calls
      {
        id: '3',
        role: 'user',
        content: '__TOOL_RESULT__:tc-1:result1',
        timestamp: 3,
      },
    ];
    const result = buildApiMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].tool_calls).toHaveLength(2);
    expect(result[2].content).toContain('tc-1');
  });

  it('should drop duplicate tool results', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        tool_calls: [{ id: 'tc-1', name: 'read_file', arguments: '{}' }],
      },
      { id: '2', role: 'user', content: '__TOOL_RESULT__:tc-1:first', timestamp: 2 },
      { id: '3', role: 'user', content: '__TOOL_RESULT__:tc-1:duplicate', timestamp: 3 },
    ];
    const result = buildApiMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[1].content).toContain('first');
  });

  it('should skip orphan tool results', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: '__TOOL_RESULT__:orphan-id:some result',
        timestamp: 1,
      },
      { id: '2', role: 'user', content: 'Hello', timestamp: 2 },
    ];
    const result = buildApiMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello');
  });

  it('should handle empty message array', () => {
    expect(buildApiMessages([])).toEqual([]);
  });

  it('should preserve system messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'system' as any, content: 'You are a helpful assistant.', timestamp: 1 },
      { id: '2', role: 'user', content: 'Hello', timestamp: 2 },
    ];
    const result = buildApiMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
  });

  it('should preserve user image attachments', () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'user',
        content: 'Describe this image',
        timestamp: 1,
        attachments: [{
          id: 'img-1',
          source: 'upload',
          mime: 'image/png',
          bytes: 128,
          encoding: 'base64',
          data: 'ZmFrZQ==',
          createdAt: 1,
        }],
      },
    ];

    const result = buildApiMessages(messages);
    expect(result[0].attachments).toHaveLength(1);
    expect(result[0].attachments?.[0]?.mime).toBe('image/png');
  });
});

// ─── safeJsonParse ───────────────────────────────────────────────────────────

describe('safeJsonParse', () => {
  it('should parse valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('should return fallback for null', () => {
    expect(safeJsonParse(null, [])).toEqual([]);
  });

  it('should return fallback for undefined', () => {
    expect(safeJsonParse(undefined, 'default')).toBe('default');
  });

  it('should return fallback for invalid JSON', () => {
    expect(safeJsonParse('not json', 42)).toBe(42);
  });

  it('should return fallback for empty string', () => {
    expect(safeJsonParse('', false)).toBe(false);
  });
});

// ─── DB ↔ Frontend converters ────────────────────────────────────────────────

describe('dbToSession / sessionToDb', () => {
  it('should round-trip session through DB format', () => {
    const session = {
      id: 'sess-1',
      title: 'Test Session',
      createdAt: 1000,
      updatedAt: 2000,
      cwd: '/home/user',
      projectId: 'proj-1',
      model: 'gpt-4',
      workDir: '/work/dir',
      messages: [],
    };

    const db = sessionToDb(session as any);
    expect(db.id).toBe('sess-1');
    expect(db.created_at).toBe(1000);
    expect(db.cwd).toBe('/home/user');

    const restored = dbToSession(db, []);
    expect(restored.id).toBe('sess-1');
    expect(restored.createdAt).toBe(1000);
    expect(restored.cwd).toBe('/home/user');
  });

  it('should handle null fields in DB format', () => {
    const db = {
      id: 'sess-1',
      title: 'Test',
      created_at: 1000,
      updated_at: 2000,
      cwd: null,
      project_id: null,
      model: null,
    };
    const session = dbToSession(db, []);
    expect(session.cwd).toBeUndefined();
    expect(session.projectId).toBeUndefined();
    expect(session.model).toBeUndefined();
  });

  it('should restore message attachments from DB format', () => {
    const session = dbToSession({
      id: 'sess-1',
      title: 'Test',
      created_at: 1000,
      updated_at: 2000,
      cwd: null,
      project_id: null,
      model: null,
    }, [{
      id: 'msg-1',
      session_id: 'sess-1',
      role: 'user',
      content: 'Hello',
      reasoning: null,
      attachments: JSON.stringify([{
        id: 'img-1',
        source: 'upload',
        mime: 'image/png',
        bytes: 128,
        encoding: 'base64',
        data: 'ZmFrZQ==',
        createdAt: 1,
      }]),
      artifacts: null,
      tool_calls: null,
      token_usage: null,
      created_at: 1000,
    }]);

    expect(session.messages[0].attachments?.[0]?.mime).toBe('image/png');
  });
});

describe('messageToDb', () => {
  it('should convert message to DB format', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: 1000,
      attachments: [{
        id: 'img-1',
        source: 'upload',
        mime: 'image/png',
        bytes: 128,
        encoding: 'base64',
        data: 'ZmFrZQ==',
        createdAt: 1,
      }],
    };
    const db = messageToDb(msg, 'sess-1');
    expect(db.id).toBe('msg-1');
    expect(db.session_id).toBe('sess-1');
    expect(db.role).toBe('user');
    expect(db.created_at).toBe(1000);
    expect(db.reasoning).toBeNull();
    expect(db.attachments).toContain('image/png');
    expect(db.artifacts).toBeNull();
  });

  it('should serialize artifacts and tool_calls', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Done',
      timestamp: 1000,
      artifacts: [{ type: 'code', content: 'console.log("hi")' }],
      tool_calls: [{ id: 'tc-1', name: 'run', arguments: '{}' }],
    };
    const db = messageToDb(msg, 'sess-1');
    expect(db.artifacts).toContain('console.log');
    expect(db.tool_calls).toContain('tc-1');
  });
});

describe('dbToProject / projectToDb', () => {
  it('should round-trip project through DB format', () => {
    const project = {
      id: 'proj-1',
      name: 'My Project',
      createdAt: 1000,
      updatedAt: 2000,
      workDir: '/work',
    };

    const db = projectToDb(project as any);
    expect(db.work_dir).toBe('/work');

    const restored = dbToProject(db);
    expect(restored.workDir).toBe('/work');
  });
});
