import React from 'react';
import { t } from '../i18n';
import { getErrorLogsText, logError } from '../utils/errorLogger';
import { useUIStore } from '../store/uiStore';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
  /** Incremented to force a fresh subtree render after recovery */
  recoverKey: number;
}

/**
 * AppErrorBoundary - Catches unhandled React errors and shows a friendly fallback UI.
 *
 * Features:
 * - Friendly error page (no white screen)
 * - Reload button
 * - Back-to-chat button (resets transient UI via uiStore.recoverToChatView)
 * - Copy sanitized diagnostics button (no API keys/tokens)
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  private copyTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false, recoverKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logError('error', error.message, 'AppErrorBoundary', error, errorInfo.componentStack ?? undefined);
  }

  componentWillUnmount(): void {
    // Clear any pending copy-reset timers to avoid setState on unmounted component
    for (const timer of this.copyTimers) {
      clearTimeout(timer);
    }
    this.copyTimers = [];
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleBackToChat = (): void => {
    // Reset transient UI state that may have caused the crash
    try {
      useUIStore.getState().recoverToChatView();
    } catch {
      // If store access fails, we still clear the boundary state
    }
    // Clear error state and bump recoverKey to force fresh render
    this.setState((prev) => ({
      hasError: false,
      error: null,
      copied: false,
      recoverKey: prev.recoverKey + 1,
    }));
  };

  private handleCopyDiagnostics = async (): Promise<void> => {
    const logs = getErrorLogsText(30);
    const diagnostics = [
      '=== PiPi Shrimp Diagnostics ===',
      `Time: ${new Date().toISOString()}`,
      `User Agent: ${navigator.userAgent}`,
      '',
      '--- Recent Error Logs ---',
      logs,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(diagnostics);
      this.setState({ copied: true });
      this.copyTimers.push(setTimeout(() => this.setState({ copied: false }), 2000));
    } catch {
      // Fallback: select text in a temporary textarea
      const textarea = document.createElement('textarea');
      textarea.value = diagnostics;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.setState({ copied: true });
      this.copyTimers.push(setTimeout(() => this.setState({ copied: false }), 2000));
    }
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-gray-200 p-8 text-center">
            {/* Icon */}
            <div className="mx-auto w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>

            {/* Title */}
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              {t('errorBoundary.title')}
            </h1>

            {/* Description */}
            <p className="text-sm text-gray-500 mb-6">
              {t('errorBoundary.description')}
            </p>

            {/* Error detail (sanitized) */}
            {this.state.error && (
              <div className="mb-6 p-3 bg-gray-50 rounded-lg border border-gray-200 text-left">
                <p className="text-xs font-mono text-gray-600 break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium text-sm transition-colors"
              >
                {t('errorBoundary.reload')}
              </button>

              <button
                type="button"
                onClick={this.handleBackToChat}
                className="w-full px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 rounded-lg font-medium text-sm border border-gray-300 transition-colors"
              >
                {t('errorBoundary.tryBackToChat')}
              </button>

              <button
                type="button"
                onClick={this.handleCopyDiagnostics}
                className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {this.state.copied
                  ? t('errorBoundary.copySuccess')
                  : t('errorBoundary.copyDiagnostics')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Wrap children with a keyed div so recovery forces a fresh subtree
    return <div key={this.state.recoverKey}>{this.props.children}</div>;
  }
}
