import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import DOMPurify from 'dompurify';

interface FilmSynopsisProps {
  htmlContent: string;
}

const SYNOPSIS_ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'i',
  'em',
  'strong',
  'ul',
  'ol',
  'li',
];

export const FilmSynopsis: React.FC<FilmSynopsisProps> = ({ htmlContent }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const cleanHtml = useMemo(
    () =>
      DOMPurify.sanitize(
        htmlContent || '<p>Nội dung phim đang được cập nhật...</p>',
        {
          ALLOWED_TAGS: SYNOPSIS_ALLOWED_TAGS,
          ALLOWED_ATTR: [],
        }
      ),
    [htmlContent]
  );

  useEffect(() => {
    setIsExpanded(false);
  }, [cleanHtml]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measureOverflow = () => {
      if (isExpanded) return;
      setIsOverflowing(el.scrollHeight > el.clientHeight + 4);
    };

    measureOverflow();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measureOverflow);
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', measureOverflow);
    return () => window.removeEventListener('resize', measureOverflow);
  }, [cleanHtml, isExpanded]);

  const showToggle = isOverflowing || isExpanded;

  return (
    <div className="space-y-2">
      <h2 className="text-base sm:text-lg font-bold text-lime-300">
        Nội Dung Phim
      </h2>

      <div className="relative max-w-[68ch]">
        <div
          ref={contentRef}
          className={`text-xs sm:text-sm text-[#cbe1c8] leading-relaxed transition-all duration-300 ${
            !isExpanded ? 'max-h-28 overflow-hidden' : 'max-h-none'
          }`}
          dangerouslySetInnerHTML={{
            __html: cleanHtml,
          }}
        />

        {/* Fade gradient overlay ONLY when real DOM overflow exists */}
        {!isExpanded && isOverflowing && (
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#071307] to-transparent pointer-events-none"
          />
        )}
      </div>

      {showToggle && (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          className="inline-flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 px-2 -ml-2 rounded-lg min-h-[44px] touch-manipulation cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400"
        >
          <span>{isExpanded ? 'Thu gọn nội dung' : 'Xem thêm nội dung'}</span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
};
