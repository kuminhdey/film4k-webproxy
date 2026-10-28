import React, { useState } from 'react';
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
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      return;
    }
    e.preventDefault();
    onClick();
  };

  return (
    <a
      href={`/phim/${movie.slug}`}
      onClick={handleClick}
      className="group relative flex flex-col h-full cursor-pointer transition-transform duration-300 hover:-translate-y-1.5"
    >
      {/* VIS-01: Responsive Border Radius (rounded-xl sm:rounded-2xl) & Aspect 2/3 */}
      <div className="relative aspect-[2/3] w-full rounded-xl sm:rounded-2xl overflow-hidden bg-[#071307] border border-lime-500/20 group-hover:border-lime-400/60 shadow-[0_4px_20px_rgba(0,0,0,0.6)] group-hover:shadow-[0_0_25px_rgba(132,204,22,0.35)] transition-all duration-300">
        
        {/* VIS-02: Shimmer Skeleton Placeholder when Poster is Loading */}
        {!isLoaded && !imgError && (
          <div className="absolute inset-0 bg-[#0a180b] flex flex-col items-center justify-center animate-pulse z-0">
            <Film className="w-8 h-8 text-lime-500/20 mb-2 stroke-[1.5]" />
            <div className="w-12 h-1.5 rounded-full bg-lime-500/15" />
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-lime-500/5 to-transparent pointer-events-none" />
          </div>
        )}

        <img
          src={imageSrc}
          alt={movie.name}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setImgError(true);
            setIsLoaded(true);
          }}
          loading="lazy"
          className={`w-full h-full object-cover transform group-hover:scale-105 transition-all duration-500 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/30 pointer-events-none" />

        {/* Top-Left Episode Badge */}
        {movie.current_episode && (
          <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-lime-500/90 text-black text-[10px] font-extrabold shadow-[0_0_8px_rgba(132,204,22,0.6)] tracking-tight">
            {movie.current_episode}
          </div>
        )}

        {/* Top-Right Quality Badge */}
        {movie.quality && (
          <div className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded-md bg-black/70 border border-yellow-400/40 text-[#fef08a] text-[10px] font-bold">
            {movie.quality}
          </div>
        )}

        {/* Favorite Bookmark Button (A11Y-03 touch target & A11Y-04 aria-label) */}
        <button
          type="button"
          onClick={handleFav}
          aria-label={fav ? `Bỏ lưu phim ${movie.name}` : `Lưu phim ${movie.name} vào yêu thích`}
          className={`absolute bottom-2 left-2 z-20 min-w-[36px] min-h-[36px] p-2 rounded-full backdrop-blur-md flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-lime-400 ${
            fav
              ? 'bg-lime-500 text-black shadow-[0_0_10px_#84cc16]'
              : 'bg-black/70 text-[#d4ebd2] hover:text-lime-300 hover:bg-black/90'
          }`}
          title={fav ? 'Bỏ lưu phim' : 'Lưu vào yêu thích'}
        >
          <Bookmark className="w-3.5 h-3.5 fill-current" />
        </button>

        {/* Bottom-Right Language Badge */}
        {movie.language && (
          <div className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded-md bg-black/70 border border-lime-500/30 text-lime-300 text-[10px] font-semibold">
            {movie.language}
          </div>
        )}

        {/* Center Hover Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-lime-500 text-black flex items-center justify-center shadow-[0_0_20px_#84cc16] transform scale-75 group-hover:scale-100 transition-transform duration-300">
            <Play className="w-6 h-6 fill-black ml-0.5" />
          </div>
        </div>
      </div>

      {/* Info Below Poster (A11Y-01 upgraded contrast >= 5.5:1) */}
      <div className="mt-2.5 space-y-1 flex-1 flex flex-col justify-between">
        <h3 className="text-xs sm:text-sm font-bold text-[#f4fbf0] group-hover:text-lime-300 transition-colors line-clamp-2 leading-snug min-h-[2.5rem]">
          {movie.name}
        </h3>
        <div className="flex items-center justify-between text-[11px] text-[#a8cca2] min-h-[1.1rem]">
          <span className="line-clamp-1 flex-1 pr-2 truncate">
            {movie.original_name || 'Đang cập nhật'}
          </span>
          {yearDisplay && (
            <span className="font-semibold text-lime-400 flex-shrink-0">
              {yearDisplay}
            </span>
          )}
        </div>
      </div>
    </a>
  );
};
