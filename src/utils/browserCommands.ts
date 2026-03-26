/**
 * Browser commands - Frontend invoke wrappers
 *
 * These functions invoke the Tauri backend commands for browser automation.
 * Supports both external window and embedded surface modes.
 *
 * The embedded surface is the primary browser surface for the "real browser in-app" experience.
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
  has_login_modal: boolean;
  content_word_count: number;
}

// ============================================
// External Window Commands (Legacy/Fallback)
// ============================================

/**
 * Open a new browser window with the given URL (separate window)
 */
export async function openBrowserWindow(url: string): Promise<string> {
  return invoke<string>('open_browser_window', { url });
}

/**
 * Show and focus the existing browser window
 */
export async function showBrowserWindow(): Promise<string> {
  return invoke<string>('show_browser_window');
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
 * Inspect the current browser page state (external window version)
 */
export async function inspectBrowserState(): Promise<RawBrowserInspection> {
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

// ============================================
// Embedded Surface Commands (Primary)
// ============================================

/**
 * Open browser in embedded mode - primary command for "real browser in-app" experience
 * Creates a webview embedded in the main window rather than a separate window
 */
export async function openEmbeddedSurface(url: string): Promise<string> {
  return invoke<string>('open_embedded_surface', { url });
}

/**
 * Move browser surface between mini and expanded presentation
 * Keeps the same session while changing presentation mode
 */
export async function moveBrowserSurface(
  targetMode: 'mini' | 'expanded',
  bounds?: { x: number; y: number; width: number; height: number }
): Promise<string> {
  return invoke<string>('move_browser_surface', {
    targetMode,
    x: bounds?.x ?? null,
    y: bounds?.y ?? null,
    width: bounds?.width ?? null,
    height: bounds?.height ?? null,
  });
}

/**
 * Show or hide the embedded browser surface without closing the session.
 */
export async function setEmbeddedSurfaceVisibility(visible: boolean): Promise<string> {
  return invoke<string>('set_embedded_surface_visibility', { visible });
}

/**
 * Get the current embedded surface URL
 */
export async function getEmbeddedSurfaceUrl(): Promise<string> {
  return invoke<string>('get_embedded_surface_url');
}

/**
 * Execute a PageAgent task on the embedded surface
 */
export async function executeOnEmbeddedSurface(
  task: string,
  apiKey: string,
  model: string,
  options?: {
    baseUrl?: string;
    systemPrompt?: string;
  }
): Promise<string> {
  return invoke<string>('execute_on_embedded_surface', {
    task,
    apiKey,
    model,
    baseUrl: options?.baseUrl ?? null,
    systemPrompt: options?.systemPrompt ?? null,
  });
}

/**
 * Inspect the embedded surface page state
 */
export async function inspectEmbeddedSurface(): Promise<RawBrowserInspection> {
  return invoke<RawBrowserInspection>('inspect_embedded_surface');
}

/**
 * Navigate the embedded surface to a URL
 */
export async function navigateEmbeddedSurface(url: string): Promise<string> {
  return invoke<string>('navigate_embedded_surface', { url });
}

/**
 * Reload the embedded surface
 */
export async function reloadEmbeddedSurface(): Promise<string> {
  return invoke<string>('reload_embedded_surface');
}

/**
 * Close the embedded surface
 */
export async function closeEmbeddedSurface(): Promise<string> {
  return invoke<string>('close_embedded_surface');
}

// ============================================
// Screenshot and Dimensions
// ============================================

/**
 * Capture a screenshot from the browser window
 * Returns an acknowledgement string; the actual image data arrives via event.
 */
export async function captureScreenshot(): Promise<string> {
  return invoke<string>('capture_screenshot');
}

/**
 * Get browser window dimensions
 */
export interface BrowserDimensions {
  width: number;
  height: number;
}

export async function getBrowserDimensions(): Promise<BrowserDimensions> {
  return invoke<BrowserDimensions>('get_browser_dimensions');
}
