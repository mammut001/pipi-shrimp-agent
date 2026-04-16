/**
 * NotificationToast - Toast notification component
 *
 * Displays floating messages from the uiStore with auto-dismiss
 */

import type { ReactNode } from 'react';
import { useUIStore } from '@/store';
import type { Notification } from '@/types/ui';

/**
 * Single Toast Item component
 */
function ToastItem({ notification }: { notification: Notification }) {
  const { removeNotification } = useUIStore();

  // Skill notifications get a special gradient treatment
  if (notification.type === 'skill') {
    return (
      <div
        className="relative flex items-center gap-3 px-4 py-3 rounded-xl border border-purple-300/50 shadow-lg animate-in slide-in-from-right-full fade-in duration-300 overflow-hidden"
        role="alert"
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
          backgroundSize: '200% 200%',
          animation: 'skill-gradient 3s ease infinite, slide-in-from-right-full 0.3s ease-out',
        }}
      >
        {/* Shimmer overlay */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'skill-shimmer 2s ease-in-out infinite',
          }}
        />
        <div className="relative flex-shrink-0 text-white">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="relative text-sm font-semibold text-white pr-4 drop-shadow-sm">
          {notification.message}
        </div>
        <button
          type="button"
          onClick={() => removeNotification(notification.id)}
          className="relative flex-shrink-0 ml-auto p-1 rounded-md hover:bg-white/20 transition-colors text-white/80 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  const typeStyles: Record<string, string> = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  };

  const iconMap: Record<string, ReactNode> = {
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

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-in slide-in-from-right-full fade-in duration-300 ${typeStyles[notification.type]}`}
      role="alert"
    >
      <div className="flex-shrink-0">
        {iconMap[notification.type]}
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
  const { notifications } = useUIStore();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-full">
      {notifications.map((notification) => (
        <ToastItem key={notification.id} notification={notification} />
      ))}
    </div>
  );
}

export default NotificationToast;
