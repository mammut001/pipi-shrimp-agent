import type { BrowserPanelTone } from './browserPanelModel';

export const QUICK_SITES = [
  { nameKey: 'browser.quickSite.cbc', url: 'https://www.cbc.ca/news', icon: '📰' },
  { nameKey: 'browser.quickSite.googleNews', url: 'https://news.google.com', icon: '📱' },
  { nameKey: 'browser.quickSite.reddit', url: 'https://www.reddit.com', icon: '💬' },
  { nameKey: 'browser.quickSite.github', url: 'https://github.com', icon: '💻' },
  { nameKey: 'browser.quickSite.hn', url: 'https://news.ycombinator.com', icon: '🔥' },
  { nameKey: 'browser.quickSite.twitter', url: 'https://x.com', icon: '🐦' },
  { nameKey: 'browser.quickSite.youtube', url: 'https://www.youtube.com', icon: '▶️' },
  { nameKey: 'browser.quickSite.whatsapp', url: 'https://web.whatsapp.com', icon: '💬' },
];

export interface TaskHistoryItem {
  id: string;
  url: string;
  task: string;
  timestamp: Date;
  status: 'pending' | 'completed' | 'failed';
}

export interface InlineNotice {
  tone: BrowserPanelTone;
  titleKey: string;
  descriptionKey: string;
}

/**
 * Extract hostname from URL string safely
 */
export function extractHostname(url: string): string | null {
  try {
    // Handle URLs that might not have protocol
    const urlToCheck = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(urlToCheck);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check if hostname matches a domain (including subdomains)
 */
export function hostnameMatches(hostname: string | null, ...patterns: string[]): boolean {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  return patterns.some((pattern) => {
    const patternLower = pattern.toLowerCase();
    // Exact match or subdomain match (e.g., github.com matches www.github.com)
    return lower === patternLower || lower.endsWith(`.${patternLower}`);
  });
}

export const getQuickTasks = (url: string): string[] => {
  const hostname = extractHostname(url);

  if (hostnameMatches(hostname, 'news.google.com', 'cbc.ca', 'bbc.com', 'news.ycombinator.com')) {
    return [
      'browser.quickTask.extractHeadlines',
      'browser.quickTask.findTechNews',
      'browser.quickTask.listCategories',
    ];
  }

  if (hostnameMatches(hostname, 'reddit.com', 'www.reddit.com', 'old.reddit.com')) {
    return [
      'browser.quickTask.findHotPosts',
      'browser.quickTask.searchDiscussions',
      'browser.quickTask.extractComments',
    ];
  }

  if (hostnameMatches(hostname, 'github.com', 'www.github.com')) {
    return [
      'browser.quickTask.findHotRepos',
      'browser.quickTask.searchProjects',
      'browser.quickTask.extractProjectInfo',
    ];
  }

  if (hostnameMatches(hostname, 'youtube.com', 'www.youtube.com', 'youtu.be')) {
    return [
      'browser.quickTask.extractVideoTitle',
      'browser.quickTask.findRelatedRecommendations',
      'browser.quickTask.getVideoDescription',
    ];
  }

  if (hostnameMatches(hostname, 'web.whatsapp.com', 'whatsapp.com')) {
    return [
      'browser.quickTask.searchContacts',
      'browser.quickTask.sendTestMessage',
      'browser.quickTask.getRecentChats',
    ];
  }

  if (hostnameMatches(hostname, 'amazon.com', 'www.amazon.com', 'smile.amazon.com', 'shopping.google.com')) {
    return [
      'browser.quickTask.searchProducts',
      'browser.quickTask.extractPriceInfo',
      'browser.quickTask.compareReviews',
    ];
  }

  return [
    'browser.quickTask.extractMainContent',
    'browser.quickTask.findImportantInfo',
    'browser.quickTask.summarizePage',
  ];
};

export const toneClasses: Record<
  BrowserPanelTone,
  { container: string; title: string; body: string; icon: string }
> = {
  slate: {
    container: 'border-gray-200 bg-gray-50',
    title: 'text-gray-900',
    body: 'text-gray-600',
    icon: 'bg-white text-gray-500',
  },
  blue: {
    container: 'border-blue-200 bg-blue-50',
    title: 'text-blue-900',
    body: 'text-blue-700',
    icon: 'bg-white text-blue-600',
  },
  green: {
    container: 'border-green-200 bg-green-50',
    title: 'text-green-900',
    body: 'text-green-700',
    icon: 'bg-white text-green-600',
  },
  amber: {
    container: 'border-amber-200 bg-amber-50',
    title: 'text-amber-900',
    body: 'text-amber-700',
    icon: 'bg-white text-amber-600',
  },
  red: {
    container: 'border-red-200 bg-red-50',
    title: 'text-red-900',
    body: 'text-red-700',
    icon: 'bg-white text-red-600',
  },
};

export const getToneIcon = (tone: BrowserPanelTone) => {
  switch (tone) {
    case 'green':
      return '✓';
    case 'blue':
      return '…';
    case 'amber':
      return '!';
    case 'red':
      return '×';
    default:
      return '•';
  }
};
