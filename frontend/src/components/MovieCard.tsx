import React, { useState, useEffect } from 'react';
import { Play, Bookmark, Film } from 'lucide-react';
import { MovieItem } from '../types';
import { getImageUrl, isFavorite, toggleFavorite } from '../utils';

interface MovieCardProps {
  movie: MovieItem;
  onClick: () => void;
  onFavoriteToggle?: () => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  movie,
  onClick,
  onFavoriteToggle,
}) => {
  const [imgError, setImgError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [fav, setFav] = useState(() => isFavorite(movie.slug));

  useEffect(() => {
    const syncFav = () => setFav(isFavorite(movie.slug));
    window.addEventListener('bofilm_favorites_update', syncFav);
    window.addEventListener('storage', syncFav);
    return () => {
      window.removeEventListener('bofilm_favorites_update', syncFav);
      window.removeEventListener('storage', syncFav);
    };
  }, [movie.slug]);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = toggleFavorite(movie.slug);
    setFav(updated);
    if (onFavoriteToggle) onFavoriteToggle();
  };

  const rawImage = movie.thumb_url || movie.poster_url;
  const imageSrc = !imgError && rawImage ? getImageUrl(rawImage) : '/logo.png';

  const yearDisplay =
    typeof movie.year === 'object' ? JSON.stringify(movie.year) : movie.year;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
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
    onClick();
  };

  return (
    <div className="group relative flex flex-col h-full cursor-pointer transition-transform duration-200 hover:-translate-y-0.5">
      <a
        href={`/phim/${movie.slug}`}
        onClick={handleClick}
        aria-label={`Xem chi tiết ${movie.name}`}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-400"
      />
      <div className="relative aspect-[2/3] w-full rounded-xl sm:rounded-2xl overflow-hidden bg-[#071307] border border-lime-500/15 group-hover:border-lime-400/50 shadow-[0_4px_20px_rgba(0,0,0,0.6)] transition-colors duration-200">
        {!isLoaded && !imgError && (
          <div className="absolute inset-0 bg-[#0a180b] flex flex-col items-center justify-center animate-pulse z-0">
            <Film className="w-8 h-8 text-lime-500/20 mb-2 stroke-[1.5]" />
            <div className="w-12 h-1.5 rounded-full bg-lime-500/15" />
          </div>
        )}

        <img
          src={imageSrc}
          alt={movie.name}
          width={300}
          height={450}
          loading="lazy"
          decoding="async"
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setImgError(true);
            setIsLoaded(true);
          }}
          className={`w-full h-full object-cover transform group-hover:scale-[1.02] transition-all duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/30 pointer-events-none" />

        {/* Top-Left Episode Badge */}
        {movie.current_episode && (
          <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-lime-500/95 text-black text-xs font-extrabold shadow-sm tracking-tight">
            {movie.current_episode}
          </div>
        )}

        {/* Top-Right Quality Badge */}
        {movie.quality && (
          <div className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded-md bg-black/75 border border-yellow-400/40 text-[#fef08a] text-xs font-bold">
            {movie.quality}
          </div>
        )}

        {/* Favorite Bookmark Button (44x44px accessible touch target) */}
        <button
          type="button"
          onClick={handleFav}
          aria-pressed={fav}
          aria-label={fav ? `Bỏ lưu phim ${movie.name}` : `Lưu phim ${movie.name} vào yêu thích`}
          className={`touch-target-44 absolute bottom-2 left-2 z-20 p-2 rounded-full backdrop-blur-md transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400 ${
            fav
              ? 'bg-lime-500 text-black shadow-sm'
              : 'bg-black/75 text-[#d4ebd2] hover:text-lime-300 hover:bg-black/90 border border-white/10'
          }`}
          title={fav ? 'Bỏ lưu phim' : 'Lưu vào yêu thích'}
        >
          <Bookmark className="w-4 h-4 fill-current" />
        </button>

        {/* Bottom-Right Language Badge */}
        {movie.language && (
          <div className="absolute bottom-2.5 right-2 z-10 px-2 py-0.5 rounded-md bg-black/75 border border-lime-500/30 text-lime-300 text-xs font-semibold">
            {movie.language}
          </div>
        )}

        {/* Center Hover Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-lime-500 text-black flex items-center justify-center shadow-lg transform scale-95 group-hover:scale-100 transition-transform duration-200">
            <Play className="w-6 h-6 fill-black ml-0.5" />
          </div>
        </div>
      </div>

      {/* Info Below Poster */}
      <div className="mt-2.5 space-y-1 flex-1 flex flex-col justify-between">
        <h3 className="text-xs sm:text-sm font-bold text-[#f4fbf0] group-hover:text-lime-300 transition-colors line-clamp-2 leading-snug h-[2.5rem] min-h-[2.5rem]">
          {movie.name}
        </h3>
        <div className="flex items-center justify-between text-xs text-[#9ab395] h-[1.25rem] min-h-[1.25rem]">
          <span className="line-clamp-1 flex-1 pr-2 truncate">
            {movie.original_name || 'Đang cập nhật'}
          </span>
          {yearDisplay && (
            <span className="font-semibold text-lime-400 flex-shrink-0 tabular-nums">
              {yearDisplay}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
