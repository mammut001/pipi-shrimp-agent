import { readFileSync } from 'fs';

const code = readFileSync('src/utils/browserIntentDetector.ts', 'utf8');

// Extract WEBSITE_MAPPINGS
const mappingsMatch = code.match(/export const WEBSITE_MAPPINGS: Record<string, string> = ({[\s\S]*?});/);
if (!mappingsMatch) { console.log('Could not parse WEBSITE_MAPPINGS'); process.exit(1); }
const mappingsStr = mappingsMatch[1];
const WEBSITE_MAPPINGS = {};
const pairs = mappingsStr.matchAll(/'([^']+)': '([^']+)'/g);
for (const [, key, url] of pairs) WEBSITE_MAPPINGS[key] = url;

// Extract INTENT_PATTERNS from the actual file
const patternsSection = code.match(/const INTENT_PATTERNS = \[([\s\S]*?)\];\n/);
if (!patternsSection) { console.log('Could not parse INTENT_PATTERNS'); process.exit(1); }
const patternLines = patternsSection[1];
const INTENT_PATTERNS = [];
const regexMatches = patternLines.matchAll(/\/(.+?)\/([gimsuy]*)/g);
for (const [, src] of regexMatches) {
  try { INTENT_PATTERNS.push(new RegExp(src.trim())); }
  catch (e) { /* skip invalid regex */ }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function websiteToUrl(website) {
  const lowerWebsite = website.toLowerCase();
  for (const [key, url] of Object.entries(WEBSITE_MAPPINGS)) {
    if (lowerWebsite === key || lowerWebsite.includes(key)) return url;
  }
  if (website.includes('.') && !website.includes(' ')) {
    if (website.startsWith('http://') || website.startsWith('https://')) return website;
    return `https://${website}`;
  }
  return null;
}

function tryFuzzyMatch(message) {
  const lowerMessage = message.toLowerCase();
  const hasActionWord = (
    lowerMessage.includes('看看') || lowerMessage.includes('查查') ||
    lowerMessage.includes('找找') || lowerMessage.includes('看看看') ||
    lowerMessage.includes('帮我') || lowerMessage.includes('去') ||
    lowerMessage.includes('打开') || lowerMessage.includes('访问')
  );
  if (!hasActionWord) return null;

  const sortedKeys = Object.keys(WEBSITE_MAPPINGS).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    const url = WEBSITE_MAPPINGS[key];

    // Strategy 1: GitHub repo format {user}/{repo}
    const githubRepoPattern = /([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)\s+(?:去|帮我去|帮我看看|帮我查查|帮我找找|看看|查查|找找|访问|打开)/i;
    const repoMatch = message.match(githubRepoPattern);
    if (repoMatch && key === 'github') {
      const repoPath = repoMatch[1];
      const taskStart = repoMatch.index + repoMatch[0].length;
      const task = message.slice(taskStart).trim() || '浏览网页内容';
      return { detected: true, website: repoPath, url: `${url}/${repoPath}`, task, confidence: 0.85 };
    }

    // Strategy 2: Known website + action word
    const siteActionPattern = new RegExp(
      `(?:^|[\\s，,])(?:这个|那个)?${escapeRegExp(key)}(?:\\.com)?\\s+(?:去|帮我去|帮我看看|帮我查查|帮我找找|看看|查查|找找|访问|打开)`,
      'i'
    );
    const siteActionMatch = message.match(siteActionPattern);
    if (siteActionMatch) {
      const actionEndIndex = siteActionMatch.index + siteActionMatch[0].length;
      const task = message.slice(actionEndIndex).trim() || '浏览网页内容';
      return { detected: true, website: key, url, task, confidence: 0.8 };
    }

    // Strategy 3: Original
    if (
      (lowerMessage.includes('帮我') || lowerMessage.includes('去') || lowerMessage.includes('看看') || lowerMessage.includes('查查')) &&
      (lowerMessage === key ||
       lowerMessage.includes(' ' + key) ||
       lowerMessage.includes(key + ' ') ||
       lowerMessage.includes('看看' + key) ||
       lowerMessage.includes('查查' + key) ||
       lowerMessage.includes('找找' + key) ||
       lowerMessage.includes('帮我看看' + key) ||
       lowerMessage.includes('帮我查查' + key) ||
       lowerMessage.includes('帮我找找' + key) ||
       lowerMessage.includes('去' + key) ||
       lowerMessage.includes(key + '新闻') ||
       lowerMessage.includes(key + '网站'))
    ) {
      return { detected: true, website: key, url, task: '浏览网页内容', confidence: 0.7 };
    }
  }
  return null;
}

function extractTask(message, match) {
  let task = message;

  const patterns = [
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+去\s+(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+帮我(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:访问|打开)/i,
    /去\s*(.+?)\s*(?:看|查|搜索|访问|打开|找)/,
    /帮我去\s*(.+?)\s*(?:查看|搜索|找|看看)/,
    /(?:访问|打开|去)\s*(.+?)\s*(?:网站|新闻|内容|看看|查查|找找)/,
    /上\s*(.+?)\s*(?:看看|找找|查查)/,
    /在\s*(.+?)\s*(?:看看|找找|查查|搜索)/,
    /到\s*(.+?)\s*(?:看看|找找|查查|搜索)/,
    /(?:帮我)?\s*(?:看看|查查|找找|看看看|查查查)\s*(.+?)(?:\s*$)/i,
    /帮我\s+(.+?)\s+(?:看看|查查|找找)/i,
  ];

  for (const pattern of patterns) {
    const matchResult = task.match(pattern);
    if (matchResult) {
      task = task.replace(matchResult[0], '').trim();
    }
  }

  if (match && match[0]) {
    task = task.replace(match[0], '').trim();
  }

  task = task.replace(/^[的得地\s]+/, '').trim();
  task = task.replace(/[。.]+$/, '').trim();

  // Post-cleanup for residual "去这个github" fragments
  task = task.replace(/去\s*这\s*个\s*(?:github|github\.com|推特?|twitter|x\.com|youtube|google|百度|淘宝|reddit|cbc|bbc|nyt|wsj|yahoo|amazon|ebay|知乎|stackoverflow|stackoverflow|stackoverflow)/gi, '').trim();
  task = task.replace(/去\s*那\s*个\s*(?:github|github\.com|推特?|twitter|x\.com|youtube|google|百度|淘宝|reddit|cbc|bbc|nyt|wsj|yahoo|amazon|ebay|知乎|stackoverflow|stackoverflow|stackoverflow)/gi, '').trim();
  task = task.replace(/^[的得地\s]+/, '').trim();

  return task || '浏览网页内容';
}

function detectGitHubRepoFirst(message) {
  const repoActionPattern = /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+(?:去|帮我去|帮我看看|帮我查查|帮我找找|看看|查查|找找|访问|打开)/i;
  const match = message.match(repoActionPattern);
  if (!match) return null;
  const repoPath = match[1];
  const matchEnd = (match.index || 0) + match[0].length;
  const task = message.slice(matchEnd).trim() || '浏览网页内容';
  const cleanTask = task
    .replace(/^(?:去|帮我|请)\s*/i, '')
    .replace(/^[的得地\s]+/, '')
    .replace(/^(?:这|那)\s*个\s*/, '')
    .replace(/[。.]+$/, '')
    .trim() || '浏览网页内容';
  return { detected: true, website: repoPath, url: `https://github.com/${repoPath}`, task: cleanTask, confidence: 0.9 };
}

function detectBrowserIntent(message) {
  const githubPre = detectGitHubRepoFirst(message);
  if (githubPre) return githubPre;

  for (const pattern of INTENT_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      if (pattern.source.includes('https?://')) {
        return { detected: true, website: match[0], url: match[0], task: '浏览网页内容', confidence: 0.95 };
      }
      const website = match[1]?.trim()?.replace(/[.。,，!?!?]+$/, '') || null;
      if (!website) continue;
      const url = websiteToUrl(website);
      if (!url) continue;
      let task = extractTask(message, match);
      return { detected: true, website, url, task: task || '浏览网页内容', confidence: 0.8 };
    }
  }
  const fuzzy = tryFuzzyMatch(message);
  if (fuzzy) return fuzzy;
  return { detected: false, website: null, url: null, task: '', confidence: 0 };
}

const tests = [
  // NEW: Repo/Website FIRST, then action word
  ['mammut001/pipi-shrimp-agent 去这个GitHub 看看有多少个star', true, 'https://github.com/mammut001/pipi-shrimp-agent', '有多少个star'],
  ['mammut001/pipi-shrimp-agent 帮我看看有多少个star', true, 'https://github.com/mammut001/pipi-shrimp-agent', null],
  ['mammut001/pipi-shrimp-agent 查查', true, 'https://github.com/mammut001/pipi-shrimp-agent', null],
  ['github.com/mammut001/pipi-shrimp-agent 去看看', true, 'https://github.com/mammut001/pipi-shrimp-agent', null],
  ['mammut001/pipi-shrimp-agent 访问', true, 'https://github.com/mammut001/pipi-shrimp-agent', null],
  ['github 去看看', true, 'https://github.com', null],
  ['github 帮我看看', true, 'https://github.com', null],
  ['这个github 看看', true, 'https://github.com', null],
  ['那个github 查查', true, 'https://github.com', null],
  ['twitter 去看看', true, 'https://x.com', null],
  ['youtube 帮我查查', true, 'https://www.youtube.com', null],
  ['github 去 看看', true, 'https://github.com', null],  // space between 去 and 看看

  // Original: action first
  ['帮我去 CBC News 看看科技新闻', true, 'https://www.cbc.ca/news', null],
  ['去 GitHub 搜索 React 项目', true, 'https://github.com', null],
  ['open https://google.com', true, 'https://google.com', null],
  ['帮我看看cbc', true, 'https://www.cbc.ca/news', null],
  ['查查twitter', true, 'https://x.com', null],

  // Should NOT match
  ['我在 github 上看到', false, null, null],
  ['cbc 新闻怎么样', false, null, null],
  ['just a normal message', false, null, null],
];

console.log('\n=== Browser Intent Detection Tests ===\n');
let passed = 0, failed = 0;
for (const [test, shouldDetect, expectedUrl, expectedTask] of tests) {
  const intent = detectBrowserIntent(test);
  const detectOk = intent.detected === shouldDetect;
  const urlOk = !expectedUrl || (intent.url && intent.url.startsWith(expectedUrl));

  if (detectOk && urlOk) {
    console.log(`  ✅ "${test}"`);
    if (intent.detected) {
      console.log(`     → website="${intent.website}" url="${intent.url}" task="${intent.task}" [${Math.round(intent.confidence * 100)}%]`);
    }
    passed++;
  } else {
    console.log(`  ❌ "${test}"`);
    console.log(`     → detected=${intent.detected} (expected ${shouldDetect}), url=${intent.url} (expected prefix ${expectedUrl})`);
    if (intent.detected) {
      console.log(`     → got: website="${intent.website}" url="${intent.url}" task="${intent.task}"`);
    }
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed\n`);
