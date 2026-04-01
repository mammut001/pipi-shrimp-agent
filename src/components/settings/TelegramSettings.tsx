/**
 * Telegram Settings Component
 *
 * Provides a complete Telegram bot configuration interface:
 * - Token input with validation
 * - Connection status display
 * - Bot information when connected
 * - Quick setup instructions
 */

import { useState, useEffect } from 'react';
import { useTelegramStore, useTelegramBotInfo, useTelegramConnected, useTelegramError } from '@/store/telegramStore';
import { useUIStore } from '@/store';
import { telegramValidateToken } from '@/services/telegramService';
import type { TelegramBotInfo } from '@/types/telegram';

/**
 * Telegram Settings Component
 */
export function TelegramSettings() {
  const store = useTelegramStore();
  const botInfo = useTelegramBotInfo();
  const isConnected = useTelegramConnected();
  const error = useTelegramError();
  const { addNotification } = useUIStore();

  const [tokenInput, setTokenInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    botInfo?: TelegramBotInfo;
    error?: string;
  } | null>(null);

  // Load existing token on mount
  useEffect(() => {
    if (store.token) {
      setTokenInput(store.token);
    }
  }, [store.token]);

  /**
   * Validate the token by calling getMe API
   */
  const handleValidate = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setValidationResult({ success: false, error: 'Token is required' });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      const info = await telegramValidateToken(trimmed);
      setValidationResult({ success: true, botInfo: info });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid token';
      setValidationResult({ success: false, error: message });
    } finally {
      setIsValidating(false);
    }
  };

  /**
   * Connect to Telegram with the current token
   */
  const handleConnect = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      addNotification('error', 'Please enter a bot token');
      return;
    }

    try {
      await store.connect(trimmed);
      addNotification('success', 'Connected to Telegram!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect';
      addNotification('error', message);
    }
  };

  /**
   * Disconnect from Telegram
   */
  const handleDisconnect = async () => {
    try {
      await store.disconnect();
      addNotification('info', 'Disconnected from Telegram');
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  };

  /**
   * Clear the token
   */
  const handleClear = () => {
    setTokenInput('');
    setValidationResult(null);
  };

  const status = store.status;
  const isConnecting = status === 'connecting';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex justify-center items-center w-10 h-10 rounded-lg bg-sky-500/10 shrink-0">
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5 text-sky-500"
            fill="currentColor"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.37-.49 1.02-.74 3.99-1.74 6.65-2.89 7.99-3.45 3.8-1.6 4.59-1.88 5.1-1.89.11 0 .37.03.54.17.14.12.18.28.2.45-.01.06.01.24 0 .38z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Telegram Integration</h2>
          <p className="text-xs text-gray-500">Connect your bot to receive and send messages</p>
        </div>
      </div>

      {/* Connection Status */}
      <div className="mb-4">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
          isConnected
            ? 'bg-green-100 text-green-700'
            : status === 'connecting'
            ? 'bg-yellow-100 text-yellow-700'
            : status === 'error'
            ? 'bg-red-100 text-red-700'
            : 'bg-gray-100 text-gray-600'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            isConnected
              ? 'bg-green-500'
              : status === 'connecting'
              ? 'bg-yellow-500 animate-pulse'
              : status === 'error'
              ? 'bg-red-500'
              : 'bg-gray-400'
          }`} />
          {isConnected
            ? 'Connected'
            : status === 'connecting'
            ? 'Connecting...'
            : status === 'error'
            ? 'Error'
            : 'Disconnected'}
        </div>

        {isConnected && botInfo && (
          <div className="mt-2 text-xs text-gray-600">
            <span className="font-medium">@{botInfo.username}</span>
            <span className="mx-1">•</span>
            <span>{botInfo.firstName}</span>
          </div>
        )}

        {error && (
          <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
            {error}
          </div>
        )}
      </div>

      {/* Token Input */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-700 mb-1.5">
          Bot Token
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              setValidationResult(null);
            }}
            placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleValidate}
            disabled={!tokenInput.trim() || isValidating}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isValidating ? 'Checking...' : 'Check'}
          </button>
        </div>

        {/* Validation Result */}
        {validationResult && (
          <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${
            validationResult.success
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {validationResult.success && validationResult.botInfo ? (
              <div>
                <span className="font-medium">Valid token for @{validationResult.botInfo.username}</span>
                <span className="mx-1">•</span>
                <span>{validationResult.botInfo.firstName}</span>
              </div>
            ) : (
              <span>{validationResult.error}</span>
            )}
          </div>
        )}
      </div>

      {/* Quick Setup Instructions */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="text-xs font-semibold text-gray-700 mb-2">Quick Setup</h3>
        <ol className="text-xs text-gray-600 space-y-1 list-decimal pl-4">
          <li>Open Telegram and search for <span className="font-medium">@BotFather</span></li>
          <li>Send <span className="font-mono bg-gray-200 px-1 rounded">/newbot</span> to create a new bot</li>
          <li>Follow the instructions and copy your bot token</li>
          <li>Paste the token above and click "Check" to validate</li>
          <li>Click "Connect" to start receiving messages</li>
        </ol>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {!isConnected ? (
          <>
            <button
              type="button"
              onClick={handleConnect}
              disabled={!tokenInput.trim() || isConnecting}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isConnecting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Connecting...
                </span>
              ) : (
                'Connect'
              )}
            </button>
            {tokenInput && (
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 transition-colors"
              >
                Clear
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={handleDisconnect}
            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-600 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Connected Features Info */}
      {isConnected && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h3 className="text-xs font-semibold text-gray-700 mb-2">Connected Features</h3>
          <ul className="text-xs text-gray-600 space-y-1">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Send messages to any chat
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Receive messages from users
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Real-time message notifications
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default TelegramSettings;
