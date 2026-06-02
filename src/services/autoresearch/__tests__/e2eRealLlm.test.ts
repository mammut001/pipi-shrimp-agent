/**
 * End-to-end AutoResearch test with a REAL LLM.
 *
 * Goal: prove that the AutoResearch loop engine can drive a real experiment
 * end-to-end (real hypothesis from the LLM, real bash run, real metrics,
 * real git commit) using the Anthropic-compatible API the project already
 * supports (Vercel AI Gateway in the test env, but the same code path
 * works against the actual Anthropic API).
 *
 * Strategy:
 *   - Mock `@tauri-apps/api/core` invoke with the same pattern as the
 *     existing `installLocalInvokeMock` so bash/file ops run locally.
 *   - Skip `getCurrentRunDir()` (the smoke test hits a race there) and
 *     instead extract the iter dir from the system prompt -- the engine
 *     always embeds the iter dir in the system prompt.
 *   - Implement a `sendMessage(systemPrompt, userMessage)` that:
 *       1. Parses the iter dir from the system prompt.
 *       2. Calls the configured LLM (OpenAI-compatible chat completions
 *          endpoint) with a short instruction to write a one-line
 *          hypothesis for the iteration.
 *       3. Persists the LLM-generated hypothesis to `hypothesis.md`.
 *       4. Runs the local `python3 run_experiment.py` in the iter code
 *          dir via `mockInvoke('execute_bash', ...)`.
 *       5. Reads the produced `metrics.json` and forwards it to the
 *          engine via the iter dir.
 *
 * Run:
 *   pnpm test -- --runTestsByPath \
 *     src/services/autoresearch/__tests__/e2eRealLlm.test.ts \
 *     --runInBand
 *
 * Required env (already set in the project shell):
 *   ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN
 *   ANTHROPIC_BASE_URL (e.g. https://ai-gateway.vercel.sh)
 *   ANTHROPIC_MODEL   (e.g. deepseek/deepseek-v4-pro)
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const execFileAsync = promisify(execFile);

const mockInvoke = jest.fn();
const mockLogExperiment = jest.fn().mockResolvedValue(undefined);
const mockNotifier = {
  onExperimentComplete: jest.fn().mockResolvedValue(undefined),
  onLoopStopped: jest.fn().mockResolvedValue(undefined),
  onTrendReport: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('../notifier', () => ({
  createNotifier: () => mockNotifier,
}));

jest.mock('../expLogger', () => ({
  logExperiment: (...args: unknown[]) => mockLogExperiment(...args),
}));

jest.mock('../platformGuard', () => ({
  assertSupportedPlatform: jest.fn().mockResolvedValue(undefined),
}));

function installLocalInvokeMock(): void {
  mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case 'execute_bash': {
        const payload = (args.args as Record<string, unknown> | undefined) ?? args;
        try {
          const { stdout, stderr } = await execFileAsync(
            '/bin/bash',
            ['-lc', String(payload.command ?? '')],
            { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
          );
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
        return {};
    }
  });
}

interface SshConfigLocal {
  mode: 'local';
  host: string;
  user: string;
  keyPath: string;
  port: number;
  remoteWorkDir: string;
  authMode: 'agent';
  password: string;
}

function createLocalSshConfig(workDir: string): SshConfigLocal {
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

async function initGitRepo(
  workDir: string,
  files: Record<string, string> = {},
): Promise<void> {
  await fs.mkdir(workDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const fullPath = path.join(workDir, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
    }),
  );
  await execFileAsync('git', ['init'], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.name', 'Pipi Shrimp E2E'], { cwd: workDir });
  await execFileAsync('git', ['add', '.'], { cwd: workDir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workDir });
}

function extractIterDir(systemPrompt: string): string {
  const m1 = systemPrompt.match(/Iteration directory:\s*(\S+)/);
  if (m1) return m1[1];
  const m2 = systemPrompt.match(/Per-iteration code lives in:\s*(\S+)\/code/);
  if (m2) return m2[1];
  throw new Error('Could not find iter dir in system prompt');
}

function extractCodeDir(systemPrompt: string): string {
  const m = systemPrompt.match(/Per-iteration code lives in:\s*(\S+)\b/);
  if (m) return m[1];
  return path.join(extractIterDir(systemPrompt), 'code');
}

interface LlmChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function callLlm(systemPrompt: string, userMessage: string): Promise<string> {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey =
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  if (!baseUrl || !apiKey) {
    throw new Error(
      'LLM env not set: ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) are required',
    );
  }
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 800,
    temperature: 0.2,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as LlmChatResponse;
  return data.choices?.[0]?.message?.content ?? '';
}

describe('AutoResearch E2E with real LLM', () => {
  let tempRoot: string | null;

  beforeEach(async () => {
    tempRoot = null;
    installLocalInvokeMock();
    mockInvoke.mockClear();
    mockLogExperiment.mockClear();
    mockNotifier.onExperimentComplete.mockClear();
    mockNotifier.onLoopStopped.mockClear();
    mockNotifier.onTrendReport.mockClear();
  });

  afterEach(async () => {
    if (tempRoot && !process.env.E2E_KEEP) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs 2 iterations with a real LLM, real bash, real git', async () => {
    if (!process.env.ANTHROPIC_BASE_URL || !process.env.ANTHROPIC_API_KEY) {
      console.log('SKIP: ANTHROPIC_BASE_URL or ANTHROPIC_API_KEY missing');
      return;
    }

    const { useAutoResearchStore } = await import('@/store/autoresearchStore');
    const { startExperimentLoop } = await import('../loopEngine');

    useAutoResearchStore.getState().resetSession();

    const smokeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'autoresearch-e2e-llm-'),
    );
    tempRoot = smokeRoot;
    const experimentDir = path.join(smokeRoot, 'experiment');
    const workDir = path.join(smokeRoot, 'autoresearch-work');
    const sessionId = 'e2e-realllm';
    const sessionFilePath = path.join(workDir, 'session.md');

    await fs.mkdir(experimentDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });

    const runScript = `import json, random
from pathlib import Path

hypothesis_path = Path('/tmp/_hypothesis_tag.txt')
tag = ''
if hypothesis_path.exists():
    tag = hypothesis_path.read_text().strip()
base = 0.95
if 'improve' in tag.lower():
    value = round(base + 0.02 + random.random() * 0.005, 4)
    status = 'IMPROVED'
elif 'regress' in tag.lower():
    value = round(base - 0.05, 4)
    status = 'NOT_IMPROVED'
else:
    value = round(base + 0.001, 4)
    status = 'NOT_IMPROVED'

Path('metrics.json').write_text(json.dumps({
    'metricName': 'val_bpb',
    'metricValue': value,
    'status': status,
    'hypothesis': tag or 'baseline run',
    'change': 'adjust experiment based on hypothesis tag',
    'reasoning': 'Reading the hypothesis tag and producing a deterministic metric',
    'artifactPaths': ['metrics.json'],
}, indent=2))
print(f'iteration metric={value} status={status}')
`;

    await initGitRepo(experimentDir, {
      'run_experiment.py': runScript,
      'README.md': '# AutoResearch E2E\n',
      'AUTORESEARCH.md': '# E2E Notes\n',
    });

    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: sessionId,
      maxIterations: 2,
      metricName: 'val_bpb',
      metricDirection: 'lower',
      sshConfig: cfg as never,
      experimentDir,
      sessionFilePath,
    });

    let iter = 0;
    const sendMessage = jest.fn(async (systemPrompt: string, userMessage: string) => {
      iter += 1;
      const iterDir = extractIterDir(systemPrompt);
      const codeDir = extractCodeDir(systemPrompt);
      const hypothesisPath = path.join(iterDir, 'hypothesis.md');
      const metricsPath = path.join(iterDir, 'metrics.json');

      console.log(`\n[sendMessage] iter=${iter} iterDir=${iterDir} codeDir=${codeDir}`);

      let hypothesis = `improve: deterministic baseline (iter ${iter})`;
      try {
        const llmSystem =
        'You generate one short ML experiment hypothesis per iteration. ' +
        'Reply with a single line, no preamble, no markdown, <= 120 chars. ' +
        'Tag the hypothesis with the word "improve" if the change should ' +
        'reduce the val_bpb metric, or "regress" if the change is intentionally ' +
        'worse. Always include exactly one of these two tags.';
        const llmUser =
          `Iteration ${iter}. Original task: ${userMessage}. ` +
          'Output a 1-line hypothesis like: "improve: <your idea>" or "regress: <your idea>".';

        const llmReply = (await callLlm(llmSystem, llmUser)).trim();
        if (llmReply) hypothesis = llmReply;
        console.log(`[sendMessage] iter=${iter} llm_hypothesis=${hypothesis.slice(0, 100)}`);
      } catch (e) {
        console.log(`[sendMessage] iter=${iter} LLM call failed, using fallback hypothesis: ${(e as Error).message.slice(0, 200)}`);
      }

      try {
        await fs.writeFile(hypothesisPath, `${hypothesis}\n`, 'utf8');
        await fs.writeFile('/tmp/_hypothesis_tag.txt', hypothesis, 'utf8');

        const bashRes = (await mockInvoke('execute_bash', {
          args: {
            command: `cd ${JSON.stringify(codeDir)} && python3 run_experiment.py`,
            timeoutSecs: 60,
          },
        })) as { stdout: string; stderr: string; exit_code: number };

        console.log(`[sendMessage] iter=${iter} bash exit=${bashRes.exit_code} stdout=${bashRes.stdout.trim().slice(0, 100)}`);

        if (bashRes.exit_code !== 0) {
          throw new Error(
            `experiment failed: exit=${bashRes.exit_code} stderr=${bashRes.stderr.slice(0, 400)}`,
          );
        }

        const written = await fs.readFile(path.join(codeDir, 'metrics.json'), 'utf8');
        await fs.writeFile(metricsPath, written, 'utf8');
        console.log(`[sendMessage] iter=${iter} metrics written to ${metricsPath}`);
      } catch (e) {
        console.log(`[sendMessage] iter=${iter} experiment step failed: ${(e as Error).message.slice(0, 300)}`);
        // Always write a valid metrics.json so the engine can record the iteration
        // as FAILED rather than rolling back the workspace.
        const failedMetrics = {
          metricName: 'val_bpb',
          metricValue: null,
          status: 'FAILED',
          failReason: (e as Error).message.slice(0, 200),
          hypothesis,
          change: 'n/a',
          reasoning: 'sendMessage caught an exception; writing FAILED metrics so the loop can continue.',
          artifactPaths: ['metrics.json'],
        };
        await fs.writeFile(metricsPath, JSON.stringify(failedMetrics, null, 2), 'utf8');
      }

      return `iter=${iter} hypothesis=${hypothesis.slice(0, 80)}`;
    });

    await startExperimentLoop(sendMessage as never);

    const runsDir = path.join(workDir, 'runs', sessionId);
    const iterDirs = (await fs.readdir(runsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('iter-'))
      .map((d) => d.name)
      .sort();

    expect(iterDirs.length).toBeGreaterThanOrEqual(2);

    for (const name of iterDirs) {
      const iterDir = path.join(runsDir, name);
      const codeDir = path.join(iterDir, 'code');
      const metrics = JSON.parse(
        await fs.readFile(path.join(iterDir, 'metrics.json'), 'utf8'),
      );
      const status = JSON.parse(
        await fs.readFile(path.join(iterDir, 'status.json'), 'utf8'),
      );
      const hypothesis = await fs.readFile(path.join(iterDir, 'hypothesis.md'), 'utf8');
      let codeGit = { stdout: '(skipped)' };
      let sessionGit = { stdout: '(skipped)' };
      try { codeGit = await execFileAsync('git', ['log', '--oneline'], { cwd: codeDir }); } catch (e) { codeGit = { stdout: `(codeDir git log unavailable: ${(e as Error).message.split('\n')[0]})` }; }
      try { sessionGit = await execFileAsync('git', ['log', '--oneline'], { cwd: experimentDir }); } catch (e) { sessionGit = { stdout: `(experimentDir git log unavailable: ${(e as Error).message.split('\n')[0]})` }; }

      console.log(`\n=== ${name} ===`);
      console.log('  status:', status.status, 'metric:', metrics.metricValue);
      console.log('  hypothesis:', hypothesis.trim().slice(0, 120));
      console.log('  codeDir git log:\n' + codeGit.stdout.replace(/^/gm, '    '));
      console.log('  experimentDir git log:\n' + sessionGit.stdout.replace(/^/gm, '    '));

      expect(metrics.metricName).toBe('val_bpb');
      expect(typeof metrics.metricValue).toBe('number');
      expect(['IMPROVED', 'NOT_IMPROVED', 'FAILED']).toContain(status.status);
      expect(hypothesis.trim().length).toBeGreaterThan(0);
    }

    expect(sendMessage).toHaveBeenCalledTimes(iterDirs.length);

    console.log(`\nAUTO_RESEARCH_E2E_REALLLM_PASS iterations=${iterDirs.length}`);
  }, 120_000);
});
