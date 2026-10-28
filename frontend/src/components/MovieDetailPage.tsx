import React, { useState, useEffect } from 'react';
import { Play, Bookmark, Clock, Calendar, Globe, Film, ArrowLeft, Loader2, Share2, Check, Server } from 'lucide-react';
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

    getMovieDetail(slug).then((data) => {
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

  const handleToggleFav = () => {
    const res = toggleFavorite(slug);
    setFav(res);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center text-center">
        <Loader2 className="w-12 h-12 text-lime-400 animate-spin mb-3" />
        <p className="text-sm font-semibold text-[#8aa885]">
          Đang tải thông tin phim Bơ Film...
        </p>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="py-24 text-center max-w-md mx-auto space-y-4">
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

  const bgImage = movie.poster_url || movie.thumb_url;
  const servers = movie.episodes || [];
  const currentServer = servers[activeServerIndex] || servers[0];
  const firstEp = currentServer?.items?.[0] || servers[0]?.items?.[0];

  const yearStr =
    typeof movie.year === 'object' ? JSON.stringify(movie.year) : movie.year;

  // Extract categories/genres
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

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#071307] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-500/40 text-xs font-semibold transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Quay lại</span>
      </button>

      {/* Main Detail Header Container */}
      <div className="relative rounded-3xl overflow-hidden bg-[#071307] border border-lime-500/25 shadow-2xl p-4 sm:p-6 md:p-8">
        {/* Blurred Backdrop */}
        {bgImage && (
          <div className="absolute inset-0 z-0">
            <img
              src={getImageUrl(bgImage)}
              alt={movie.name}
              className="w-full h-full object-cover filter blur-2xl opacity-20 transform scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#071307] via-[#071307]/80 to-transparent" />
          </div>
        )}

        <div className="relative z-10 flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Poster Column */}
          <div className="w-48 sm:w-56 md:w-64 flex-shrink-0 mx-auto md:mx-0">
            <div className="aspect-[2/3] w-full rounded-2xl overflow-hidden bg-black/60 border border-lime-500/30 shadow-[0_10px_35px_rgba(0,0,0,0.8)] relative group">
              <img
                src={getImageUrl(movie.thumb_url || movie.poster_url)}
                alt={movie.name}
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
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-[#f4fbf0] tracking-tight leading-tight">
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
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-lime-950/60 border border-lime-500/20 text-[#cbe1c8] font-semibold">
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
                    className="px-2.5 py-1 rounded-full bg-[#050e05] border border-lime-500/15 text-[11px] font-medium text-lime-300/90"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Crew / Cast */}
            <div className="space-y-1.5 text-xs text-[#a3c49e] pt-2 border-t border-lime-500/15">
              {movie.director && (
                <p>
                  <span className="text-[#8aa885] font-semibold">Đạo diễn:</span>{' '}
                  <span className="text-[#f4fbf0]">{movie.director}</span>
                </p>
              )}
              {movie.casts && (
                <p>
                  <span className="text-[#8aa885] font-semibold">Diễn viên:</span>{' '}
                  <span className="text-[#f4fbf0]">{movie.casts}</span>
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <button
                onClick={() => onWatch(slug, firstEp?.slug, activeServerIndex)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-lime-500 hover:bg-lime-400 text-black font-black text-sm transition-all transform hover:scale-105 shadow-[0_0_20px_rgba(132,204,22,0.5)] cursor-pointer"
              >
                <Play className="w-5 h-5 fill-black" />
                <span>Xem Phim Ngay</span>
              </button>

              <button
                onClick={handleToggleFav}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-bold transition-all ${
                  fav
                    ? 'bg-lime-500/20 text-lime-300 border-lime-500/50 shadow-sm'
                    : 'bg-lime-950/40 hover:bg-lime-900/60 text-[#cbe1c8] border-lime-500/20'
                }`}
              >
                <Bookmark className="w-4 h-4 fill-current" />
                <span>{fav ? 'Đã lưu yêu thích' : 'Lưu yêu thích'}</span>
              </button>

              <button
                onClick={handleShare}
                className="p-3 rounded-xl bg-lime-950/40 hover:bg-lime-900/60 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 transition-colors"
                title="Chia sẻ liên kết phim"
              >
                {copied ? <Check className="w-4 h-4 text-lime-400" /> : <Share2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Film Synopsis */}
      <div className="bg-[#071307] border border-lime-500/20 rounded-2xl p-5 shadow-lg">
        <FilmSynopsis htmlContent={movie.description} />
      </div>

      {/* Quick Episode Grid */}
      {currentServer?.items && currentServer.items.length > 0 && (
        <div className="bg-[#071307] border border-lime-500/20 rounded-2xl p-5 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-lime-500/15 pb-3">
            <h3 className="text-base font-bold text-lime-300 flex items-center gap-2">
              <Film className="w-4 h-4" />
              <span>Danh Sách Tập Phim</span>
            </h3>
            <span className="text-xs text-[#8aa885]">
              {currentServer.items.length} tập
            </span>
          </div>

          {/* Thanh chọn Server (Tabs: Vietsub, Lồng Tiếng, Thuyết Minh) khi phim có nhiều server */}
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
                      onClick={() => setActiveServerIndex(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-lime-500 text-black shadow-[0_0_12px_rgba(132,204,22,0.4)] font-extrabold'
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
            {currentServer.items.map((ep) => (
              <button
                key={ep.slug}
                onClick={() => onWatch(slug, ep.slug, activeServerIndex)}
                className="flex items-center justify-center p-2 rounded-xl text-xs font-bold bg-[#0a180b] hover:bg-lime-500 hover:text-black text-[#d8ebd5] border border-lime-500/20 hover:border-lime-400 transition-all min-h-[44px] cursor-pointer"
              >
                <span>Tập {ep.name}</span>
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
