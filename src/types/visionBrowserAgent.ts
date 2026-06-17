/**
 * Vision browser agent — type definitions only.
 *
 * These types describe the contract a *future* screenshot/coordinate-based
 * provider (Fara, OmniParser, etc.) would implement. We do not ship a runtime
 * here; only a mock provider in `visionBrowserProvider.ts` is wired up so the
 * agent loop can declare "vision fallback would have been used here" without
 * pulling in a Python sidecar.
 *
 * Once a real provider is available:
 *   1. Implement `VisionBrowserProvider` against the chosen runtime.
 *   2. Register the provider in `visionBrowserProvider.ts`.
 *   3. Flip `PIPI_BROWSER_VISION_FALLBACK` to enabled via localStorage.
 */

import type { BrowserScreenshotRef } from './browserPageState';
import type { ObservationLevel } from './browserEngine';

/** Coordinate-based actions a vision provider can emit. */
export type VisionBrowserAction =
  | { action: 'left_click'; coordinate: [number, number] }
  | { action: 'type'; coordinate?: [number, number]; text: string; press_enter?: boolean }
  | { action: 'scroll'; pixels: number; direction?: 'up' | 'down' | 'left' | 'right' }
  | { action: 'key'; keys: string[] }
  | { action: 'wait'; time: number }
  | { action: 'terminate'; status: 'success' | 'failure'; message?: string };

/** Step history the provider can inspect to decide its next action. */
export interface BrowserAgentStepHistory {
  index: number;
  observationLevel: ObservationLevel;
  /** Last model output, if any. */
  thought?: string;
  /** Last action the agent executed. */
  action?: string;
  /** Whether the previous step succeeded. */
  success?: boolean;
  url?: string;
  navigationId?: string;
}

/** Input handed to the provider on every step. */
export interface VisionBrowserInput {
  task: string;
  screenshotRef: BrowserScreenshotRef | null;
  viewport: { width: number; height: number };
  history: BrowserAgentStepHistory[];
  /** Optional URL/title snapshot of the page that produced the screenshot. */
  pageMeta?: {
    url: string;
    title: string;
    navigationId: string;
  };
}

/** Provider interface — every vision backend must implement this. */
export interface VisionBrowserProvider {
  /** Unique, stable name (used in logs and the debug panel). */
  readonly name: string;
  /** Whether this provider can service the current request (e.g. screenshot available). */
  isReady(input: VisionBrowserInput): Promise<boolean> | boolean;
  /** Produce the next action based on the screenshot + history. */
  observeAndAct(input: VisionBrowserInput): Promise<VisionBrowserAction>;
  /** Tear down any expensive resources (models, sandboxes). */
  dispose?(): Promise<void> | void;
}
