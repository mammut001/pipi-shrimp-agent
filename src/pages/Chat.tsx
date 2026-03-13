/**
 * Chat - Main chat page component
 *
 * Features:
 * - Display current session messages
 * - User/assistant message styles
 * - Auto-scroll to latest message
 * - Loading state (isStreaming)
 * - Error display
 * - Permission dialog integration
 */

import { useEffect, useRef } from 'react';
import { useChatStore, useUIStore } from '@/store';
import { MainLayout } from '@/layout';
import { ChatMessage, ChatInput, PermissionModal } from '@/components';

/**
 * Chat page component
 */
export function Chat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    currentMessages,
    isStreaming,
    error,
    clearError,
    init,
  } = useChatStore();

  const {
    pendingPermission,
    clearPermissionRequest,
    addNotification,
  } = useUIStore();

  const messages = currentMessages();
  const hasMessages = messages.length > 0;

  // Initialize chat store on mount
  useEffect(() => {
    init();
  }, [init]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Handle permission approval
   */
  const handleApprovePermission = () => {
    addNotification('success', 'Permission granted');
    clearPermissionRequest();
    // TODO: Execute the approved action
  };

  /**
   * Handle permission denial
   */
  const handleDenyPermission = () => {
    addNotification('info', 'Permission denied');
    clearPermissionRequest();
  };

  /**
   * Handle error dismissal
   */
  const handleDismissError = () => {
    clearError();
  };

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Messages List */}
        <div className="flex-1 overflow-y-auto">
          {hasMessages ? (
            <div className="divide-y divide-gray-100">
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isLatest={index === messages.length - 1}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            /* Empty State */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="mb-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-16 w-16 mx-auto text-gray-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-700 mb-2">
                  Start a conversation
                </h2>
                <p className="text-gray-500 max-w-sm">
                  Send a message to begin chatting with AI Agent. Your conversations will be saved here.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-4 py-3 bg-red-50 border-t border-red-200">
            <div className="max-w-3xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-700">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm font-medium">{error}</span>
              </div>
              <button
                onClick={handleDismissError}
                className="p-1 hover:bg-red-100 rounded text-red-600"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {isStreaming && (
          <div className="px-4 py-2 bg-blue-50 border-t border-blue-200">
            <div className="max-w-3xl mx-auto flex items-center gap-2 text-blue-700">
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="text-sm">AI is thinking...</span>
            </div>
          </div>
        )}

        {/* Chat Input */}
        <ChatInput />

        {/* Permission Modal */}
        {pendingPermission && (
          <PermissionModal
            permission={pendingPermission}
            onApprove={handleApprovePermission}
            onDeny={handleDenyPermission}
          />
        )}
      </div>
    </MainLayout>
  );
}

export default Chat;
