/**
 * Write a soak failure bundle: diagnostics + filtered traces + assertion meta.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dumpRuntimeDiagnostics } from '../SessionRuntime';
import { dumpRuntimeTraceJsonLines } from '../RuntimeTraceSink';
import type { FailureBundlePaths, SoakAssertionFailure } from './types';

export function resolveSoakArtifactRoot(explicit?: string): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const fromEnv = process.env.PIPI_SOAK_ARTIFACT_DIR;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  // Prefer repo-local artifacts/soak when cwd looks like the repo; else /tmp.
  const local = join(process.cwd(), 'artifacts', 'soak');
  try {
    mkdirSync(local, { recursive: true });
    return local;
  } catch {
    return '/tmp';
  }
}

export function createFailureBundleDir(artifactRoot: string, ts = Date.now()): string {
  const dir = join(artifactRoot, `pipi-soak-failure-${ts}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeSoakFailureBundle(options: {
  artifactRoot?: string;
  iteration: number;
  sessionA: string;
  sessionB: string;
  failures: SoakAssertionFailure[];
  assertionMessage?: string;
}): FailureBundlePaths {
  const root = resolveSoakArtifactRoot(options.artifactRoot);
  const dir = createFailureBundleDir(root);
  const metaPath = join(dir, 'meta.json');
  const diagnosticsPath = join(dir, 'diagnostics.json');
  const traceAPath = join(dir, `trace-${options.sessionA}.jsonl`);
  const traceBPath = join(dir, `trace-${options.sessionB}.jsonl`);
  const fullTracePath = join(dir, 'trace-all.jsonl');

  const assertionMessage = options.assertionMessage
    ?? options.failures.map((f) => `[${f.invariant}] ${f.message}`).join('\n');

  const meta = {
    iteration: options.iteration,
    sessionA: options.sessionA,
    sessionB: options.sessionB,
    assertionMessage,
    failures: options.failures,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  writeFileSync(diagnosticsPath, `${dumpRuntimeDiagnostics()}\n`, 'utf8');
  writeFileSync(
    traceAPath,
    `${dumpRuntimeTraceJsonLines({ sessionId: options.sessionA })}\n`,
    'utf8',
  );
  writeFileSync(
    traceBPath,
    `${dumpRuntimeTraceJsonLines({ sessionId: options.sessionB })}\n`,
    'utf8',
  );
  writeFileSync(fullTracePath, `${dumpRuntimeTraceJsonLines()}\n`, 'utf8');

  // Sanity: dir exists for callers that only check path.
  if (!existsSync(dir)) {
    throw new Error(`failure bundle dir missing after write: ${dir}`);
  }

  return {
    dir,
    metaPath,
    diagnosticsPath,
    traceAPath,
    traceBPath,
    fullTracePath,
  };
}
