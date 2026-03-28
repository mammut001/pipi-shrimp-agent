/**
 * CDP Connector Modal - Chrome connection wizard
 *
 * Guides users through connecting to Chrome DevTools Protocol.
 */

import React, { useState, useEffect } from 'react';
import { useCdpStore } from '../store/cdpStore';

interface Props {
  onClose: () => void;
}

export const CdpConnectorModal: React.FC<Props> = ({ onClose }) => {
  const { status, errorMessage, connect, launchChromeAndConnect } = useCdpStore();
  const [mode, setMode] = useState<'choice' | 'manual'>('choice');

  const isLoading = status === 'connecting';

  // Auto-close on successful connection
  useEffect(() => {
    if (status === 'connected') {
      const timer = setTimeout(() => onClose(), 1200);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-800">连接 Chrome</h2>
              <p className="text-xs text-gray-400">Pipi Shrimp in Chrome</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {mode === 'choice' && (
          <>
            <p className="text-xs text-gray-500 leading-relaxed">
              需要连接到你本地的 Chrome 浏览器，才能执行网页自动化任务（填写表单、点击按钮等）。
            </p>

            {/* Option A: Auto launch */}
            <button
              onClick={launchChromeAndConnect}
              disabled={isLoading}
              className="w-full flex items-center gap-3 p-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl transition-colors"
            >
              <span className="text-lg">🚀</span>
              <div className="text-left">
                <p className="text-xs font-bold">一键启动并连接</p>
                <p className="text-[10px] opacity-75">自动以调试模式打开 Chrome</p>
              </div>
            </button>

            <div className="flex items-center gap-2 text-[10px] text-gray-300">
              <div className="flex-1 h-px bg-gray-100" />
              已经开启了调试模式
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {/* Option B: Already running */}
            <button
              onClick={connect}
              disabled={isLoading}
              className="w-full flex items-center gap-3 p-3.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 text-gray-700 border border-gray-200 rounded-xl transition-colors"
            >
              <span className="text-lg">🔗</span>
              <div className="text-left">
                <p className="text-xs font-bold">直接连接</p>
                <p className="text-[10px] text-gray-400">Chrome 已在 9222 端口运行</p>
              </div>
            </button>

            <button onClick={() => setMode('manual')} className="w-full text-[10px] text-gray-400 hover:text-gray-600 underline text-center">
              如何手动开启调试模式？
            </button>
          </>
        )}

        {mode === 'manual' && (
          <>
            <p className="text-xs text-gray-500">完全退出 Chrome 后，在终端运行：</p>
            <code className="block text-[10px] bg-gray-900 text-green-400 p-3 rounded-xl font-mono leading-relaxed select-all">
              {`open -a "Google Chrome" --args --remote-debugging-port=9222`}
            </code>
            <button
              onClick={connect}
              disabled={isLoading}
              className="w-full p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-bold rounded-xl transition-colors"
            >
              {isLoading ? '连接中...' : '已启动，立即连接'}
            </button>
            <button onClick={() => setMode('choice')} className="w-full text-[10px] text-gray-400 hover:text-gray-600 underline text-center">
              返回
            </button>
          </>
        )}

        {/* Status feedback */}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 p-3 rounded-xl">
            <div className="h-3 w-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            正在连接 Chrome...
          </div>
        )}

        {status === 'error' && (
          <div className="text-xs text-red-600 bg-red-50 p-3 rounded-xl space-y-1">
            <p className="font-bold">连接失败</p>
            <p className="text-[10px] opacity-75 break-all">{errorMessage}</p>
            <p className="text-[10px] text-gray-500 mt-1">请确认 Chrome 已完全退出后重新以调试模式启动</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="text-xs text-green-600 bg-green-50 p-3 rounded-xl font-bold flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            连接成功！
          </div>
        )}
      </div>
    </div>
  );
};
