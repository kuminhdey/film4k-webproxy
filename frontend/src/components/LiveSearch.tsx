import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, X, Film } from 'lucide-react';
import { getSearchSuggestions } from '../api';
import { SearchSuggestion } from '../types';
import { getImageUrl } from '../utils';

interface LiveSearchProps {
  onSelectMovie: (slug: string) => void;
}

export default function LiveSearch({ onSelectMovie }: LiveSearchProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      setIsLoading(false);
      setIsOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const abortController = new AbortController();

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const items = await getSearchSuggestions(query, abortController.signal);
        if (!abortController.signal.aborted) {
          setSuggestions(items);
          setActiveSuggestionIndex(-1);
          setIsLoading(false);
          setIsOpen(true);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [query]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (slug: string) => {
    onSelectMovie(slug);
    setQuery('');
    setIsOpen(false);
    setActiveSuggestionIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }
    if (isOpen && suggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActiveSuggestionIndex((current) => e.key === 'ArrowDown'
        ? Math.min(current + 1, suggestions.length - 1)
        : Math.max(current - 1, -1));
      return;
    }
    if (e.key === 'Enter' && query.trim()) {
      if (isOpen && activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
        handleSelect(suggestions[activeSuggestionIndex].slug);
        return;
      }
      // Trigger search page navigation
      window.history.pushState({}, '', `/tim-kiem?keyword=${encodeURIComponent(query.trim())}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      setIsOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-autocomplete="list"
          placeholder="Tìm phim, diễn viên..."
          aria-label="Tìm kiếm phim hoặc diễn viên"
          aria-expanded={isOpen}
          aria-controls={isOpen ? 'live-search-suggestions' : undefined}
          aria-activedescendant={activeSuggestionIndex >= 0 ? `live-search-option-${activeSuggestionIndex}` : undefined}
          className="w-full bg-[#0a180b]/90 border border-lime-500/25 rounded-full py-1.5 pl-8 pr-8 text-xs text-[#f4fbf0] placeholder-[#9cb897] focus:outline-none focus:border-lime-400 focus:ring-2 focus:ring-lime-400/40 transition-all shadow-inner"
        />
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-[#9cb897] pointer-events-none" />
        {isLoading ? (
          <Loader2 className="absolute right-2.5 w-3.5 h-3.5 text-lime-400 animate-spin" />
        ) : query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Xóa từ khóa tìm kiếm"
            className="absolute right-2 p-1 text-[#9cb897] hover:text-white rounded-full hover:bg-lime-500/20 focus-visible:ring-2 focus-visible:ring-lime-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      {/* Instant Suggestions Dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-[340px] sm:w-[400px] md:w-[440px] max-w-[92vw] bg-[#081509] border border-lime-500/30 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.9)] overflow-hidden z-50 backdrop-blur-2xl max-h-[520px] overflow-y-auto">
          {suggestions.length > 0 ? (
            <div>
              <div id="live-search-suggestions" role="listbox" aria-label="Gợi ý tìm kiếm" className="py-2 divide-y divide-lime-500/10">
                {suggestions.map((item, index) => (
                  <div
                    role="option"
                    aria-selected={index === activeSuggestionIndex}
                    id={`live-search-option-${index}`}
                    key={item.slug}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(item.slug)}
                    className={`flex w-full text-left items-center gap-3 px-3.5 py-2.5 hover:bg-lime-950/40 cursor-pointer transition-colors group ${index === activeSuggestionIndex ? 'bg-lime-950/40' : ''}`}
                  >
                    <div className="w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-black/50 border border-lime-500/20">
                      {item.thumb_url ? (
                        <img
                          src={getImageUrl(item.thumb_url)}
                          alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lime-500">
                          <Film className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-[#f4fbf0] group-hover:text-lime-300 transition-colors line-clamp-2 leading-snug">
                        {item.name}
                      </p>
                      {item.original_name && (
                        <p className="text-[11px] text-[#8aa885] truncate mt-0.5">
                          {item.original_name}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {item.current_episode && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-lime-500/20 text-lime-300 border border-lime-500/30">
                            {item.current_episode}
                          </span>
                        )}
                        {item.quality && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                            {item.quality}
                          </span>
                        )}
                        {item.year && (
                          <span className="text-[10px] text-[#8aa885] font-medium">
                            {item.year}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button"
                onClick={() => {
                  window.history.pushState({}, '', `/tim-kiem?keyword=${encodeURIComponent(query.trim())}`);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                  setIsOpen(false);
                }}
                className="w-full py-2.5 px-3 text-center text-xs font-semibold text-lime-400 hover:text-lime-300 hover:bg-lime-950/50 cursor-pointer transition-colors border-t border-lime-500/15 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-lime-400"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Xem tất cả kết quả cho "{query}"</span>
              </button>
            </div>
          ) : !isLoading ? (
            <div id="live-search-suggestions" role="listbox" aria-label="Gợi ý tìm kiếm" className="p-4 text-center text-xs text-[#8aa885]">
              <div role="option" aria-disabled="true">Không tìm thấy phim phù hợp với từ khóa</div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
