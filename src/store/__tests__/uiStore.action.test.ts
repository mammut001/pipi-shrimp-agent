/**
 * uiStore.addNotification — `action` payload tests
 *
 * The notification system now supports an optional inline action button
 * (label + onClick). These tests guard:
 *   1. The action payload is stored verbatim on the entry.
 *   2. It survives into the persisted notification history.
 *   3. It is not required — the existing two-argument call site still works.
 *
 * We avoid rendering `NotificationToast` (it pulls in Tauri / global drag
 * listeners) and exercise the store directly.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { useUIStore } from '@/store/uiStore';
import type { Notification } from '@/types/ui';

function lastNotification(): Notification {
  const notifications = useUIStore.getState().notifications;
  if (notifications.length === 0) {
    throw new Error('expected at least one notification in the store');
  }
  return notifications[notifications.length - 1];
}

function lastHistoryEntry(): Notification {
  const history = useUIStore.getState().notificationHistory;
  if (history.length === 0) {
    throw new Error('expected at least one entry in notificationHistory');
  }
  return history[0];
}

describe('useUIStore.addNotification — action payload', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useUIStore.setState({ notifications: [], notificationHistory: [] });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('preserves an action payload on the live notification and the history', () => {
    const onClick = () => undefined;
    useUIStore.getState().addNotification('info', 'Set parent as workspace?', 'session-1', {
      label: 'Use as workspace',
      onClick,
    });

    const entry = lastNotification();
    expect(entry.action).toBeDefined();
    expect(entry.action?.label).toBe('Use as workspace');
    expect(entry.action?.onClick).toBe(onClick);

    const history = lastHistoryEntry();
    expect(history.action?.label).toBe('Use as workspace');
    expect(history.action?.onClick).toBe(onClick);
  });

  it('still works without an action payload (legacy two/three-arg call sites)', () => {
    useUIStore.getState().addNotification('success', '5 context files added to session');
    useUIStore.getState().addNotification('error', 'Failed to read file', 'session-1');

    const notifications = useUIStore.getState().notifications;
    expect(notifications).toHaveLength(2);
    expect(notifications[0].action).toBeUndefined();
    expect(notifications[1].action).toBeUndefined();
    expect(notifications[1].sessionId).toBe('session-1');
  });
});
