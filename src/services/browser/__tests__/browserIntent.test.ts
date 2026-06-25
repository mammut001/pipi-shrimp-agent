import { detectBrowserIntent } from '../browserIntent';

describe('detectBrowserIntent', () => {
  it('identifies English web/browser commands', () => {
    expect(detectBrowserIntent('open website')).toBe(true);
    expect(detectBrowserIntent('go to https://google.com')).toBe(true);
    expect(detectBrowserIntent('search Google for pipi shrimp')).toBe(true);
    expect(detectBrowserIntent('how to automate browser')).toBe(true);
    expect(detectBrowserIntent('scrape page')).toBe(true);
  });

  it('identifies Chinese web/browser commands', () => {
    expect(detectBrowserIntent('打开 https://example.com')).toBe(true);
    expect(detectBrowserIntent('用 Chrome 搜索 pipi shrimp agent')).toBe(true);
    expect(detectBrowserIntent('访问百度页面')).toBe(true);
    expect(detectBrowserIntent('总结网页内容')).toBe(true);
    expect(detectBrowserIntent('点击登录按钮并输入账号密码')).toBe(true);
  });

  it('ignores local file / repository commands (false positives)', () => {
    expect(detectBrowserIntent('帮我搜索项目里的 README')).toBe(false);
    expect(detectBrowserIntent('open README.md')).toBe(false);
    expect(detectBrowserIntent('列出文件')).toBe(false);
    expect(detectBrowserIntent('搜索本地代码')).toBe(false);
    expect(detectBrowserIntent('打开 local_config.json')).toBe(false);
  });

  it('handles empty inputs', () => {
    expect(detectBrowserIntent('')).toBe(false);
    expect(detectBrowserIntent(null as any)).toBe(false);
  });
});
