import { describe, expect, it } from '@jest/globals';

import { isTerminalPassThroughShortcut } from '@/utils/terminalShortcuts';

describe('isTerminalPassThroughShortcut', () => {
  it('lets Ctrl+K and Cmd+K through', () => {
    expect(isTerminalPassThroughShortcut({
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
    })).toBe(true);
    expect(isTerminalPassThroughShortcut({
      key: 'k',
      code: 'KeyK',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
    })).toBe(true);
  });

  it('does not steal plain typing or other chords', () => {
    expect(isTerminalPassThroughShortcut({
      key: 'k',
      code: 'KeyK',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    })).toBe(false);
    expect(isTerminalPassThroughShortcut({
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
      metaKey: false,
      altKey: true,
    })).toBe(false);
  });
});
