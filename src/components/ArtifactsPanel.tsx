/**
 * ArtifactsPanel — Right-side panel for previewing generated files.
 *
 * Layout:
 * ┌──────────────────────────────────┐
 * │ ✕  Artifacts         1 / 5      │  ← header
 * ├──────────────────────────────────┤
 * │                                  │
 * │      Large preview of active     │  ← main preview area
 * │      artifact (image / PDF /     │
 * │      code)                       │
 * │                                  │
 * ├──────────────────────────────────┤
 * │ [thumb] [thumb] [thumb] [thumb]  │  ← thumbnail strip
 * └──────────────────────────────────┘
 */

import { useCallback } from 'react';
import { useUIStore } from '@/store';
import { useArtifactsStore, type ArtifactItem } from '@/store/artifactsStore';

// ============= Sub-components =============

/** Render a single artifact preview depending on type */
function ArtifactPreview({ item }: { item: ArtifactItem }) {
  if (item.fileType === 'image' || item.fileType === 'svg') {
    return (
      <img
        src={item.url}
        alt={item.name}
        className="max-w-full max-h-full object-contain rounded"
        draggable={false}
      />
    );
  }

  if (item.fileType === 'pdf') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-gray-500">
        <svg className="w-16 h-16 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="text-sm font-medium">{item.name}</span>
        <span className="text-xs text-gray-400">PDF preview</span>
      </div>
    );
  }

  if (item.fileType === 'code' || item.fileType === 'text') {
    return (
      <div className="w-full h-full p-4 overflow-auto bg-gray-900 rounded">
        <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap break-words">
          {item.url.startsWith('data:') ? atob(item.url.split(',')[1] || '') : item.name}
        </pre>
      </div>
    );
  }

  // Unknown type fallback
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-gray-400">
      <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <span className="text-sm">{item.name}</span>
    </div>
  );
}

/** Single thumbnail in the strip */
function Thumbnail({ item, isActive, onClick }: { item: ArtifactItem; isActive: boolean; onClick: () => void }) {
  const thumbSrc = item.thumbnailUrl || item.url;
  const isVisual = item.fileType === 'image' || item.fileType === 'svg';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 w-16 h-20 rounded-lg overflow-hidden border-2 transition-all duration-150 ${
        isActive
          ? 'border-blue-500 ring-2 ring-blue-200 shadow-md'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      {isVisual ? (
        <img
          src={thumbSrc}
          alt={item.name}
          className="w-full h-full object-cover object-top"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          <span className="text-lg">
            {item.fileType === 'pdf' ? '📄' : item.fileType === 'code' ? '💻' : '📎'}
          </span>
        </div>
      )}
    </button>
  );
}

// ============= Main Component =============

export function ArtifactsPanel() {
  const panelOpen = useArtifactsStore((s) => s.panelOpen);
  const activeItemId = useArtifactsStore((s) => s.activeItemId);
  const activeMessageId = useArtifactsStore((s) => s.activeMessageId);
  const items = useArtifactsStore((s) => s.items);
  const closePanel = useArtifactsStore((s) => s.closePanel);
  const setActiveItem = useArtifactsStore((s) => s.setActiveItem);
  const setAgentPanelTab = useUIStore((s) => s.setAgentPanelTab);

  // Filter to current message's artifacts
  const messageItems = activeMessageId
    ? items.filter((i) => i.messageId === activeMessageId)
    : [];

  const activeItem = messageItems.find((i) => i.id === activeItemId) ?? messageItems[0] ?? null;
  const activeIdx = activeItem ? messageItems.indexOf(activeItem) : -1;

  const handlePrev = useCallback(() => {
    if (messageItems.length < 2 || activeIdx <= 0) return;
    setActiveItem(messageItems[activeIdx - 1].id);
  }, [messageItems, activeIdx, setActiveItem]);

  const handleNext = useCallback(() => {
    if (messageItems.length < 2 || activeIdx >= messageItems.length - 1) return;
    setActiveItem(messageItems[activeIdx + 1].id);
  }, [messageItems, activeIdx, setActiveItem]);

  const handleBackToPanel = useCallback(() => {
    closePanel();
    setAgentPanelTab('main');
  }, [closePanel, setAgentPanelTab]);

  if (!panelOpen || messageItems.length === 0) return null;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBackToPanel}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            title="Back to panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="text-sm">📁</span>
          <span className="text-sm font-semibold text-gray-800">Artifacts</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {activeIdx + 1} / {messageItems.length}
          </span>
          <button
            type="button"
            onClick={closePanel}
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main preview area */}
      <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
        {/* Prev/Next buttons */}
        {messageItems.length > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrev}
              disabled={activeIdx <= 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center bg-white/80 hover:bg-white border border-gray-200 rounded-full shadow-sm disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={activeIdx >= messageItems.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center bg-white/80 hover:bg-white border border-gray-200 rounded-full shadow-sm disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {activeItem && <ArtifactPreview item={activeItem} />}
      </div>

      {/* File name label */}
      {activeItem && (
        <div className="px-4 py-1.5 text-center border-t border-gray-100">
          <span className="text-xs text-gray-500 font-medium">{activeItem.name}</span>
        </div>
      )}

      {/* Thumbnail strip */}
      {messageItems.length > 1 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-white">
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
            {messageItems.map((item) => (
              <Thumbnail
                key={item.id}
                item={item}
                isActive={item.id === activeItemId}
                onClick={() => setActiveItem(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ArtifactsPanel;
