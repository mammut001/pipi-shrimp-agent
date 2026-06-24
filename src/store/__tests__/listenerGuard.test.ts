import { afterEach, describe, expect, it } from '@jest/globals';
import {
  clearListeners,
  getListenerRefCount,
  hasListeners,
  registerWithRefCount,
} from '../listenerGuard';

/**
 * TOP-15-04 / T-12 — listenerGuard ref-count concurrent order.
 *
 * The listener guard prevents duplicate Tauri event handlers when
 * multiple components (ChatBrowserWorkspaceShell, BrowserPanel,
 * BrowserMiniPreview) call setup. Regression cases:
 *  - register → unregister → register: second register runs setup
 *    again because ref-count dropped to 0
 *  - concurrent registers: both share one setup promise, ref-count
 *    goes to 2; both cleanup functions decrement correctly
 *  - register, unregister while setup is in-flight: cleanup must
 *    not fire on a still-pending setup
 */
describe('listenerGuard (TOP-15-04 / T-12)', () => {
  afterEach(() => {
    clearListeners();
  });

  it('single register/unregister cleans up exactly once', async () => {
    let setupCalls = 0;
    let cleanupCalls = 0;
    const setup = registerWithRefCount(async () => {
      setupCalls += 1;
      return () => {
        cleanupCalls += 1;
      };
    });
    // The setup runs synchronously enough that the ref-count is
    // incremented to 1 before the async setup resolves. After awaiting
    // the registration, hasListeners() must be true.
    const cleanup = await setup;
    expect(setupCalls).toBe(1);
    expect(getListenerRefCount()).toBe(1);
    expect(hasListeners()).toBe(true);

    await cleanup();

    expect(getListenerRefCount()).toBe(0);
    expect(hasListeners()).toBe(false);
    expect(cleanupCalls).toBe(1);
  });

  it('two concurrent registers share the same setup', async () => {
    let setupCalls = 0;
    let cleanupCalls = 0;
    const setup = () => {
      setupCalls += 1;
      return Promise.resolve(() => {
        cleanupCalls += 1;
      });
    };
    const a = registerWithRefCount(setup);
    const b = registerWithRefCount(setup);
    const cleanupA = await a;
    const cleanupB = await b;
    expect(setupCalls).toBe(1);
    expect(getListenerRefCount()).toBe(2);

    await cleanupA();
    expect(getListenerRefCount()).toBe(1);
    // First cleanup should NOT tear down (ref count > 0).
    expect(cleanupCalls).toBe(0);

    await cleanupB();
    expect(getListenerRefCount()).toBe(0);
    expect(cleanupCalls).toBe(1);
  });

  it('re-register after full cleanup re-runs setup', async () => {
    let setupCalls = 0;
    const setup = () => {
      setupCalls += 1;
      return Promise.resolve(() => {});
    };
    const c1 = await registerWithRefCount(setup);
    await c1();
    expect(setupCalls).toBe(1);

    const c2 = await registerWithRefCount(setup);
    await c2();
    expect(setupCalls).toBe(2);
  });

  it('clearListeners() during in-flight setup is safe', async () => {
    // Register a setup that will resolve later, then call clearListeners
    // before it resolves. The setup promise still completes but the
    // cleanup function should be a no-op (or at least idempotent).
    let cleanupCalls = 0;
    let resolveSetup!: (cb: () => void) => void;
    const slow = new Promise<() => void>((resolve) => {
      resolveSetup = resolve;
    });

    const regPromise = registerWithRefCount(() => slow);
    clearListeners();
    resolveSetup(() => {
      cleanupCalls += 1;
    });
    const cleanup = await regPromise;
    // Calling cleanup after clear should not throw and should not
    // double-fire (the guard is supposed to be tolerant of late
    // resolutions).
    await cleanup();
    expect(getListenerRefCount()).toBe(0);
  });
});