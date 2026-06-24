import { invoke } from '@tauri-apps/api/core';

import type { ToolExecutionSource } from '@/services/tools/toolExecutionPolicy';
import type { BrowserActionTarget } from '@/types/browserPageState';

export interface ExecuteBrowserScriptOptions {
  source?: ToolExecutionSource;
  sessionId?: string;
  approvalToken?: string;
  executionMode?: string;
  toolCallId?: string;
}

export * from './browserSessionClient';
export * from './browserPageStateClient';
export type {
  BrowserActionTarget,
  BrowserInteractiveElement,
  BrowserPageState,
  BrowserScreenshotRef,
} from '@/types/browserPageState';

export async function clickBrowserElement(target: BrowserActionTarget): Promise<string> {
  return invoke<string>('browser_click', {
    elementId: target.elementId ?? null,
    backendNodeId: target.backendNodeId ?? null,
    navigationId: target.navigationId ?? null,
  });
}

export async function typeIntoBrowserElement(target: BrowserActionTarget, text: string): Promise<string> {
  return invoke<string>('browser_type', {
    elementId: target.elementId ?? null,
    backendNodeId: target.backendNodeId ?? null,
    navigationId: target.navigationId ?? null,
    text,
  });
}

export async function scrollBrowser(direction: string, pixels = 600): Promise<string> {
  return invoke<string>('browser_scroll', { direction, pixels });
}

export async function pressBrowserKey(key: string): Promise<string> {
  return invoke<string>('browser_press_key', { key });
}

export async function waitForBrowser(options?: {
  seconds?: number;
  selector?: string;
}): Promise<string> {
  return invoke<string>('browser_wait', {
    seconds: options?.seconds ?? null,
    waitSelector: options?.selector ?? null,
  });
}

export async function executeBrowserScript(
  script: string,
  options: ExecuteBrowserScriptOptions = {},
): Promise<string> {
  return invoke<string>('cdp_execute_script', {
    script,
    source: options.source ?? 'headless_agent',
    sessionId: options.sessionId ?? null,
    approvalToken: options.approvalToken ?? null,
    executionMode: options.executionMode ?? null,
    toolCallId: options.toolCallId ?? null,
  });
}