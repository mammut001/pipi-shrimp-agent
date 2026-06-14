/**
 * Chat-related type definitions
 * Includes Message, Artifact, Session, and ChatState interfaces
 */

import { ImportedFile } from './settings';
import type { ImageAttachment } from './vision';

export interface ChatSendOptions {
  allowBrowserTools?: boolean;
  attachments?: ImageAttachment[];
}

// ============= Type Definitions =============

/** Tool call interface (for Function Calling) */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Chat message interface */
export interface Message {
  id: string;                    // Unique ID (UUID v4)
  role: 'user' | 'assistant' | 'system';  // Message sender role ('system' for compact boundaries)
  content: string;              // Message content
  attachments?: ImageAttachment[];
  reasoning?: string;           // AI reasoning/thinking process (optional)
  timestamp: number;            // Timestamp in milliseconds
  artifacts?: Artifact[];        // Attached code/charts etc
  tool_calls?: ToolCall[];       // Tool calls made by assistant
  tool_call_id?: string;         // ID of tool result (for tool role messages)
  metadata?: Record<string, unknown>;  // Additional metadata
  token_usage?: {                // Token usage for this message (assistant only)
    input_tokens: number;
    output_tokens: number;
    model?: string;
  };
}

/** Artifact (code blocks, diagrams, etc) */
export interface Artifact {
  id: string;
  type: 'html' | 'svg' | 'mermaid' | 'react' | 'code' | 'image';
  content: string;
  title?: string;
  language?: string;  // Only for 'code' type
  mimeType?: string;  // e.g. 'image/png', 'image/svg+xml'
}

/** Chat session */
export interface Session {
  id: string;
  title: string;                // Session title (extracted from first message or user-defined)
  messages: Message[];          // All messages in the session
  createdAt: number;            // Creation timestamp
  updatedAt: number;            // Last update timestamp
  cwd?: string;                  // Current working directory (for code execution). Kept in sync with projectDir.
  projectId?: string;           // Project ID this session belongs to (optional)
  model?: string;               // Model to use for this session (optional, defaults to apiConfig model)
  /**
   * Project Folder (the user's actual repo/project path).
   * Tools run commands and read/write project files relative to this folder.
   * For backwards compatibility with pre-v7 sessions that only had a
   * single folder field, the legacy `workDir` is treated as the Project
   * Folder when this field is absent — see
   * {@link import('@/utils/sessionFolders').getSessionProjectDir}.
   */
  projectDir?: string;
  /**
   * PiPi Output Folder (app-owned output root).
   * Stores `.pipi-shrimp/`, generated docs, memory, chat outputs and
   * AutoResearch artifacts. By default this is the per-session app-managed
   * path `{Documents|HOME}/PiPi-Shrimp/chats/{session_id}/` — see
   * {@link import('@/utils/sessionFolders').getSessionPipiOutputDir}.
   */
  pipiOutputDir?: string;
  /**
   * Legacy single-folder field retained for backward compatibility with
   * pre-v7 sessions and DB rows that predate the two-folder split.
   * Mirrors `projectDir` on save; on load, the helpers in
   * `utils/sessionFolders.ts` treat this as the Project Folder when no
   * explicit `projectDir` is set.
   */
  workDir?: string;
  outputDir?: string;            // current output directory (derived from `pipiOutputDir`, not from `projectDir`)
  workingFiles?: ImportedFile[]; // session-level working files
  permissionMode?: 'standard' | 'auto-edits' | 'bypass' | 'plan-only'; // NEW: execution permission mode
  /**
   * Chat execution mode (6-mode dropdown). When present, this is the source
   * of truth for the composer; `permissionMode` is derived from it via
   * `resolvePermissionMode`. Older sessions without this field fall back to
   * the default Ask mode and `permissionMode` is still honored.
   */
  executionMode?: import('@/services/executionMode').ExecutionModeId;
}

/** Project (folder for grouping sessions) */
export interface Project {
  id: string;
  name: string;                  // Project name
  createdAt: number;            // Creation timestamp
  updatedAt: number;            // Last update timestamp
  workDir?: string;             // NEW: absolute path to local work directory
}

/** Output folder structure from .pipi-shrimp/ */
export interface OutputFolder {
  name: string;   // e.g. "2025-01-15-2"
  path: string;   // absolute path
  files: string[]; // file names inside
}

// ============= Zustand State Interface =============

/** Chat store state interface */
export interface ChatState {
  // ========== Data State ==========
  sessions: Session[];
  projects: Project[];
  currentSessionId: string | null;
  isStreaming: boolean;
  isInitialized: boolean;
  streamingContent: string;
  streamingReasoning: string;
  error: string | null;         // Error message
  streamingTimeoutId: ReturnType<typeof setTimeout> | null;  // Timeout ID for streaming protection
  lastUiUpdateTime: number;     // Last UI update timestamp for throttling
  pendingToolCalls: number;     // Counter for pending parallel tool executions
  pendingToolResults: { toolCallId: string; result: string }[];  // Accumulated tool results for batching
  streamingSessionId: string | null;  // Session that owns the current streaming request (cross-session guard)

  // ========== Computed Properties ==========
  currentSession: () => Session | null;  // Get current session
  currentMessages: () => Message[];      // Get current session's messages
  getSessionsByProject: (projectId: string | null) => Session[];  // Get sessions by project

  // ========== Action Methods ==========

  /**
   * Initialize store (load data from local storage)
   */
  init: () => Promise<void>;

  /**
   * Create a new session (optionally in a project and with a specific model)
   */
  startSession: (projectId?: string | null, model?: string) => Promise<string>;

  /**
   * Send message (call API)
   */
  sendMessage: (content: string, sessionId?: string, options?: ChatSendOptions) => Promise<void>;
  generateBrowserResultResponse: (browserResult: string, originalQuery: string) => Promise<void>;

  /**
   * Stop/cancel the current generation (kill subprocess)
   */
  stopGeneration: () => Promise<void>;

  /**
   * Retry the last failed message
   */
  retryLastMessage: () => Promise<void>;

  /**
   * Add message to current session
   */
  addMessage: (message: Message) => void;

  /**
   * Add message to a specific session by ID (used by swarm inbox feedback loop)
   */
  addMessageToSession: (sessionId: string, message: Message) => Promise<void>;

  /**
   * Update last message (for streaming updates) and persist to database
   */
  updateLastMessage: (content: string, artifacts?: Artifact[], reasoning?: string, tokenUsage?: Message['token_usage']) => Promise<void>;

  /**
   * Update a specific message by ID (content + metadata) and persist to database.
   * Used for consolidating browser progress messages into a single dynamic bubble.
   */
  updateMessageContent: (messageId: string, content: string, metadata?: Record<string, unknown>) => Promise<void>;

  /**
   * Append streaming content to current buffer
   */
  appendStreamingContent: (content: string) => void;

  /**
   * Set streaming status (with timeout protection)
   */
  setStreaming: (streaming: boolean) => void;

  /**
   * Set error message
   */
  setError: (error: string | null) => void;

  /**
   * Clear error message
   */
  clearError: () => void;

  /**
   * Load sessions list
   */
  loadSessions: (sessions: Session[]) => void;

  /**
   * Select a session
   */
  selectSession: (sessionId: string) => void;

  /**
   * Delete a session
   */
  deleteSession: (sessionId: string) => Promise<void>;

  /**
   * Delete multiple sessions
   */
  deleteSessions: (sessionIds: string[]) => Promise<void>;

  /**
   * Update session's working directory
   */
  updateSessionCwd: (sessionId: string, cwd: string) => Promise<void>;

  /**
   * Update session's project
   */
  updateSessionProject: (sessionId: string, projectId: string | null) => Promise<void>;

  /**
   * Create a new project
   */
  createProject: (name: string) => Promise<void>;

  /**
   * Delete a project (and all its sessions)
   */
  deleteProject: (projectId: string) => Promise<void>;

  /**
   * Rename a project
   */
  renameProject: (projectId: string, name: string) => Promise<void>;

  /**
   * Bind a local folder as the **Project Folder** for this session.
   * Opens the native folder-picker dialog.
   * Returns the selected path or null if cancelled.
   *
   * Two-folder model: this method only sets the Project Folder. The
   * PiPi Output Folder continues to be derived from the app-managed
   * default unless `setSessionPipiOutputDir` is called explicitly.
   */
  setSessionProjectDir: (sessionId: string) => Promise<string | null>;

  /**
   * Bind a known local folder as the **Project Folder** for this
   * session without showing the folder picker. Used by affordances like
   * "Set parent folder as workspace?" surfaced from the file-drop toast,
   * where the user has already implicitly chosen a candidate folder.
   *
   * The same init/save flow as `setSessionProjectDir` runs
   * (`init_pipi_shrimp` + first-run README/tech-stack/structure scan +
   * DB persistence).
   * Returns the bound path, or `null` if `path` is empty / not a string.
   */
  setSessionProjectDirFromPath: (sessionId: string, path: string) => Promise<string | null>;

  /**
   * Remove the **Project Folder** binding from this session. The PiPi
   * Output Folder is preserved (it is independent in the two-folder
   * model).
   */
  clearSessionProjectDir: (sessionId: string) => Promise<void>;

  /**
   * Bind a local folder as the **PiPi Output Folder** for this session.
   * Opens the native folder-picker dialog. The PiPi Output Folder is
   * the app-owned root for `.pipi-shrimp/`, docs, memory, and
   * AutoResearch artifacts. Defaults to
   * `{Documents|HOME}/PiPi-Shrimp/chats/{session_id}` when unset.
   */
  setSessionPipiOutputDir: (sessionId: string) => Promise<string | null>;

  /**
   * Bind a known local folder as the **PiPi Output Folder** for this
   * session without showing the folder picker. Returns the bound path,
   * or `null` if `path` is empty / not a string.
   */
  setSessionPipiOutputDirFromPath: (sessionId: string, path: string) => Promise<string | null>;

  /**
   * Remove the **PiPi Output Folder** binding from this session. The
   * app-managed default (`{Documents|HOME}/PiPi-Shrimp/chats/{id}/`)
   * takes over on subsequent reads.
   */
  clearSessionPipiOutputDir: (sessionId: string) => Promise<void>;

  /**
   * Legacy alias for `setSessionProjectDir`. Pre-v7 callers used this
   * method name and the binding still maps to the Project Folder in
   * the two-folder model. New code should prefer the explicit
   * `setSessionProjectDir` / `setSessionPipiOutputDir` pair.
   */
  setSessionWorkDir: (sessionId: string) => Promise<string | null>;

  /**
   * Legacy alias for `setSessionProjectDirFromPath`.
   */
  setSessionWorkDirFromPath: (sessionId: string, path: string) => Promise<string | null>;

  /**
   * Ensure the session has an app-managed PiPi Output Folder.
   * Does not prompt; creates `{Documents|HOME}/PiPi-Shrimp/chats/{session_id}`.
   */
  ensureSessionWorkDir: (sessionId: string) => Promise<string | null>;

  /**
   * Legacy alias for `clearSessionProjectDir`.
   */
  clearSessionWorkDir: (sessionId: string) => Promise<void>;

  /**
   * Write a file into the PiPi Output Folder structure.
   * Automatically computes/creates the correct `{pipiOutputDir}/{date}-{i}/` folder.
   * Returns the absolute path where the file was written.
   */
  writeToWorkDir: (sessionId: string, filename: string, content: string) => Promise<string | null>;

  /**
   * Get the index of all previously generated output folders for this session.
   */
  getWorkDirIndex: (sessionId: string) => Promise<OutputFolder[]>;

  /**
   * Add working files to a session (session-level)
   */
  addSessionWorkingFiles: (sessionId: string, files: ImportedFile[]) => Promise<void>;

  /**
   * Remove a working file from a session
   */
  removeSessionWorkingFile: (sessionId: string, fileId: string) => Promise<void>;

  /**
   * Clear all working files from a session
   */
  clearSessionWorkingFiles: (sessionId: string) => Promise<void>;

  /**
   * Update session's permission mode (execution mode: standard, auto-edits, bypass, plan-only)
   */
  updateSessionPermissionMode: (sessionId: string, permissionMode: 'standard' | 'auto-edits' | 'bypass' | 'plan-only') => Promise<void>;
  /**
   * Update the 6-mode execution mode for a session. Internally mirrors
   * the 4-mode PermissionMode so existing preToolUseHooks keep working.
   */
  updateSessionExecutionMode: (sessionId: string, executionMode: import('@/services/executionMode').ExecutionModeId) => Promise<void>;

  /**
   * Rename a session (update title)
   */
  renameSession: (sessionId: string, newTitle: string) => Promise<void>;

  // ========== Token Stats ==========
  
  /**
   * Get daily token stats for a specific month (YYYY-MM format)
   */
  getDailyTokenStats: (yearMonth: string, apiConfigId?: string) => Promise<{ date: string; input_tokens: number; output_tokens: number; total_tokens: number }[]>;

  /**
   * Get monthly token stats
   */
  getMonthlyTokenStats: (apiConfigId?: string) => Promise<{ date: string; input_tokens: number; output_tokens: number; total_tokens: number }[]>;

  /**
   * Get token stats by model
   */
  getModelTokenStats: (apiConfigId?: string) => Promise<{ model: string; input_tokens: number; output_tokens: number; total_tokens: number }[]>;

    /**
    * Get total token stats (input, output, total)
    */
    getTotalTokenStats: (apiConfigId?: string) => Promise<{ input: number; output: number; total: number }>;

    /**
    * Reset token usage statistics
    */
    resetTokenEstimate: () => Promise<void>;

  // ========== Token Stats ==========
}

// ============= Helper Functions =============

/**
 * Helper function to create a new message with generated ID
 */
export const createMessage = (
  role: 'user' | 'assistant',
  content: string,
  artifacts?: Artifact[],
  attachments?: ImageAttachment[],
): Message => ({
  id: crypto.randomUUID(),
  role,
  content,
  timestamp: Date.now(),
  artifacts,
  attachments,
});

/**
 * Helper function to create a new session
 */
export const createSession = (title?: string, projectId?: string | null, model?: string): Session => ({
  id: crypto.randomUUID(),
  title: title || 'Chat',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  projectId: projectId ?? undefined,
  model,
});

/**
 * Helper function to create a new project
 */
export const createProject = (name: string): Project => ({
  id: crypto.randomUUID(),
  name,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/** Structured Result for Tool Executions */
export interface StructuredToolResult {
  rawContent: string;
  modelContent: string;
  structuredData?: {
    filePath?: string;
    pdfPath?: string;
    svgPath?: string;
    exists?: boolean;
    kind?: 'file' | 'directory' | 'unknown';
    [key: string]: unknown;
  };
  isError: boolean;
  errorMessage?: string;
}

export interface AgentExecutionBudget {
  maxModelRounds: number;
  maxToolExecutions: number;
  maxToolRetries: number;
  maxToolWallClockMs: number;
  maxTotalWallClockMs: number;
  reserveFinalResponseRound: boolean;
}

export interface AgentExecutionCounters {
  modelRoundsUsed: number;
  toolExecutionsUsed: number;
  toolRetriesUsed: number;
  startedAt: number;
  lastToolStartedAt?: number;
  lastToolName?: string;
}
