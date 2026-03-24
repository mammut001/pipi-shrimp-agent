/**
 * Browser Connectors - Runtime connector abstraction
 *
 * Provides a unified interface for different browser/IM surfaces
 * Currently implements browser_web, reserves space for IM connectors
 */

import type {
  RuntimeConnector,
  BrowserConnectorType,
  BrowserTaskEnvelope,
  BrowserInspectionResult,
} from '../types/browser';
import { matchProfileByUrl } from './browserProfiles';
import {
  inspectBrowserState,
} from './browserCommands';
import { useSettingsStore } from '../store/settingsStore';
import { useBrowserAgentStore } from '../store/browserAgentStore';

/**
 * Browser Web Connector
 * Implements the RuntimeConnector interface for standard web browsing
 */
class BrowserWebConnector implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'browser_web';

  constructor(id: string = 'browser-web-default') {
    this.id = id;
  }

  /**
   * Check if this connector can handle the given target
   */
  canHandle(target: string): boolean {
    // Browser web connector handles HTTP/HTTPS URLs
    return target.startsWith('http://') || target.startsWith('https://');
  }

  /**
   * Inspect current page state
   */
  async inspect(): Promise<BrowserInspectionResult> {
    const raw = await inspectBrowserState();
    const profile = matchProfileByUrl(raw.url);

    // Import the parser dynamically to avoid circular dependencies
    const { parseInspectionResult } = await import('./browserInspection');

    return parseInspectionResult(raw, profile.id);
  }

  /**
   * Open a target URL
   */
  async open(targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.openWindow(targetUrl);
  }

  /**
   * Request user to authenticate manually
   */
  async requestUserAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  /**
   * Resume after authentication
   */
  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  /**
   * Execute a task
   */
  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useBrowserAgentStore.getState();

    // Get API config
    const config = useSettingsStore.getState().getActiveConfig();
    if (!config?.apiKey) {
      throw new Error('API not configured');
    }

    // Execute via store
    await store.executeTask(task.executionPrompt);
  }

  /**
   * Stop current execution
   */
  async stop(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.stopTask();
  }
}

/**
 * WhatsApp Web Connector (reserved for future implementation)
 *
 * Note: This is a placeholder for future IM connector support.
 * The current implementation uses the same browser approach as BrowserWebConnector.
 */
class WhatsAppConnector implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'im_whatsapp';

  constructor(id: string = 'whatsapp-default') {
    this.id = id;
  }

  canHandle(target: string): boolean {
    return target.includes('whatsapp');
  }

  async inspect(): Promise<BrowserInspectionResult> {
    // Same as browser web for now
    const raw = await inspectBrowserState();
    const { parseInspectionResult } = await import('./browserInspection');
    return parseInspectionResult(raw, 'whatsapp_web');
  }

  async open(targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.openWindow(targetUrl);
  }

  async requestUserAuth(): Promise<void> {
    // WhatsApp uses QR code login
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.executeTask(task.executionPrompt);
  }

  async stop(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.stopTask();
  }
}

/**
 * Telegram Web Connector (reserved for future implementation)
 */
class TelegramConnector implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'im_telegram';

  constructor(id: string = 'telegram-default') {
    this.id = id;
  }

  canHandle(target: string): boolean {
    return target.includes('telegram');
  }

  async inspect(): Promise<BrowserInspectionResult> {
    const raw = await inspectBrowserState();
    const { parseInspectionResult } = await import('./browserInspection');
    return parseInspectionResult(raw, 'telegram_web');
  }

  async open(targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.openWindow(targetUrl);
  }

  async requestUserAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.executeTask(task.executionPrompt);
  }

  async stop(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.stopTask();
  }
}

/**
 * Generic Web Connector (fallback for unknown sites)
 */
class GenericWebConnector implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'generic_web';

  constructor(id: string = 'generic-default') {
    this.id = id;
  }

  canHandle(_target: string): boolean {
    // Generic connector handles everything as fallback
    return true;
  }

  async inspect(): Promise<BrowserInspectionResult> {
    const raw = await inspectBrowserState();
    const { parseInspectionResult } = await import('./browserInspection');
    return parseInspectionResult(raw, 'generic_authenticated_site');
  }

  async open(targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.openWindow(targetUrl);
  }

  async requestUserAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.executeTask(task.executionPrompt);
  }

  async stop(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.stopTask();
  }
}

// ========== Connector Factory ==========

/**
 * Get a connector instance based on connector type
 */
export function getConnector(type: BrowserConnectorType): RuntimeConnector {
  switch (type) {
    case 'browser_web':
      return new BrowserWebConnector();
    case 'im_whatsapp':
      return new WhatsAppConnector();
    case 'im_telegram':
      return new TelegramConnector();
    case 'im_slack':
      // Slack uses web interface, similar to browser_web
      return new BrowserWebConnector('slack-connector');
    case 'generic_web':
    default:
      return new GenericWebConnector();
  }
}

/**
 * Auto-detect connector type from URL
 */
export function detectConnectorType(url: string): BrowserConnectorType {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('whatsapp')) {
    return 'im_whatsapp';
  }
  if (lowerUrl.includes('telegram')) {
    return 'im_telegram';
  }
  if (lowerUrl.includes('slack')) {
    return 'im_slack';
  }

  return 'browser_web';
}

/**
 * Get all available connector types
 */
export function getAvailableConnectors(): BrowserConnectorType[] {
  return ['browser_web', 'im_whatsapp', 'im_telegram', 'im_slack', 'generic_web'];
}

// Export connector classes for extensibility
export {
  BrowserWebConnector,
  WhatsAppConnector,
  TelegramConnector,
  GenericWebConnector,
};
