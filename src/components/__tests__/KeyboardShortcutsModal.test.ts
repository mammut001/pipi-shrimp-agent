jest.mock('@/store', () => ({
  useUIStore: Object.assign(() => ({ toggleSidebar: jest.fn() }), {
    getState: () => ({ toggleSettings: jest.fn() }),
  }),
}));

jest.mock('@/services/newChatFlow', () => ({
  startNewChatFlow: jest.fn(),
}));

import { handleKeyboardShortcut } from '../KeyboardShortcutsModal';

describe('handleKeyboardShortcut', () => {
  it('routes Cmd/Ctrl+N through the shared new chat flow', () => {
    const preventDefault = jest.fn();
    const startNewChat = jest.fn();

    handleKeyboardShortcut({
      key: 'n',
      metaKey: true,
      ctrlKey: false,
      preventDefault,
      target: { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget,
    } as unknown as KeyboardEvent, {
      toggleShortcuts: jest.fn(),
      toggleSidebar: jest.fn(),
      toggleSettings: jest.fn(),
      startNewChat,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(startNewChat).toHaveBeenCalledTimes(1);
  });
});
