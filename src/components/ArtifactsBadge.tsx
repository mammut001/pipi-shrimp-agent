/**
 * ArtifactsBadge — Inline 📁 button shown in chat messages
 * that have generated artifacts (files, images, etc.)
 *
 * Clicking it opens the ArtifactsPanel in the right column.
 */

import { useArtifactsStore } from '@/store/artifactsStore';

interface ArtifactsBadgeProps {
  messageId: string;
}

export function ArtifactsBadge({ messageId }: ArtifactsBadgeProps) {
  const items = useArtifactsStore((s) => s.items);
  const openPanel = useArtifactsStore((s) => s.openPanel);

  const count = items.filter((i) => i.messageId === messageId).length;
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => openPanel(messageId)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-2 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg text-xs text-gray-600 hover:text-gray-800 transition-colors group"
    >
      <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
      <span className="font-medium">{count} {count === 1 ? 'file' : 'files'} generated</span>
      <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </button>
  );
}

export default ArtifactsBadge;
