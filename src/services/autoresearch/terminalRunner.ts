import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { buildRemoteBashCommand, shellEscape, shellEscapePath } from '@/utils/remoteExec';
import { readTargetText, type RunDir } from './runDir';

const TERMINAL_READY_TIMEOUT_MS = 15_000;
const TERMINAL_EXIT_MARKER = '__PIPI_AUTORESEARCH_EXIT__';

export interface TerminalRunOptions {
  cfg: SshConfig;
  cmd: string;
  cwd?: string;
  logsDir: string;
  timeoutSecs?: number;
  label?: string;
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface TerminalRunResult {
  exitCode: number;
  stdoutPath: string;
  stderrPath: string;
  combinedPath: string;
  durationMs: number;
}

let currentRunDir: RunDir | null = null;

export function setCurrentRunDir(runDir: RunDir | null): void {
  currentRunDir = runDir;
}

export function getCurrentRunDir(): RunDir | null {
  return currentRunDir;
}

export function clearCurrentRunDir(): void {
  currentRunDir = null;
}

function normalizeTerminalCwd(cfg: SshConfig, cwd?: string): string {
  if (cfg.mode !== 'local') {
    return '';
  }
  return cwd || cfg.remoteWorkDir;
}

function buildTargetLoggedCommand(
  command: string,
  logsDir: string,
  timeoutSecs: number | undefined,
  label: string | undefined,
  token: string,
): string {
  const stdoutPath = `${logsDir}/stdout.log`;
  const stderrPath = `${logsDir}/stderr.log`;
  const combinedPath = `${logsDir}/combined.log`;
  const bashCommand = timeoutSecs && timeoutSecs > 0
    ? [
        `if command -v timeout >/dev/null 2>&1; then`,
        `  timeout ${Math.max(1, Math.floor(timeoutSecs))} bash -lc ${shellEscape(command)}`,
        `elif command -v gtimeout >/dev/null 2>&1; then`,
        `  gtimeout ${Math.max(1, Math.floor(timeoutSecs))} bash -lc ${shellEscape(command)}`,
        `else`,
        `  bash -lc ${shellEscape(command)}`,
        `fi`,
      ].join('\n')
    : `bash -lc ${shellEscape(command)}`;

  return [
    `mkdir -p ${shellEscapePath(logsDir)}`,
    `: > ${shellEscapePath(stdoutPath)}`,
    `: > ${shellEscapePath(stderrPath)}`,
    `: > ${shellEscapePath(combinedPath)}`,
    label ? `printf '%s\n' ${shellEscape(`[AutoResearch] ${label}`)}` : '',
    `{ ${bashCommand}; } > >(tee ${shellEscapePath(stdoutPath)} >> ${shellEscapePath(combinedPath)}) 2> >(tee ${shellEscapePath(stderrPath)} >> ${shellEscapePath(combinedPath)} >&2)`,
    '__ps_exit=$?',
    `printf '\\n${TERMINAL_EXIT_MARKER}:${token}:%s\\n' "$__ps_exit"`,
    'exit $__ps_exit',
  ].filter(Boolean).join('\n');
}

function waitForTerminalReady(sessionId: string): Promise<void> {
  const state = useAutoResearchStore.getState();
  if (state.terminalSessionId === sessionId && state.terminalReady) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for AutoResearch terminal'));
    }, TERMINAL_READY_TIMEOUT_MS);

    const unsubscribe = useAutoResearchStore.subscribe((nextState) => {
      if (nextState.terminalSessionId === sessionId && nextState.terminalReady) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export async function ensureAutoResearchTerminal(cfg: SshConfig, cwd?: string): Promise<string> {
  const store = useAutoResearchStore.getState();
  const existingSessionId = store.terminalSessionId;
  if (existingSessionId) {
    useAutoResearchStore.getState().setTerminalVisible(true);
    await waitForTerminalReady(existingSessionId);
    return existingSessionId;
  }

  const sessionId = `autoresearch-terminal-${Date.now()}`;
  useAutoResearchStore.getState().openTerminalPanel(sessionId, normalizeTerminalCwd(cfg, cwd));
  await waitForTerminalReady(sessionId);
  return sessionId;
}

function readBufferedLines(buffer: string): { lines: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  const remainder = parts.pop() ?? '';
  return { lines: parts, remainder };
}

export async function runInTerminal(opts: TerminalRunOptions): Promise<TerminalRunResult> {
  const sessionId = await ensureAutoResearchTerminal(opts.cfg, opts.cwd);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const stdoutPath = `${opts.logsDir}/stdout.log`;
  const stderrPath = `${opts.logsDir}/stderr.log`;
  const combinedPath = `${opts.logsDir}/combined.log`;
  const targetScript = buildTargetLoggedCommand(opts.cmd, opts.logsDir, opts.timeoutSecs, opts.label, token);
  const fullCommand = buildRemoteBashCommand(
    {
      ...opts.cfg,
      remoteWorkDir: opts.cwd ?? opts.cfg.remoteWorkDir,
    },
    `bash -lc ${shellEscape(targetScript)}`,
  );

  const startedAt = Date.now();

  return new Promise<TerminalRunResult>((resolve, reject) => {
    let pending = '';
    let settled = false;

    void (async () => {
      const unlisten = await listen<{ session_id: string; data: string }>('terminal-output', async (event) => {
        if (event.payload.session_id !== sessionId || settled) {
          return;
        }

        try {
          pending += event.payload.data;

          const markerIndex = pending.indexOf(`${TERMINAL_EXIT_MARKER}:${token}:`);
          if (markerIndex >= 0) {
            const beforeMarker = pending.slice(0, markerIndex);
            const markerTail = pending.slice(markerIndex);
            const exitMatch = markerTail.match(new RegExp(`${TERMINAL_EXIT_MARKER}:${token}:(\\d+)`));
            const { lines } = readBufferedLines(beforeMarker);
            for (const line of lines) {
              opts.onLine?.(line, 'stdout');
            }

            if (!exitMatch) {
              return;
            }

            settled = true;
            unlisten();

            await Promise.all([
              readTargetText(opts.cfg, stdoutPath),
              readTargetText(opts.cfg, stderrPath),
            ]);

            resolve({
              exitCode: Number.parseInt(exitMatch[1], 10),
              stdoutPath,
              stderrPath,
              combinedPath,
              durationMs: Date.now() - startedAt,
            });
            return;
          }

          const { lines, remainder } = readBufferedLines(pending);
          pending = remainder;
          for (const line of lines) {
            opts.onLine?.(line, 'stdout');
          }
        } catch (error) {
          settled = true;
          unlisten();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      try {
        await invoke('terminal_input', {
          sessionId,
          data: `${fullCommand}\r`,
        });
      } catch (error) {
        settled = true;
        unlisten();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}
