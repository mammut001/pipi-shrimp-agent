/**
 * isTauri - Check if the app is running inside Tauri's webview.
 *
 * When running at `localhost:5173` in a regular browser, Tauri IPC is unavailable.
 * Use this before calling any Tauri-specific APIs.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
