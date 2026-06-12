/**
 * find-unused-i18n-keys.mjs
 *
 * Scans `src/i18n/locales/en-US.ts` for keys that are NOT referenced
 * anywhere in `src/` via `t('...')` / `t("...")` / `t(`...`)` and prints
 * them. Intended for one-off cleanup passes; it is not a permanent test.
 *
 * Usage:  node tools/find-unused-i18n-keys.mjs
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const LOCALE_PATH = path.join(repoRoot, 'src', 'i18n', 'locales', 'en-US.ts');
const SCAN_ROOTS = [
  path.join(repoRoot, 'src'),
];
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

async function collectFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const localeSource = await readFile(LOCALE_PATH, 'utf8');
// Match:   'foo.bar': '…'   "foo.bar": "…"   `foo.bar`: `…`
const KEY_LINE = /^\s*['"`]([^'"`]+)['"`]\s*:/gm;
const keys = new Set();
for (const match of localeSource.matchAll(KEY_LINE)) {
  const key = match[1];
  if (!key.includes('.')) continue; // skip top-level headers
  keys.add(key);
}

// Grep for `t('…')` / `t("…")` / `t(`…`)` usages in the source tree.
const usagePattern = /\bt\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

const usedKeys = new Set();
for (const root of SCAN_ROOTS) {
  const statResult = await stat(root).catch(() => null);
  if (!statResult) continue;
  const files = await collectFiles(root);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(usagePattern)) {
      usedKeys.add(match[1]);
    }
  }
}

const unused = [...keys].filter((key) => !usedKeys.has(key)).sort();

if (unused.length === 0) {
  console.log(`[unused-i18n] No unused keys found (${keys.size} total).`);
  process.exit(0);
}

console.log(`[unused-i18n] ${unused.length} unused keys out of ${keys.size}:`);
for (const key of unused) {
  console.log(`  - ${key}`);
}
