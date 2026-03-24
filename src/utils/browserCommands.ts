/**
 * Browser commands - Frontend invoke wrappers
 *
 * These functions invoke the Tauri backend commands for browser automation
 * using the second WebviewWindow approach.
 */

import { invoke } from '@tauri-apps/api/core';

export interface AgentLog {
  timestamp: string;
  message: string;
  level: 'info' | 'success' | 'error' | 'thinking';
}

export interface AgentTaskComplete {
  success: boolean;
  final_url: string;
  result: string;
}

/** Raw inspection data from backend */
export interface RawBrowserInspection {
  url: string;
  title: string;
  has_password_input: boolean;
  has_login_form: boolean;
  has_qr_auth: boolean;
  has_captcha: boolean;
  text_markers: string[];
  dom_markers: string[];
}

/**
 * Open a new browser window with the given URL
 */
export async function openBrowserWindow(url: string): Promise<string> {
  return invoke<string>('open_browser_window', { url });
}

/**
 * Close the browser window
 */
export async function closeBrowserWindow(): Promise<string> {
  return invoke<string>('close_browser_window');
}

/**
 * Execute a PageAgent task in the browser window
 */
export async function executeAgentTask(
  task: string,
  apiKey: string,
  model: string,
  options?: {
    baseUrl?: string;
    systemPrompt?: string;
  }
): Promise<string> {
  return invoke<string>('execute_agent_task', {
    task,
    apiKey,
    model,
    baseUrl: options?.baseUrl ?? null,
    systemPrompt: options?.systemPrompt ?? null,
  });
}

/**
 * Get the current URL of the browser window
 */
export async function getBrowserUrl(): Promise<string> {
  return invoke<string>('get_browser_url');
}

/**
 * Inject arbitrary JavaScript into the browser window
 */
export async function injectScript(script: string): Promise<string> {
  return invoke<string>('inject_script', { script });
}

/**
 * Check if the agent is currently busy
 */
export async function isAgentBusy(): Promise<boolean> {
  return invoke<boolean>('is_agent_busy');
}

/**
 * Navigate back in browser history
 */
export async function goBack(): Promise<string> {
  return invoke<string>('browser_go_back');
}

/**
 * Inspect the current browser page state
 * Returns raw DOM and text information for auth detection
 * Uses the backend inspect_browser_state command which injects JS and returns results
 */
export async function inspectBrowserState(): Promise<RawBrowserInspection> {
  // Use the backend command - it handles script injection and returns real data
  return invoke<RawBrowserInspection>('inspect_browser_state');
}

/**
 * Navigate to a specific URL in the browser window
 */
export async function browserNavigate(url: string): Promise<string> {
  return invoke<string>('browser_navigate', { url });
}

/**
 * Reload the current page in the browser window
 */
export async function browserReload(): Promise<string> {
  return invoke<string>('browser_reload');
}
