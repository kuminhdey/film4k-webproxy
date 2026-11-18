import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  Bookmark,
  Clock,
  Calendar,
  Globe,
  Film,
  ArrowLeft,
  Loader2,
  Share2,
  Check,
  Server,
  AlertCircle,
} from 'lucide-react';
import { getMovieDetail } from '../api';
import { MovieDetail } from '../types';
import { FilmSynopsis } from './FilmSynopsis';
import { RelatedMoviesRow } from './RelatedMoviesRow';
import { getImageUrl, isFavorite, toggleFavorite } from '../utils';

interface MovieDetailPageProps {
  slug: string;
  initialServerIndex?: number;
  onBack: () => void;
  onWatch: (slug: string, epSlug?: string, serverIndex?: number) => void;
  onSelectMovie: (slug: string) => void;
}

export const MovieDetailPage: React.FC<MovieDetailPageProps> = ({
  slug,
  initialServerIndex,
  onBack,
  onWatch,
  onSelectMovie,
}) => {
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fav, setFav] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeServerIndex, setActiveServerIndex] = useState(initialServerIndex ?? 0);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    getMovieDetail(slug)
      .then((data) => {
        if (!isMounted) return;
        if (data) {
          setMovie(data);
          const validServer =
            initialServerIndex !== undefined &&
            data.episodes &&
            initialServerIndex >= 0 &&
            initialServerIndex < data.episodes.length
              ? initialServerIndex
              : 0;
          setActiveServerIndex(validServer);
          setFav(isFavorite(slug));
        } else {
          setError('Không thể tải thông tin phim. Vui lòng thử lại sau.');
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading movie detail:', err);
        if (!isMounted) return;
        setError('Đã xảy ra lỗi khi tải thông tin phim. Vui lòng thử lại.');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [slug, initialServerIndex]);

  useEffect(() => {
    if (
      initialServerIndex !== undefined &&
      movie?.episodes &&
      movie.episodes.length > 0
    ) {
      const valid =
        initialServerIndex >= 0 && initialServerIndex < movie.episodes.length
          ? initialServerIndex
          : 0;
      setActiveServerIndex(valid);
    }
  }, [initialServerIndex, movie]);

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

  const handleToggleFav = () => {
    const res = toggleFavorite(slug);
    setFav(res);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center text-center">
        <Loader2 className="w-12 h-12 text-lime-400 animate-spin mb-3" />
        <p className="text-sm font-semibold text-[#9ab395]">
          Đang tải thông tin phim Bơ Film...
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

  const bgImage = movie.poster_url || movie.thumb_url;
  const servers = movie.episodes || [];
  const currentServer = servers[activeServerIndex] || servers[0];
  const firstEp = currentServer?.items?.[0] || servers[0]?.items?.[0];

  const isSingleMovie =
    Number(movie.total_episodes || 1) <= 1 &&
    (currentServer?.items?.length ?? 0) <= 1;
  const targetWatchSlug = firstEp?.slug || (isSingleMovie ? 'full' : 'tap-1');
  const serverQuery = activeServerIndex > 0 ? `?server=${activeServerIndex}` : '';
  const watchHref = `/xem-phim/${slug}/${targetWatchSlug}${serverQuery}`;

  const yearStr =
    typeof movie.year === 'object' ? JSON.stringify(movie.year) : movie.year;

  const handleWatchClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
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
    onWatch(slug, targetWatchSlug, activeServerIndex);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Back Button */}
      <button
        type="button"
        onClick={onBack}
        className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#071307] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-500/40 text-xs font-semibold transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Quay lại</span>
      </button>

      {/* Main Detail Header Container */}
      <div className="relative rounded-3xl overflow-hidden bg-[#071307] border border-lime-500/25 shadow-2xl p-4 sm:p-6 md:p-8">
        {bgImage && (
          <div className="absolute inset-0 z-0">
            <img
              src={getImageUrl(bgImage)}
              alt=""
              width={1280}
              height={720}
              decoding="async"
              className="w-full h-full object-cover blur-2xl opacity-20 transform scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#071307] via-[#071307]/80 to-transparent" />
          </div>
        )}

        <div className="relative z-10 flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Poster Column */}
          <div className="w-48 sm:w-56 md:w-64 flex-shrink-0 mx-auto md:mx-0">
            <div className="aspect-[2/3] w-full rounded-2xl overflow-hidden bg-black/60 border border-lime-500/30 shadow-[0_10px_35px_rgba(0,0,0,0.8)] relative">
              <img
                src={getImageUrl(movie.thumb_url || movie.poster_url)}
                alt={movie.name}
                width={320}
                height={480}
                decoding="async"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              {movie.current_episode && (
                <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-md bg-lime-500 text-black text-xs font-black shadow-md">
                  {movie.current_episode}
                </div>
              )}
              {movie.quality && (
                <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/75 border border-yellow-400/40 text-[#fef08a] text-xs font-bold">
                  {movie.quality}
                </div>
              )}
            </div>
          </div>

          {/* Details Column */}
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#f4fbf0] tracking-tight leading-tight">
                {movie.name}
              </h1>
              {movie.original_name && (
                <p className="text-sm sm:text-base font-bold text-lime-400 mt-1">
                  {movie.original_name}
                </p>
              )}
            </div>

            {/* Meta Chips */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {yearStr && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-lime-950/60 border border-lime-500/20 text-[#cbe1c8] font-semibold tabular-nums">
                  <Calendar className="w-3.5 h-3.5 text-lime-400" />
                  <span>Năm {yearStr}</span>
                </span>
              )}
              {movie.time && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-lime-950/60 border border-lime-500/20 text-[#cbe1c8] font-semibold">
                  <Clock className="w-3.5 h-3.5 text-lime-400" />
                  <span>{movie.time}</span>
                </span>
              )}
              {movie.language && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-lime-950/60 border border-lime-500/20 text-[#cbe1c8] font-semibold">
                  <Globe className="w-3.5 h-3.5 text-lime-400" />
                  <span>{movie.language}</span>
                </span>
              )}
            </div>

            {/* Genres List */}
            {genresList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {genresList.map((g, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-full bg-[#050e05] border border-lime-500/15 text-xs font-medium text-lime-300/90"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Crew / Cast */}
            {(movie.director || movie.casts) && (
              <div className="space-y-1.5 text-xs text-[#a3c49e] pt-2 border-t border-lime-500/15">
                {movie.director && (
                  <p>
                    <span className="text-[#9ab395] font-semibold">Đạo diễn:</span>{' '}
                    <span className="text-[#f4fbf0]">{movie.director}</span>
                  </p>
                )}
                {movie.casts && (
                  <p>
                    <span className="text-[#9ab395] font-semibold">Diễn viên:</span>{' '}
                    <span className="text-[#f4fbf0]">{movie.casts}</span>
                  </p>
                )}
              </div>
            )}

            {/* Single-Movie Multi-Server Switcher right inside Detail Header */}
            {isSingleMovie && servers.length > 1 && (
              <div className="pt-2 space-y-2">
                <span className="text-xs font-bold text-lime-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5" />
                  <span>Chọn Server / Phiên bản phát ({servers.length}):</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {servers.map((srv, idx) => {
                    const isActive = idx === activeServerIndex;
                    return (
                      <button
                        key={idx}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setActiveServerIndex(idx)}
                        className={`min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-lime-500 text-black font-extrabold ring-1 ring-lime-400'
                            : 'bg-[#0a180b] hover:bg-lime-950/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
                        }`}
                      >
                        {isActive && <Check className="w-3.5 h-3.5" />}
                        <span>{srv.server_name || `Server #${idx + 1}`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <a
                href={watchHref}
                onClick={handleWatchClick}
                className="min-h-[44px] flex items-center gap-2 px-6 py-3 rounded-xl bg-lime-500 hover:bg-lime-400 text-black font-extrabold text-sm transition-all hover:-translate-y-0.5 shadow-[0_4px_18px_rgba(132,204,22,0.35)] cursor-pointer"
              >
                <Play className="w-5 h-5 fill-black" />
                <span>Xem Phim Ngay</span>
              </a>

              <button
                type="button"
                onClick={handleToggleFav}
                aria-pressed={fav}
                className={`min-h-[44px] flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  fav
                    ? 'bg-lime-500/20 text-lime-300 border-lime-500/50 shadow-sm'
                    : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] border-lime-500/20'
                }`}
              >
                <Bookmark className="w-4 h-4 fill-current" />
                <span>{fav ? 'Đã lưu yêu thích' : 'Lưu yêu thích'}</span>
              </button>

              <button
                type="button"
                onClick={handleShare}
                aria-label={copied ? 'Đã sao chép liên kết phim' : 'Chia sẻ liên kết phim'}
                className="min-w-[44px] min-h-[44px] p-3 rounded-xl bg-lime-950/40 hover:bg-lime-900/60 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 transition-colors flex items-center justify-center cursor-pointer"
                title="Chia sẻ liên kết phim"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-lime-400" />
                ) : (
                  <Share2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Film Synopsis */}
      <div className="bg-[#071307] border border-lime-500/20 rounded-2xl p-5 shadow-lg">
        <FilmSynopsis htmlContent={movie.description} />
      </div>

      {/* Episode Grid ONLY for multi-episode series (hides redundant "1 tập [Full]" box on single movies!) */}
      {!isSingleMovie && currentServer?.items && currentServer.items.length > 0 && (
        <div className="bg-[#071307] border border-lime-500/20 rounded-2xl p-5 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-lime-500/15 pb-3">
            <h3 className="text-base font-bold text-lime-300 flex items-center gap-2">
              <Film className="w-4 h-4" />
              <span>Danh Sách Tập Phim</span>
            </h3>
            <span className="text-xs text-[#9ab395] tabular-nums">
              {currentServer.items.length} tập
            </span>
          </div>

          {servers.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
              <span className="text-xs font-bold text-lime-400 uppercase tracking-wider flex items-center gap-1.5 mr-1">
                <Server className="w-3.5 h-3.5" />
                <span>Phiên Bản / Server:</span>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {servers.map((srv, idx) => {
                  const isActive = idx === activeServerIndex;
                  return (
                    <button
                      key={idx}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setActiveServerIndex(idx)}
                      className={`min-h-[44px] sm:min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-lime-500 text-black font-extrabold ring-1 ring-lime-400'
                          : 'bg-[#0a180b] hover:bg-lime-950/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20'
                      }`}
                    >
                      {isActive && <Check className="w-3.5 h-3.5" />}
                      <span>{srv.server_name || `Server #${idx + 1}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 max-h-96 overflow-y-auto pr-1">
            {currentServer.items.map((ep, idx) => (
              <button
                key={`${ep.slug}-${idx}`}
                type="button"
                onClick={() => onWatch(slug, ep.slug, activeServerIndex)}
                title={
                  ep.season && ep.season > 1
                    ? `Tập ${ep.globalIndex || ep.name} (Mùa ${ep.season})`
                    : `Tập ${ep.name}`
                }
                className="flex items-center justify-center overflow-hidden p-2 rounded-xl text-xs font-bold bg-[#0a180b] hover:bg-lime-500 hover:text-black text-[#d8ebd5] border border-lime-500/20 hover:border-lime-400 transition-all min-h-[44px] cursor-pointer"
              >
                <span className="truncate">
                  {ep.name.startsWith('Tập') || isNaN(Number(ep.name.trim()))
                    ? ep.name
                    : `Tập ${ep.name}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Related Movies Shelf */}
      <RelatedMoviesRow
        currentSlug={slug}
        genres={genresList}
        onSelectMovie={onSelectMovie}
      />
    </div>
  );
};
