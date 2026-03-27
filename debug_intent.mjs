import { readFileSync } from 'fs';

const code = readFileSync('src/utils/browserIntentDetector.ts', 'utf8');
const mappingsMatch = code.match(/export const WEBSITE_MAPPINGS: Record<string, string> = ({[\s\S]*?});/);
const mappingsStr = mappingsMatch[1];
const WEBSITE_MAPPINGS = {};
for (const [, k, u] of mappingsStr.matchAll(/'([^']+)': '([^']+)'/g)) WEBSITE_MAPPINGS[k] = u;

const patternsSection = code.match(/const INTENT_PATTERNS = \[([\s\S]*?)\];\n/);
const INTENT_PATTERNS = [];
for (const [, src] of patternsSection[1].matchAll(/\/(.+?)\/([gimsuy]*)/g)) {
  try { INTENT_PATTERNS.push(new RegExp(src.trim())); } catch(e) {}
}

function detectGitHubRepoFirst(message) {
  const p = /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+(?:去|帮我去|帮我看看|帮我查查|帮我找找|看看|查查|找找|访问|打开)/i;
  const m = message.match(p);
  if (!m) return null;
  const repoPath = m[1];
  const matchEnd = (m.index || 0) + m[0].length;
  const task = message.slice(matchEnd).trim() || '浏览网页内容';
  const cleanTask = task.replace(/^[的得地\s]+/, '').replace(/[。.]+$/, '').trim() || '浏览网页内容';
  return { detected: true, website: repoPath, url: `https://github.com/${repoPath}`, task: cleanTask, confidence: 0.9 };
}

function websiteToUrl(website) {
  const lw = website.toLowerCase();
  for (const [k, u] of Object.entries(WEBSITE_MAPPINGS)) { if (lw === k || lw.includes(k)) return u; }
  if (website.includes('.') && !website.includes(' ')) { return website.startsWith('http') ? website : `https://${website}`; }
  return null;
}

function extractTask(message, match) {
  let task = message;
  const patterns = [
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+去\s+(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+帮我(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:访问|打开)/i,
  ];
  for (const p of patterns) {
    const r = task.match(p);
    if (r) { console.log(`  extractTask pattern matched: ${p.source.slice(0,60)}... → match[0]="${r[0]}"`); task = task.replace(r[0], '').trim(); }
  }
  if (match && match[0]) task = task.replace(match[0], '').trim();
  task = task.replace(/^[的得地\s]+/, '').trim();
  task = task.replace(/[。.]+$/, '').trim();
  task = task.replace(/去\s*这\s*个\s*(?:github|github\.com|推特?|twitter|x\.com|youtube|google|百度|淘宝|reddit|cbc|bbc|nyt|wsj|yahoo|amazon|ebay|知乎|stackoverflow)/gi, '').trim();
  task = task.replace(/去\s*那\s*个\s*(?:github|github\.com|推特?|twitter|x\.com|youtube|google|百度|淘宝|reddit|cbc|bbc|nyt|wsj|yahoo|amazon|ebay|知乎|stackoverflow)/gi, '').trim();
  task = task.replace(/^[的得地\s]+/, '').trim();
  return task || '浏览网页内容';
}

function detectBrowserIntent(message) {
  const pre = detectGitHubRepoFirst(message);
  if (pre) { console.log('  [pre-check] matched!'); return pre; }
  for (const p of INTENT_PATTERNS) {
    const m = message.match(p);
    if (m) {
      if (p.source.includes('https?://')) return { detected: true, website: m[0], url: m[0], task: '浏览网页内容', confidence: 0.95 };
      const w = m[1]?.trim()?.replace(/[.。,，!?!?]+$/, '') || null;
      if (!w) continue;
      const u = websiteToUrl(w);
      if (!u) continue;
      console.log(`  [category] pattern matched: ${p.source.slice(0,50)}... → website="${w}", url="${u}"`);
      const t = extractTask(message, m);
      return { detected: true, website: w, url: u, task: t, confidence: 0.8 };
    }
  }
  return { detected: false, website: null, url: null, task: '', confidence: 0 };
}

const msg = '帮我去 App Store Connect 看看数据';
console.log('Input:', msg);
console.log('');
console.log('=== Tracing detectBrowserIntent ===');
const result = detectBrowserIntent(msg);
console.log('');
console.log('Result:', JSON.stringify(result, null, 2));
