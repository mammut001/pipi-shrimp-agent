/**
 * AG-21: source guards for the mechanical extract of the Chrome
 * remote-debugging launch helpers out of
 * `src-tauri/src/commands/web/cdp.rs` into the child module
 * `src-tauri/src/commands/web/cdp/chrome_launch.rs`.
 *
 * Keeps both files under the 500 LOC watch line, asserts the moved helpers
 * live only in the new module, and that every CDP command body web.rs
 * delegates to (`cdp::<name>`) is still defined directly in cdp.rs.
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
const CDP_RS = 'src-tauri/src/commands/web/cdp.rs';
const LAUNCH_RS = 'src-tauri/src/commands/web/cdp/chrome_launch.rs';
const TESTS_RS = 'src-tauri/src/commands/web/tests.rs';

const MOVED = [
  'ChromeDebugLaunchOutcome',
  'chrome_debug_port_ready',
  'linux_chrome_debug_args',
  'ensure_chrome_debug_process',
];

describe('AG-21 web/cdp.rs extract guards', () => {
  it('cdp.rs and cdp/chrome_launch.rs are under 500 LOC', () => {
    expect(loc(CDP_RS)).toBeLessThan(500);
    expect(loc(LAUNCH_RS)).toBeLessThan(500);
  });

  it('declares the child module and imports the moved helpers with static uses', () => {
    const cdp = read(CDP_RS);
    expect(cdp).toMatch(/^mod chrome_launch;$/m);
    expect(cdp).toMatch(
      /^use chrome_launch::\{ensure_chrome_debug_process, ChromeDebugLaunchOutcome\};$/m,
    );
    // tests.rs reaches the Linux args builder via `super::cdp::linux_chrome_debug_args`.
    expect(cdp).toMatch(/#\[cfg\(test\)\]\npub\(super\) use chrome_launch::linux_chrome_debug_args;/);
    expect(read(TESTS_RS)).toContain('super::cdp::linux_chrome_debug_args(');
  });

  it('moved helpers are defined only in cdp/chrome_launch.rs', () => {
    const cdp = read(CDP_RS);
    const launch = read(LAUNCH_RS);
    expect(cdp).not.toMatch(/\benum ChromeDebugLaunchOutcome\b/);
    expect(launch).toMatch(/^pub\(super\) enum ChromeDebugLaunchOutcome \{$/m);
    expect(cdp).not.toMatch(/\bfn chrome_debug_port_ready\b/);
    expect(launch).toMatch(/^async fn chrome_debug_port_ready\(\) -> bool \{$/m);
    expect(cdp).not.toMatch(/\bfn linux_chrome_debug_args\b/);
    expect(launch).toMatch(
      /#\[cfg\(any\(test, not\(any\(target_os = "macos", target_os = "windows"\)\)\)\)\]\npub\(in crate::commands::web\) fn linux_chrome_debug_args\(/,
    );
    expect(cdp).not.toMatch(/\bfn ensure_chrome_debug_process\b/);
    expect(launch).toMatch(/^pub\(super\) async fn ensure_chrome_debug_process\($/m);
    for (const name of MOVED) {
      expect(launch).toContain(name);
    }
  });

  it('keeps launch error strings verbatim in the new module', () => {
    const launch = read(LAUNCH_RS);
    for (const message of [
      '启动 Chrome 失败: {}',
      '未找到 Chrome 或 Chromium，请确认已安装',
      '启动 {} 失败: {}',
      '未找到 Chrome/Chromium 浏览器，请确认已安装。',
      '启动 Chrome 成功，但调试端口未能就绪，连接超时。请确认未占用 9222 端口，或尝试手动启动。',
    ]) {
      expect(launch).toContain(message);
    }
  });

  it('neither cdp.rs nor the new module defines tauri commands', () => {
    const launch = read(LAUNCH_RS);
    expect(launch).not.toContain('#[tauri::command]');
    expect(read(CDP_RS)).not.toContain('#[tauri::command]');
  });

  it('every cdp::<fn> web.rs delegates to is still defined in cdp.rs', () => {
    const delegated = [...new Set([...read(WEB_RS).matchAll(/\bcdp::(\w+)\(/g)].map((m) => m[1]))];
    expect(delegated).toHaveLength(24);
    const cdp = read(CDP_RS);
    for (const name of delegated) {
      expect(cdp).toMatch(new RegExp(`^pub\\(super\\) async fn ${name}\\(`, 'm'));
    }
  });
});
