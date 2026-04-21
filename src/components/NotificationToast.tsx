/**
 * NotificationToast - Toast notification component
 *
 * Displays floating messages from the uiStore with auto-dismiss
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChatStore, useUIStore } from '@/store';
import type { Notification } from '@/types/ui';

function formatTimestamp(timestamp?: number) {
  if (!timestamp) return '';

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTypeStyles(type: Notification['type']) {
  const typeStyles: Record<Exclude<Notification['type'], 'skill'>, string> = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  };

  return type === 'skill' ? 'bg-slate-50 border-slate-200 text-slate-700' : typeStyles[type];
}

function getTypeIcon(type: Notification['type']) {
  const iconMap: Record<Exclude<Notification['type'], 'skill'>, ReactNode> = {
    info: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    warning: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  if (type === 'skill') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.143 2.143 0 01-.627 1.516L4.39 15.067a2.143 2.143 0 000 3.03l1.514 1.515a2.143 2.143 0 003.03 0l4.733-4.734a2.143 2.143 0 011.516-.627h5.714M15 5h4m0 0v4m0-4L10 14" />
      </svg>
    );
  }

  return iconMap[type];
}

function HistoryButton({ count, isOpen, onClick }: { count: number; isOpen: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pointer-events-auto relative inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white/95 text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-slate-50 hover:text-slate-900 ${isOpen ? 'border-slate-300' : 'border-slate-200'}`}
      aria-label="查看通知历史"
      aria-expanded={isOpen}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 min-w-[1rem] rounded-full bg-slate-900 px-1 text-[10px] font-semibold leading-4 text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

function NotificationHistoryPanel({
  notifications,
  onClear,
}: {
  notifications: Notification[];
  onClear: () => void;
}) {
  return (
    <div className="pointer-events-auto w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Toast History</p>
          <p className="text-xs text-slate-400">最近 {notifications.length} 条通知</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        >
          清空
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto p-2">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`mb-2 flex gap-3 rounded-xl border px-3 py-2 last:mb-0 ${getTypeStyles(notification.type)}`}
          >
            <div className="mt-0.5 flex-shrink-0">{getTypeIcon(notification.type)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-5">{notification.message}</p>
                <span className="whitespace-nowrap text-[11px] font-medium opacity-70">
                  {formatTimestamp(notification.timestamp)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Single Toast Item component
 */
function ToastItem({ notification }: { notification: Notification }) {
  const { removeNotification } = useUIStore();

  // Skill notifications are now surfaced inline in the AgentPanel's
  // Context → Skills section. Skip them here to avoid the shimmer toast.
  if (notification.type === 'skill') return null;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-in slide-in-from-right-full fade-in duration-300 ${getTypeStyles(notification.type)}`}
      role="alert"
    >
      <div className="flex-shrink-0">
        {getTypeIcon(notification.type)}
      </div>
      <div className="text-sm font-medium pr-4">
        {notification.message}
      </div>
      <button
        type="button"
        onClick={() => removeNotification(notification.id)}
        className="flex-shrink-0 ml-auto p-1 rounded-md hover:bg-black/5 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Toast Container component
 */
export function NotificationToast() {
  const { notifications, notificationHistory, clearNotificationHistory } = useUIStore();
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => !notification.sessionId || notification.sessionId === currentSessionId),
    [currentSessionId, notifications],
  );
  const visibleHistory = useMemo(
    () => notificationHistory.filter((notification) => notification.type !== 'skill' && (!notification.sessionId || notification.sessionId === currentSessionId)),
    [currentSessionId, notificationHistory],
  );

  useEffect(() => {
    if (!historyOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [historyOpen]);

  if (visibleNotifications.length === 0 && visibleHistory.length === 0) return null;

  return (
    <div ref={containerRef} className="fixed top-6 right-6 z-[9999] flex w-full max-w-sm flex-col items-end gap-2">
      <HistoryButton
        count={visibleHistory.length}
        isOpen={historyOpen}
        onClick={() => setHistoryOpen((open) => !open)}
      />

      {historyOpen && visibleHistory.length > 0 && (
        <NotificationHistoryPanel
          notifications={visibleHistory}
          onClear={() => {
            clearNotificationHistory(currentSessionId || undefined);
            setHistoryOpen(false);
          }}
        />
      )}

      <div className="flex w-full flex-col gap-3">
        {visibleNotifications.map((notification) => (
          <ToastItem key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  );
}

export default NotificationToast;
