/**
 * Browser intent classifier.
 * Detects whether the user is asking to open, browse, search, or interact with a webpage.
 */

export function detectBrowserIntent(input: string): boolean {
  if (!input) return false;

  const lower = input.toLowerCase();

  // 1. Any HTTP/HTTPS URL or www. link should always trigger
  if (/https?:\/\/\S+|www\.\S+/i.test(lower)) {
    return true;
  }

  // 2. Local/file exclusion rules to avoid false positives
  const isLocalTask =
    /\b(open|view|edit|search|read|find|list|grep)\b\s+(file|code|folder|directory|repo|repository|local|log|history|config|package\.json|readme|Cargo\.toml)/i.test(lower) ||
    /打开(文件|代码|目录|文件夹|工程|项目|日志|配置|历史|本地)/.test(lower) ||
    /搜索(文件|代码|本地|函数|类|模块|定义|引用|工程)/.test(lower) ||
    /查找(文件|代码|本地)/.test(lower) ||
    /列出文件/.test(lower);

  const hasStrongWebSignal = /chrome|browser|google|bing|baidu|yandex|duckduckgo|网页|网站|浏览器|网址|https?:\/\//i.test(lower);
  if (isLocalTask && !hasStrongWebSignal) {
    return false;
  }

  // 3. Web/browser patterns (English & Chinese)
  const webPatterns = [
    // English
    /\bchrome\b/,
    /\bbrowser\b/,
    /\bwebsite\b/,
    /\bweb\s*page\b/,
    /\bopen\s+(a\s+)?(website|url|webpage)\b/,
    /\bgo\s*to\s+https?\b/,
    /\bnavigate\s+to\b/,
    /\bvisit\s+\S+\.\S+/,
    /\bsearch\s+(the\s+)?(web|google|bing|duckduckgo|internet)\b/,
    /\bgoogle\s+(search|for)\b/,
    /\bscrape\s+(the\s+)?(web|page|website|url)\b/,
    /\bbrowser\s+automation\b/,

    // Chinese
    /chrome/i,
    /浏览器/,
    /网页/,
    /网站/,
    /网址/,
    /访问\s*\S+\.\S+/,
    /访问(网页|网站|网址|页面|链接)/,
    /打开(网页|网站|网址|链接|https?)/,
    /跳转到/,
    /谷歌/,
    /百度/,
    /必应/,
    /搜一下/,
    /查一下/,
    /用浏览器/,
    /用\s*chrome/i,
    /总结网页/,
    /总结(页面|网站|网页|内容)/,
    /网页内容/,
    /抓取网页/,
    /爬取网页/,
    /抓取网站/,
    /爬取网站/,
    /网页自动化/,
    /控制浏览器/,
  ];

  // Specific actions like click/type/fill form only if accompanied by browser/web context
  const actionPatterns = [
    /\b(click|type|fill|scrape|navigate|search)\b/i,
    /点击|输入|填表|抓取|爬取|搜索|打开/
  ];

  // Check if any strong web pattern matches
  if (webPatterns.some(pattern => pattern.test(lower))) {
    return true;
  }

  // Check if there is an action with a general browser keyword context
  const hasWebContext = /\b(web|page|site|online|url|http|link|login|signin|button|input|form)\b/i.test(lower) || /网络|页面|在线|链接|网址|上万维网|登录|注册|按钮|表单|输入框|账号|密码/.test(lower);
  if (hasWebContext && actionPatterns.some(pattern => pattern.test(lower))) {
    return true;
  }

  return false;
}
