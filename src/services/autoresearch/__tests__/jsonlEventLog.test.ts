import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createJsonlEventLogger,
  parseJsonlLine,
  readJsonlEvents,
  redactSecrets,
} from '../jsonlEventLog';

describe('jsonlEventLog — redaction', () => {
  it('redacts openai keys', () => {
    expect(redactSecrets('hello sk-abcdefghijklmnop1234 world')).toContain('sk-[REDACTED]');
  });

  it('redacts anthropic keys', () => {
    expect(redactSecrets('sk-ant-api03-abc123def456')).toContain('sk-ant-[REDACTED]');
  });

  it('redacts bearer tokens', () => {
    const out = redactSecrets('Authorization: Bearer abcdefghijklmnop1234');
    expect(String(out)).toContain('Bearer [REDACTED]');
  });

  it('redacts github tokens', () => {
    expect(redactSecrets('ghp_abcdefghijklmnop1234')).toContain('ghp_[REDACTED]');
  });

  it('redacts AWS access keys', () => {
    expect(redactSecrets('AKIAIOSFODNN7EXAMPLE')).toContain('AKIA[REDACTED]');
  });

  it('redacts embedded private keys', () => {
    const out = redactSecrets('-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----');
    expect(String(out)).toContain('[REDACTED]');
  });

  it('truncates long strings', () => {
    const long = 'x'.repeat(8_000);
    const out = String(redactSecrets(long));
    expect(out.length).toBeLessThan(8_000);
    expect(out).toContain('[truncated');
  });

  it('redacts recursively inside objects', () => {
    const out = redactSecrets({ a: 'bearer abcdefghijklmnop1234', nested: { b: 'sk-abc1234567890123' } });
    expect(JSON.stringify(out)).toContain('[REDACTED]');
  });

  it('handles circular references safely', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => redactSecrets(obj)).not.toThrow();
  });
});

describe('jsonlEventLog — logger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonl-logger-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes one event per line and is parseable', async () => {
    const logger = await createJsonlEventLogger({ runDir: dir, runId: 'run-1' });
    await logger.append({ iteration: 1, phase: 'AUDIT', type: 'phase.started', status: 'ok', data: { foo: 'bar' } });
    await logger.append({ iteration: 1, phase: 'AUDIT', type: 'phase.completed', status: 'ok' });
    await logger.close();

    const events = await readJsonlEvents(path.join(dir, 'run.jsonl'));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('phase.started');
    expect(events[0].runId).toBe('run-1');
    expect(events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts secrets inside data payloads', async () => {
    const logger = await createJsonlEventLogger({ runDir: dir, runId: 'run-2' });
    await logger.append({
      iteration: 1,
      phase: 'VERIFY',
      type: 'tool.started',
      status: 'ok',
      data: { cmd: 'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://api.example.com' },
    });
    await logger.close();

    const raw = await fs.readFile(path.join(dir, 'run.jsonl'), 'utf8');
    expect(raw).not.toContain('abcdefghijklmnop1234');
    expect(raw).toContain('[REDACTED]');
  });

  it('rejects appends after close', async () => {
    const logger = await createJsonlEventLogger({ runDir: dir, runId: 'run-3' });
    await logger.close();
    await expect(
      logger.append({ iteration: 1, phase: 'AUDIT', type: 'phase.started', status: 'ok' }),
    ).rejects.toThrow(/already closed/);
  });

  it('truncates existing file when re-opened', async () => {
    const logger1 = await createJsonlEventLogger({ runDir: dir, runId: 'run-4' });
    await logger1.append({ iteration: 1, phase: 'AUDIT', type: 'phase.started', status: 'ok' });
    await logger1.close();

    const logger2 = await createJsonlEventLogger({ runDir: dir, runId: 'run-4' });
    await logger2.close();
    const events = await readJsonlEvents(path.join(dir, 'run.jsonl'));
    expect(events).toHaveLength(0);
  });

  it('parseJsonlLine handles invalid lines', () => {
    const ok = parseJsonlLine('{"a":1}');
    expect(ok.parsed).not.toBeNull();
    const bad = parseJsonlLine('not-json');
    expect(bad.parsed).toBeNull();
    expect(bad.error).toBeDefined();
  });
});
