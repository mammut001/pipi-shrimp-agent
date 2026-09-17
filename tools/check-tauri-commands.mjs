#!/usr/bin/env node
/**
 * Contract check: TypeScript `invoke('...')` names vs Rust `generate_handler![]`
 * registrations in src-tauri/src/lib.rs.
 *
 * Default scope is telegram_* (R7-12 / T-15 / INFRA-03). Pass --all to report
 * every missing invoke; --strict-all exits non-zero on any non-allowlisted gap.
 *
 * Usage:
 *   node tools/check-tauri-commands.mjs
 *   node tools/check-tauri-commands.mjs --all
 *   node tools/check-tauri-commands.mjs --strict-all
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const libRsPath = path.join(repoRoot, 'src-tauri', 'src', 'lib.rs');
const telegramServicePath = path.join(repoRoot, 'src', 'services', 'telegramService.ts');
const telegramRsPath = path.join(repoRoot, 'src-tauri', 'src', 'commands', 'telegram.rs');

/** Known non-telegram dead invokes tracked outside R7-12 — warn unless --strict-all. */
const ALL_SCOPE_ALLOWLIST = new Set([
  'mcp_reconnect_server',
  'read_dir',
  'save_experiment',
]);

const INVOKE_RE = /invoke(?:<[^>]+>)?\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
const HANDLER_RE = /commands::(?:[a-zA-Z0-9_]+::)*([a-zA-Z0-9_]+)/g;

async function collectTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
        continue;
      }
      files.push(...(await collectTsFiles(full)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    files.push(full);
  }
  return files;
}

function extractInvokes(source) {
  const names = new Set();
  for (const match of source.matchAll(INVOKE_RE)) {
    names.add(match[1]);
  }
  return names;
}

function extractHandlers(libSource) {
  const blockMatch = libSource.match(/generate_handler!\[([\s\S]*?)\]/);
  const block = blockMatch ? blockMatch[1] : libSource;
  const names = new Set();
  for (const match of block.matchAll(HANDLER_RE)) {
    names.add(match[1]);
  }
  return names;
}

function extractTelegramFns(telegramRs) {
  const names = new Set();
  for (const match of telegramRs.matchAll(/pub\s+(?:async\s+)?fn\s+(telegram_[a-z0-9_]+)\s*\(/g)) {
    names.add(match[1]);
  }
  return names;
}

async function main() {
  const args = new Set(process.argv.slice(2).filter((a) => a !== '--'));
  const checkAll = args.has('--all') || args.has('--strict-all');
  const strictAll = args.has('--strict-all');

  const [libSource, telegramService, telegramRs] = await Promise.all([
    readFile(libRsPath, 'utf8'),
    readFile(telegramServicePath, 'utf8'),
    readFile(telegramRsPath, 'utf8'),
  ]);

  const handlers = extractHandlers(libSource);
  const telegramFns = extractTelegramFns(telegramRs);
  const serviceInvokes = [...extractInvokes(telegramService)].filter((n) =>
    n.startsWith('telegram_')
  );

  const missingInLib = serviceInvokes.filter((n) => !handlers.has(n)).sort();
  const missingFn = serviceInvokes.filter((n) => !telegramFns.has(n)).sort();

  let failed = false;

  console.log(`telegramService.ts telegram_* invokes: ${serviceInvokes.length}`);
  console.log(`lib.rs registered commands: ${handlers.size}`);
  console.log(`telegram.rs pub fn telegram_*: ${telegramFns.size}`);

  if (missingInLib.length > 0) {
    failed = true;
    console.error('\nR7-12 FAIL: telegram invokes missing from lib.rs generate_handler:');
    for (const name of missingInLib) console.error(`  - ${name}`);
  }

  if (missingFn.length > 0) {
    failed = true;
    console.error('\nR7-12 FAIL: telegram invokes missing pub fn in telegram.rs:');
    for (const name of missingFn) console.error(`  - ${name}`);
  }

  if (!failed) {
    console.log('\nR7-12 OK: every telegramService invoke has a Rust handler + telegram.rs fn.');
  }

  if (checkAll) {
    const srcRoot = path.join(repoRoot, 'src');
    const files = await collectTsFiles(srcRoot);
    const byCommand = new Map();
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const name of extractInvokes(source)) {
        if (!byCommand.has(name)) byCommand.set(name, []);
        byCommand.get(name).push(path.relative(repoRoot, file));
      }
    }

    const missing = [...byCommand.keys()].filter((n) => !handlers.has(n)).sort();
    const actionable = missing.filter((n) => !ALL_SCOPE_ALLOWLIST.has(n));
    const allowlisted = missing.filter((n) => ALL_SCOPE_ALLOWLIST.has(n));

    console.log(`\n--all: non-test TS invokes: ${byCommand.size}`);
    if (allowlisted.length > 0) {
      console.log('Allowlisted known gaps (non-R7-12):');
      for (const name of allowlisted) {
        console.log(`  - ${name} (${byCommand.get(name).join(', ')})`);
      }
    }
    if (actionable.length > 0) {
      console.error('Missing handlers outside allowlist:');
      for (const name of actionable) {
        console.error(`  - ${name} (${byCommand.get(name).join(', ')})`);
      }
      if (strictAll) failed = true;
    } else if (missing.length === 0) {
      console.log('All TS invokes are registered in lib.rs.');
    } else {
      console.log('No new gaps beyond allowlist.');
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
