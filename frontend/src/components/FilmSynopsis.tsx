import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import DOMPurify from 'dompurify';

interface FilmSynopsisProps {
  htmlContent: string;
}

export const FilmSynopsis: React.FC<FilmSynopsisProps> = ({ htmlContent }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const cleanHtml = DOMPurify.sanitize(htmlContent || '<p>Nội dung phim đang được cập nhật...</p>');
  const textLength = (htmlContent || '').replace(/<[^>]*>/g, '').length;
  const isLong = textLength > 280;

  return (
    <div className="space-y-2">
      <h2 className="text-base sm:text-lg font-bold text-lime-300">
        Nội Dung Phim
      </h2>

      <div className="relative">
        <div
          className={`text-xs sm:text-sm text-[#cbe1c8] leading-relaxed transition-all duration-300 ${
            !isExpanded && isLong ? 'max-h-28 overflow-hidden' : 'max-h-none'
          }`}
          dangerouslySetInnerHTML={{
            __html: cleanHtml,
          }}
        />

        {/* Fade gradient overlay when collapsed */}
        {!isExpanded && isLong && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#060b05] to-transparent pointer-events-none" />
        )}
      </div>

      {isLong && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 pt-1 focus:outline-none min-h-[36px] touch-manipulation cursor-pointer"
        >
          <span>{isExpanded ? 'Thu gọn nội dung' : 'Xem thêm nội dung'}</span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
};
