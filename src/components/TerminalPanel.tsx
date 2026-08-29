/**
 * TerminalPanel — Embedded interactive PTY terminal
 *
 * A minimal, clean terminal that visually matches the app's monochrome palette
 * (black sidebar / black primary buttons, white content). Opening and closing
 * the terminal always produces a fresh session (no stale output).
 *
 * Architecture:
 * - xterm.js renders the UI
 * - portable-pty (Rust) drives a real shell via `terminal_create/input/resize/close`
 * - Output streams back via the `terminal-output` / `terminal-exit` events
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';
import { t } from '@/i18n';
import { useSettingsStore } from '@/store';
import {
  convertWindowsPathToWsl,
  detectPathKind,
  formatShellProfileLabel,
  resolveWindowsShellProfile,
} from '@/utils/windowsShellProfile';

/** Monochrome theme matching the app's palette (black accents, light surfaces). */
const TERMINAL_THEME = {
  background: '#0a0a0a',
  foreground: '#e8e8e8',
  cursor: '#ffffff',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#3a3a3a',
  selectionForeground: '#ffffff',
  black: '#0a0a0a',
  red: '#ff6b6b',
  green: '#51cf66',
  yellow: '#fcc419',
  blue: '#74c0fc',
  magenta: '#e599f7',
  cyan: '#66d9e8',
  white: '#e8e8e8',
  brightBlack: '#868e96',
  brightRed: '#ff8787',
  brightGreen: '#69db7c',
  brightYellow: '#ffd43b',
  brightBlue: '#91a7ff',
  brightMagenta: '#eebefa',
  brightCyan: '#99e9f2',
  brightWhite: '#ffffff',
};

interface TerminalPanelProps {
  /** Working directory for the spawned shell. */
  cwd?: string;
  /** Optional stable session id. */
  sessionId?: string;
  /** Invoked when the user closes the terminal. */
  onClose?: () => void;
  /** Invoked when the PTY is ready to accept input. */
  onSessionReady?: (sessionId: string) => void;
  /** Invoked when the PTY exits. */
  onSessionExit?: (sessionId: string) => void;
}

/** Truncate a long path so only the final segments are displayed. */
function shortenPath(path: string, maxLen = 48): string {
  if (path.length <= maxLen) return path;
  const parts = path.split('/');
  const tail = parts.slice(-2).join('/');
  return `…/${tail}`;
}

export function TerminalPanel({
  cwd,
  sessionId: externalSessionId,
  onClose,
  onSessionReady,
  onSessionExit,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'exited' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);
  const shellResolution = resolveWindowsShellProfile(windowsShellProfile, cwd);
  const shellLabel = formatShellProfileLabel(shellResolution);
  const cwdPathKind = detectPathKind(cwd);
  const shellBanner = shellResolution.isWindows && shellResolution.resolved === 'wsl' && cwdPathKind === 'windows'
    ? {
      tone: 'warning' as const,
      message: t('terminal.shell.wslMixedPathWarning'),
    }
    : null;
  const shellInlineHint = shellResolution.isWindows && shellResolution.resolved === 'wsl' && cwdPathKind === 'wsl'
    ? t('terminal.shell.wslReady')
    : null;

  const buildCwdCommand = useCallback((target: string): string => {
    if (!shellResolution.isWindows || shellResolution.resolved === 'default') {
      const escaped = target.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `cd "${escaped}" && clear\r`;
    }
    if (shellResolution.resolved === 'powershell') {
      const escaped = target.replace(/'/g, "''");
      return `Set-Location -LiteralPath '${escaped}'\r\nClear-Host\r`;
    }
    const wslPath = convertWindowsPathToWsl(target) ?? target;
    const escaped = wslPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `cd "${escaped}" && clear\r`;
  }, [shellResolution]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sessionId = externalSessionId || crypto.randomUUID();
    let disposed = false;

    setStatus('connecting');
    setErrorMessage(null);

    const terminal = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: 10_000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    const safeFit = () => {
      try {
        const dims = fitAddon.proposeDimensions();
        if (dims && dims.rows > 0 && dims.cols > 0) {
          fitAddon.fit();
          return dims;
        }
      } catch { /* ignore */ }
      return null;
    };

    const waitForVisibleSize = (): Promise<void> => new Promise((resolve) => {
      if (container.clientWidth > 8 && container.clientHeight > 8) {
        resolve();
        return;
      }
      const observer = new ResizeObserver(() => {
        if (container.clientWidth > 8 && container.clientHeight > 8) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(container);
      window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 800);
    });

    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let cwdSetupTimeoutId: ReturnType<typeof setTimeout> | null = null;

    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        return false;
      }
      return true;
    });

    const onDataDisposable = terminal.onData((data) => {
      invoke('terminal_input', { sessionId, data }).catch(() => {});
    });
    const onResizeDisposable = terminal.onResize(({ rows, cols }) => {
      invoke('terminal_resize', { sessionId, rows, cols }).catch(() => {});
    });

    // Wait until the panel is actually laid out. Opening xterm inside
    // `display:none` / 0-height leaves a black PTY that never echoes.
    (async () => {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise<void>((resolve) => window.setTimeout(resolve, 250)),
        ]);
        if (disposed) return;

        await waitForVisibleSize();
        if (disposed) return;

        terminal.open(container);
        await nextFrame();
        if (disposed) return;

        safeFit();

        unlistenOutput = await listen<{ session_id: string; data: string }>(
          'terminal-output',
          (event) => {
            if (disposed) return;
            if (event.payload.session_id !== sessionId) return;
            terminal.write(event.payload.data);
          }
        );

        unlistenExit = await listen<{ session_id: string; exit_code: number | null }>(
          'terminal-exit',
          (event) => {
            if (disposed) return;
            if (event.payload.session_id !== sessionId) return;
            terminal.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
            setStatus('exited');
            onSessionExit?.(sessionId);
          }
        );

        if (disposed) return;

        const dims = fitAddon.proposeDimensions();
        await invoke('terminal_create', {
          sessionId,
          cwd: cwd || null,
          rows: dims?.rows ?? 24,
          cols: dims?.cols ?? 80,
          shellProfile: windowsShellProfile,
        });

        if (disposed) {
          invoke('terminal_close', { sessionId }).catch(() => {});
          return;
        }

        setStatus('ready');
        onSessionReady?.(sessionId);
        safeFit();
        terminal.focus();

        if (cwd && !disposed) {
          cwdSetupTimeoutId = setTimeout(() => {
            if (!disposed) {
              const cmd = buildCwdCommand(cwd);
              invoke('terminal_input', { sessionId, data: cmd }).catch(() => {});
            }
            cwdSetupTimeoutId = null;
          }, 350);
        }
      } catch (err) {
        if (disposed) return;
        const msg = typeof err === 'string' ? err : String(err);
        setStatus('error');
        setErrorMessage(msg);
        terminal.write(`\x1b[31m${msg}\x1b[0m\r\n`);
      }
    })();

    // Refit on container / window resize
    const resizeObserver = new ResizeObserver(() => safeFit());
    resizeObserver.observe(container);
    const onWindowResize = () => safeFit();
    window.addEventListener('resize', onWindowResize);

    return () => {
      disposed = true;
      if (cwdSetupTimeoutId) {
        clearTimeout(cwdSetupTimeoutId);
        cwdSetupTimeoutId = null;
      }
      window.removeEventListener('resize', onWindowResize);
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      resizeObserver.disconnect();
      unlistenOutput?.();
      unlistenExit?.();
      invoke('terminal_close', { sessionId }).catch(() => {});
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cwd, externalSessionId, onSessionExit, onSessionReady, buildCwdCommand, windowsShellProfile]);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const handleCopy = useCallback(() => {
    if (!terminalRef.current) return;
    terminalRef.current.selectAll();
    const selection = terminalRef.current.getSelection();
    if (selection) {
      void navigator.clipboard.writeText(selection);
      terminalRef.current.clearSelection();
    }
  }, []);

  const statusLabel =
    status === 'connecting'
      ? 'Connecting'
      : status === 'ready'
      ? 'Active'
      : status === 'exited'
      ? 'Exited'
      : 'Error';

  const statusDotClass =
    status === 'ready'
      ? 'bg-green-500'
      : status === 'connecting'
      ? 'bg-gray-400 animate-pulse'
      : status === 'exited'
      ? 'bg-gray-400'
      : 'bg-red-500';

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 h-8 bg-black border-b border-white/5 select-none flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <svg
            className="w-3.5 h-3.5 text-white/70 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-[11px] font-semibold tracking-wide text-white/90 uppercase">
            Terminal
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`}
            title={statusLabel}
          />
          {cwd && (
            <span
              className="text-[11px] text-white/50 font-mono truncate ml-1"
              title={cwd}
            >
              {shortenPath(cwd)}
            </span>
          )}
          <span className="text-[11px] text-white/50 ml-2">
            {t('terminal.shell.activeProfile')}: {shellLabel}
          </span>
          {shellInlineHint && (
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
              {shellInlineHint}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 h-6 text-[11px] text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors flex items-center gap-1"
            title="Copy terminal content"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Copy</span>
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="px-2 h-6 text-[11px] text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors flex items-center gap-1"
            title="Clear terminal"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Clear</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2 h-6 text-[11px] text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors flex items-center gap-1"
              title="Close Terminal"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>Close</span>
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {status === 'error' && errorMessage && (
        <div className="px-3 py-1.5 bg-red-900/30 border-b border-red-500/30 text-[11px] text-red-200 flex-shrink-0">
          {errorMessage}
        </div>
      )}
      {shellBanner && (
        <div className="px-3 py-1.5 bg-amber-900/25 border-b border-amber-500/30 text-[11px] text-amber-200 flex-shrink-0">
          {shellBanner.message}
        </div>
      )}

      {/* Terminal body — no CSS padding on the xterm container itself;
           padding is on the outer wrapper so FitAddon measures correctly */}
      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{ padding: '4px 4px 0 6px' }}
        onClick={() => terminalRef.current?.focus()}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}

export default TerminalPanel;
