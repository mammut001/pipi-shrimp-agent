import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SshConfig } from '@/store/autoresearchStore';

const execFileAsync = promisify(execFile);

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
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workDir });
}

export function installLocalInvokeMock(mockInvoke: jest.Mock): void {
  mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case 'execute_bash': {
        const payload = (args.args as Record<string, unknown> | undefined) ?? args;
        try {
          const { stdout, stderr } = await execFileAsync('/bin/bash', ['-lc', String(payload.command ?? '')], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
          });
          return { stdout, stderr, exit_code: 0 };
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
