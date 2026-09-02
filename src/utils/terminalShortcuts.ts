/** App search (Ctrl/Cmd+K) must not be captured by the embedded xterm. */
export function isTerminalPassThroughShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (event.altKey) return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  return event.key.toLowerCase() === 'k' || event.code === 'KeyK';
}
