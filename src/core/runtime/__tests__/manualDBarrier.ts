/**
 * Deterministic latch/barrier for Manual D harnesses — no wall-clock sleeps.
 * Mirrors the intent of Rust `test_barrier_tool` at the TS test boundary.
 */
export type ManualDBarrier = {
  /** Block until {@link release} (or resolve immediately if already released). */
  wait(): Promise<void>;
  /** Unblock all current and future waiters. */
  release(): void;
  /** How many callers are currently blocked in {@link wait}. */
  readonly waiterCount: number;
  /** Whether {@link release} has been called. */
  readonly released: boolean;
};

export function createManualDBarrier(): ManualDBarrier {
  let released = false;
  const waiters: Array<() => void> = [];

  return {
    wait(): Promise<void> {
      if (released) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
    release(): void {
      released = true;
      while (waiters.length > 0) {
        waiters.shift()?.();
      }
    },
    get waiterCount() {
      return waiters.length;
    },
    get released() {
      return released;
    },
  };
}

/** Poll a predicate via setImmediate (deterministic event-loop ticks, no sleep ms). */
export async function awaitCondition(
  predicate: () => boolean,
  label: string,
  maxTicks = 100,
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`awaitCondition timed out: ${label}`);
}
