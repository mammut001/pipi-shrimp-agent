/**
 * Swarm Runtime — Public API
 *
 * This barrel export exposes the swarm runtime foundation:
 * - types: durable data models
 * - repository: persistence + event bus
 * - lifecycle: agent/team state management
 * - taskManager: work-queue task operations
 * - messageService: inbox/async collaboration protocol
 * - permissionBridge: leader permission delegation
 * - transcript: sidechain observability
 */

// Types
export type {
  SwarmAgent,
  SwarmTeam,
  SwarmTask,
  SwarmMessage,
  SwarmRun,
  SwarmPermissionRequest,
  TranscriptEntry,
  SwarmSnapshot,
  SwarmEvent,
  SwarmEventType,
  AgentRole,
  AgentStatus,
  TeamStatus,
  TaskStatus,
  TaskType,
  MessageType,
  TranscriptEventType,
  PermissionStatus,
  RiskLevel,
  RunStatus,
} from './types';

// Repository (persistence + events)
export {
  subscribe as subscribeToSwarmEvents,
  restoreFromStorage as restoreSwarmState,
  saveToStorage as saveSwarmState,
  clearAll as clearSwarmState,
  generateId,
} from './repository';

// Lifecycle
export {
  startRun,
  completeRun,
  failRun,
  createTeam,
  disbandTeam,
  spawnAgent,
  startAgent,
  completeAgent,
  failAgent,
  transitionAgent,
  getTeamWithMembers,
  getAgentSummary,
} from './lifecycle';

// Task Manager
export {
  createTask,
  claimNextTask,
  claimTask,
  startTask,
  completeTask,
  failTask,
  getTeamTaskSummary,
} from './taskManager';

// Message Service
export {
  sendMessage,
  broadcastToTeam,
  pollInbox,
  markRead,
  markAllRead,
  listUnread,
  getConversation,
  getMessagesByType,
  getInboxSummary,
  startInboxPolling,
  stopInboxPolling,
  stopAllInboxPolling,
} from './messageService';

// Permission Bridge
export {
  requestPermission,
  resolvePermission,
  expireAllPending as expireAllPermissions,
  enqueuePermissionInUI,
  classifyRisk,
} from './permissionBridge';

// Transcript
export {
  recordTranscript,
  recordAgentStarted,
  recordUserPrompt,
  recordAssistantOutput,
  recordToolCall,
  recordToolResult,
  recordPermissionRequested,
  recordPermissionResolved,
  recordAgentCompleted,
  recordAgentFailed,
  getAgentTranscript,
  getTranscriptByType,
  getTranscriptSummary,
  getRecentTranscript,
} from './transcript';

// Repository queries (re-exported for convenience)
export {
  getAllRuns,
  getRun,
  getAllTeams,
  getTeam,
  getTeamByName,
  getTeamsForSession,
  getAllAgents,
  getAgent,
  getAgentsForTeam,
  getAgentByName,
  getAllTasks,
  getTask,
  getTasksForTeam,
  getTasksForAgent,
  getUnclaimedTasks,
  getAllMessages,
  getMessage,
  getMessagesForAgent,
  getUnreadMessages,
  getMessagesForTeam,
  getPendingPermissions,
  getPendingPermissionsForTeam,
} from './repository';
