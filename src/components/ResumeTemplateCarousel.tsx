/**
 * ResumeTemplateCarousel - Horizontal carousel for resume template previews.
 *
 * Rendered inline in chat when the AI outputs a ```resume-templates code block.
 * Shows 5 template SVG previews that the user can scroll through, click to
 * enlarge, and select.  On selection the template ID is sent back as a user
 * message so the AI can proceed with the questionnaire flow.
 */

import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '@/store';

export interface ResumeTemplate {
  id: string;
  name: string;
  description: string;
  preview: string; // URL to SVG preview (e.g. /resume-previews/basic-resume.svg)
}

const BUILT_IN_TEMPLATES: ResumeTemplate[] = [
  {
    id: 'basic-resume',
    name: 'Basic Resume',
    description: 'Clean single-column layout. Great for software engineers and new grads.',
    preview: '/resume-previews/basic-resume.png',
  },
  {
    id: 'brilliant-cv',
    name: 'Brilliant CV',
    description: 'Photo sidebar with color accent. Multi-language support, great for international roles.',
    preview: '/resume-previews/brilliant-cv.png',
  },
  {
    id: 'calligraphics',
    name: 'Calligraphics',
    description: 'Elegant two-column design with artistic flair. Perfect for creative professionals.',
    preview: '/resume-previews/calligraphics.png',
  },
  {
    id: 'grotesk-cv',
    name: 'Grotesk CV',
    description: 'Modern sans-serif style with warm tones. Professional and distinctive.',
    preview: '/resume-previews/grotesk-cv.png',
  },
  {
    id: 'nabcv',
    name: 'NAB CV',
    description: 'TOML-driven sidebar layout with icons. Structured and data-focused.',
    preview: '/resume-previews/nabcv.png',
  },
];

interface ResumeTemplateCarouselProps {
  /** Optional JSON override — if omitted, uses built-in templates */
  dataJson?: string;
}

export function ResumeTemplateCarousel({ dataJson }: ResumeTemplateCarouselProps) {
  const templates: ResumeTemplate[] = (() => {
    if (!dataJson) return BUILT_IN_TEMPLATES;
    try {
      const parsed = JSON.parse(dataJson);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : BUILT_IN_TEMPLATES;
    } catch {
      return BUILT_IN_TEMPLATES;
    }
  })();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sendMessage = useChatStore((s) => s.sendMessage);

  // Scroll helpers
  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 220;
    el.scrollBy({ left: dir === 'left' ? -cardWidth : cardWidth, behavior: 'smooth' });
  }, []);

  // User picks a template → send message back to the AI
  const handleSelect = useCallback((tpl: ResumeTemplate) => {
    setSelectedId(tpl.id);
    sendMessage(`I'd like to use the **${tpl.name}** template (id: \`${tpl.id}\`). Please call Skill("resume") first to load the template code examples before writing any files.`);
  }, [sendMessage]);

  // Lightbox navigation
  const lightboxPrev = useCallback(() => {
    setLightboxIdx((i) => (i !== null ? (i - 1 + templates.length) % templates.length : null));
  }, [templates.length]);
  const lightboxNext = useCallback(() => {
    setLightboxIdx((i) => (i !== null ? (i + 1) % templates.length : null));
  }, [templates.length]);

  return (
    <div className="my-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">📄</span>
        <span className="text-sm font-semibold text-gray-800">Choose a Resume Template</span>
        <span className="text-xs text-gray-400">— click to preview, then select</span>
      </div>

      {/* Carousel */}
      <div className="relative group/carousel">
        {/* Left arrow */}
        <button
          type="button"
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-white/90 border border-gray-200 rounded-full shadow-md opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-gray-100"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Scrollable container */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-2 scroll-smooth snap-x snap-mandatory px-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {templates.map((tpl, idx) => {
            const isSelected = selectedId === tpl.id;
            return (
              <div
                key={tpl.id}
                className={`snap-start flex-shrink-0 w-[200px] rounded-xl border-2 overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
                  isSelected
                    ? 'border-blue-500 ring-2 ring-blue-200 shadow-blue-100'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Preview thumbnail — click to open lightbox */}
                <div
                  className="relative w-full h-[260px] bg-white overflow-hidden"
                  onClick={() => setLightboxIdx(idx)}
                >
                  <img
                    src={tpl.preview}
                    alt={tpl.name}
                    className="w-full h-full object-cover object-top"
                    loading="lazy"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
                    <span className="opacity-0 hover:opacity-100 text-white text-xs bg-black/50 px-2 py-1 rounded-full transition-opacity">
                      🔍 Preview
                    </span>
                  </div>
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info + select button */}
                <div className="p-2.5 bg-gray-50 border-t border-gray-100">
                  <div className="text-xs font-semibold text-gray-800 mb-0.5">{tpl.name}</div>
                  <div className="text-[10px] text-gray-500 mb-2 line-clamp-2 leading-tight">{tpl.description}</div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleSelect(tpl); }}
                    disabled={isSelected}
                    className={`w-full py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-blue-500 text-white cursor-default'
                        : 'bg-gray-900 text-white hover:bg-gray-800'
                    }`}
                  >
                    {isSelected ? '✓ Selected' : 'Use This Template'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-white/90 border border-gray-200 rounded-full shadow-md opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-gray-100"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Lightbox portal */}
      {lightboxIdx !== null && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          {/* Prev button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); lightboxPrev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/40 rounded-full text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Image */}
          <div
            className="max-w-[90vw] max-h-[90vh] overflow-auto bg-white rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-2 border-b border-gray-100 flex items-center justify-between px-4">
              <span className="text-sm font-semibold text-gray-800">
                {templates[lightboxIdx].name}
              </span>
              <span className="text-xs text-gray-400">
                {lightboxIdx + 1} / {templates.length}
              </span>
            </div>
            <img
              src={templates[lightboxIdx].preview}
              alt={templates[lightboxIdx].name}
              className="w-auto max-h-[80vh]"
            />
          </div>

          {/* Next button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); lightboxNext(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/40 rounded-full text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={() => setLightboxIdx(null)}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/40 rounded-full text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ResumeTemplateCarousel;
