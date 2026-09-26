export type ToolTerminalStatus =
  | 'success'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'timed_out';

export type ToolStepStatus = 'done' | 'failed' | 'cancelled' | 'timed_out' | 'rejected';

/** Map Rust `ToolTerminalStatus` snake_case values onto Chat step statuses. */
export function mapTerminalStatusToStepStatus(
  terminalStatus: string | null | undefined,
): ToolStepStatus | null {
  if (!terminalStatus) {
    return null;
  }
  switch (terminalStatus) {
    case 'success':
      return 'done';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'timed_out':
    case 'timeout':
      return 'timed_out';
    default:
      return null;
  }
}

/**
 * Prefer the authoritative native `status` / `terminal_status` field when present.
 * Fall back to JSON/content heuristics only for legacy results that omit it.
 */
export function resolveToolStepStatus(
  content: string,
  fallbackFailed: boolean,
  terminalStatus?: string | null,
): ToolStepStatus {
  const fromNative = mapTerminalStatusToStepStatus(terminalStatus);
  if (fromNative) {
    return fromNative;
  }

  try {
    const parsed = JSON.parse(content) as {
      status?: string;
      error_kind?: string;
      terminal_status?: string;
      timed_out?: boolean;
    };
    // Legacy content heuristics: only cancel / timeout / reject — not process "failed".
    const legacyTerminal = parsed.terminal_status
      ?? (parsed.status === 'cancelled'
        || parsed.status === 'canceled'
        || parsed.status === 'timed_out'
        || parsed.status === 'timeout'
        || parsed.status === 'rejected'
        ? parsed.status
        : null);
    const fromLegacy = mapTerminalStatusToStepStatus(legacyTerminal);
    if (fromLegacy && fromLegacy !== 'done' && fromLegacy !== 'failed') {
      return fromLegacy;
    }
    if (parsed.status === 'cancelled' || parsed.status === 'canceled') {
      return 'cancelled';
    }
    if (parsed.status === 'timed_out' || parsed.status === 'timeout' || parsed.timed_out === true) {
      return 'timed_out';
    }
    if (parsed.error_kind === 'permission_denied') {
      return 'rejected';
    }
  } catch {
    // Keep legacy fallback for plain-text tool results.
  }

  return fallbackFailed ? 'failed' : 'done';
}
