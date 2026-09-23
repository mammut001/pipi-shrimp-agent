import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  cleanupOldDrafts,
  clearDraftPair,
  persistBlockDraft,
  persistTextDraft,
  readTextDraft,
  draftTimestampKey,
} from '../draftPersistence';
import { MAX_CHAT_DRAFT_CHARS } from '@/components/chatInputFlow';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
  jest.restoreAllMocks();
});

describe('draftPersistence', () => {
  it('persistTextDraft writes value + __ts; clearDraftPair removes both', () => {
    persistTextDraft('chat_draft_a', 'hello');
    expect(readTextDraft('chat_draft_a')).toBe('hello');
    expect(localStorage.getItem(draftTimestampKey('chat_draft_a'))).toMatch(/^\d+$/);
    clearDraftPair('chat_draft_a');
    expect(readTextDraft('chat_draft_a')).toBeNull();
    expect(localStorage.getItem(draftTimestampKey('chat_draft_a'))).toBeNull();
  });

  it('persistTextDraft with empty string clears the pair', () => {
    persistTextDraft('chat_draft_a', 'x');
    persistTextDraft('chat_draft_a', '');
    expect(readTextDraft('chat_draft_a')).toBeNull();
  });

  it('persistBlockDraft null clears; string persists', () => {
    persistBlockDraft('chat_blocks_draft_a', '[]');
    expect(localStorage.getItem('chat_blocks_draft_a')).toBe('[]');
    persistBlockDraft('chat_blocks_draft_a', null);
    expect(localStorage.getItem('chat_blocks_draft_a')).toBeNull();
  });

  it('cleanupOldDrafts removes oversized stale drafts', () => {
    const huge = 'x'.repeat(MAX_CHAT_DRAFT_CHARS + 1);
    localStorage.setItem('chat_draft_stale', huge);
    localStorage.setItem(
      draftTimestampKey('chat_draft_stale'),
      String(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    // Force cleanup window open
    localStorage.setItem('draft_cleanup_timestamp', '0');
    cleanupOldDrafts();
    expect(localStorage.getItem('chat_draft_stale')).toBeNull();
  });
});
