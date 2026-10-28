import React, { useState, useEffect } from 'react';
import { Play, Info, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { MovieItem } from '../types';
import { getImageUrl } from '../utils';

interface HeroBannerProps {
  movies: MovieItem[];
  onSelectMovie: (slug: string) => void;
  onWatchMovie: (slug: string) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  movies,
  onSelectMovie,
  onWatchMovie,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!movies || movies.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % movies.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [movies]);

  if (!movies || movies.length === 0) return null;

  const current = movies[currentIndex] || movies[0];
  const bgImage = current.poster_url || current.thumb_url;

  return (
    <div className="relative w-full h-[460px] sm:h-[540px] md:h-[600px] overflow-hidden bg-black select-none">
      {/* Background Backdrop with Gradient Overlays */}
      <div className="absolute inset-0">
        {bgImage && (
          <img
            src={getImageUrl(bgImage)}
            alt={current.name}
            className="w-full h-full object-cover object-center transform scale-105 filter blur-[1px] opacity-40 transition-all duration-700 ease-out"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#060b05] via-[#060b05]/75 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#060b05] via-[#060b05]/60 to-transparent" />
        {/* Subtle Avocado Glow Atmosphere */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-lime-500/10 filter blur-[120px] pointer-events-none" />
      </div>

      {/* Main Content Area */}
      <div className="relative max-w-7xl mx-auto h-full px-4 sm:px-6 flex flex-col justify-end pb-14 sm:pb-16 z-10">
        <div className="max-w-2xl space-y-3 sm:space-y-4 animate-in fade-in slide-in-from-bottom-6 duration-500 key={current.slug}">
          {/* Badges / Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-lime-500/25 border border-lime-400/40 text-lime-300 text-xs font-bold shadow-sm">
              <Sparkles className="w-3 h-3 text-lime-400" />
              <span>Spotlight Nổi Bật</span>
            </span>

            {current.quality && (
              <span className="px-2 py-0.5 rounded-md bg-yellow-500/20 border border-yellow-500/40 text-[#fef08a] text-xs font-bold">
                {current.quality}
              </span>
            )}

            {current.current_episode && (
              <span className="px-2 py-0.5 rounded-md bg-lime-950/60 border border-lime-500/30 text-lime-300 text-xs font-semibold">
                {current.current_episode}
              </span>
            )}

            {current.year && (
              <span className="px-2 py-0.5 rounded-md bg-black/40 text-[#cbe1c8] text-xs font-medium">
                {typeof current.year === 'object' ? JSON.stringify(current.year) : current.year}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-[#f4fbf0] tracking-tight leading-snug sm:leading-normal pt-2 sm:pt-3 pb-1 line-clamp-2 drop-shadow-md">
            {current.name}
          </h1>

          {/* Original Name */}
          {current.original_name && (
            <p className="text-sm sm:text-base font-semibold text-lime-400/90 -mt-1 line-clamp-1">
              {current.original_name}
            </p>
          )}

          {/* Synopsis (A11Y-01: higher contrast text) */}
          {current.description && (
            <p className="text-xs sm:text-sm text-[#d4ebd2] line-clamp-3 leading-relaxed max-w-xl">
              {current.description.replace(/<[^>]*>/g, '')}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => onWatchMovie(current.slug)}
              className="flex items-center gap-2 px-6 py-2.5 sm:py-3 rounded-xl bg-lime-500 hover:bg-lime-400 text-black font-extrabold text-sm sm:text-base transition-all transform hover:scale-105 shadow-[0_0_25px_rgba(132,204,22,0.5)] cursor-pointer focus-visible:ring-2 focus-visible:ring-white"
            >
              <Play className="w-5 h-5 fill-black" />
              <span>Xem Phim Ngay</span>
            </button>

            <button
              onClick={() => onSelectMovie(current.slug)}
              className="flex items-center gap-2 px-5 py-2.5 sm:py-3 rounded-xl bg-lime-950/50 hover:bg-lime-900/60 text-[#f4fbf0] hover:text-lime-300 font-bold text-sm sm:text-base border border-lime-500/30 transition-all backdrop-blur-md cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400"
            >
              <Info className="w-4 h-4 text-lime-400" />
              <span>Chi Tiết</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Controls & Slide Thumbnails (A11Y-03: min 44x44px touch targets) */}
      <div className="absolute right-4 sm:right-6 bottom-4 sm:bottom-6 z-20 flex items-center gap-2">
        <button
          onClick={() => setCurrentIndex((prev) => (prev - 1 + movies.length) % movies.length)}
          className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-black/70 hover:bg-lime-950 border border-lime-500/25 text-[#d4ebd2] hover:text-lime-300 transition-colors flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
          aria-label="Slide phim trước"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5">
          {movies.slice(0, 6).map((m, idx) => (
            <button
              key={m.slug}
              onClick={() => setCurrentIndex(idx)}
              className={`h-2.5 rounded-full transition-all duration-300 focus-visible:ring-2 focus-visible:ring-lime-400 ${
                idx === currentIndex
                  ? 'w-6 bg-lime-400 shadow-[0_0_8px_#84cc16]'
                  : 'w-2.5 bg-lime-950/80 hover:bg-lime-800'
              }`}
              aria-label={`Tới slide ${idx + 1}`}
            />
          ))}
        </div>

        <button
          onClick={() => setCurrentIndex((prev) => (prev + 1) % movies.length)}
          className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-black/70 hover:bg-lime-950 border border-lime-500/25 text-[#d4ebd2] hover:text-lime-300 transition-colors flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
          aria-label="Slide phim tiếp theo"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
