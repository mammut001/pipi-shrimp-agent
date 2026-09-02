import { describe, expect, it } from '@jest/globals';
import { detectAskModeToolNeed } from '../askModeToolNeed';

describe('detectAskModeToolNeed', () => {
  it('detects browser intents', () => {
    expect(detectAskModeToolNeed('用 Chrome 打开 https://github.com/foo/bar')).toEqual({
      needed: true,
      reason: 'browser',
    });
  });

  it('detects workspace read requests', () => {
    expect(detectAskModeToolNeed('读取 README 并总结')).toEqual({
      needed: true,
      reason: 'workspace',
    });
    expect(detectAskModeToolNeed('详细阅读一下这个项目吧')).toEqual({
      needed: true,
      reason: 'workspace',
    });
    expect(detectAskModeToolNeed('看看 src/App.tsx')).toEqual({
      needed: true,
      reason: 'workspace',
    });
  });

  it('detects command execution requests', () => {
    expect(detectAskModeToolNeed('运行 npm test')).toEqual({
      needed: true,
      reason: 'general',
    });
  });

  it('ignores pure chat prompts', () => {
    expect(detectAskModeToolNeed('介绍一下这个项目的大概方向')).toEqual({
      needed: false,
      reason: 'general',
    });
  });
});
