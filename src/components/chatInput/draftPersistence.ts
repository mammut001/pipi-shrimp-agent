/**
 * Chat draft localStorage helpers for ChatInput.
 *
 * Keeps text/block draft cleanup and debounced persist keys out of the
 * component file (AG-13). Behavior matches the former ChatInput inline helpers.
 */

import { isStaleChatDraftValue } from '@/components/chatInputFlow';

/** Debounce window for localStorage writes (AUDIT-FIX audit-1#6). */
export const DRAFT_PERSIST_DEBOUNCE_MS = 300;

const TIMESTAMP_SUFFIX = '__ts';

export function draftTimestampKey(storageKey: string): string {
  return `${storageKey}${TIMESTAMP_SUFFIX}`;
}

/**
 * Cleanup old drafts from localStorage to prevent unbounded growth.
 * Removes drafts older than 7 days (via isStaleChatDraftValue + __ts).
 */
export function cleanupOldDrafts(): void {
  try {
    const cleanupKey = 'draft_cleanup_timestamp';
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

    const lastCleanup = parseInt(localStorage.getItem(cleanupKey) || '0', 10);
    if (lastCleanup && now - lastCleanup < maxAge) {
      return; // Recently cleaned, skip
    }

    // Mark cleanup time
    localStorage.setItem(cleanupKey, now.toString());

    // Find and remove old drafts. We iterate the raw localStorage keys so we
    // can also delete the matching `<key>__ts` timestamp entry.
    const keysToRemove: string[] = [];
    const timestampsToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.endsWith(TIMESTAMP_SUFFIX)) {
        continue;
      }
      const isTextDraft = key.startsWith('chat_draft_');
      const isBlockDraft = key.startsWith('chat_blocks_draft_');
      if (!isTextDraft && !isBlockDraft) {
        continue;
      }
      const value = localStorage.getItem(key);
      if (!value || value.length === 0) {
        keysToRemove.push(key);
        continue;
      }

      const tsRaw = localStorage.getItem(`${key}${TIMESTAMP_SUFFIX}`);
      const lastTouchedAt = tsRaw ? Number.parseInt(tsRaw, 10) : null;

      // AUDIT-FIX [audit-1#6] — isStaleChatDraftValue now consults the
      // timestamp when present, so a large but recently-touched prompt is
      // preserved. Only the size+age combination triggers removal.
      if (isStaleChatDraftValue(value, Number.isFinite(lastTouchedAt) ? lastTouchedAt : null)) {
        keysToRemove.push(key);
        timestampsToRemove.push(`${key}${TIMESTAMP_SUFFIX}`);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    timestampsToRemove.forEach((key) => localStorage.removeItem(key));
    if (keysToRemove.length > 0) {
      console.log(`[ChatInput] Cleaned up ${keysToRemove.length} old drafts`);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/** Read a text draft value (no timestamp). */
export function readTextDraft(storageKey: string): string | null {
  return localStorage.getItem(storageKey);
}

/** Persist a text draft + lastTouchedAt, or clear both when empty. */
export function persistTextDraft(storageKey: string, input: string): void {
  if (input) {
    try {
      localStorage.setItem(storageKey, input);
      localStorage.setItem(draftTimestampKey(storageKey), String(Date.now()));
    } catch (error) {
      // localStorage may be full / disabled; degrade silently.
      console.warn('[ChatInput] failed to persist draft:', error);
    }
  } else {
    clearDraftPair(storageKey);
  }
}

/** Remove draft value + companion __ts key. */
export function clearDraftPair(storageKey: string): void {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(draftTimestampKey(storageKey));
}

/** Persist or clear a JSON block-composer draft + timestamp. */
export function persistBlockDraft(storageKey: string, json: string | null): void {
  if (json) {
    localStorage.setItem(storageKey, json);
    localStorage.setItem(draftTimestampKey(storageKey), String(Date.now()));
  } else {
    clearDraftPair(storageKey);
  }
}
