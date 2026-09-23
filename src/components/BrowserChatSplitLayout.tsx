/**
 * Browser + chat side-by-side dock layout for `browserDockMode=split`.
 *
 * Extracted from ChatBrowserWorkspaceShell (AG-15). `browserSplitFocus`
 * enlarges the focused pane (3:2 vs 2:3).
 */

import type { ReactNode } from 'react';
import type { SplitFocus } from '@/types/ui';

export type BrowserSplitFocus = SplitFocus;

export interface BrowserChatSplitLayoutProps {
  browserSplitFocus: SplitFocus;
  browser: ReactNode;
  chat: ReactNode;
}

export function BrowserChatSplitLayout({
  browserSplitFocus,
  browser,
  chat,
}: BrowserChatSplitLayoutProps) {
  return (
    <div className="flex-1 flex min-h-0 min-w-0" data-testid="browser-chat-split-layout">
      <div
        className={`min-w-0 bg-white ${
          browserSplitFocus === 'browser' ? 'flex-[3]' : 'flex-[2]'
        }`}
        data-testid="browser-chat-split-browser"
      >
        {browser}
      </div>
      <div
        className={`flex min-h-0 min-w-0 flex-col border-l border-gray-200 ${
          browserSplitFocus === 'chat' ? 'flex-[3]' : 'flex-[2]'
        }`}
        data-testid="browser-chat-split-chat"
      >
        {chat}
      </div>
    </div>
  );
}

export default BrowserChatSplitLayout;
