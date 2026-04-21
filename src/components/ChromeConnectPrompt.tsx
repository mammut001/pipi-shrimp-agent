/**
 * ChromeConnectPrompt - Dialog shown when a complex browser task is detected
 * and Chrome CDP is not yet connected.
 *
 * Lets the user connect Chrome for full capability, or fall back to PageAgent.
 */

import { useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useCdpStore } from '@/store/cdpStore';

export function ChromeConnectPrompt() {
  const chromePromptVisible = useUIStore(s => s.chromePromptVisible);
  const chromePromptTargetUrl = useUIStore(s => s.chromePromptTargetUrl);
  const resolveChromePrompt = useUIStore(s => s.resolveChromePrompt);

  const cdpStatus = useCdpStore(s => s.status);
  const launchChromeAndConnect = useCdpStore(s => s.launchChromeAndConnect);

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  if (!chromePromptVisible) return null;

  const domain = (() => {
    try { return new URL(chromePromptTargetUrl ?? '').hostname; }
    catch { return chromePromptTargetUrl ?? ''; }
  })();

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const connected = await launchChromeAndConnect();
      if (connected) {
        resolveChromePrompt(true);
        return;
      }

      setConnectError(useCdpStore.getState().errorMessage ?? '连接失败，请重试');
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : '连接失败，请重试');
    } finally {
      setConnecting(false);
    }
  };

  const handleSkip = () => {
    resolveChromePrompt(false);
  };

  // If CDP just connected while dialog is open, auto-resolve
  if (cdpStatus === 'connected' && chromePromptVisible) {
    resolveChromePrompt(true);
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[420px] p-6 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="text-2xl">🌐</div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-base">
              建议使用 Chrome 浏览器
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {domain} 是一个复杂的网站，连接 Chrome 后执行效果更好
            </p>
          </div>
        </div>

        {/* Why Chrome */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-600 dark:text-gray-300 space-y-1.5">
          <div className="flex gap-2"><span>✅</span><span>支持真实浏览器指纹，绕过反爬</span></div>
          <div className="flex gap-2"><span>✅</span><span>支持文件上传/下载</span></div>
          <div className="flex gap-2"><span>✅</span><span>完整 JS 环境，兼容复杂 SPA</span></div>
          <div className="flex gap-2"><span>✅</span><span>在你已登录的 Chrome 里运行，免重新登录</span></div>
        </div>

        {/* Error */}
        {connectError && (
          <p className="text-sm text-red-500">{connectError}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex-1 bg-black dark:bg-white text-white dark:text-black rounded-lg py-2 px-4 text-sm font-medium hover:opacity-80 disabled:opacity-50 transition-opacity"
          >
            {connecting ? '连接中...' : '连接 Chrome'}
          </button>
          <button
            onClick={handleSkip}
            disabled={connecting}
            className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg py-2 px-4 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            继续用内置浏览器
          </button>
        </div>

        {/* How to connect hint */}
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          将自动以调试模式启动 Chrome · 无需手动操作
        </p>
      </div>
    </div>
  );
}

export default ChromeConnectPrompt;
