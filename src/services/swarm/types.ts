/**
 * Swarm Runtime Types
 *
 * Durable data models for the swarm runtime foundation.
 * These types represent persistent entities, not temporary function-call artifacts.
 *
 * Design principles:
 * - All entities have stable IDs and timestamps
 * - Status fields use explicit union types
 * - Optional fields are clearly marked
 * - Types are serializable for persistence
 */

// =============================================================================
// Agent
// =============================================================================

export type AgentRole = 'leader' | 'member';
export type AgentStatus = 'idle' | 'working' | 'completed' | 'failed' | 'interrupted';

export interface SwarmAgent {
  id: string;
  teamId: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  parentAgentId?: string;
  currentTaskId?: string;
  /** The session/run this agent belongs to */
  sessionId: string;
  /** Model override for this agent (e.g. 'sonnet', 'haiku') */
  model?: string;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// Team
// =============================================================================

export type TeamStatus = 'active' | 'completed' | 'disbanded';

export interface SwarmTeam {
  id: string;
  name: string;
  leaderId: string;
  status: TeamStatus;
  sessionId: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// Task
// =============================================================================

export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed';
export type TaskType = 'research' | 'implementation' | 'review' | 'synthesis' | 'general';

export interface SwarmTask {
  id: string;
  teamId: string;
  assignedAgentId?: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  resultSummary?: string;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// Message (inbox protocol)
// =============================================================================

export type MessageType =
  | 'task_assignment'
  | 'task_result'
  | 'question'
  | 'answer'
  | 'status_update'
  | 'permission_request'
  | 'permission_result';

export interface SwarmMessage {
  id: string;
  teamId: string;
  fromAgentId: string;
  toAgentId: string;
  messageType: MessageType;
  content: string;
  taskId?: string;
  readAt?: number;
  createdAt: number;
}

// =============================================================================
// Transcript
// =============================================================================

export type TranscriptEventType =
  | 'agent_started'
  | 'user_prompt_injected'
  | 'assistant_output'
  | 'tool_called'
  | 'tool_result'
  | 'permission_requested'
  | 'permission_resolved'
  | 'agent_completed'
  | 'agent_failed';

export interface TranscriptEntry {
  id: string;
  agentId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  eventType: TranscriptEventType;
  toolName?: string;
  taskId?: string;
  createdAt: number;
}

// =============================================================================
// Permission (swarm permission bridge)
// =============================================================================

export type PermissionStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface SwarmPermissionRequest {
  requestId: string;
  teamId: string;
  agentId: string;
  agentName: string;
  taskId?: string;
  toolName: string;
  toolArgs: string;
  riskLevel: RiskLevel;
  status: PermissionStatus;
  createdAt: number;
  resolvedAt?: number;
}

// =============================================================================
// Session / Run
// =============================================================================

export type RunStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface SwarmRun {
  id: string;
  /** Links to the chat session that initiated this swarm */
  chatSessionId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// Repository snapshot (for persistence)
// =============================================================================

export interface SwarmSnapshot {
  version: number;
  runs: SwarmRun[];
  teams: SwarmTeam[];
  agents: SwarmAgent[];
  tasks: SwarmTask[];
  messages: SwarmMessage[];
  transcripts: TranscriptEntry[];
  permissionRequests: SwarmPermissionRequest[];
  savedAt: number;
}

// =============================================================================
// Event types for reactive updates
// =============================================================================

export type SwarmEventType =
  | 'agent:created'
  | 'agent:updated'
  | 'agent:removed'
  | 'team:created'
  | 'team:updated'
  | 'team:removed'
  | 'task:created'
  | 'task:updated'
  | 'task:removed'
  | 'message:created'
  | 'message:read'
  | 'transcript:appended'
  | 'permission:created'
  | 'permission:resolved'
  | 'run:created'
  | 'run:updated';

export interface SwarmEvent {
  type: SwarmEventType;
  entityId: string;
  timestamp: number;
}

// =============================================================================
// Agent Memory
// =============================================================================

/**
 * Agent-level persistent memory.
 * Each agent has its own private memory directory.
 */
export interface AgentMemory {
  teamId: string;
  agentId: string;
  /** e.g. ~/.pipi-shrimp/swarm/{teamId}/{agentId}/memory/ */
  memoryDir: string;
  enabled: boolean;
}

/**
 * Metadata for a single agent memory file.
 */
export interface AgentMemoryFile {
  filename: string;
  type: import('../memory/memoryTypes').MemoryType;
  title: string;
  created: string;
  preview: string;
  path: string;
}

// =============================================================================
// Team Memory
// =============================================================================

/**
 * Team-level shared memory.
 * All team agents can read; only the leader can write.
 */
export interface TeamMemory {
  teamId: string;
  /** e.g. ~/.pipi-shrimp/swarm/{teamId}/team-memory/ */
  memoryDir: string;
  enabled: boolean;
}

export type TeamMemoryType = 'goal' | 'convention' | 'context' | 'decision';

/**
 * Metadata for a single team memory file.
 */
export interface TeamMemoryFile {
  filename: string;
  type: TeamMemoryType;
  title: string;
  created: string;
  preview: string;
  path: string;
}
