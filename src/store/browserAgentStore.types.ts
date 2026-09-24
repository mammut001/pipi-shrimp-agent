import type { StateCreator } from 'zustand';
import type {
  BrowserSessionStatus,
  BrowserControlMode,
  BrowserAuthState,
  BrowserBlockReason,
  BrowserTaskEnvelope,
  BrowserInspectionResult,
  BrowserConnectorType,
  BrowserPresentationMode,
  BrowserHandoffState,
  LogEntry,
} from '../types/browser';
import type { BrowserPendingActionApproval } from './browser/browserActionApproval';

/**
 * Extended browser agent state interface
 */
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
  /** Raw result string returned by PageAgent on task completion */
  lastTaskResult: string | null;

  // ========== Execution State ==========
  logs: LogEntry[];
  screenshots: string[];
  _abortController: AbortController | null;
  _taskRunToken: number;
  _screenshotInterval: ReturnType<typeof setInterval> | null;
  _isLivePreviewEnabled: boolean;

  // ========== Presentation State ==========
  presentationMode: BrowserPresentationMode;
  handoffState: BrowserHandoffState;

  // Removed explicit embedded mode flag; rely on real runtime when available

  /** Guard against concurrent inspections — only one at a time */
  _isInspecting: boolean;

  /** Pending sensitive-action approval surfaced to the browser panel UI (R3-01). */
  pendingBrowserActionApproval: BrowserPendingActionApproval | null;
}

/**
 * Extended browser agent actions interface
 */
export interface BrowserAgentActions {
  // ========== Window Actions ==========
  openWindow: (url: string) => Promise<void>;
  closeWindow: () => Promise<void>;

  // ========== Task Actions ==========
  executeTask: (task: string) => Promise<void>;
  executeTaskEnvelope: (envelope: BrowserTaskEnvelope) => Promise<void>;
  stopTask: () => void;
  approveBrowserAction: (id?: string) => boolean;
  rejectBrowserAction: (id?: string) => boolean;
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
  resetToReady: () => void;

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

  // Embedded mode actions removed in favor of runtime capability-based embedding
  refreshScreenshot: (screenshot: string) => void;

  // Live preview actions
  _startLivePreview: () => void;
  _stopLivePreview: () => void;
  _toggleLivePreview: (enabled: boolean) => void;
}

export type BrowserAgentStore = BrowserAgentState & BrowserAgentActions;
export type BrowserAgentSet = Parameters<StateCreator<BrowserAgentStore>>[0];
export type BrowserAgentGet = Parameters<StateCreator<BrowserAgentStore>>[1];
export type BrowserAgentActionFactory<T> = (
  set: BrowserAgentSet,
  get: BrowserAgentGet,
) => T;

export type BrowserAgentEventActions = Pick<
  BrowserAgentActions,
  'setupEventListeners' | 'openWindow' | 'closeWindow'
>;

export type BrowserAgentTaskActions = Pick<
  BrowserAgentActions,
  | 'executeTask'
  | 'executeTaskEnvelope'
  | 'stopTask'
  | 'approveBrowserAction'
  | 'rejectBrowserAction'
  | 'bindTask'
  | 'clearTask'
  | 'resumePendingTask'
>;

export type BrowserAgentInspectionActions = Pick<
  BrowserAgentActions,
  | 'inspectCurrentPage'
  | 'requestLogin'
  | 'confirmLoginAndResume'
  | 'forceResumeWithoutAuth'
>;
