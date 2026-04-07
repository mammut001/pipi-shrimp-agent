/**
 * Swarm Runtime Repository
 *
 * Central repository for all swarm runtime entities.
 * Provides CRUD operations + reactive event bus for state changes.
 *
 * Persistence: localStorage with explicit save/restore.
 * Future: migrate to SQLite via Tauri invoke.
 *
 * Design:
 * - Single source of truth for swarm state
 * - Event-driven: subscribers notified on every mutation
 * - Snapshot-based persistence (save/restore entire state)
 * - Thread-safe for single-threaded JS runtime
 */

import type {
  SwarmAgent,
  SwarmTeam,
  SwarmTask,
  SwarmMessage,
  TranscriptEntry,
  SwarmPermissionRequest,
  SwarmRun,
  SwarmSnapshot,
  SwarmEvent,
  SwarmEventType,
} from './types';

const STORAGE_KEY = 'pipi-swarm-runtime-v1';
const SNAPSHOT_VERSION = 1;

// =============================================================================
// Event bus
// =============================================================================

type SwarmEventListener = (event: SwarmEvent) => void;

const listeners: Set<SwarmEventListener> = new Set();

function emit(type: SwarmEventType, entityId: string): void {
  const event: SwarmEvent = { type, entityId, timestamp: Date.now() };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.error('[SwarmRepo] listener error:', e);
    }
  }
}

export function subscribe(listener: SwarmEventListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// =============================================================================
// In-memory stores
// =============================================================================

const runs = new Map<string, SwarmRun>();
const teams = new Map<string, SwarmTeam>();
const agents = new Map<string, SwarmAgent>();
const tasks = new Map<string, SwarmTask>();
const messages = new Map<string, SwarmMessage>();
const transcripts = new Map<string, TranscriptEntry>();
const permissionRequests = new Map<string, SwarmPermissionRequest>();

// =============================================================================
// Runs
// =============================================================================

export function createRun(run: SwarmRun): SwarmRun {
  runs.set(run.id, run);
  emit('run:created', run.id);
  scheduleSave();
  return run;
}

export function getRun(id: string): SwarmRun | undefined {
  return runs.get(id);
}

export function updateRun(id: string, updates: Partial<SwarmRun>): SwarmRun | undefined {
  const existing = runs.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  runs.set(id, updated);
  emit('run:updated', id);
  scheduleSave();
  return updated;
}

export function getAllRuns(): SwarmRun[] {
  return Array.from(runs.values());
}

// =============================================================================
// Teams
// =============================================================================

export function createTeam(team: SwarmTeam): SwarmTeam {
  teams.set(team.id, team);
  emit('team:created', team.id);
  scheduleSave();
  return team;
}

export function getTeam(id: string): SwarmTeam | undefined {
  return teams.get(id);
}

export function getTeamByName(name: string): SwarmTeam | undefined {
  for (const team of teams.values()) {
    if (team.name === name) return team;
  }
  return undefined;
}

export function updateTeam(id: string, updates: Partial<SwarmTeam>): SwarmTeam | undefined {
  const existing = teams.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  teams.set(id, updated);
  emit('team:updated', id);
  scheduleSave();
  return updated;
}

export function removeTeam(id: string): boolean {
  const deleted = teams.delete(id);
  if (deleted) {
    emit('team:removed', id);
    scheduleSave();
  }
  return deleted;
}

export function getAllTeams(): SwarmTeam[] {
  return Array.from(teams.values());
}

export function getTeamsForSession(sessionId: string): SwarmTeam[] {
  return Array.from(teams.values()).filter(t => t.sessionId === sessionId);
}

// =============================================================================
// Agents
// =============================================================================

export function createAgent(agent: SwarmAgent): SwarmAgent {
  agents.set(agent.id, agent);
  emit('agent:created', agent.id);
  scheduleSave();
  return agent;
}

export function getAgent(id: string): SwarmAgent | undefined {
  return agents.get(id);
}

export function updateAgent(id: string, updates: Partial<SwarmAgent>): SwarmAgent | undefined {
  const existing = agents.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  agents.set(id, updated);
  emit('agent:updated', id);
  scheduleSave();
  return updated;
}

export function removeAgent(id: string): boolean {
  const deleted = agents.delete(id);
  if (deleted) {
    emit('agent:removed', id);
    scheduleSave();
  }
  return deleted;
}

export function getAllAgents(): SwarmAgent[] {
  return Array.from(agents.values());
}

export function getAgentsForTeam(teamId: string): SwarmAgent[] {
  return Array.from(agents.values()).filter(a => a.teamId === teamId);
}

export function getAgentByName(name: string, teamId: string): SwarmAgent | undefined {
  for (const agent of agents.values()) {
    if (agent.name === name && agent.teamId === teamId) return agent;
  }
  return undefined;
}

// =============================================================================
// Tasks
// =============================================================================

export function createTask(task: SwarmTask): SwarmTask {
  tasks.set(task.id, task);
  emit('task:created', task.id);
  scheduleSave();
  return task;
}

export function getTask(id: string): SwarmTask | undefined {
  return tasks.get(id);
}

export function updateTask(id: string, updates: Partial<SwarmTask>): SwarmTask | undefined {
  const existing = tasks.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  tasks.set(id, updated);
  emit('task:updated', id);
  scheduleSave();
  return updated;
}

export function removeTask(id: string): boolean {
  const deleted = tasks.delete(id);
  if (deleted) {
    emit('task:removed', id);
    scheduleSave();
  }
  return deleted;
}

export function getAllTasks(): SwarmTask[] {
  return Array.from(tasks.values());
}

export function getTasksForTeam(teamId: string): SwarmTask[] {
  return Array.from(tasks.values()).filter(t => t.teamId === teamId);
}

export function getTasksForAgent(agentId: string): SwarmTask[] {
  return Array.from(tasks.values()).filter(t => t.assignedAgentId === agentId);
}

export function getUnclaimedTasks(teamId: string): SwarmTask[] {
  return Array.from(tasks.values()).filter(
    t => t.teamId === teamId && t.status === 'pending' && !t.assignedAgentId
  );
}

// =============================================================================
// Messages
// =============================================================================

export function createMessage(message: SwarmMessage): SwarmMessage {
  messages.set(message.id, message);
  emit('message:created', message.id);
  scheduleSave();
  return message;
}

export function getMessage(id: string): SwarmMessage | undefined {
  return messages.get(id);
}

export function markMessageRead(id: string): SwarmMessage | undefined {
  const existing = messages.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, readAt: Date.now() };
  messages.set(id, updated);
  emit('message:read', id);
  scheduleSave();
  return updated;
}

export function getAllMessages(): SwarmMessage[] {
  return Array.from(messages.values());
}

export function getMessagesForAgent(agentId: string): SwarmMessage[] {
  return Array.from(messages.values()).filter(m => m.toAgentId === agentId);
}

export function getUnreadMessages(agentId: string): SwarmMessage[] {
  return Array.from(messages.values()).filter(
    m => m.toAgentId === agentId && !m.readAt
  );
}

export function getMessagesForTeam(teamId: string): SwarmMessage[] {
  return Array.from(messages.values()).filter(m => m.teamId === teamId);
}

// =============================================================================
// Transcripts
// =============================================================================

export function appendTranscript(entry: TranscriptEntry): TranscriptEntry {
  transcripts.set(entry.id, entry);
  emit('transcript:appended', entry.id);
  scheduleSave();
  return entry;
}

export function getTranscript(id: string): TranscriptEntry | undefined {
  return transcripts.get(id);
}

export function getAllTranscripts(): TranscriptEntry[] {
  return Array.from(transcripts.values());
}

export function getTranscriptForAgent(agentId: string): TranscriptEntry[] {
  return Array.from(transcripts.values())
    .filter(t => t.agentId === agentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// =============================================================================
// Permission Requests
// =============================================================================

export function createPermissionRequest(req: SwarmPermissionRequest): SwarmPermissionRequest {
  permissionRequests.set(req.requestId, req);
  emit('permission:created', req.requestId);
  scheduleSave();
  return req;
}

export function getPermissionRequest(requestId: string): SwarmPermissionRequest | undefined {
  return permissionRequests.get(requestId);
}

export function resolvePermissionRequest(
  requestId: string,
  status: 'approved' | 'denied' | 'expired'
): SwarmPermissionRequest | undefined {
  const existing = permissionRequests.get(requestId);
  if (!existing) return undefined;
  const updated = { ...existing, status, resolvedAt: Date.now() };
  permissionRequests.set(requestId, updated);
  emit('permission:resolved', requestId);
  scheduleSave();
  return updated;
}

export function getPendingPermissions(): SwarmPermissionRequest[] {
  return Array.from(permissionRequests.values()).filter(p => p.status === 'pending');
}

export function getPendingPermissionsForTeam(teamId: string): SwarmPermissionRequest[] {
  return Array.from(permissionRequests.values()).filter(
    p => p.teamId === teamId && p.status === 'pending'
  );
}

export function getAllPermissionRequests(): SwarmPermissionRequest[] {
  return Array.from(permissionRequests.values());
}

// =============================================================================
// Persistence: save / restore
// =============================================================================

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToStorage();
  }, 500);
}

export function saveToStorage(): void {
  try {
    const snapshot: SwarmSnapshot = {
      version: SNAPSHOT_VERSION,
      runs: Array.from(runs.values()),
      teams: Array.from(teams.values()),
      agents: Array.from(agents.values()),
      tasks: Array.from(tasks.values()),
      messages: Array.from(messages.values()),
      transcripts: Array.from(transcripts.values()),
      permissionRequests: Array.from(permissionRequests.values()),
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.error('[SwarmRepo] Failed to save:', e);
  }
}

export function restoreFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const snapshot: SwarmSnapshot = JSON.parse(raw);
    if (snapshot.version !== SNAPSHOT_VERSION) {
      console.warn('[SwarmRepo] Version mismatch, skipping restore');
      return false;
    }

    runs.clear();
    teams.clear();
    agents.clear();
    tasks.clear();
    messages.clear();
    transcripts.clear();
    permissionRequests.clear();

    for (const r of snapshot.runs) runs.set(r.id, r);
    for (const t of snapshot.teams) teams.set(t.id, t);
    for (const a of snapshot.agents) agents.set(a.id, a);
    for (const t of snapshot.tasks) tasks.set(t.id, t);
    for (const m of snapshot.messages) messages.set(m.id, m);
    for (const t of snapshot.transcripts) transcripts.set(t.id, t);
    for (const p of snapshot.permissionRequests) permissionRequests.set(p.requestId, p);

    // Mark previously-working agents as interrupted (they were working when app closed)
    for (const agent of agents.values()) {
      if (agent.status === 'working') {
        agents.set(agent.id, { ...agent, status: 'interrupted', updatedAt: Date.now() });
      }
    }
    // Mark in-progress tasks as failed
    for (const task of tasks.values()) {
      if (task.status === 'in_progress' || task.status === 'claimed') {
        tasks.set(task.id, { ...task, status: 'failed', updatedAt: Date.now() });
      }
    }

    console.log(`[SwarmRepo] Restored: ${teams.size} teams, ${agents.size} agents, ${tasks.size} tasks, ${messages.size} messages`);
    return true;
  } catch (e) {
    console.error('[SwarmRepo] Failed to restore:', e);
    return false;
  }
}

export function clearAll(): void {
  runs.clear();
  teams.clear();
  agents.clear();
  tasks.clear();
  messages.clear();
  transcripts.clear();
  permissionRequests.clear();
  localStorage.removeItem(STORAGE_KEY);
}

// =============================================================================
// Utility: ID generation
// =============================================================================

let idCounter = 0;

export function generateId(prefix: string = 'swarm'): string {
  idCounter++;
  return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}
