import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, Film, ChevronRight } from 'lucide-react';
import { MovieCard } from './MovieCard';
import { MovieItem } from '../types';
import { getRelatedMovies } from '../api';

interface RelatedMoviesRowProps {
  currentSlug: string;
  genres?: string[];
  onSelectMovie: (slug: string) => void;
  title?: string;
}

export const RelatedMoviesRow: React.FC<RelatedMoviesRowProps> = ({
  currentSlug,
  genres = [],
  onSelectMovie,
  title = 'Phim Tương Tự Bạn Có Thể Thích',
}) => {
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const genreHint = genres.length > 0 ? genres[0] : undefined;
    getRelatedMovies(currentSlug, genreHint)
      .then((items) => {
        if (!isMounted) return;
        // Filter out current movie just in case
        const filtered = (items || []).filter((m) => m.slug !== currentSlug);
        setMovies(filtered);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load related movies:', err);
        if (isMounted) {
          setMovies([]);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentSlug, genres]);

  if (loading) {
    return (
      <div className="bg-[#071307] border border-lime-500/20 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-lime-400 animate-pulse" />
          <h3 className="text-base sm:text-lg font-bold text-[#f4fbf0]">{title}</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="aspect-[2/3] rounded-2xl bg-lime-950/20 border border-lime-500/10 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (movies.length === 0) {
    return null;
  }

  return (
    <section className="bg-[#071307] border border-lime-500/20 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-lime-500/15 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-lime-500/10 border border-lime-500/25 text-lime-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-[#f4fbf0] tracking-tight">
              {title}
            </h3>
            <p className="text-[11px] sm:text-xs text-[#8aa885]">
              Tuyển tập phim cùng thể loại, đề tài và phong cách
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-lime-950/40 border border-lime-500/20 text-lime-300 text-xs font-semibold">
          <Film className="w-3.5 h-3.5 text-lime-400" />
          <span>{movies.length} phim</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
        {movies.map((movie) => (
          <MovieCard
            key={movie.slug}
            movie={movie}
            onClick={() => {
              onSelectMovie(movie.slug);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ))}
      </div>
    </section>
  );
};
