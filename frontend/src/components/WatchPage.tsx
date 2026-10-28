import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Loader2, Info, Film, AlertCircle, Minimize2 } from 'lucide-react';
import { getMovieDetail } from '../api';
import { MovieDetail, EpisodeServer, EpisodeItem } from '../types';
import { VideoPlayer } from './VideoPlayer';
import { EpisodeSelector } from './EpisodeSelector';
import { FilmSynopsis } from './FilmSynopsis';
import { RelatedMoviesRow } from './RelatedMoviesRow';
import { ErrorBoundary } from './ErrorBoundary';
import { getImageUrl } from '../utils';

/**
 * Helper to parse numeric episode number from slug (tap-1, tap-02) or title (Tập 1, Tập 2, Full)
 */
export function parseEpisodeNumber(epSlug?: string, epName?: string): number {
  if (epSlug) {
    const match = epSlug.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  if (epName) {
    const match = epName.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 1;
}

/**
 * Standard authentic HLS URL generator matching historical webproxy logic:
 * - Single movie or episode 1 -> /api/stream/:slug/master.m3u8
 * - TV series episode N (N > 1) -> /api/stream/:slug/ep/:N/master.m3u8
 */
export function getEpisodeHlsUrl(
  slug: string,
  epNum: number = 1,
  isSeries: boolean = false,
  serverIndex?: number
): string {
  const isMultiEp = isSeries && epNum > 1;
  const basePath = isMultiEp
    ? `/api/stream/${encodeURIComponent(slug)}/ep/${epNum}/master.m3u8`
    : `/api/stream/${encodeURIComponent(slug)}/master.m3u8`;
  if (serverIndex !== undefined && serverIndex > 0) {
    return `${basePath}?server=${serverIndex}`;
  }
  return basePath;
}

interface WatchPageProps {
  slug: string;
  episodeSlug?: string;
  initialServerIndex?: number;
  onBack: () => void;
  onNavigateEpisode: (slug: string, epSlug: string, serverIndex?: number) => void;
  onSelectMovie?: (slug: string) => void;
}

export const WatchPage: React.FC<WatchPageProps> = ({
  slug,
  episodeSlug,
  initialServerIndex,
  onBack,
  onNavigateEpisode,
  onSelectMovie,
}) => {
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeServerIndex, setActiveServerIndex] = useState(initialServerIndex ?? 0);
  const [playerMode, setPlayerMode] = useState<'hls' | 'embed'>('hls');
  const [isTheater, setIsTheater] = useState(false);

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
    setActiveServerIndex(initialServerIndex ?? 0);

    getMovieDetail(slug).then((data) => {
      if (!isMounted) return;
      if (data) {
        setMovie(data);
        setActiveServerIndex(
          initialServerIndex !== undefined && initialServerIndex >= 0 && initialServerIndex < (data.episodes?.length ?? 0)
            ? initialServerIndex : 0
        );
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
    if (movie) {
      setActiveServerIndex(
        initialServerIndex !== undefined && initialServerIndex >= 0 && initialServerIndex < (movie.episodes?.length ?? 0)
          ? initialServerIndex : 0
      );
    }
  }, [initialServerIndex, movie]);

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
    onNavigateEpisode(slug, epSlug, activeServerIndex);
  };

  const handleSelectServer = (index: number) => {
    if (index < 0 || index >= servers.length) return;
    setActiveServerIndex(index);
    setPlayerMode('hls');
    onNavigateEpisode(slug, currentEpisode?.slug || episodeSlug || 'tap-1', index);
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

  // Determine whether this movie has multiple episodes (TV Series) vs Single Movie (phim lẻ)
  const isSeries = (movie.total_episodes !== undefined && Number(movie.total_episodes) > 1) || items.length > 1;
  const isSingleMovie = !isSeries;
  const epNum = parseEpisodeNumber(currentEpisode?.slug, currentEpisode?.name);

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

  // Authentic HLS URL generation: /api/stream/:slug/master.m3u8 (or ep/N for series N > 1)
  const hlsStreamUrl = getEpisodeHlsUrl(movie.slug, epNum, isSeries, activeServerIndex);

  // Only pass embedUrl if it is a real webpage embed, not an m3u8 playlist file
  const rawEmbed = currentEpisode?.embed || '';
  const safeEmbedUrl = rawEmbed && !rawEmbed.includes('.m3u8') ? rawEmbed : '';

  const playerElement = (
    <ErrorBoundary fallbackTitle="Không thể khởi chạy trình phát video">
      <VideoPlayer
        embedUrl={safeEmbedUrl}
        m3u8Url={hlsStreamUrl}
        serverIndex={activeServerIndex}
        movieName={movie.name}
        movieSlug={movie.slug}
        episodeName={currentEpisode?.name || '1'}
        episodeSlug={currentEpisode?.slug || 'tap-1'}
        posterUrl={getImageUrl(movie.poster_url || movie.thumb_url)}
        playerMode={playerMode}
        onPlayerModeChange={setPlayerMode}
        nextEpisode={isSeries && nextEpisode ? { name: nextEpisode.name, slug: nextEpisode.slug } : undefined}
        onNextEpisode={isSeries && nextEpisode ? handleNextEpisode : undefined}
        prevEpisode={isSeries && prevEpisode ? { name: prevEpisode.name, slug: prevEpisode.slug } : undefined}
        onPrevEpisode={isSeries && prevEpisode ? handlePrevEpisode : undefined}
        allEpisodes={isSeries ? items.map((ep) => ({ name: ep.name, slug: ep.slug })) : undefined}
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
              {movie.name}
              {isSeries && currentEpisode?.name && currentEpisode.name.toLowerCase() !== 'full' ? (
                <>
                  {' '}—{' '}
                  <span className="text-lime-400 font-bold">
                    Tập {currentEpisode.name}
                  </span>
                </>
              ) : null}
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
          {movie.name}
          {isSeries && currentEpisode?.name && currentEpisode.name.toLowerCase() !== 'full' ? (
            <>
              {' '}—{' '}
              <span className="text-lime-400 font-bold">
                Tập {currentEpisode.name}
              </span>
            </>
          ) : null}
        </span>
      </div>

      {/* Video Player */}
      <div className="w-full">
        {playerElement}
      </div>

      {/* Episode Selector (Phim lẻ ẩn hoàn toàn vùng chọn tập) */}
      {!isSingleMovie && (
        <EpisodeSelector
          servers={servers}
          activeServerIndex={activeServerIndex}
          activeEpisodeSlug={currentEpisode?.slug || ''}
          movieSlug={movie.slug}
          onSelectServer={handleSelectServer}
          onSelectEpisode={handleSelectEpisode}
          isSingleMovie={isSingleMovie}
        />
      )}

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
