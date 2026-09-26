/**
 * AG-28 source guards: preserve browser command paths, proxy behavior and
 * await boundaries while extracting command bodies at compile time.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};
const hash = (src: string) => createHash('sha256').update(src).digest('hex');

const BROWSER_RS = 'src-tauri/src/commands/browser.rs';
const EMBEDDED_RS = 'src-tauri/src/commands/browser/embedded_surface.rs';
const WINDOW_RS = 'src-tauri/src/commands/browser/window.rs';
const STATE_RS = 'src-tauri/src/commands/browser/state.rs';

const COMMANDS = [
  'open_browser_window',
  'open_embedded_surface',
  'move_browser_surface',
  'set_embedded_surface_visibility',
  'get_embedded_surface_url',
  'execute_on_embedded_surface',
  'inspect_embedded_surface',
  'navigate_embedded_surface',
  'reload_embedded_surface',
  'close_embedded_surface',
  'show_browser_window',
  'close_browser_window',
  'execute_agent_task',
  'proxy_http_request',
  'open_devtools',
  'get_browser_url',
  'inject_script',
  'is_agent_busy',
  'browser_go_back',
  'inspect_browser_state',
  'browser_navigate',
  'browser_reload',
  'set_embedded_mode',
  'get_embedded_mode',
  'capture_screenshot',
  'get_browser_dimensions',
];

const EMBEDDED_COMMANDS = [
  'open_embedded_surface',
  'move_browser_surface',
  'set_embedded_surface_visibility',
  'get_embedded_surface_url',
  'execute_on_embedded_surface',
  'inspect_embedded_surface',
  'navigate_embedded_surface',
  'reload_embedded_surface',
  'close_embedded_surface',
];

const WINDOW_COMMANDS = [
  'open_browser_window',
  'show_browser_window',
  'close_browser_window',
  'execute_agent_task',
  'open_devtools',
  'get_browser_url',
  'inject_script',
  'is_agent_busy',
  'browser_go_back',
  'inspect_browser_state',
  'browser_navigate',
  'browser_reload',
  'set_embedded_mode',
  'get_embedded_mode',
  'capture_screenshot',
  'get_browser_dimensions',
];

function commandNames(src: string) {
  return [...src.matchAll(/#\[tauri::command\]\s*pub async fn\s+(\w+)/g)].map((m) => m[1] ?? '');
}

function commandSignatures(src: string) {
  return [...src.matchAll(/#\[tauri::command\]\s*pub async fn\s+\w+/g)]
    .map((m) => {
      const start = m.index ?? 0;
      const bodyStart = src.indexOf('{', start);
      return src.slice(start, bodyStart);
    })
    .join('\n');
}

function proxySource(src: string) {
  const start = src.lastIndexOf('/// Proxy HTTP requests through the backend');
  const fn = src.indexOf('pub async fn proxy_http_request', start);
  const end = src.indexOf('\n}\n', fn);
  return src.slice(start, end + 2);
}

describe('AG-28 browser command body-extract guards', () => {
  it('browser.rs and each static child file are below 500 LOC', () => {
    for (const file of [BROWSER_RS, EMBEDDED_RS, WINDOW_RS, STATE_RS]) {
      expect(loc(file)).toBeLessThan(500);
    }
  });

  it('keeps all Tauri command names and signatures at the original browser module path', () => {
    const src = read(BROWSER_RS);
    expect(commandNames(src)).toEqual(COMMANDS);
    expect(hash(commandSignatures(src))).toBe('2df6efef907fb14ed21ee08a8853f0a0528eb7e691ac28ec9c622caa64dbae2a');
    expect(src).toContain('mod state;');
    expect(src).toContain('#[macro_use]\nmod embedded_surface;');
    expect(src).toContain('#[macro_use]\nmod window;');
    expect(src).toContain('pub use state::{ActiveSurface, BrowserState};');
  });

  it('expands all extracted command bodies inline and retains the proxy verbatim', () => {
    const src = read(BROWSER_RS);
    const embedded = read(EMBEDDED_RS);
    const window = read(WINDOW_RS);
    for (const name of EMBEDDED_COMMANDS) {
      expect(src).toContain(`${name}_body!(`);
      expect(embedded).toContain(`macro_rules! ${name}_body`);
    }
    for (const name of WINDOW_COMMANDS) {
      expect(src).toContain(`${name}_body!(`);
      expect(window).toContain(`macro_rules! ${name}_body`);
    }
    expect(window).not.toContain('macro_rules! proxy_http_request_body');
    expect(hash(proxySource(src))).toBe('bcc664b9df4bde90d9b632f8ccc36383ee61f59c12c25ba74374daa3442b7738');
  });

  it('preserves the total await count across browser.rs and its extracted modules', () => {
    const sources = [BROWSER_RS, EMBEDDED_RS, WINDOW_RS, STATE_RS].map(read);
    const awaits = sources.reduce((count, src) => count + (src.match(/\.await\b/g) ?? []).length, 0);
    expect(awaits).toBe(33);
  });
});
