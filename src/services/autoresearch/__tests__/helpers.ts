import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SshConfig } from '@/store/autoresearchStore';

const execFileAsync = promisify(execFile);

type BashFlavor = 'git-bash' | 'wsl-bash';

function detectBashFlavor(bashPath: string): BashFlavor {
  const normalized = bashPath.toLowerCase();
  return normalized.includes('git\\bin\\bash.exe') || normalized.includes('git/bin/bash.exe')
    ? 'git-bash'
    : 'wsl-bash';
}

function toPosixPath(value: string, flavor: BashFlavor): string {
  const match = value.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) {
    return value.replace(/\\/g, '/');
  }

  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return flavor === 'git-bash'
    ? `/${drive}/${rest}`
    : `/mnt/${drive}/${rest}`;
}

function normalizeCommandForBash(command: string, flavor: BashFlavor): string {
  if (process.platform !== 'win32') {
    return command;
  }

  return command.replace(/[a-zA-Z]:[\\/][^'\r\n]*/g, (segment) => toPosixPath(segment, flavor));
}

async function findBash(): Promise<string> {
  if (process.platform !== 'win32') return 'bash';
  if (process.env.GIT_INSTALL_ROOT) {
    const candidate = path.join(process.env.GIT_INSTALL_ROOT, 'bin', 'bash.exe');
    try { await fs.access(candidate); return candidate; } catch {}
  }
  const cands = ['C:\\Program Files\\Git\\bin\\bash.exe','C:\\Program Files (x86)\\Git\\bin\\bash.exe'];
  for (const cd of cands) { try { await fs.access(cd); return cd; } catch {} }
  try {
    const { stdout } = await execFileAsync('git', ['--exec-path'], { encoding: 'utf8' });
    const bp = path.join(path.dirname(stdout.trim()), '..', 'bin', 'bash.exe');
    try { await fs.access(bp); return bp; } catch {}
  } catch {}
  return 'bash';
}

function shouldUseWslForTests(windowsShellProfile: unknown): boolean {
  if (process.env.JEST_WORKER_ID) {
    return windowsShellProfile === 'wsl';
  }
  return windowsShellProfile === 'wsl' || windowsShellProfile === 'auto' || windowsShellProfile == null;
}

async function runLocalShellCommand(
  command: string,
  cwd: string | undefined,
  windowsShellProfile: unknown,
): Promise<{ stdout: string; stderr: string }> {
  if (
    process.platform === 'win32'
    && shouldUseWslForTests(windowsShellProfile)
  ) {
    const effectiveCommand = cwd
      ? `cd ${JSON.stringify(toPosixPath(cwd, 'wsl-bash'))}\n${normalizeCommandForBash(command, 'wsl-bash')}`
      : normalizeCommandForBash(command, 'wsl-bash');
    try {
      const { stdout, stderr } = await execFileAsync(
        'wsl.exe',
        ['--', 'bash', '-lc', effectiveCommand],
        {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      return {
        stdout,
        stderr,
      };
    } catch (error) {
      const execError = error as Error & { stderr?: string; stdout?: string };
      const combined = `${execError.stderr ?? ''}\n${execError.stdout ?? ''}\n${execError.message}`;
      const wslUnavailable = /Wsl\/Service\/E_UNEXPECTED|Catastrophic failure/i.test(combined);
      if (!wslUnavailable) {
        throw error;
      }
      // WSL service is down on this machine — fall back to Git Bash so CI/local Jest stays green.
    }
  }

  const bashPath = await findBash();
  const bashFlavor = detectBashFlavor(bashPath);
  const { stdout, stderr } = await execFileAsync(
    bashPath,
    ['-lc', normalizeCommandForBash(command, bashFlavor)],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      cwd,
    },
  );
  return {
    stdout,
    stderr,
  };
}



export function createLocalSshConfig(workDir: string): SshConfig {
  return {
    mode: 'local',
    host: '',
    user: '',
    keyPath: '',
    port: 22,
    remoteWorkDir: workDir,
    authMode: 'agent',
    password: '',
  };
}

export async function initGitRepo(
  workDir: string,
  files: Record<string, string> = { 'train.py': 'print("train")\n' },
): Promise<void> {
  await fs.mkdir(workDir, { recursive: true });
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const fullPath = path.join(workDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }));

  await execFileAsync('git', ['init'], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.name', 'Pipi Shrimp Test'], { cwd: workDir });
  await execFileAsync('git', ['add', '.'], { cwd: workDir });
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: workDir });
}

export function installLocalInvokeMock(mockInvoke: jest.Mock): void {
  mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case 'execute_bash': {
        const payload = (args.args as Record<string, unknown> | undefined) ?? args;
        try {
          const cwd = typeof payload.workDir === 'string' && payload.workDir.trim().length > 0
            ? String(payload.workDir)
            : undefined;
          const { stdout, stderr } = await runLocalShellCommand(
            String(payload.command ?? ''),
            cwd,
            payload.windowsShellProfile,
          );
          return {
            stdout,
            stderr,
            exit_code: 0,
          };
        } catch (error) {
          const execError = error as Error & {
            stdout?: string;
            stderr?: string;
            code?: number;
          };
          return {
            stdout: execError.stdout ?? '',
            stderr: execError.stderr ?? execError.message,
            exit_code: execError.code ?? 1,
          };
        }
      }
      case 'read_file': {
        const filePath = String(args.path ?? '');
        const content = await fs.readFile(filePath, 'utf8');
        return { content, path: filePath };
      }
      case 'write_file': {
        const filePath = String(args.path ?? '');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, String(args.content ?? ''), 'utf8');
        return 'File written successfully';
      }
      case 'path_exists': {
        const filePath = String(args.path ?? '');
        try {
          await fs.access(filePath);
          return true;
        } catch {
          return false;
        }
      }
      case 'create_directory': {
        const filePath = String(args.path ?? '');
        await fs.mkdir(filePath, { recursive: true });
        return 'Directory created successfully';
      }
      default:
        throw new Error(`Unexpected invoke command in test: ${command}`);
    }
  });
}
