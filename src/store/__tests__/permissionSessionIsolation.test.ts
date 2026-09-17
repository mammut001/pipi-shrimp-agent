import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { useUIStore } from '@/store/uiStore';

describe('permission session isolation', () => {
  beforeEach(() => {
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });
  });

  afterEach(() => {
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });
  });

  it('clearPermissionsForSession denies only that session; other session promises stay pending', async () => {
    const promiseA = useUIStore.getState().waitForPermission({
      id: 'tool-a',
      name: 'execute_command',
      arguments: '{}',
      sessionId: 'session-A',
    });
    const promiseB = useUIStore.getState().waitForPermission({
      id: 'tool-b',
      name: 'execute_command',
      arguments: '{}',
      sessionId: 'session-B',
    });

    let aSettled: boolean | null = null;
    void promiseA.then((approved) => {
      aSettled = approved;
    });

    useUIStore.getState().clearPermissionsForSession('session-B');

    await expect(promiseB).resolves.toBe(false);
    await Promise.resolve();
    expect(aSettled).toBeNull();
    expect(useUIStore.getState().permissionQueue).toEqual([
      expect.objectContaining({ id: 'tool-a', sessionId: 'session-A' }),
    ]);

    useUIStore.getState().resolvePermissionRequest(true, 'tool-a');
    await expect(promiseA).resolves.toBe(true);
  });

  it('clearAllPermissions still denies every pending approval', async () => {
    const promiseA = useUIStore.getState().waitForPermission({
      id: 'tool-a',
      name: 'execute_command',
      arguments: '{}',
      sessionId: 'session-A',
    });
    const promiseB = useUIStore.getState().waitForPermission({
      id: 'tool-b',
      name: 'execute_command',
      arguments: '{}',
      sessionId: 'session-B',
    });

    useUIStore.getState().clearAllPermissions();

    await expect(promiseA).resolves.toBe(false);
    await expect(promiseB).resolves.toBe(false);
    expect(useUIStore.getState().permissionQueue).toEqual([]);
  });
});
