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

  it('routes Cmd/Ctrl+K to session search even from an input', () => {
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    const focusSessionSearch = jest.fn();

    handleKeyboardShortcut({
      key: 'k',
      code: 'KeyK',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      preventDefault,
      stopPropagation,
      target: { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget,
    } as unknown as KeyboardEvent, {
      toggleShortcuts: jest.fn(),
      toggleSidebar: jest.fn(),
      toggleSettings: jest.fn(),
      startNewChat: jest.fn(),
      focusSessionSearch,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(focusSessionSearch).toHaveBeenCalledTimes(1);
  });

  it('routes Ctrl+K to session search from an xterm textarea', () => {
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    const focusSessionSearch = jest.fn();

    handleKeyboardShortcut({
      key: 'k',
      code: 'KeyK',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      preventDefault,
      stopPropagation,
      target: { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget,
    } as unknown as KeyboardEvent, {
      toggleShortcuts: jest.fn(),
      toggleSidebar: jest.fn(),
      toggleSettings: jest.fn(),
      startNewChat: jest.fn(),
      focusSessionSearch,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(focusSessionSearch).toHaveBeenCalledTimes(1);
  });
});
