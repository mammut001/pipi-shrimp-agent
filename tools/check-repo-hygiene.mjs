import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { checkSkillSync } from './check-skill-sync.mjs';

const repoRoot = process.cwd();
const maxAssetBytes = 1024 * 1024;
const skipDirectories = new Set([
  '.git',
  '.pipi-shrimp',
  '.vscode',
  'coverage',
  'dist',
  'dist-ssr',
  'node_modules',
  'src-tauri/target',
  'website/.next',
  'website/node_modules',
]);

const rootOnlyPatterns = [
  { label: 'patch_*.mjs', regex: /^patch_.*\.mjs$/ },
  { label: 'fix_*.mjs', regex: /^fix_.*\.mjs$/ },
  { label: '*.timestamp-*', regex: /^.*\.timestamp-.*$/ },
  { label: '*.patch', regex: /^.*\.patch$/ },
  { label: 'debug_*.mjs', regex: /^debug_.*\.mjs$/ },
  { label: 'test_*.mjs', regex: /^test_.*\.mjs$/ },
  { label: 'test_output.*', regex: /^test_output\..*$/ },
  { label: 'test.typ', regex: /^test\.typ$/ },
];

async function loadAllowlist() {
  const allowlistPath = path.join(repoRoot, 'tools', 'repo-hygiene.allowlist.json');
  try {
    const raw = await readFile(allowlistPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      largeAssetPrefixes: Array.isArray(parsed.largeAssetPrefixes) ? parsed.largeAssetPrefixes : [],
      largeAssets: Array.isArray(parsed.largeAssets) ? parsed.largeAssets : [],
    };
  } catch (error) {
    return { largeAssetPrefixes: [], largeAssets: [] };
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isSkippedDirectory(relativePath) {
  const posixPath = toPosix(relativePath);
  return skipDirectories.has(posixPath);
}

function isAllowlistedLargeAsset(relativePath, allowlist) {
  return allowlist.largeAssets.includes(relativePath)
    || allowlist.largeAssetPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

async function walk(relativeDirectory = '') {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = toPosix(path.join(relativeDirectory, entry.name));

    if (entry.isDirectory()) {
      if (!isSkippedDirectory(relativePath)) {
        files.push(...await walk(relativePath));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

const allowlist = await loadAllowlist();
const failures = [];
const warnings = [];
const rootEntries = await readdir(repoRoot, { withFileTypes: true });

for (const entry of rootEntries) {
  if (!entry.isFile()) {
    continue;
  }

  for (const pattern of rootOnlyPatterns) {
    if (pattern.regex.test(entry.name)) {
      failures.push(`Root artifact matches ${pattern.label}: ${entry.name}`);
    }
  }
}

const files = await walk();
const skillSyncFailures = await checkSkillSync();
failures.push(...skillSyncFailures);

for (const relativePath of files) {
  if (relativePath.startsWith('src/') && relativePath.endsWith('.patch')) {
    failures.push(`Patch residue under src/: ${relativePath}`);
  }

  if (!/\.(png|svg)$/i.test(relativePath)) {
    continue;
  }

  const fileStat = await stat(path.join(repoRoot, relativePath));
  if (fileStat.size <= maxAssetBytes) {
    continue;
  }

  const message = `Large asset ${relativePath} is ${formatBytes(fileStat.size)} (> 1.00MB)`;
  if (isAllowlistedLargeAsset(relativePath, allowlist)) {
    warnings.push(`${message}; allowlisted for later resource cleanup`);
  } else {
    failures.push(message);
  }
}

for (const warning of warnings) {
  console.warn(`[repo-hygiene] warning: ${warning}`);
}

if (failures.length > 0) {
  console.error('[repo-hygiene] Repository hygiene check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[repo-hygiene] Repository hygiene check passed.');