import { invoke } from '@tauri-apps/api/core';

export async function connectBrowserSession(): Promise<string> {
  return invoke<string>('connect_browser');
}

export async function navigateBrowserPage(url: string, waitSelector?: string | null): Promise<string> {
  return invoke<string>('navigate_and_wait', {
    url,
    waitSelector: waitSelector ?? null,
  });
}

export async function resyncBrowserPage(): Promise<string> {
  return invoke<string>('resync_page');
}