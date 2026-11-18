import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, Loader2, AlertCircle, Minimize2, Server } from 'lucide-react';
import { getMovieDetail, normalizeStreamUrl } from '../api';
import { MovieDetail, EpisodeServer, EpisodeItem } from '../types';
import { VideoPlayer } from './VideoPlayer';
import { EpisodeSelector } from './EpisodeSelector';
import { FilmSynopsis } from './FilmSynopsis';
import { RelatedMoviesRow } from './RelatedMoviesRow';
import { ErrorBoundary } from './ErrorBoundary';
import { getImageUrl, sanitizeEmbedUrl } from '../utils';
import { formatEpisodeLabel } from '../episodeLabel.mjs';

/**
 * Helper to parse numeric episode number from slug (`tap-1`, `s2-tap-5`, `s02e05`) or title (`Tập 5`, `Full`)
 * Prioritizes explicit episode patterns after season prefix so `s2-tap-5` parses `5` instead of `2` (`MED-10`).
 */
export function parseEpisodeNumber(epSlug?: string, epName?: string): number {
  if (epSlug) {
    const seasonEpMatch = epSlug.match(/^s\d+[-_\s]*(?:e|tap|ep)[-_\s]*(\d+)/i);
    if (seasonEpMatch) {
      const parsed = parseInt(seasonEpMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const tapMatch = epSlug.match(/(?:tap|ep|e)[-_]?(\d+)/i);
    if (tapMatch) {
      const parsed = parseInt(tapMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const match = epSlug.match(/\d+/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  if (epName) {
    const seasonEpMatch = epName.match(/s\d+[-_\s]*(?:e|tap|tập|ep)[-_\s]*(\d+)/i);
    if (seasonEpMatch) {
      const parsed = parseInt(seasonEpMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const tapMatch = epName.match(/(?:tập|tap|ep|episode)\s*(\d+)/i);
    if (tapMatch) {
      const parsed = parseInt(tapMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
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
  serverIndex?: number,
  season?: number
): string {
  const hasSeasonParam = season !== undefined && season > 1;
  const isMultiEp = (isSeries && epNum > 1) || hasSeasonParam;
  const basePath = isMultiEp
    ? `/api/stream/${encodeURIComponent(slug)}/ep/${epNum}/master.m3u8`
    : `/api/stream/${encodeURIComponent(slug)}/master.m3u8`;
  const params = new URLSearchParams();
  if (hasSeasonParam) {
    params.set('season', String(season));
  }
  if (serverIndex !== undefined && serverIndex > 0) {
    params.set('server', String(serverIndex));
  }
  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

export function findEpisodeIndex(items: EpisodeItem[], episodeSlug?: string): number {
  if (!items || items.length === 0) return -1;
  if (!episodeSlug) return 0;

  let currentEpisodeIndex = -1;

  // 1. Support s{S}-tap-{E} or s{S}e{E} (e.g., s2-tap-5, s2e5, s02e01)
  const sMatch = episodeSlug.match(/^s(\d+)[-_\s]*(?:e|tap|ep)[-_\s]*(\d+)$/i);
  if (sMatch) {
    const seasonTarget = parseInt(sMatch[1], 10);
    const episodeTarget = parseInt(sMatch[2], 10);
    currentEpisodeIndex = items.findIndex(
      (ep) => (ep.season ?? 1) === seasonTarget && (ep.episode ?? 1) === episodeTarget
    );
  }

  // 2. Direct slug or name match
  if (currentEpisodeIndex === -1) {
    currentEpisodeIndex = items.findIndex(
      (ep) => ep.slug === episodeSlug || ep.name === episodeSlug
    );
  }

  // 3. Clean number match
  if (currentEpisodeIndex === -1) {
    const cleanTargetStr = episodeSlug.replace(/^(?:tap|ep)[-_]?/i, '').trim();
    const numMatch = episodeSlug.match(/\d+/);
    const cleanTarget = numMatch ? parseInt(numMatch[0], 10) : NaN;

    currentEpisodeIndex = items.findIndex((ep) => {
      const cleanSlug = ep.slug.replace(/^tap-/i, '').trim();
      if (cleanSlug === cleanTargetStr) return true;
      if (!isNaN(cleanTarget)) {
        if (ep.slug === `tap-${cleanTarget}`) return true;
        if (ep.globalIndex === cleanTarget) return true;
      }
      return false;
    });

    if (currentEpisodeIndex === -1) {
      currentEpisodeIndex = items.findIndex((ep) => {
        const cleanName = ep.name.replace(/^Tập\s*/i, '').trim();
        if (cleanName === cleanTargetStr || cleanName === episodeSlug) return true;
        if (!isNaN(cleanTarget)) {
          if (ep.episode === cleanTarget) return true;
        }
        return false;
      });
    }
  }

  return currentEpisodeIndex !== -1 ? currentEpisodeIndex : 0;
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
  const [failoverNotice, setFailoverNotice] = useState<string | null>(null);
  const failedServersRef = useRef<Set<number>>(new Set());

  const toggleTheater = useCallback(() => {
    setIsTheater((prev) => !prev);
  }, []);

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
    setFailoverNotice(null);
    failedServersRef.current.clear();
    setActiveServerIndex(initialServerIndex ?? 0);

    getMovieDetail(slug)
      .then((data) => {
        if (!isMounted) return;
        if (data) {
          setMovie(data);
          setActiveServerIndex(
            initialServerIndex !== undefined &&
              initialServerIndex >= 0 &&
              initialServerIndex < (data.episodes?.length ?? 0)
              ? initialServerIndex
              : 0
          );
        } else {
          setError('Không thể tải thông tin xem phim. Vui lòng thử lại sau.');
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading watch page detail:', err);
        if (!isMounted) return;
        setError('Đã xảy ra lỗi kết nối khi tải thông tin xem phim.');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [slug]);

  useEffect(() => {
    if (movie && initialServerIndex !== undefined) {
      setActiveServerIndex(
        initialServerIndex >= 0 &&
          initialServerIndex < (movie.episodes?.length ?? 0)
          ? initialServerIndex
          : 0
      );
    }
  }, [initialServerIndex, movie]);

  useEffect(() => {
    setPlayerMode('hls');
    setFailoverNotice(null);
    failedServersRef.current.clear();
  }, [slug, episodeSlug]);

  const genresList = useMemo(() => {
    const list: string[] = [];
    if (movie?.category) {
      Object.values(movie.category).forEach((cg) => {
        if (cg?.list) {
          cg.list.forEach((item) => {
            if (item?.name) list.push(item.name);
          });
        }
      });
    }
    return list;
  }, [movie?.category]);

  if (loading) {
    return (
      <div className="min-h-[calc(100svh-3.5rem)] py-24 flex flex-col items-center justify-center text-center">
        <Loader2 className="w-12 h-12 text-lime-400 animate-spin mb-3" />
        <p className="text-sm font-semibold text-[#9ab395]">
          Đang khởi tạo phòng chiếu Bơ Film...
        </p>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div role="alert" className="py-24 text-center max-w-md mx-auto space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <p className="text-red-400 text-sm font-semibold">
          {error || 'Không tìm thấy phim'}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-lime-500 text-black text-xs font-extrabold hover:bg-lime-400 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
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

  const currentEpisodeIndex = findEpisodeIndex(items, episodeSlug);
  const currentEpisode: EpisodeItem | undefined =
    currentEpisodeIndex >= 0 && currentEpisodeIndex < items.length
      ? items[currentEpisodeIndex]
      : items[0];

  const nextEpisode =
    currentEpisodeIndex >= 0 && currentEpisodeIndex < items.length - 1
      ? items[currentEpisodeIndex + 1]
      : undefined;

  const prevEpisode =
    currentEpisodeIndex > 0 ? items[currentEpisodeIndex - 1] : undefined;

  const isSeries =
    (movie.total_episodes !== undefined && Number(movie.total_episodes) > 1) ||
    items.length > 1;
  const isSingleMovie = !isSeries;

  const handleSelectEpisode = (epSlug: string) => {
    setPlayerMode('hls');
    setFailoverNotice(null);
    failedServersRef.current.clear();
    onNavigateEpisode(slug, epSlug, activeServerIndex);
  };

  const handleSelectServer = (index: number) => {
    if (index < 0 || index >= servers.length) return;
    setActiveServerIndex(index);
    setPlayerMode('hls');
    setFailoverNotice(null);
    const targetSlug =
      currentEpisode?.slug || episodeSlug || (isSingleMovie ? 'full' : 'tap-1');
    onNavigateEpisode(slug, targetSlug, index);
  };

  // Automatic multi-server failover when VideoPlayer encounters a fatal stream/network error (`CRIT-05`)
  const handleStreamFatalError = (): boolean => {
    if (servers.length <= 1) return false;
    failedServersRef.current.add(activeServerIndex);

    let nextIdx = -1;
    if (
      activeServerIndex + 1 < servers.length &&
      !failedServersRef.current.has(activeServerIndex + 1)
    ) {
      nextIdx = activeServerIndex + 1;
    } else {
      nextIdx = servers.findIndex((_, idx) => !failedServersRef.current.has(idx));
    }

    if (nextIdx === -1) {
      return false;
    }

    const nextServerLabel =
      servers[nextIdx]?.server_name || `Server #${nextIdx + 1}`;
    setFailoverNotice(
      `Nguồn hiện tại không phản hồi — đã tự động chuyển sang ${nextServerLabel}.`
    );
    setActiveServerIndex(nextIdx);
    setPlayerMode('hls');
    const targetSlug =
      currentEpisode?.slug || episodeSlug || (isSingleMovie ? 'full' : 'tap-1');
    onNavigateEpisode(slug, targetSlug, nextIdx);
    return true;
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

  const epNum =
    currentEpisode?.globalIndex ||
    parseEpisodeNumber(currentEpisode?.slug, currentEpisode?.name);

  // Authentic HLS URL generation + legacy domain normalization (`CRIT-05`)
  const rawHlsUrl = getEpisodeHlsUrl(
    movie.slug,
    epNum,
    isSeries,
    activeServerIndex,
    currentEpisode?.season
  );
  const hlsStreamUrl = normalizeStreamUrl(
    currentEpisode?.m3u8 || rawHlsUrl,
    movie.slug,
    {
      epNum,
      isSeries,
      season: currentEpisode?.season,
      serverIndex: activeServerIndex,
    }
  );

  // Strict origin & protocol check on embedUrl (`CRIT-03`)
  const safeEmbedUrl = sanitizeEmbedUrl(currentEpisode?.embed);

  const serverOptionsForPlayer = servers.map((srv, idx) => ({
    index: idx,
    name: srv.server_name || `Server #${idx + 1}`,
  }));

  const playerElement = (
    <ErrorBoundary fallbackTitle="Không thể khởi chạy trình phát video">
      <VideoPlayer
        embedUrl={safeEmbedUrl}
        m3u8Url={hlsStreamUrl}
        serverIndex={activeServerIndex}
        servers={serverOptionsForPlayer}
        onSelectServer={handleSelectServer}
        onStreamFatalError={handleStreamFatalError}
        movieName={movie.name}
        movieSlug={movie.slug}
        episodeName={currentEpisode?.name || (isSingleMovie ? 'Full' : '1')}
        episodeSlug={
          currentEpisode?.slug || episodeSlug || (isSingleMovie ? 'full' : 'tap-1')
        }
        posterUrl={getImageUrl(movie.poster_url || movie.thumb_url)}
        playerMode={playerMode}
        onPlayerModeChange={setPlayerMode}
        nextEpisode={
          isSeries && nextEpisode
            ? { name: nextEpisode.name, slug: nextEpisode.slug }
            : undefined
        }
        onNextEpisode={isSeries && nextEpisode ? handleNextEpisode : undefined}
        prevEpisode={
          isSeries && prevEpisode
            ? { name: prevEpisode.name, slug: prevEpisode.slug }
            : undefined
        }
        onPrevEpisode={isSeries && prevEpisode ? handlePrevEpisode : undefined}
        allEpisodes={
          isSeries
            ? items.map((ep) => ({ name: ep.name, slug: ep.slug }))
            : undefined
        }
        currentEpisodeSlug={currentEpisode?.slug}
        onSelectEpisode={handleSelectEpisode}
        isTheater={isTheater}
        onToggleTheater={toggleTheater}
      />
    </ErrorBoundary>
  );

  if (isTheater) {
    return (
      <div className="fixed inset-0 z-50 bg-black overflow-y-auto animate-in fade-in duration-300">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-2.5 bg-[#09150a]/95 backdrop-blur-md border-b border-lime-500/20">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#cbe1c8] truncate min-w-0">
            <span className="w-2 h-2 rounded-full bg-lime-400 flex-shrink-0" />
            <span className="truncate">
              {movie.name}
              {isSeries &&
              currentEpisode?.name &&
              currentEpisode.name.toLowerCase() !== 'full' ? (
                <>
                  {' '}—{' '}
                  <span className="text-lime-400 font-bold">
                    {currentEpisode.season && currentEpisode.season > 1
                      ? `${currentEpisode.name} (Mùa ${currentEpisode.season})`
                      : formatEpisodeLabel(currentEpisode.name)}
                  </span>
                </>
              ) : null}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleTheater}
            aria-label="Thoát chế độ rạp chiếu"
            className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-lime-500/20 border border-lime-500/40 text-lime-300 hover:bg-lime-500 hover:text-black text-xs font-bold transition-colors flex-shrink-0 cursor-pointer"
            title="Thoát chế độ rạp chiếu (Esc)"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>Thu nhỏ</span>
          </button>
        </div>
        <div className="px-2 sm:px-4 py-3 sm:py-5 max-w-[1800px] mx-auto">
          {playerElement}
          <p className="text-center text-xs text-[#9ab395] mt-3">
            Chế độ rạp chiếu — bấm "Thu nhỏ" hoặc phím{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-lime-950/60 border border-lime-500/30 text-lime-300 font-black">
              Esc
            </kbd>{' '}
            để quay lại trang xem phim.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Back button & Breadcrumb */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#071307] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 text-xs font-semibold transition-colors cursor-pointer flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại chi tiết</span>
        </button>

        <span className="text-xs text-[#9ab395] truncate max-w-[200px] sm:max-w-md">
          {movie.name}
          {isSeries &&
          currentEpisode?.name &&
          currentEpisode.name.toLowerCase() !== 'full' ? (
            <>
              {' '}—{' '}
              <span className="text-lime-400 font-bold">
                {currentEpisode.season && currentEpisode.season > 1
                  ? `${currentEpisode.name} (Mùa ${currentEpisode.season})`
                  : formatEpisodeLabel(currentEpisode.name)}
              </span>
            </>
          ) : null}
        </span>
      </div>

      {/* Auto-Failover Banner */}
      {failoverNotice && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-lime-950/60 border border-lime-500/35 text-xs font-semibold text-lime-200"
        >
          <Server className="w-4 h-4 text-lime-400 flex-shrink-0" />
          <span>{failoverNotice}</span>
        </div>
      )}

      {/* Video Player */}
      <div className="w-full">{playerElement}</div>

      {/* Server & Episode Selector (renders Server Switcher for single movies with multiple servers too!) */}
      {(!isSingleMovie || servers.length > 1) && (
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
          <div className="w-16 h-24 rounded-xl overflow-hidden bg-black/50 flex-shrink-0 border border-lime-500/25 hidden sm:block">
            <img
              src={getImageUrl(movie.thumb_url || movie.poster_url)}
              alt={movie.name}
              width={64}
              height={96}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] tracking-tight">
              {movie.name}
            </h2>
            {movie.original_name && (
              <p className="text-xs sm:text-sm font-semibold text-lime-400 mt-0.5">
                {movie.original_name}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-[#9ab395]">
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
