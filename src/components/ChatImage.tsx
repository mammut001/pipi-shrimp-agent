import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { t } from '@/i18n';

interface ChatImageProps {
  src: string;
  alt?: string;
  className?: string;
  isSVG?: boolean;
}

export const ChatImage = ({ src, alt, className = '', isSVG = false }: ChatImageProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(!isSVG);

  const toggleOpen = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = src;
    link.download = alt || 'pipi-shrimp-image';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Render actual image content
   */
  const renderContent = (isLightbox: boolean = false) => {
    if (isSVG && src.trim().startsWith('<svg')) {
      const sanitizedSvg = DOMPurify.sanitize(src, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script'],
        FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
      });
      return (
        <div 
          className={isLightbox ? 'max-w-full max-h-[90vh]' : 'max-w-full'}
          dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
        />
      );
    }

    if (hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-xs">{t('common.error')}</span>
        </div>
      );
    }

    return (
      <img
        src={src}
        alt={alt || 'Image'}
        className={`${isLightbox ? 'max-w-full max-h-[90vh] object-contain' : 'max-w-full rounded-xl cursor-zoom-in hover:opacity-90 transition-opacity'} ${className}`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setHasError(true);
          setIsLoading(false);
        }}
        loading="lazy"
      />
    );
  };

  return (
    <div className="my-4 relative group">
      {isLoading && (
        <div className="w-full aspect-video bg-gray-100 animate-pulse rounded-xl flex items-center justify-center">
           <div className="flex gap-1">
            <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
            <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        </div>
      )}

      <div onClick={toggleOpen} className={isLoading ? 'hidden' : 'relative'}>
        {renderContent()}
        
        {/* Floating Actions on Hover */}
        {!hasError && !isOpen && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
            <button
               onClick={handleDownload}
               className="p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg backdrop-blur-sm transition-colors"
               title={t('common.copy')} // Reusing copy or add download to t()
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Lightbox / Modal Portal */}
      {isOpen && createPortal(
        <div 
          className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 md:p-12 animate-in fade-in duration-300"
          onClick={toggleOpen}
        >
          {/* Close Button */}
          <button 
            className="absolute top-6 right-6 p-2 text-white/50 hover:text-white transition-colors"
            onClick={toggleOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Download Button */}
          <button 
            className="absolute bottom-6 right-6 px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl backdrop-blur-md transition-all flex items-center gap-2"
            onClick={handleDownload}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Download
          </button>

          {/* Image Title / Alt */}
          {alt && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 text-white/80 font-medium">
              {alt}
            </div>
          )}

          <div 
            className="relative transform transition-transform duration-300 scale-100"
            onClick={e => e.stopPropagation()}
          >
            {renderContent(true)}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
