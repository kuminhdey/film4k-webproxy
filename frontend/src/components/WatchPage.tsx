import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Loader2, Info, Film, AlertCircle, Minimize2, Maximize2, X } from 'lucide-react';
import { getMovieDetail } from '../api';
import { MovieDetail, EpisodeServer, EpisodeItem } from '../types';
import { VideoPlayer } from './VideoPlayer';
import { EpisodeSelector } from './EpisodeSelector';
import { FilmSynopsis } from './FilmSynopsis';
import { RelatedMoviesRow } from './RelatedMoviesRow';
import { ErrorBoundary } from './ErrorBoundary';
import { getImageUrl } from '../utils';

interface WatchPageProps {
  slug: string;
  episodeSlug?: string;
  onBack: () => void;
  onNavigateEpisode: (slug: string, epSlug: string) => void;
  onSelectMovie?: (slug: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({
  slug,
  episodeSlug,
  onBack,
  onNavigateEpisode,
  onSelectMovie,
}) => {
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeServerIndex, setActiveServerIndex] = useState(0);
  const [playerMode, setPlayerMode] = useState<'hls' | 'embed'>('hls');
  const [isTheater, setIsTheater] = useState(false);

  // ===== Scroll-Driven Floating Miniplayer =====
  const miniSentinelRef = useRef<HTMLDivElement | null>(null);
  const [isMiniplayer, setIsMiniplayer] = useState(false);
  const [miniplayerClosed, setMiniplayerClosed] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const el = miniSentinelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const past = rect.bottom < 0;
      setIsMiniplayer((prev) => {
        const next = past;
        if (!next && prev) {
          setMiniplayerClosed(false);
        }
        return next;
      });
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const showMiniplayer = isMiniplayer && !isTheater && !miniplayerClosed;

  const handleMaximizeMiniplayer = useCallback(() => {
    const el = miniSentinelRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setIsMiniplayer(false);
    setMiniplayerClosed(false);
  }, []);

  const handleCloseMiniplayer = useCallback(() => {
    setMiniplayerClosed(true);
  }, []);

  const toggleTheater = useCallback(() => {
    setIsTheater((prev) => !prev);
  }, []);

  // Escape exits theater mode
  useEffect(() => {
    if (!isTheater) return;
    const handleKey = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        setIsTheater(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [isTheater]);

  // Lock body scroll in theater mode
  useEffect(() => {
    if (isTheater) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isTheater]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setActiveServerIndex(0);

    getMovieDetail(slug).then((data) => {
      if (!isMounted) return;
      if (data) {
        setMovie(data);
        setActiveServerIndex(0);
      } else {
        setError('Không thể tải thông tin xem phim. Vui lòng thử lại sau.');
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [slug]);

  useEffect(() => {
    setPlayerMode('hls');
  }, [slug, episodeSlug]);

  if (loading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center text-center">
        <Loader2 className="w-12 h-12 text-lime-400 animate-spin mb-3" />
        <p className="text-sm font-semibold text-[#8aa885]">
          Đang khởi tạo phòng chiếu Bơ Film...
        </p>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="py-24 text-center max-w-md mx-auto space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <p className="text-red-400 text-sm font-semibold">{error || 'Không tìm thấy phim'}</p>
        <button
          onClick={onBack}
          className="px-5 py-2 rounded-xl bg-lime-500 text-black text-xs font-bold hover:bg-lime-400 transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại</span>
        </button>
      </div>
    );
  }

  const servers: EpisodeServer[] = movie.episodes || [];
  const currentServer = servers[activeServerIndex] || servers[0];
  const items: EpisodeItem[] = currentServer?.items || [];

  // Match episode item
  let currentEpisode: EpisodeItem | undefined;
  let currentEpisodeIndex = -1;
  if (episodeSlug) {
    const cleanTarget = episodeSlug.replace(/^tap-/i, '').trim();
    currentEpisodeIndex = items.findIndex((ep) => {
      const cleanName = ep.name.replace(/^Tập\s*/i, '').trim();
      const cleanSlug = ep.slug.replace(/^tap-/i, '').trim();
      return (
        ep.slug === episodeSlug ||
        ep.name === episodeSlug ||
        cleanName === cleanTarget ||
        cleanSlug === cleanTarget ||
        cleanName === episodeSlug ||
        cleanSlug === episodeSlug
      );
    });
    if (currentEpisodeIndex !== -1) {
      currentEpisode = items[currentEpisodeIndex];
    }
  }
  if (!currentEpisode && items.length > 0) {
    currentEpisode = items[0];
    currentEpisodeIndex = 0;
  }

  const nextEpisode =
    currentEpisodeIndex >= 0 && currentEpisodeIndex < items.length - 1
      ? items[currentEpisodeIndex + 1]
      : undefined;

  const prevEpisode =
    currentEpisodeIndex > 0 ? items[currentEpisodeIndex - 1] : undefined;

  const handleSelectEpisode = (epSlug: string) => {
    setPlayerMode('hls');
    onNavigateEpisode(slug, epSlug);
  };

  const handleNextEpisode = () => {
    if (nextEpisode) {
      handleSelectEpisode(nextEpisode.slug);
    }
  };

  const handlePrevEpisode = () => {
    if (prevEpisode) {
      handleSelectEpisode(prevEpisode.slug);
    }
  };

  const cleanEp = currentEpisode?.name
    ? currentEpisode.name.replace(/^Tập\s*/i, '').trim()
    : (currentEpisode?.slug ? currentEpisode.slug.replace(/^tap-/i, '').trim() : '');

  // Extract categories/genres for related movies
  const genresList: string[] = [];
  if (movie.category) {
    Object.values(movie.category).forEach((cg) => {
      if (cg?.list) {
        cg.list.forEach((item) => {
          if (item?.name) genresList.push(item.name);
        });
      }
    });
  }

  const hlsStreamUrl = cleanEp
    ? `/api/stream/${encodeURIComponent(movie.slug)}/ep/${encodeURIComponent(cleanEp)}/master.m3u8?server=${activeServerIndex}`
    : `/api/stream/${encodeURIComponent(movie.slug)}/master.m3u8?server=${activeServerIndex}`;

  const playerElement = (
    <ErrorBoundary fallbackTitle="Không thể khởi chạy trình phát video">
      <VideoPlayer
        embedUrl={currentEpisode?.embed || ''}
        m3u8Url={hlsStreamUrl}
        serverIndex={activeServerIndex}
        movieName={movie.name}
        movieSlug={movie.slug}
        episodeName={currentEpisode?.name || '1'}
        episodeSlug={currentEpisode?.slug || 'tap-1'}
        posterUrl={getImageUrl(movie.poster_url || movie.thumb_url)}
        playerMode={playerMode}
        onPlayerModeChange={setPlayerMode}
        nextEpisode={nextEpisode ? { name: nextEpisode.name, slug: nextEpisode.slug } : undefined}
        onNextEpisode={nextEpisode ? handleNextEpisode : undefined}
        prevEpisode={prevEpisode ? { name: prevEpisode.name, slug: prevEpisode.slug } : undefined}
        onPrevEpisode={prevEpisode ? handlePrevEpisode : undefined}
        allEpisodes={items.map((ep) => ({ name: ep.name, slug: ep.slug }))}
        currentEpisodeSlug={currentEpisode?.slug}
        onSelectEpisode={handleSelectEpisode}
        isTheater={isTheater}
        onToggleTheater={toggleTheater}
      />
    </ErrorBoundary>
  );

  // Theater Mode: fixed full-viewport overlay with only the player
  if (isTheater) {
    return (
      <div className="fixed inset-0 z-50 bg-black overflow-y-auto animate-in fade-in duration-300">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-2.5 bg-[#09150a]/95 backdrop-blur-md border-b border-lime-500/20">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#cbe1c8] truncate min-w-0">
            <span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse flex-shrink-0" />
            <span className="truncate">
              {movie.name} —{' '}
              <span className="text-lime-400 font-bold">
                {currentEpisode?.name ? `Tập ${currentEpisode.name}` : ''}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={toggleTheater}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-lime-500/20 border border-lime-500/40 text-lime-300 hover:bg-lime-500 hover:text-black text-xs font-bold transition-colors flex-shrink-0"
            title="Thoát chế độ rạp chiếu (Esc)"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>Thu nhỏ</span>
          </button>
        </div>
        <div className="px-2 sm:px-4 py-3 sm:py-5 max-w-[1800px] mx-auto">
          {playerElement}
          <p className="text-center text-[11px] text-[#8aa885] mt-3">
            Chế độ rạp chiếu — bấm "Thu nhỏ" hoặc phím <kbd className="px-1 py-0.5 rounded bg-lime-950/60 border border-lime-500/30 text-lime-300 font-black">Esc</kbd> để quay lại trang xem phim.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Back button & Breadcrumb */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#071307] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 text-xs font-semibold transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại chi tiết</span>
        </button>

        <span className="text-xs text-[#8aa885] truncate max-w-[200px] sm:max-w-md">
          {movie.name} — <span className="text-lime-400 font-bold">{currentEpisode?.name ? `Tập ${currentEpisode.name}` : ''}</span>
        </span>
      </div>

      {/* Video Player */}
      <div ref={miniSentinelRef} aria-hidden className="h-0" />
      {showMiniplayer && (
        <div className="aspect-video w-full rounded-2xl bg-[#071307] border border-lime-500/25 flex items-center justify-center text-xs text-[#8aa885] border-dashed">
          <span className="truncate">Đang phát ở miniplayer góc màn hình</span>
        </div>
      )}
      <div
        className={
          showMiniplayer
            ? 'fixed bottom-4 right-4 z-[55] w-[380px] max-w-[92vw] rounded-2xl bg-[#09150a] border border-lime-500/40 shadow-[0_18px_55px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200'
            : 'w-full'
        }
      >
        {showMiniplayer && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#0a1f0d] border-b border-lime-500/30">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-lime-300 truncate min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse flex-shrink-0" />
              <span className="truncate">{movie.name}</span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={handleMaximizeMiniplayer}
                className="p-1 rounded-lg bg-lime-950/50 hover:bg-lime-500 hover:text-black text-lime-300 border border-lime-500/30 transition-colors cursor-pointer"
                title="Mở rộng trình phát"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCloseMiniplayer}
                className="p-1 rounded-lg bg-lime-950/50 hover:bg-red-500 hover:text-black text-lime-300 border border-lime-500/30 transition-colors cursor-pointer"
                title="Đóng miniplayer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {playerElement}
      </div>

      {/* Episode Selector */}
      <EpisodeSelector
        servers={servers}
        activeServerIndex={activeServerIndex}
        activeEpisodeSlug={currentEpisode?.slug || ''}
        movieSlug={movie.slug}
        playerMode={playerMode}
        onSelectServer={setActiveServerIndex}
        onSelectEpisode={handleSelectEpisode}
        onSelectPlayerMode={setPlayerMode}
      />

      {/* Movie Information Summary */}
      <div className="bg-[#071307] border border-lime-500/20 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="w-16 h-22 rounded-xl overflow-hidden bg-black/50 flex-shrink-0 border border-lime-500/25 hidden sm:block">
            <img
              src={getImageUrl(movie.thumb_url || movie.poster_url)}
              alt={movie.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg sm:text-xl font-black text-[#f4fbf0] tracking-tight">
              {movie.name}
            </h2>
            {movie.original_name && (
              <p className="text-xs sm:text-sm font-semibold text-lime-400 mt-0.5">
                {movie.original_name}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-[#8aa885]">
              {movie.quality && (
                <span className="px-2 py-0.5 rounded bg-yellow-500/20 text-[#fef08a] font-bold border border-yellow-500/30">
                  {movie.quality}
                </span>
              )}
              {movie.time && (
                <span className="px-2 py-0.5 rounded bg-lime-950/40 text-[#cbe1c8] border border-lime-500/20">
                  {movie.time}
                </span>
              )}
              {movie.language && (
                <span className="px-2 py-0.5 rounded bg-lime-950/40 text-[#cbe1c8] border border-lime-500/20">
                  {movie.language}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Synopsis */}
        <FilmSynopsis htmlContent={movie.description} />
      </div>

      {/* Related Movies Shelf */}
      <RelatedMoviesRow
        currentSlug={movie.slug}
        genres={genresList}
        onSelectMovie={(newSlug) => {
          if (onSelectMovie) {
            onSelectMovie(newSlug);
          } else {
            window.location.href = `/phim/${newSlug}`;
          }
        }}
      />
    </div>
  );
};
