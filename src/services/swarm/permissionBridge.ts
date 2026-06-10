/**
 * Swarm Permission Bridge
 *
 * Bridges teammate/worker permission requests through the leader/host UI.
 * Teammate agents do not drive their own permission modals directly;
 * instead, permission requests flow through this bridge into the existing
 * UI permission queue (uiStore.permissionQueue).
 *
 * Design:
 * - Records permission requests in the swarm repository (for observability/audit)
 * - Maps swarm permission requests into the existing PermissionRequest format
 * - Enriches the existing permission UI with agent identity (workerBadge)
 * - Approval/denial flows back to the requesting agent/task via promise resolution
 * - Does NOT replace the existing main-chat permission modes (ask/bypass/auto-edits)
 */

import type { SwarmPermissionRequest, RiskLevel } from './types';
import * as repo from './repository';
import { recordTranscript } from './transcript';

// =============================================================================
// Risk classification (basic)
// =============================================================================

/** Simple heuristic risk classifier for tool use */
export function classifyRisk(toolName: string, _toolArgs: string): RiskLevel {
  const highRisk = ['execute_command', 'write_file', 'delete_file', 'create_directory'];
  const mediumRisk = ['search_files', 'glob_search', 'grep_files'];
  // read_file, list_files, path_exists, get_current_workspace = low risk

  if (highRisk.includes(toolName)) return 'high';
  if (mediumRisk.includes(toolName)) return 'medium';
  return 'low';
}

// =============================================================================
// Promise-based resolution bridge
// =============================================================================

/** Map of pending permission promises: requestId → resolve function */
const pendingResolvers = new Map<string, (approved: boolean) => void>();

/** AUDIT-FIX [fix-5#1] — TTL for unattended permission requests. After
 * this many milliseconds a request is auto-expired (denied) so we never
 * leak a resolver for a request the user closed the modal for without
 * explicitly resolving. Tuned at 60s — long enough for human review of a
 * single tool call, short enough to bound memory. */
const PERMISSION_REQUEST_TTL_MS = 60_000;

/** Pending-request timers so we can cancel them on explicit resolution. */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Request permission for a teammate tool use.
 * Records the request in the swarm repo and returns a promise that resolves
 * when the user approves or denies via the UI.
 *
 * This is called by the agent execution flow when a teammate needs permission.
 */
export function requestPermission(options: {
  teamId: string;
  agentId: string;
  agentName: string;
  taskId?: string;
  toolName: string;
  toolArgs: string;
}): { requestId: string; promise: Promise<boolean> } {
  const riskLevel = classifyRisk(options.toolName, options.toolArgs);

  const req = repo.createPermissionRequest({
    requestId: repo.generateId('perm'),
    teamId: options.teamId,
    agentId: options.agentId,
    agentName: options.agentName,
    taskId: options.taskId,
    toolName: options.toolName,
    toolArgs: options.toolArgs,
    riskLevel,
    status: 'pending',
    createdAt: Date.now(),
  });

  recordTranscript(options.agentId, {
    role: 'system',
    content: `Permission requested: ${options.toolName} (risk: ${riskLevel})`,
    eventType: 'permission_requested',
    toolName: options.toolName,
    taskId: options.taskId,
  });

  const promise = new Promise<boolean>((resolve) => {
    pendingResolvers.set(req.requestId, resolve);
    // AUDIT-FIX [fix-5#1] — Schedule an auto-expiry timer so unresolved
    // requests don't accumulate. The timer is cancelled in
    // `resolvePermission` or `expireAllPending`.
    const timer = setTimeout(() => {
      expirePermission(req.requestId, 'timeout');
    }, PERMISSION_REQUEST_TTL_MS);
    pendingTimers.set(req.requestId, timer);
  });

  return { requestId: req.requestId, promise };
}

/**
 * Resolve a pending permission request (called by the UI when user approves/denies).
 */
export function resolvePermission(requestId: string, approved: boolean): void {
  const resolver = pendingResolvers.get(requestId);
  if (!resolver) {
    console.warn(`[PermBridge] No resolver for requestId: ${requestId}`);
    return;
  }

  const status = approved ? 'approved' : 'denied';
  const req = repo.resolvePermissionRequest(requestId, status);

  if (req) {
    recordTranscript(req.agentId, {
      role: 'system',
      content: `Permission ${status}: ${req.toolName}`,
      eventType: 'permission_resolved',
      toolName: req.toolName,
      taskId: req.taskId,
    });
  }

  resolver(approved);
  pendingResolvers.delete(requestId);
  // AUDIT-FIX [fix-5#1] — Cancel the auto-expire timer so it doesn't fire
  // after an explicit resolution.
  const timer = pendingTimers.get(requestId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(requestId);
  }
}

/**
 * Expire all pending permission requests (cleanup).
 */
export function expireAllPending(): void {
  for (const [requestId, resolver] of pendingResolvers) {
    repo.resolvePermissionRequest(requestId, 'expired');
    resolver(false);
  }
  pendingResolvers.clear();
  // AUDIT-FIX [fix-5#1] — Clear all pending expiry timers too.
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
}

/**
 * AUDIT-FIX [fix-5#1] — Expire a single pending request. Used both by the
 * auto-expiry timer and by the explicit `expirePermission` callers that
 * need to retire a request early (e.g. the agent was cancelled).
 */
function expirePermission(requestId: string, reason: 'timeout' | 'cancelled'): void {
  const resolver = pendingResolvers.get(requestId);
  if (!resolver) return;
  repo.resolvePermissionRequest(requestId, 'expired');
  const req = repo.getPermissionRequest(requestId);
  if (req) {
    recordTranscript(req.agentId, {
      role: 'system',
      content: `Permission expired (${reason}): ${req.toolName}`,
      eventType: 'permission_expired',
      toolName: req.toolName,
      taskId: req.taskId,
    });
  }
  resolver(false);
  pendingResolvers.delete(requestId);
  pendingTimers.delete(requestId);
}

// =============================================================================
// UI bridge: map swarm permission into existing PermissionRequest format
// =============================================================================

/**
 * Convert a SwarmPermissionRequest into the format expected by uiStore.permissionQueue.
 * The UI can display the agentName as a badge/prefix.
 *
 * Usage: call `uiStore.setPermissionRequest(toUIPermissionRequest(swarmReq, resolve))`
 */
export function toUIPermissionRequest(
  req: SwarmPermissionRequest,
  resolve: (approved: boolean) => void,
): {
  id: string;
  toolName: string;
  toolInput: string;
  description: string;
  _resolve: (approved: boolean) => void;
  /** Swarm-specific: identifies which agent requested this */
  agentBadge?: { name: string; agentId: string; teamId: string; riskLevel: RiskLevel };
} {
  return {
    id: req.requestId,
    toolName: req.toolName,
    toolInput: req.toolArgs,
    description: `[${req.agentName}] Execute ${req.toolName}?`,
    _resolve: (approved: boolean) => {
      resolvePermission(req.requestId, approved);
      resolve(approved);
    },
    agentBadge: {
      name: req.agentName,
      agentId: req.agentId,
      teamId: req.teamId,
      riskLevel: req.riskLevel,
    },
  };
}

/**
 * Enqueue a swarm permission request into the existing uiStore permission queue.
 * This is the main integration point between swarm permission and existing UI.
 */
export async function enqueuePermissionInUI(options: {
  teamId: string;
  agentId: string;
  agentName: string;
  taskId?: string;
  toolName: string;
  toolArgs: string;
}): Promise<boolean> {
  const { requestId, promise } = requestPermission(options);
  const req = repo.getPermissionRequest(requestId);
  if (!req) return false;

  // Dynamically import to avoid circular dependency
  const { useUIStore } = await import('../../store/uiStore');

  return new Promise<boolean>((resolve) => {
    const uiReq = toUIPermissionRequest(req, resolve);
    useUIStore.getState().setPermissionRequest(uiReq);
  }).then(async (approved) => {
    // Wait for the swarm-level promise too
    await promise;
    return approved;
  });
}
