import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const INVOKE_RE = /invoke(?:<[^>]+>)?\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
const HANDLER_RE = /commands::(?:[a-zA-Z0-9_]+::)*([a-zA-Z0-9_]+)/g;
const TELEGRAM_FN_RE = /pub\s+(?:async\s+)?fn\s+(telegram_[a-z0-9_]+)\s*\(/g;

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

function extractMatches(source: string, pattern: RegExp): string[] {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

function extractHandlers(libRs: string): Set<string> {
  const blockMatch = libRs.match(/generate_handler!\[([\s\S]*?)\]/);
  const block = blockMatch ? blockMatch[1] : libRs;
  return new Set(extractMatches(block, HANDLER_RE));
}

describe('telegram invoke / Rust handler parity (R7-12 / T-15)', () => {
  const serviceSource = readRepoFile('src/services/telegramService.ts');
  const libRs = readRepoFile('src-tauri/src/lib.rs');
  const telegramRs = readRepoFile('src-tauri/src/commands/telegram.rs');

  const serviceInvokes = extractMatches(serviceSource, INVOKE_RE).filter((name) =>
    name.startsWith('telegram_')
  );
  const handlers = extractHandlers(libRs);
  const telegramFns = new Set(extractMatches(telegramRs, TELEGRAM_FN_RE));

  it('discovers telegram_* invokes from telegramService.ts', () => {
    expect(serviceInvokes.length).toBeGreaterThanOrEqual(18);
    expect(serviceInvokes).toEqual(expect.arrayContaining([
      'telegram_connect',
      'telegram_set_command_prefix',
      'telegram_set_allowed_chats',
      'telegram_download_file',
      'telegram_set_webhook',
      'telegram_delete_webhook',
      'telegram_get_webhook_info',
    ]));
  });

  it('registers every telegramService invoke in lib.rs generate_handler', () => {
    const missing = serviceInvokes.filter((name) => !handlers.has(name));
    expect(missing).toEqual([]);
  });

  it('defines a pub fn in telegram.rs for every telegramService invoke', () => {
    const missing = serviceInvokes.filter((name) => !telegramFns.has(name));
    expect(missing).toEqual([]);
  });

  it('keeps telegram_set_allowed_chats wired in telegramService', () => {
    expect(serviceSource).toContain("invoke('telegram_set_allowed_chats'");
  });
});
