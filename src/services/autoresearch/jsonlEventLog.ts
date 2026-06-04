/**
 * AutoResearch Harness — JSONL Event Log
 *
 * Writes a structured, append-only log of events for one run/iteration.
 * Each event is a single JSON object on its own line. The log is meant
 * to be machine-readable: an auditor can replay the run, see exactly
 * which tools were invoked, and confirm guardrails fired.
 *
 * Privacy contract:
 *   - Events MUST NOT include raw API keys, bearer tokens, or full
 *     private file content.
 *   - Long string fields are truncated to MAX_STRING_LEN.
 *   - Free-form "data" is passed through a secret redactor before write.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// ─── Event taxonomy ──────────────────────────────────────────────────────────

export type JsonlEventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'preflight.completed'
  | 'iteration.started'
  | 'iteration.completed'
  | 'phase.started'
  | 'phase.completed'
  | 'tool.started'
  | 'tool.completed'
  | 'file_change.detected'
  | 'verification.started'
  | 'verification.completed'
  | 'patch.generated'
  | 'permission.denied'
  | 'guardrail.triggered';

export type JsonlEventStatus = 'ok' | 'warn' | 'error' | 'skipped';

export interface JsonlEvent {
  ts: string;
  runId: string;
  iteration: number | null;
  phase: string | null;
  type: JsonlEventType;
  status: JsonlEventStatus;
  /** Free-form safe metadata. Must not contain secrets. */
  data?: Record<string, unknown>;
}

// ─── Limits ──────────────────────────────────────────────────────────────────

const MAX_STRING_LEN = 4_000;
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, replacement: 'sk-[REDACTED]' },
  { pattern: /\bsk-ant-[A-Za-z0-9-]{8,}\b/g, replacement: 'sk-ant-[REDACTED]' },
  { pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\bghp_[A-Za-z0-9]{16,}\b/g, replacement: 'ghp_[REDACTED]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, replacement: 'xox?-[REDACTED]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: 'AKIA[REDACTED]' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----' },
];

// ─── Redaction ───────────────────────────────────────────────────────────────

export function redactSecrets(input: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return redactString(input);
  }
  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
    return input;
  }
  if (Array.isArray(input)) {
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    return input.map((item) => redactSecrets(item, seen));
  }
  if (typeof input === 'object') {
    if (seen.has(input as object)) return '[Circular]';
    seen.add(input as object);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = redactSecrets(value, seen);
    }
    return out;
  }
  return input;
}

function redactString(value: string): string {
  let result = value;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  if (result.length > MAX_STRING_LEN) {
    return `${result.slice(0, MAX_STRING_LEN)}…[truncated ${result.length - MAX_STRING_LEN} chars]`;
  }
  return result;
}

// ─── Logger ──────────────────────────────────────────────────────────────────

export interface JsonlEventLoggerOptions {
  filePath: string;
  runId: string;
}

export class JsonlEventLogger {
  private readonly filePath: string;
  private readonly runId: string;
  private lineCount = 0;
  private closed = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: JsonlEventLoggerOptions) {
    this.filePath = options.filePath;
    this.runId = options.runId;
  }

  get path(): string {
    return this.filePath;
  }

  get count(): number {
    return this.lineCount;
  }

  async append(input: Omit<JsonlEvent, 'ts' | 'runId'> & { ts?: string }): Promise<void> {
    if (this.closed) {
      throw new Error(`JsonlEventLogger for ${this.runId} is already closed.`);
    }
    const event: JsonlEvent = {
      ts: input.ts ?? new Date().toISOString(),
      runId: this.runId,
      iteration: input.iteration ?? null,
      phase: input.phase ?? null,
      type: input.type,
      status: input.status,
      data: input.data ? (redactSecrets(input.data) as Record<string, unknown>) : undefined,
    };
    const line = `${JSON.stringify(event)}\n`;
    this.lineCount += 1;
    this.writeQueue = this.writeQueue.then(() => fs.appendFile(this.filePath, line, 'utf8'));
    await this.writeQueue;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.writeQueue;
  }
}

// ─── File-based event factory ────────────────────────────────────────────────

export interface CreateLoggerInput {
  runDir: string;
  runId: string;
  fileName?: string;
}

export async function createJsonlEventLogger(input: CreateLoggerInput): Promise<JsonlEventLogger> {
  const fileName = input.fileName ?? 'run.jsonl';
  await fs.mkdir(input.runDir, { recursive: true });
  const filePath = path.join(input.runDir, fileName);
  // Truncate any previous file (one run = one log).
  await fs.writeFile(filePath, '', 'utf8');
  return new JsonlEventLogger({ filePath, runId: input.runId });
}

// ─── Inline helper for one-off reads ─────────────────────────────────────────

export interface ParsedJsonlLine {
  raw: string;
  parsed: JsonlEvent | null;
  error?: string;
}

export function parseJsonlLine(line: string): ParsedJsonlLine {
  const trimmed = line.trim();
  if (!trimmed) return { raw: line, parsed: null };
  try {
    const parsed = JSON.parse(trimmed) as JsonlEvent;
    return { raw: line, parsed };
  } catch (error) {
    return {
      raw: line,
      parsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readJsonlEvents(filePath: string): Promise<JsonlEvent[]> {
  const content = await fs.readFile(filePath, 'utf8');
  const events: JsonlEvent[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const { parsed } = parseJsonlLine(line);
    if (parsed) events.push(parsed);
  }
  return events;
}
