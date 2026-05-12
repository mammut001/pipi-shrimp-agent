/**
 * Timer Guard Module
 *
 * Provides safe timer management with task ID tracking to prevent
 * race conditions between auto-reset timers for different tasks.
 *
 * Timers are identified by task ID so that stale timers don't
 * reset the wrong state.
 */

// Timer tracking to prevent race conditions between tasks
let _completionTimerId: ReturnType<typeof setTimeout> | null = null;
let _completionTimerTaskId: string | null = null;
let _errorTimerId: ReturnType<typeof setTimeout> | null = null;
let _errorTimerTaskId: string | null = null;

/**
 * Cancel pending auto-reset timers safely.
 * Also validates the task ID so stale timers don't reset wrong state.
 */
export function clearPendingTimers(currentTaskId: string | null): void {
  if (_completionTimerId !== null) {
    clearTimeout(_completionTimerId);
    if (_completionTimerTaskId === currentTaskId) {
      _completionTimerTaskId = null;
    }
    _completionTimerId = null;
  }
  if (_errorTimerId !== null) {
    clearTimeout(_errorTimerId);
    if (_errorTimerTaskId === currentTaskId) {
      _errorTimerTaskId = null;
    }
    _errorTimerId = null;
  }
}

/**
 * Set a completion timer that auto-resets state after delay.
 * Only resets if still in 'completed' state AND timer belongs to current task.
 */
export function setCompletionTimer(
  taskId: string,
  delayMs: number,
  resetFn: () => void
): void {
  clearPendingTimers(taskId);
  _completionTimerTaskId = taskId;
  _completionTimerId = setTimeout(() => {
    resetFn();
    _completionTimerTaskId = null;
    _completionTimerId = null;
  }, delayMs);
}

/**
 * Set an error timer that auto-resets state after delay.
 * Only resets if still in 'error' state AND timer belongs to current task.
 */
export function setErrorTimer(
  taskId: string,
  delayMs: number,
  resetFn: () => void
): void {
  clearPendingTimers(taskId);
  _errorTimerTaskId = taskId;
  _errorTimerId = setTimeout(() => {
    resetFn();
    _errorTimerTaskId = null;
    _errorTimerId = null;
  }, delayMs);
}

/**
 * Get current timer state (for debugging/testing)
 */
export function getTimerState(): {
  completionTimerId: string | null;
  completionTaskId: string | null;
  errorTimerId: string | null;
  errorTaskId: string | null;
} {
  return {
    completionTimerId: _completionTimerId ? 'active' : null,
    completionTaskId: _completionTimerTaskId,
    errorTimerId: _errorTimerId ? 'active' : null,
    errorTaskId: _errorTimerTaskId,
  };
}
