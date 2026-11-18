import React, { useState, useEffect } from 'react';
import { Play, Pause, Info, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { MovieItem } from '../types';
import { getImageUrl } from '../utils';

interface HeroBannerProps {
  movies: MovieItem[];
  onSelectMovie: (slug: string) => void;
  onWatchMovie: (slug: string, episodeSlug?: string) => void;
}

export function HeroBannerSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="relative w-full min-h-[calc(100svh-4rem)] max-h-[820px] overflow-hidden bg-[#071307] border-b border-lime-500/15"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-[#060b05] via-[#060b05]/80 to-[#0a180b]/60" />
      <div className="relative max-w-7xl mx-auto h-full min-h-[calc(100svh-4rem)] max-h-[820px] px-4 sm:px-6 flex flex-col justify-end pb-20 sm:pb-16">
        <div className="max-w-2xl space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-32 rounded-full bg-lime-500/15 animate-pulse" />
            <div className="h-6 w-14 rounded-md bg-lime-500/10 animate-pulse" />
          </div>
          <div className="h-10 sm:h-14 w-4/5 rounded-xl bg-lime-500/15 animate-pulse" />
          <div className="h-4 w-2/5 rounded-lg bg-lime-500/10 animate-pulse" />
          <div className="space-y-2 pt-1">
            <div className="h-3.5 w-full max-w-xl rounded bg-lime-500/10 animate-pulse" />
            <div className="h-3.5 w-3/4 max-w-md rounded bg-lime-500/10 animate-pulse" />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <div className="h-12 w-44 rounded-xl bg-lime-500/20 animate-pulse" />
            <div className="h-12 w-32 rounded-xl bg-lime-500/10 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  movies,
  onSelectMovie,
  onWatchMovie,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isHoverOrFocus, setIsHoverOrFocus] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!movies || movies.length <= 1) return;
    if (isPaused || isHoverOrFocus || prefersReducedMotion) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % movies.length);
    }, 6500);
    return () => clearInterval(interval);
  }, [movies, isPaused, isHoverOrFocus, prefersReducedMotion]);

  if (!movies || movies.length === 0) return null;

  const current = movies[currentIndex] || movies[0];
  const bgImage = current.poster_url || current.thumb_url;

  const isSingleMovie =
    current.movie_type === 'movie' ||
    current.current_episode?.toLowerCase() === 'full' ||
    (!current.movie_type && Number(current.total_episodes || 1) <= 1);
  const targetEpSlug = isSingleMovie ? 'full' : 'tap-1';
  const watchPath = `/xem-phim/${current.slug}/${targetEpSlug}`;
  const detailPath = `/phim/${current.slug}`;

  const handleLinkClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    action: () => void
  ) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey
    ) {
      return;
    }
    e.preventDefault();
    action();
  };

  const slideCount = Math.min(movies.length, 6);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Phim tiêu điểm nổi bật"
      onMouseEnter={() => setIsHoverOrFocus(true)}
      onMouseLeave={() => setIsHoverOrFocus(false)}
      onFocusCapture={() => setIsHoverOrFocus(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsHoverOrFocus(false);
        }
      }}
      className="relative w-full min-h-[calc(100svh-4rem)] max-h-[820px] overflow-hidden bg-black select-none flex flex-col justify-end"
    >
      {/* Background Backdrop with Gradient Overlays */}
      <div className="absolute inset-0">
        {bgImage && (
          <img
            src={getImageUrl(bgImage)}
            alt={current.name}
            width={1280}
            height={720}
            decoding="async"
            fetchPriority="high"
            className="w-full h-full object-cover object-center opacity-45 transition-opacity duration-500 ease-out"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#060b05] via-[#060b05]/75 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#060b05] via-[#060b05]/60 to-transparent" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-lime-500/10 blur-[120px] pointer-events-none" />
      </div>

      {/* Main Content Area */}
      <div className="relative max-w-7xl w-full mx-auto px-4 sm:px-6 flex flex-col justify-end pb-20 sm:pb-16 pt-24 z-10">
        <div
          key={current.slug}
          className="max-w-2xl space-y-3 sm:space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          {/* Badges / Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-lime-500/20 border border-lime-400/35 text-lime-300 text-xs font-bold shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-lime-400" />
              <span>Spotlight Nổi Bật</span>
            </span>

            {current.quality && (
              <span className="px-2.5 py-0.5 rounded-md bg-yellow-500/20 border border-yellow-500/40 text-[#fef08a] text-xs font-bold">
                {current.quality}
              </span>
            )}

            {current.current_episode && (
              <span className="px-2.5 py-0.5 rounded-md bg-lime-950/60 border border-lime-500/30 text-lime-300 text-xs font-semibold">
                {current.current_episode}
              </span>
            )}

            {current.year && (
              <span className="px-2.5 py-0.5 rounded-md bg-black/50 text-[#cbe1c8] text-xs font-medium tabular-nums">
                {typeof current.year === 'object' ? JSON.stringify(current.year) : current.year}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-[#f4fbf0] tracking-tight leading-snug sm:leading-tight pt-1 pb-0.5 line-clamp-2 drop-shadow-md">
            {current.name}
          </h1>

          {/* Original Name */}
          {current.original_name && (
            <p className="text-sm sm:text-base font-semibold text-lime-400/90 -mt-1 line-clamp-1">
              {current.original_name}
            </p>
          )}

          {/* Synopsis */}
          {current.description && (
            <p className="text-xs sm:text-sm text-[#d4ebd2] line-clamp-3 leading-relaxed max-w-[65ch]">
              {current.description.replace(/<[^>]*>/g, '')}
            </p>
          )}

          {/* Semantic Link Action CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href={watchPath}
              onClick={(e) => handleLinkClick(e, () => onWatchMovie(current.slug, targetEpSlug))}
              className="min-h-[44px] flex items-center gap-2 px-6 py-2.5 sm:py-3 rounded-xl bg-lime-500 hover:bg-lime-400 text-black font-extrabold text-sm sm:text-base transition-all hover:-translate-y-0.5 shadow-[0_4px_18px_rgba(132,204,22,0.35)] cursor-pointer focus-visible:ring-2 focus-visible:ring-white"
            >
              <Play className="w-5 h-5 fill-black" />
              <span>Xem Phim Ngay</span>
            </a>

            <a
              href={detailPath}
              onClick={(e) => handleLinkClick(e, () => onSelectMovie(current.slug))}
              className="min-h-[44px] flex items-center gap-2 px-5 py-2.5 sm:py-3 rounded-xl bg-lime-950/55 hover:bg-lime-900/65 text-[#f4fbf0] hover:text-lime-300 font-bold text-sm sm:text-base border border-lime-500/30 transition-all backdrop-blur-md cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400"
            >
              <Info className="w-4 h-4 text-lime-400" />
              <span>Chi Tiết</span>
            </a>
          </div>
        </div>
      </div>

      {/* Navigation Controls, Pause Toggle & Accessible Touch-Target Slide Dots */}
      {movies.length > 1 && (
        <div className="absolute right-4 sm:right-6 bottom-3 sm:bottom-6 z-20 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsPaused((prev) => !prev)}
            aria-pressed={isPaused}
            aria-label={isPaused ? 'Tiếp tục tự động chuyển slide' : 'Tạm dừng tự động chuyển slide'}
            title={isPaused ? 'Tiếp tục tự chuyển slide' : 'Tạm dừng tự chuyển slide'}
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-black/70 hover:bg-lime-950 border border-lime-500/25 text-[#d4ebd2] hover:text-lime-300 transition-colors flex items-center justify-center cursor-pointer"
          >
            {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
          </button>

          <button
            type="button"
            onClick={() => setCurrentIndex((prev) => (prev - 1 + movies.length) % movies.length)}
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-black/70 hover:bg-lime-950 border border-lime-500/25 text-[#d4ebd2] hover:text-lime-300 transition-colors flex items-center justify-center cursor-pointer"
            aria-label="Slide phim trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center" role="tablist" aria-label="Chọn slide tiêu điểm">
            {movies.slice(0, slideCount).map((m, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={m.slug}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setCurrentIndex(idx)}
                  className="min-w-[28px] min-h-[44px] px-1 flex items-center justify-center cursor-pointer group/dot"
                  aria-label={`Tới slide ${idx + 1}: ${m.name}`}
                >
                  <span
                    className={`h-2.5 rounded-full transition-all duration-300 ${
                      isActive
                        ? 'w-6 bg-lime-400 shadow-[0_0_8px_rgba(132,204,22,0.7)]'
                        : 'w-2.5 bg-lime-900/90 group-hover/dot:bg-lime-600'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setCurrentIndex((prev) => (prev + 1) % movies.length)}
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-black/70 hover:bg-lime-950 border border-lime-500/25 text-[#d4ebd2] hover:text-lime-300 transition-colors flex items-center justify-center cursor-pointer"
            aria-label="Slide phim tiếp theo"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </section>
  );
};
