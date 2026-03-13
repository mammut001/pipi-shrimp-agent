/**
 * Chat-related type definitions
 * Includes Message, Artifact, Session, and ChatState interfaces
 */

// ============= Type Definitions =============

/** Chat message interface */
export interface Message {
  id: string;                    // Unique ID (UUID v4)
  role: 'user' | 'assistant';    // Message sender role
  content: string;              // Message content
  timestamp: number;            // Timestamp in milliseconds
  artifacts?: Artifact[];        // Attached code/charts etc
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
  cwd?: string;                 // Current working directory (for code execution)
}

// ============= Zustand State Interface =============

/** Chat store state interface */
export interface ChatState {
  // ========== Data State ==========
  sessions: Session[];
  currentSessionId: string | null;
  isStreaming: boolean;
  isInitialized: boolean;
  streamingContent: string;
  error: string | null;         // Error message

  // ========== Computed Properties ==========
  currentSession: () => Session | null;  // Get current session
  currentMessages: () => Message[];      // Get current session's messages

  // ========== Action Methods ==========

  /**
   * Initialize store (load data from local storage)
   */
  init: () => Promise<void>;

  /**
   * Create a new session
   */
  startSession: () => Promise<void>;

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
   * Update last message (for streaming updates)
   */
  updateLastMessage: (content: string, artifacts?: Artifact[]) => void;

  /**
   * Append streaming content to current buffer
   */
  appendStreamingContent: (content: string) => void;

  /**
   * Set streaming status
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
   * Update session's working directory
   */
  updateSessionCwd: (sessionId: string, cwd: string) => Promise<void>;

  /**
   * Send tool execution result back to AI
   */
  sendToolResult: (toolCallId: string, result: string) => Promise<void>;

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
export const createSession = (title?: string): Session => ({
  id: crypto.randomUUID(),
  title: title || 'New Conversation',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
