/**
 * Chat-related type definitions
 * Includes Message, Artifact, Session, and ChatState interfaces
 */

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
  role: 'user' | 'assistant';    // Message sender role
  content: string;              // Message content
  reasoning?: string;           // AI reasoning/thinking process (optional)
  timestamp: number;            // Timestamp in milliseconds
  artifacts?: Artifact[];        // Attached code/charts etc
  tool_calls?: ToolCall[];       // Tool calls made by assistant
  tool_call_id?: string;         // ID of tool result (for tool role messages)
  metadata?: Record<string, unknown>;  // Additional metadata
}

/** Artifact (code blocks, diagrams, etc) */
export interface Artifact {
  id: string;
  type: 'html' | 'svg' | 'mermaid' | 'react' | 'code';
  content: string;
  title?: string;
  language?: string;  // Only for 'code' type
}

/** Chat session */
export interface Session {
  id: string;
  title: string;                // Session title (extracted from first message or user-defined)
  messages: Message[];          // All messages in the session
  createdAt: number;            // Creation timestamp
  updatedAt: number;            // Last update timestamp
  cwd?: string;                  // Current working directory (for code execution)
  projectId?: string;           // Project ID this session belongs to (optional)
  model?: string;               // Model to use for this session (optional, defaults to apiConfig model)
}

/** Project (folder for grouping sessions) */
export interface Project {
  id: string;
  name: string;                  // Project name
  createdAt: number;            // Creation timestamp
  updatedAt: number;            // Last update timestamp
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
  startSession: (projectId?: string, model?: string) => Promise<void>;

  /**
   * Send message (call API)
   */
  sendMessage: (content: string) => Promise<void>;

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
   * Update last message (for streaming updates) and persist to database
   */
  updateLastMessage: (content: string, artifacts?: Artifact[], reasoning?: string) => Promise<void>;

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
   * Send tool execution result back to AI
   */
  sendToolResult: (toolCallId: string, result: string) => Promise<void>;

  /**
   * Send all accumulated tool results to AI in a single batch
   */
  sendAllToolResults: () => Promise<void>;

  /**
   * Execute a tool and handle the result (permission-aware)
   */
  executeTool: (toolName: string, toolInput: string, toolCallId: string) => Promise<void>;
}

// ============= Helper Functions =============

/**
 * Helper function to create a new message with generated ID
 */
export const createMessage = (
  role: 'user' | 'assistant',
  content: string,
  artifacts?: Artifact[]
): Message => ({
  id: crypto.randomUUID(),
  role,
  content,
  timestamp: Date.now(),
  artifacts,
});

/**
 * Helper function to create a new session
 */
export const createSession = (title?: string, projectId?: string, model?: string): Session => ({
  id: crypto.randomUUID(),
  title: title || 'New Conversation',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  projectId,
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
