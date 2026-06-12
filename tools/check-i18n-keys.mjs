import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const localeFiles = {
  'en-US': path.join(repoRoot, 'src', 'i18n', 'locales', 'en-US.ts'),
  'zh-CN': path.join(repoRoot, 'src', 'i18n', 'locales', 'zh-CN.ts'),
};

const keyValueLinePattern = /^\s*['"]([^'"]+)['"]\s*:\s*(.+?)\s*,?\s*(?:\/\/.*)?$/;
const placeholderPattern = /\{[a-zA-Z0-9_]+\}/g;

function normalizeValueType(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('`')) {
    return 'template-string';
  }
  if (value.startsWith("'") || value.startsWith('"')) {
    return 'string';
  }
  if (value === 'true' || value === 'false') {
    return 'boolean';
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return 'number';
  }
  return 'unknown';
}

function extractStringValue(rawValue) {
  const value = rawValue.trim();
  if ((!value.startsWith("'") && !value.startsWith('"')) || value.length < 2) {
    return '';
  }

  const quote = value[0];
  let result = '';
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\') {
      result += char;
      if (index + 1 < value.length) {
        result += value[index + 1];
        index += 1;
      }
      continue;
    }
    if (char === quote) {
      return result;
    }
    result += char;
  }

  return result;
}

function extractPlaceholders(value) {
  return [...new Set(value.match(placeholderPattern) ?? [])].sort();
}

async function readLocale(locale, filePath) {
  const source = await readFile(filePath, 'utf8');
  const entries = new Map();

  for (const line of source.split(/\r?\n/)) {
    const match = keyValueLinePattern.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!key.includes('.')) {
      continue;
    }

    if (entries.has(key)) {
      throw new Error(`Duplicate i18n key in ${locale}: ${key}`);
    }

    const stringValue = extractStringValue(rawValue);
    entries.set(key, {
      locale,
      type: normalizeValueType(rawValue),
      placeholders: extractPlaceholders(stringValue),
    });
  }

  return entries;
}

function sortedDifference(left, right) {
  return [...left].filter((key) => !right.has(key)).sort();
}

function formatList(items) {
  return items.map((item) => `  - ${item}`).join('\n');
}

const locales = Object.fromEntries(await Promise.all(
  Object.entries(localeFiles).map(async ([locale, filePath]) => [locale, await readLocale(locale, filePath)]),
));

const enUSKeys = new Set(locales['en-US'].keys());
const zhCNKeys = new Set(locales['zh-CN'].keys());
const failures = [];

const missingInZh = sortedDifference(enUSKeys, zhCNKeys);
const missingInEn = sortedDifference(zhCNKeys, enUSKeys);

if (missingInZh.length > 0) {
  failures.push(`Keys present in en-US but missing in zh-CN:\n${formatList(missingInZh)}`);
}

if (missingInEn.length > 0) {
  failures.push(`Keys present in zh-CN but missing in en-US:\n${formatList(missingInEn)}`);
}

for (const key of [...enUSKeys].filter((candidate) => zhCNKeys.has(candidate)).sort()) {
  const enEntry = locales['en-US'].get(key);
  const zhEntry = locales['zh-CN'].get(key);

  if (enEntry.type !== zhEntry.type) {
    failures.push(`Value type mismatch for ${key}: en-US=${enEntry.type}, zh-CN=${zhEntry.type}`);
  }

  const enPlaceholders = enEntry.placeholders.join(', ');
  const zhPlaceholders = zhEntry.placeholders.join(', ');
  if (enPlaceholders !== zhPlaceholders) {
    failures.push(`Placeholder mismatch for ${key}: en-US=[${enPlaceholders}], zh-CN=[${zhPlaceholders}]`);
  }
}

if (failures.length > 0) {
  console.error('[i18n-check] Locale consistency check failed:');
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(`[i18n-check] Locale consistency check passed (${enUSKeys.size} keys).`);