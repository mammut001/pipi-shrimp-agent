/**
 * Browser Intent Detector
 *
 * Detects when a user message contains a browser task and extracts
 * the target website and task description.
 */

export interface BrowserIntent {
  /** Whether a browser intent was detected */
  detected: boolean;
  /** The target URL or website name */
  website: string | null;
  /** The parsed URL (if website was a name) */
  url: string | null;
  /** The extracted task description */
  task: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Known website mappings from name to URL
 */
export const WEBSITE_MAPPINGS: Record<string, string> = {
  // News
  'cbc': 'https://www.cbc.ca/news',
  'cbc news': 'https://www.cbc.ca/news',
  'cbcnews': 'https://www.cbc.ca/news',
  'google news': 'https://news.google.com',
  'news.google': 'https://news.google.com',
  'bbc': 'https://www.bbc.com/news',
  'bbc news': 'https://www.bbc.com/news',
  'nyt': 'https://www.nytimes.com',
  'new york times': 'https://www.nytimes.com',
  'wsj': 'https://www.wsj.com',
  '华尔街日报': 'https://cn.wsj.com',
  'reuters': 'https://www.reuters.com',
  '路透': 'https://www.reuters.com',

  // Social
  'twitter': 'https://x.com',
  'x': 'https://x.com',
  'x.com': 'https://x.com',
  'tweet': 'https://x.com',
  '推特': 'https://x.com',
  'reddit': 'https://www.reddit.com',
  'rss': 'https://feeds.reddit.com/',
  'hacker news': 'https://news.ycombinator.com',
  'hn': 'https://news.ycombinator.com',
  'indiehackers': 'https://www.indiehackers.com',

  // Tech
  'github': 'https://github.com',
  'stackoverflow': 'https://stackoverflow.com',
  'stack overflow': 'https://stackoverflow.com',
  '掘金': 'https://juejin.cn',
  'juejin': 'https://juejin.cn',
  '知乎': 'https://www.zhihu.com',
  'zhihu': 'https://www.zhihu.com',

  // Video
  'youtube': 'https://www.youtube.com',
  'yt': 'https://www.youtube.com',
  '哔哩哔哩': 'https://www.bilibili.com',
  'bilibili': 'https://www.bilibili.com',
  'b站': 'https://www.bilibili.com',

  // Search
  'google': 'https://www.google.com',
  'bing': 'https://www.bing.com',
  '百度': 'https://www.baidu.com',
  'baidu': 'https://www.baidu.com',
  'duckduckgo': 'https://duckduckgo.com',
  'ddg': 'https://duckduckgo.com',

  // Shopping
  'amazon': 'https://www.amazon.com',
  'ebay': 'https://www.ebay.com',
  '淘宝': 'https://www.taobao.com',
  '天猫': 'https://www.tmall.com',
  '京东': 'https://www.jd.com',

  // Reference
  'wikipedia': 'https://www.wikipedia.org',
  'wiki': 'https://www.wikipedia.org',
  'mdn': 'https://developer.mozilla.org',
  'mongodb': 'https://www.mongodb.com/docs/',
  'docs': 'https://docs.microsoft.com',

  // AI
  'openai': 'https://platform.openai.com',
  'anthropic': 'https://docs.anthropic.com',
  'claude': 'https://claude.ai',
  'gemini': 'https://ai.google.dev',
};

/**
 * Regex patterns for detecting browser intents
 */
const INTENT_PATTERNS = [
  // =========================================================
  // Category 1: Website/repo FIRST, then action word
  // Must split into separate patterns to avoid greedy backtracking:
  // "github 看看" matches pattern A (no prefix, direct action)
  // "github 去 看看" matches pattern B (with 去 prefix, requires space before action)
  // =========================================================
  // Pattern A: "github 看看" / "github 查查" / "github 找找" (direct action, no prefix word)
  /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:看看|查查|找找)/i,
  // Pattern B: "github 去 看看" / "github 去 查查" (with 去 prefix, space required before action)
  /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+去\s+(?:看看|查查|找找)/i,
  // Pattern C: "github 帮我看看" / "github 帮我查查" (with 帮我 prefix)
  /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+帮我(?:看看|查查|找找)/i,
  // Pattern D: "github 访问" / "github 打开" (standalone actions)
  /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:访问|打开)/i,

  // =========================================================
  // Category 2: Action FIRST, then website/repo (original)
  // =========================================================
  // Chinese patterns - action first
  /去\s*(.+?)\s*(看|查|搜索|访问|打开|找)/,
  /帮我去\s*(.+?)\s*(查看|搜索|找|看看)/,
  /(?:访问|打开|去)\s*(.+?)\s*(?:网站|新闻|内容|看看|查查|找找)/,
  /上\s*(.+?)\s*(?:看看|找找|查查)/,
  /在\s*(.+?)\s*(?:看看|找找|查查|搜索)/,
  /到\s*(.+?)\s*(?:看看|找找|查查|搜索)/,

  // =========================================================
  // Category 3: Action AFTER website (帮你看看xxx, 查查xxx)
  // NOTE: This pattern intentionally does NOT match arbitrary text like "这个项目"
  // because websiteToUrl() returns null for unknown names, and the URL check in
  // ChatInput prevents browser activation when url is null.
  // =========================================================
  /(?:帮我)?\s*(?:看看|查查|找找|看看看|查查查)\s*(.+?)(?:\s*$)/i,
  /帮我\s+(.+?)\s+(?:看看|查查|找找)/i,

  // =========================================================
  // Category 4: English patterns
  // =========================================================
  /go\s+to\s+(.+?)(?:\s|$|\?)/i,
  /visit\s+(.+?)(?:\s|$|\?)/i,
  /open\s+(.+?)(?:\s|$|\?)/i,
  /check\s+out\s+(.+?)(?:\s|$|\?)/i,
  /look\s+(?:at|up)\s+(.+?)(?:\s|$|\?)/i,
  /search\s+(?:for\s+)?(.+?)\s+on\s+(.+?)(?:\s|$|\?)/i,
  /browse\s+(.+?)(?:\s|$|\?)/i,

  // =========================================================
  // Category 5: Direct URL (already a URL)
  // =========================================================
  /https?:\/\/[^\s]+/,
];

/**
 * Extract the website name/URL from matched pattern
 */
function extractWebsite(_message: string, match: RegExpMatchArray): string | null {
  // Get the captured website part
  // For most patterns, it's in match[1]
  let website = match[1]?.trim() || null;

  if (!website) return null;

  // Clean up the website name
  website = website.replace(/[.。,，!?！？]+$/, '').trim();

  return website;
}

/**
 * Convert website name to URL
 */
function websiteToUrl(website: string): string | null {
  const lowerWebsite = website.toLowerCase();

  // Check known mappings
  for (const [key, url] of Object.entries(WEBSITE_MAPPINGS)) {
    if (lowerWebsite === key || lowerWebsite.includes(key)) {
      return url;
    }
  }

  // If it looks like a URL, use as-is
  if (website.includes('.') && !website.includes(' ')) {
    if (website.startsWith('http://') || website.startsWith('https://')) {
      return website;
    }
    return `https://${website}`;
  }

  // Unrecognized or vague text - return null to fall back to normal chat
  // Do NOT create Google search URLs for arbitrary text, as this causes false
  // browser triggers for normal Chinese messages like "帮我看看这个项目"
  console.warn(`[browserIntentDetector] Unrecognized website name: "${website}", falling back to chat`);
  return null;
}

/**
 * Extract task description from message
 */
function extractTask(message: string, match: RegExpMatchArray): string {
  // Remove the matched pattern from the message to get the task
  let task = message;

  // Try to remove common patterns
  const patterns = [
    // Category 1: website/repo first, then action
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+去\s+(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+帮我(?:看看|查查|找找)/i,
    /(?:^|\s)((?:github\.com\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)\s+(?:访问|打开)/i,
    // Category 2: action first, then website
    /去\s*(.+?)\s*(?:看|查|搜索|访问|打开|找)/,
    /帮我去\s*(.+?)\s*(?:查看|搜索|找|看看)/,
    /(?:访问|打开|去)\s*(.+?)\s*(?:网站|新闻|内容|看看|查查|找找)/,
    /上\s*(.+?)\s*(?:看看|找找|查查)/,
    /在\s*(.+?)\s*(?:看看|找找|查查|搜索)/,
    /到\s*(.+?)\s*(?:看看|找找|查查|搜索)/,
    // Category 3: action after website
    /(?:帮我)?\s*(?:看看|查查|找找|看看看|查查查)\s*(.+?)(?:\s*$)/i,
    /帮我\s+(.+?)\s+(?:看看|查查|找找)/i,
  ];

  for (const pattern of patterns) {
    const matchResult = task.match(pattern);
    if (matchResult) {
      task = task.replace(matchResult[0], '').trim();
    }
  }

  // Also try to remove the matched portion if it's still in the task
  if (match && match[0]) {
    task = task.replace(match[0], '').trim();
  }

  // Clean up
  task = task.replace(/^[的得地\s]+/, '').trim();
  task = task.replace(/[。.。]+$/, '').trim();

  // Post-cleanup: remove residual "去这个github / 去那个twitter" fragments
  // that can appear when the pre-check matched repo-path first,
  // but "去这个GitHub 看看" was left in the task text.
  task = task.replace(/去\s*这\s*个\s*(?:github|github\.com|推特?|twitter|x\.com|youtube|google|百度|淘宝|reddit|cbc|bbc|nyt|wsj|yahoo|amazon|ebay|知乎|stackoverflow|stackoverflow|stackoverflow)/gi, '').trim();
  task = task.replace(/去\s*那\s*个\s*(?:github|github\.com|推特?|twitter|x\.com|youtube|google|百度|淘宝|reddit|cbc|bbc|nyt|wsj|yahoo|amazon|ebay|知乎|stackoverflow|stackoverflow|stackoverflow)/gi, '').trim();
  task = task.replace(/^[的得地\s]+/, '').trim();

  return task || '浏览网页内容';
}

/**
 * Calculate confidence based on pattern match quality
 */
function calculateConfidence(website: string | null, url: string | null, task: string): number {
  let confidence = 0.5;

  // Known website = higher confidence
  if (website) {
    const lowerWebsite = website.toLowerCase();
    for (const key of Object.keys(WEBSITE_MAPPINGS)) {
      if (lowerWebsite === key || lowerWebsite.includes(key)) {
        confidence += 0.3;
        break;
      }
    }
  }

  // Direct URL = higher confidence
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    confidence += 0.2;
  }

  // Has task description = higher confidence
  if (task.length > 5) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Fallback fuzzy matching - scan for known website names
 * This handles cases like "帮我看看cbc" where the pattern doesn't match
 * but a known website name is present
 */
function tryFuzzyMatch(message: string): BrowserIntent | null {
  const lowerMessage = message.toLowerCase();

  // Only do fuzzy matching if the message contains browser-related action words
  // This prevents false positives like "我在 github 上看到" (a normal sentence)
  const hasActionWord = (
    lowerMessage.includes('看看') ||
    lowerMessage.includes('查查') ||
    lowerMessage.includes('找找') ||
    lowerMessage.includes('看看看') ||
    lowerMessage.includes('帮我') ||
    lowerMessage.includes('去') ||
    lowerMessage.includes('打开') ||
    lowerMessage.includes('访问')
  );

  if (!hasActionWord) {
    return null; // Don't fuzzy match plain sentences
  }

  // Sort keys by length (longer first) to match full names before partials
  const sortedKeys = Object.keys(WEBSITE_MAPPINGS).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    // Check if the key appears in the message (word boundary aware)
    const url = WEBSITE_MAPPINGS[key];

    // Try different matching strategies
    // Order matters - more specific patterns first

    // Strategy 1: GitHub repo format {user}/{repo} followed by action word
    // e.g., "mammut001/pipi-shrimp-agent 去" or "mammut001/pipi-shrimp-agent 帮我看看"
    const githubRepoPattern = /([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)\s+(?:去|帮我去|帮我看看|帮我查查|帮我找找|看看|查查|找找|访问|打开)/i;
    const repoMatch = message.match(githubRepoPattern);
    if (repoMatch && key === 'github') {
      // Extract task from the message
      const repoPath = repoMatch[1];
      const taskStart = (repoMatch.index ?? 0) + repoMatch[0].length;
      const task = message.slice(taskStart).trim() || '浏览网页内容';
      console.log(`[browserIntentDetector] Fuzzy matched GitHub repo: "${repoPath}" -> ${url}`);
      return {
        detected: true,
        website: repoPath,
        url: `${url}/${repoPath}`,
        task,
        confidence: 0.85, // High confidence for explicit repo path
      };
    }

    // Strategy 2: Known website name followed by action word
    // e.g., "github 去看看", "这个github 看看", "twitter 帮我查查"
    // Also handles "github.com 去看看" (with .com suffix)
    const siteActionPattern = new RegExp(
      `(?:^|[\\s，,])((?:这个|那个)?${escapeRegExp(key)}(?:\\.com)?)\\s+(?:去|帮我去|帮我看看|帮我查查|帮我找找|看看|查查|找找|访问|打开)`,
      'i'
    );
    const siteActionMatch = message.match(siteActionPattern);
    if (siteActionMatch) {
      const matchedText = siteActionMatch[1];
      // Extract task from the message (everything after the action word)
      const actionEndIndex = (siteActionMatch.index ?? 0) + siteActionMatch[0].length;
      const task = message.slice(actionEndIndex).trim() || '浏览网页内容';
      console.log(`[browserIntentDetector] Fuzzy matched: "${matchedText}" -> ${url}`);
      return {
        detected: true,
        website: key,
        url: url,
        task,
        confidence: 0.8,
      };
    }

    // Strategy 3: Original exact match patterns
    if (
      // Exact match with action context (e.g., "帮我看看cbc", "去cbc")
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
      console.log(`[browserIntentDetector] Fuzzy matched (original): "${key}" -> ${url}`);
      return {
        detected: true,
        website: key,
        url: url,
        task: '浏览网页内容',
        confidence: 0.7, // Fuzzy match confidence (above threshold of 0.6)
      };
    }
  }

  return null;
}

/**
 * Pre-check for GitHub repo path at the START of the message.
 * Matches "user/repo 去看看" and extracts the full GitHub URL
 * before Category 1 patterns can match "github" in the middle of the text.
 */
function detectGitHubRepoFirst(message: string): BrowserIntent | null {
  // Pattern: GitHub repo path (user/repo) at the start, followed by action words
  // Handles: "mammut001/pipi-shrimp-agent 去看看", "user/repo 帮我看看", etc.
  const repoActionPattern = /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+(?:去|帮我去|帮我看看|帮我查查|帮我找找|看看|查查|找找|访问|打开)/i;
  const match = message.match(repoActionPattern);

  if (!match) {
    return null;
  }

  const repoPath = match[1]; // e.g., "mammut001/pipi-shrimp-agent"
  const matchEnd = (match.index ?? 0) + match[0].length;
  const task = message.slice(matchEnd).trim() || '浏览网页内容';

  // Clean up task: remove leading "去这个github / 去那个twitter / 帮我" etc.
  const cleanTask = task
    .replace(/^(?:去|帮我|请)\s*/i, '')          // Remove leading 去/帮我/请
    .replace(/^[的得地\s]+/, '')                   // Remove leading particles
    .replace(/^(?:这|那)\s*个\s*/, '')             // Remove leading 这/那个
    .replace(/[。.]+$/, '')                        // Remove trailing punctuation
    .trim() || '浏览网页内容';

  return {
    detected: true,
    website: repoPath,
    url: `https://github.com/${repoPath}`,
    task: cleanTask,
    confidence: 0.9,
  };
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect browser intent from user message
 */
export function detectBrowserIntent(message: string): BrowserIntent {
  // =========================================================
  // Pre-check: GitHub repo path at START of message
  // Handles "user/repo 去看看" and "user/repo 帮我看看"
  // Must run before category patterns to avoid "github" being
  // matched in the middle of the message instead of the repo path.
  // =========================================================
  const githubPreCheck = detectGitHubRepoFirst(message);
  if (githubPreCheck) {
    return githubPreCheck;
  }

  // Try each pattern
  for (const pattern of INTENT_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      // Handle direct URL pattern
      if (pattern.source.includes('https?://')) {
        const url = match[0];
        return {
          detected: true,
          website: url,
          url: url,
          task: extractTask(message, match),
          confidence: 0.95,
        };
      }

      const website = extractWebsite(message, match);
      if (!website) continue;

      const url = websiteToUrl(website);
      const task = extractTask(message, match);
      const confidence = calculateConfidence(website, url, task);

      return {
        detected: true,
        website: website,
        url: url,
        task: task,
        confidence: confidence,
      };
    }
  }

  // Fallback: Try fuzzy matching for known website names
  const fuzzyResult = tryFuzzyMatch(message);
  if (fuzzyResult) {
    return fuzzyResult;
  }

  // No intent detected
  return {
    detected: false,
    website: null,
    url: null,
    task: '',
    confidence: 0,
  };
}

/**
 * Quick check if message might be a browser intent
 * (lighter check for use in input handlers)
 */
export function mightBeBrowserIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Quick keyword checks
  const browserKeywords = [
    '去', '打开', '访问', '看看', '查查', '找找',
    'go to', 'visit', 'open', 'check out', 'browse',
    'search', '搜索',
  ];

  for (const keyword of browserKeywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }

  // URL check
  if (message.match(/https?:\/\//)) {
    return true;
  }

  return false;
}

/**
 * Get display name for a website URL
 */
export function getWebsiteDisplayName(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');

    // Check if it's a known website
    for (const [name, mapping] of Object.entries(WEBSITE_MAPPINGS)) {
      if (mapping.includes(hostname) || hostname.includes(mapping.replace('https://', '').replace('www.', ''))) {
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    }

    // Return hostname as display name
    return hostname.charAt(0).toUpperCase() + hostname.split('.')[0].slice(1);
  } catch {
    return url;
  }
}

// Example usage and tests
if (import.meta.env.DEV) {
  const tests = [
    // =========================================================
    // NEW: Repo/Website FIRST, then action word
    // The key fix for "mammut001/pipi-shrimp-agent 去这个GitHub 看看"
    // =========================================================
    'mammut001/pipi-shrimp-agent 去这个GitHub 看看有多少个star',  // Should: detect GitHub repo + task
    'mammut001/pipi-shrimp-agent 帮我看看有多少个star',          // Should: detect GitHub repo + task
    'mammut001/pipi-shrimp-agent 查查',                         // Should: detect GitHub repo
    'github.com/mammut001/pipi-shrimp-agent 去看看',             // Should: detect GitHub repo
    'mammut001/pipi-shrimp-agent 访问',                         // Should: detect GitHub repo
    'github 去看看',                                             // Should: detect github
    'github 帮我看看',                                           // Should: detect github
    '这个github 看看',                                           // Should: detect github
    '那个github 查查',                                           // Should: detect github
    'twitter 去看看',                                            // Should: detect twitter
    'youtube 帮我查查',                                           // Should: detect youtube

    // =========================================================
    // Original: action first, then website
    // =========================================================
    '帮我去 CBC News 看看科技新闻',
    '去 GitHub 搜索 React 项目',
    'open https://google.com',
    '去 Twitter 看看最近关于 AI 的推文',
    '访问 Amazon 搜索 iPhone 15',
    'check out twitter.com',
    '帮我查查最新的 AI 新闻',

    // =========================================================
    // Original: action AFTER website (帮你看看xxx, 查查xxx)
    // =========================================================
    '帮我看看cbc',           // Should: fuzzy match cbc
    '帮我看看cbc新闻',       // Should: fuzzy match cbc
    '看看cbc',              // Should: fuzzy match cbc
    '查查twitter',          // Should: fuzzy match twitter
    '帮我查查github',        // Should: fuzzy match github
    '找找youtube',          // Should: fuzzy match youtube
    '去cbc看看',             // Should: match pattern + fuzzy

    // =========================================================
    // Should NOT match (normal conversation)
    // =========================================================
    '我在 github 上看到',    // No action word
    'cbc 新闻怎么样',        // Missing action word
    'just a normal message',

    // Direct URL
    'https://example.com',
  ];

  console.log('Browser Intent Detection Tests:');
  for (const test of tests) {
    const intent = detectBrowserIntent(test);
    if (intent.detected) {
      console.log(`  ✓ "${test}" -> ${intent.website} (${intent.url}) task="${intent.task}" [${Math.round(intent.confidence * 100)}%]`);
    } else {
      console.log(`  ✗ "${test}" -> no intent`);
    }
  }
}
