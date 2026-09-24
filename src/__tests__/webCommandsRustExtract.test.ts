/**
 * AG-10: source guards for the mechanical extract of
 * `src-tauri/src/commands/web.rs` shared action helpers into
 * `src-tauri/src/commands/web/action_helpers.rs`.
 *
 * Keeps both files under the 500 LOC split-soon threshold and asserts every
 * `commands::web::*` handler registered in lib.rs still resolves to a
 * `#[tauri::command] pub async fn` defined directly in web.rs.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loc = (rel: string) => {
  const src = read(rel);
  return src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
};

const WEB_RS = 'src-tauri/src/commands/web.rs';
const HELPERS_RS = 'src-tauri/src/commands/web/action_helpers.rs';
const LIB_RS = 'src-tauri/src/lib.rs';

const commandNames = (src: string) =>
  [...src.matchAll(/#\[tauri::command\]\s*pub async fn (\w+)/g)].map((m) => m[1]);

describe('AG-10 web.rs extract guards', () => {
  it('web.rs and action_helpers.rs are under 500 LOC', () => {
    expect(loc(WEB_RS)).toBeLessThan(500);
    expect(loc(HELPERS_RS)).toBeLessThan(500);
  });

  it('declares the helper module and imports the moved helpers privately', () => {
    const web = read(WEB_RS);
    expect(web).toMatch(/^mod action_helpers;$/m);
    for (const helper of [
      'clone_manager_handle',
      'action_context',
      'action_result',
      'navigate_and_wait_with_ctx',
      'browser_wait_with_ctx',
      'browser_click_with_ctx',
      'browser_type_with_ctx',
    ]) {
      expect(web).not.toMatch(new RegExp(`fn ${helper}\\b`));
      expect(read(HELPERS_RS)).toMatch(new RegExp(`pub\\(super\\) (async )?fn ${helper}\\b`));
    }
  });

  it('keeps every tauri command in web.rs (none moved into the helper module)', () => {
    const web = commandNames(read(WEB_RS));
    expect(web).toHaveLength(34);
    expect(web).toEqual(expect.arrayContaining(['connect_browser', 'cdp_execute_script', 'web_search', 'web_fetch']));
    expect(read(HELPERS_RS)).not.toContain('#[tauri::command]');
  });

  it('every commands::web::* handler in lib.rs resolves to a command in web.rs', () => {
    const registered = [...read(LIB_RS).matchAll(/commands::web::(\w+),/g)].map((m) => m[1]);
    expect(registered.length).toBeGreaterThan(0);
    const defined = new Set(commandNames(read(WEB_RS)));
    for (const name of registered) {
      expect(defined.has(name)).toBe(true);
    }
  });
});
