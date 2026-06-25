/**
 * Detect tool results that mean Chrome CDP is not connected.
 */
export function isBrowserNotConnectedToolResult(content: string): boolean {
  const normalized = content.toLowerCase();
  return content.includes('浏览器未连接')
    || normalized.includes('not connected')
    || normalized.includes('click to connect');
}

export const BROWSER_NOT_CONNECTED_USER_MESSAGE =
  '浏览器未连接。请先连接 Chrome，然后重新发送你的请求。';
