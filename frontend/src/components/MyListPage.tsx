import React, { useState, useEffect } from 'react';
import { Bookmark, Film, Trash2, Loader2, ArrowLeft } from 'lucide-react';
import { getFavorites, toggleFavorite } from '../utils';
import { getMoviesBySlugs } from '../api';
import { MovieItem } from '../types';
import { MovieCard } from './MovieCard';

interface MyListPageProps {
  onSelectMovie: (slug: string) => void;
  onBack: () => void;
}

export const MyListPage: React.FC<MyListPageProps> = ({
  onSelectMovie,
  onBack,
}) => {
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFavs = async () => {
    setLoading(true);
    const slugs = getFavorites();
    if (slugs.length === 0) {
      setMovies([]);
      setLoading(false);
      return;
    }
    const items = await getMoviesBySlugs(slugs);
    setMovies(items);
    setLoading(false);
  };

  useEffect(() => {
    loadFavs();
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between border-b border-lime-500/15 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-[#071307] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-[#f4fbf0] tracking-tight flex items-center gap-2">
              <Bookmark className="w-6 h-6 text-lime-400 fill-lime-400" />
              <span>Phim Yêu Thích Của Bạn</span>
            </h1>
            <p className="text-xs text-[#8aa885] mt-0.5">
              Danh sách các bộ phim bạn đã lưu lại để thưởng thức
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-10 h-10 text-lime-400 animate-spin mb-3" />
          <p className="text-sm font-semibold text-[#8aa885]">
            Đang tải danh sách phim yêu thích...
          </p>
        </div>
      ) : movies.length === 0 ? (
        <div className="py-20 text-center bg-[#071307] rounded-3xl border border-lime-500/20 p-8 space-y-3 max-w-md mx-auto">
          <Bookmark className="w-12 h-12 text-[#8aa885] mx-auto opacity-40" />
          <h3 className="text-base font-bold text-[#f4fbf0]">
            Chưa có bộ phim nào được lưu
          </h3>
          <p className="text-xs text-[#8aa885]">
            Bấm vào biểu tượng dấu trang trên bất kỳ thẻ phim nào để thêm vào danh sách yêu thích của bạn.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {movies.map((movie) => (
            <MovieCard
              key={movie.slug}
              movie={movie}
              onClick={() => onSelectMovie(movie.slug)}
              onFavoriteToggle={loadFavs}
            />
          ))}
        </div>
      )}
    </div>
  );
};
