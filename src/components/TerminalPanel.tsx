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
  /** Invoked when the user closes the terminal. */
  onClose?: () => void;
}

/** Truncate a long path so only the final segments are displayed. */
function shortenPath(path: string, maxLen = 48): string {
  if (path.length <= maxLen) return path;
  const parts = path.split('/');
  const tail = parts.slice(-2).join('/');
  return `…/${tail}`;
}

export function TerminalPanel({ cwd, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'exited' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sessionId = crypto.randomUUID();
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

    // Helper: wait one animation frame (lets the browser finish layout)
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    // Helper: safe fit — guards against 0×0 container
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

    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    // Wire up user input / resize forwarding (safe to register before open)
    const onDataDisposable = terminal.onData((data) => {
      invoke('terminal_input', { sessionId, data }).catch(() => {});
    });
    const onResizeDisposable = terminal.onResize(({ rows, cols }) => {
      invoke('terminal_resize', { sessionId, rows, cols }).catch(() => {});
    });

    // ── Single sequential async flow ──
    // fonts.ready → open → frame → fit → listeners → create PTY
    // This strict ordering guarantees xterm measures the real font, not a fallback.
    (async () => {
      try {
        // 1. Wait for the terminal font to finish loading
        await document.fonts.ready;
        if (disposed) return;

        // 2. Attach xterm to the DOM (creates the hidden measurement span)
        terminal.open(container);

        // 3. Wait one frame so the browser completes layout / paint
        await nextFrame();
        if (disposed) return;

        // 4. Now measure & fit — font is loaded, DOM is laid out
        safeFit();

        // 5. Set up Tauri event listeners
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
          }
        );

        if (disposed) return;

        // 6. Spawn the PTY with the measured dimensions
        const dims = fitAddon.proposeDimensions();
        await invoke('terminal_create', {
          sessionId,
          cwd: cwd || null,
          rows: dims?.rows ?? 24,
          cols: dims?.cols ?? 80,
        });

        if (disposed) {
          invoke('terminal_close', { sessionId }).catch(() => {});
          return;
        }

        setStatus('ready');
        safeFit();
        terminal.focus();

        // Belt-and-suspenders: ensure we're in the right directory even if the
        // login shell's .zprofile / .zshrc happens to change the cwd.
        // We send `cd "<dir>" && clear` after a brief delay so the shell is
        // fully initialized. The `clear` keeps the terminal looking clean.
        if (cwd && !disposed) {
          const escapedCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          setTimeout(() => {
            if (!disposed) {
              invoke('terminal_input', { sessionId, data: `cd "${escapedCwd}" && clear\r` }).catch(() => {});
            }
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
  }, [cwd]);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
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
        </div>
        <div className="flex items-center gap-1">
          <button
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
