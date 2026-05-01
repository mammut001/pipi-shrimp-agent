import fs from 'fs';
let file = fs.readFileSync('src/utils/chatBrowserBridge.ts', 'utf8');

const escapeKeywords = [
  "代码", "项目", "repo", "repository", "bug", "fix", "debug", "toolcall", "artifact", 
  "实现", "源码", "文件", "函数", "组件", "prompt", "报错", "修复", "分析", "重构"
];

const quickCheckRegex = /export function quickCheckBrowserIntent.*?\{[\s\S]*?\n\}/;
file = file.replace(quickCheckRegex, `export function quickCheckBrowserIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  const isCodeOrProjectAnalysisRequest = (msg: string) => {
    return [
      "代码", "项目", "repo", "repository", "bug", "fix", "debug", "toolcall", "artifact", 
      "实现", "源码", "文件", "函数", "组件", "prompt", "报错", "修复", "分析", "重构"
    ].some(kw => msg.includes(kw));
  };

  const isExplicitBrowserCommand = (msg: string) => {
    if (msg.startsWith('/browser') || msg.startsWith('browser:') || msg.startsWith('浏览器：') || msg.startsWith('用浏览器')) return true;
    if (msg.includes('用浏览器打开') || msg.includes('用浏览器访问') || msg.includes('在浏览器中打开') || msg.includes('打开网页') || msg.includes('访问网站')) return true;
    
    const hasDomain = /(?:https?:\\\\/\\\\/)?(?:www\\\\.)?[a-zA-Z0-9-]+\\\\.[a-zA-Z]{2,}(?:\\\\/[^\\\\s，。！？,!?]*)?/i.test(msg);
    const hasStrongNav = ['打开', '访问', '进入', '导航到', 'open', 'visit', 'go to'].some(verb => msg.includes(verb));
    if (hasDomain && hasStrongNav) return true;

    return false;
  };

  if (isCodeOrProjectAnalysisRequest(lowerMessage)) {
    // Escape hatch: even if explicit rules might catch it, if it mentions code strongly,
    // we require VERY strong explicit commands, or we just default false. 
    // Wait, the requirements say: "If a message contains code-review/debugging words, do not trigger browser workflow even if it mentions a repo-hosting site or a repo-like path."
    // Let's implement this strictly. If it starts with /browser or includes explicit "用浏览器打开", we should probably still allow it.
    // The instructions say: "Escape-hatch keywords... Examples that should be normal chat, not browser workflow... Keep explicit browser commands working (These should still trigger browser workflow...)"
    
    // We will just let explicit browser commands override the escape hatch.
    if (!isExplicitBrowserCommand(lowerMessage)) {
      return false;
    }
  }

  return isExplicitBrowserCommand(lowerMessage);
}`);

fs.writeFileSync('src/utils/chatBrowserBridge.ts', file);
