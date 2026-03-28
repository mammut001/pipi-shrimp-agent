/**
 * Browser-related type definitions
 * Supports auth handoff, IM connectors, and site profiles
 */

// ============= Browser Connector Types =============

/** Browser connector types - supports web and future IM surfaces */
export type BrowserConnectorType =
  | 'browser_web'
  | 'im_whatsapp'
  | 'im_telegram'
  | 'im_slack'
  | 'generic_web';

// ============= Auth State Types =============

/** Browser authentication states */
export type BrowserAuthState =
  | 'unknown'
  | 'authenticated'
  | 'unauthenticated'
  | 'auth_required'
  | 'mfa_required'
  | 'captcha_required'
  | 'expired';

// ============= Block Reason Types =============

/** Reasons why browser automation is blocked */
export type BrowserBlockReason =
  | 'login_required'
  | 'captcha_required'
  | 'mfa_required'
  | 'manual_confirmation_required'
  | 'unsupported_page'
  | 'rate_limited'
  | 'unknown';

// ============= Browser Control Modes =============

/** Browser control modes - who currently controls the browser */
export type BrowserControlMode =
  | 'manual_handoff'    // User controls browser; agent cannot execute
  | 'agent_controlled'  // Agent can execute PageAgent tasks
  | 'mixed_supervised'; // Agent can execute but must stop on protected actions

// ============= Browser Session Status =============

/** Extended browser session states for auth handoff */
export type BrowserSessionStatus =
  | 'uninitialized'           // Browser window not opened yet
  | 'opening'                 // Browser window creation in progress
  | 'idle'                    // Browser window open, no task bound
  | 'inspecting'              // App is evaluating current page state
  | 'needs_login'             // Login page or auth gate detected
  | 'waiting_user_resume'    // User has been prompted; app is waiting for explicit resume
  | 'ready_for_agent'         // Current page looks safe for automation
  | 'running'                 // PageAgent is actively executing
  | 'blocked_auth'            // Execution interrupted by login wall or expired session
  | 'blocked_captcha'         // Execution hit captcha or strong anti-bot gate
  | 'blocked_manual_step'     // Execution reached a site step that requires user confirmation
  | 'completed'               // Workflow finished
  | 'error';                  // Technical failure or unsupported state

// ============= Site Profile Types =============

/** Site profile definition */
export interface SiteProfile {
  id: string;
  label: string;
  connectorType: BrowserConnectorType;
  /** Domain matchers (exact or patterns) */
  domainMatchers: string[];
  /** Selectors or text markers that indicate login page */
  loginDetectors: string[];
  /** Selectors or text markers that indicate post-login state */
  postLoginDetectors: string[];
  /** Selectors or text markers that indicate blocked state */
  blockDetectors: string[];
  /** Allowed automation level */
  automationSensitivity: 'high' | 'medium' | 'low' | 'none';
}

// ============= Task Envelope Types =============

/** Browser task envelope - represents a complete browser task */
export interface BrowserTaskEnvelope {
  id: string;
  connectorType: BrowserConnectorType;
  siteProfileId: string;
  targetUrl: string;
  userIntent: string;
  executionPrompt: string;
  requiresLogin: boolean;
  authPolicy: 'manual_login_required' | 'login_optional' | 'none';
  /** Which execution tier to use for this task.
   *  'pageagent' — embedded Tauri WebView (simple/public pages, works today)
   *  'cdp'       — external Chrome via remote debugging port (complex/authenticated pages)
   *  'auto'      — reserved for future smart routing; currently defaults to 'pageagent'
   */
  executionMode?: 'pageagent' | 'cdp' | 'auto';
  allowedControlMode: BrowserControlMode;
  metadata?: Record<string, unknown>;
}

// ============= Inspection Result Types =============

/** Browser inspection result - current page state analysis */
export interface BrowserInspectionResult {
  url: string;
  title: string;
  authState: BrowserAuthState;
  blockReason?: BrowserBlockReason;
  matchedProfileId?: string;
  matchedSignals: string[];
  safeForAgent: boolean;
}

// ============= Raw Inspection Data (from backend) =============

/** Raw inspection data from backend JS injection */
export interface RawBrowserInspection {
  url: string;
  title: string;
  has_password_input: boolean;
  has_login_form: boolean;
  has_qr_auth: boolean;
  has_captcha: boolean;
  text_markers: string[];
  dom_markers: string[];
  /** Login UI is inside a modal/overlay (optional sign-in prompt, content still accessible) */
  has_login_modal: boolean;
  /** Word count of body text — high count means content is visible behind any login prompt */
  content_word_count: number;
}

// ============= Runtime Connector Interface =============

/** Runtime connector interface - for future IM expansion */
export interface RuntimeConnector {
  id: string;
  connectorType: BrowserConnectorType;
  canHandle(target: string): boolean;
  inspect(): Promise<BrowserInspectionResult>;
  open(targetUrl: string): Promise<void>;
  requestUserAuth(): Promise<void>;
  resumeAfterAuth(): Promise<void>;
  execute(task: BrowserTaskEnvelope): Promise<void>;
  stop(): Promise<void>;
}

// ============= Presentation Mode Types =============

/** Browser presentation modes - where the browser surface is displayed */
export type BrowserPresentationMode =
  | 'hidden'       // No browser task active
  | 'mini'        // Browser in right panel (embedded)
  | 'expanded'    // Browser in main workspace (embedded)
  | 'external';   // Browser in separate Tauri window (fallback)

// ============= Browser Session State =============

/** Browser session state - the core session data */
export interface BrowserSession {
  sessionId: string;
  currentUrl: string;
  pageTitle: string;
  authState: BrowserAuthState;
  taskState: BrowserTaskState;
  activeTask: BrowserTaskEnvelope | null;
  presentationMode: BrowserPresentationMode;
  canUserInteract: boolean;
}

/** Task execution states */
export type BrowserTaskState =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

// ============= Handoff State Types =============

/** Handoff states for login/auth flows */
export type BrowserHandoffState =
  | 'no_handoff'                    // No handoff needed
  | 'waiting_for_login'             // Waiting for user to login
  | 'waiting_for_captcha'          // Waiting for user to complete captcha
  | 'waiting_for_manual_confirmation' // Waiting for user confirmation
  | 'resuming';                    // Task is being resumed

// ============= Store State Types =============

/** Extended browser agent state for the store */
export interface BrowserAgentState {
  // ========== Core State ==========
  status: BrowserSessionStatus;
  isWindowOpen: boolean;
  currentUrl: string;
  error: string | null;

  // ========== Auth & Control State ==========
  mode: BrowserControlMode;
  authState: BrowserAuthState;
  blockReason: BrowserBlockReason | null;

  // ========== Task & Profile State ==========
  pendingTask: BrowserTaskEnvelope | null;
  inspection: BrowserInspectionResult | null;
  siteProfileId: string | null;
  connectorType: BrowserConnectorType;
  waitingForUserResume: boolean;
  lastCompletedTaskId: string | null;

  // ========== Execution State ==========
  logs: LogEntry[];
  screenshots: string[];
  _abortController: AbortController | null;

  // ========== Presentation State ==========
  presentationMode: BrowserPresentationMode;
  handoffState: BrowserHandoffState;
}

// ============= Log Entry =============

/** Log entry for browser agent */
export interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'success' | 'error' | 'thinking' | 'warning';
}

// ============= Store Action Types =============

/** Browser agent store actions */
export interface BrowserAgentActions {
  // ========== Window Actions ==========
  openWindow: (url: string) => Promise<void>;
  closeWindow: () => Promise<void>;

  // ========== Task Actions ==========
  executeTask: (task: string) => Promise<void>;
  executeTaskEnvelope: (envelope: BrowserTaskEnvelope) => Promise<void>;
  stopTask: () => void;
  bindTask: (task: BrowserTaskEnvelope) => void;
  clearTask: () => void;
  resumePendingTask: () => Promise<void>;

  // ========== Inspection Actions ==========
  inspectCurrentPage: () => Promise<void>;
  requestLogin: () => void;
  confirmLoginAndResume: () => Promise<void>;
  forceResumeWithoutAuth: () => Promise<void>;

  // ========== Control Mode Actions ==========
  switchToManualMode: () => void;
  switchToAgentMode: () => void;
  handleBlockedState: (reason: BrowserBlockReason) => void;

  // ========== Utility Actions ==========
  clearLogs: () => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  setupEventListeners: () => Promise<() => void>;

  // ========== Presentation Actions ==========
  setPresentationMode: (mode: BrowserPresentationMode) => void;
  expandBrowser: () => void;
  collapseBrowser: () => void;
  showMiniBrowser: () => void;
  hideBrowser: () => void;
}

// ============= Complete Store Type =============

/** Complete browser agent store type */
export type BrowserAgentStore = BrowserAgentState & BrowserAgentActions;

// ============= Event Payload Types =============

/** Event payloads from backend */
export interface AgentLog {
  level: 'info' | 'success' | 'error' | 'thinking';
  message: string;
}

export interface AgentTaskComplete {
  success: boolean;
  final_url: string;
  result: string;
}

export interface BrowserAuthRequiredEvent {
  reason: 'login_required' | 'captcha_required' | 'mfa_required';
  profile: string;
  url: string;
}

export interface BrowserBlockedEvent {
  reason: BrowserBlockReason;
  url: string;
  message: string;
}

export interface BrowserReadyEvent {
  profile: string;
  url: string;
}
