import { describe, it, expect } from '@jest/globals';
import { detectStall, buildStallNudge } from '@/services/completion/stall';

describe('detectStall', () => {
  it('empty input is not stalled', () => {
    expect(detectStall({ toolNames: [], filesChanged: [], toolRoundsUsed: 0, toolRoundsMax: 10 })).toEqual({ stalled: false, reasons: [] });
  });

  it('detects same-tool loop', () => {
    const result = detectStall({ toolNames: ['read_file', 'read_file', 'read_file', 'read_file'], filesChanged: [], toolRoundsUsed: 3, toolRoundsMax: 10 });
    expect(result.stalled).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('stalled_tools'))).toBe(true);
  });

  it('detects no file progress', () => {
    const result = detectStall({ toolNames: ['execute_command'], filesChanged: [], toolRoundsUsed: 2, toolRoundsMax: 10 });
    expect(result.stalled).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('no_file_progress'))).toBe(true);
  });

  it('detects rounds nearly exhausted', () => {
    const result = detectStall({ toolNames: ['execute_command'], filesChanged: ['a.ts'], toolRoundsUsed: 9, toolRoundsMax: 10 });
    expect(result.stalled).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('stalled_tools'))).toBe(true);
  });
});

describe('buildStallNudge', () => {
  it('contains the nudge text', () => {
    const message = buildStallNudge(['stalled_tools: 连续 3 次调用同一工具']);
    expect(message).toContain('卡住');
    expect(message).toContain('不要重复同样失败的工具调用');
  });
});
