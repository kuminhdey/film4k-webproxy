import React from 'react';
import { Play } from 'lucide-react';
import { MovieItem } from '../types';
import { getImageUrl } from '../utils';

interface MovieTableViewProps {
  movies: MovieItem[];
  onSelectMovie: (slug: string) => void;
}

export const MovieTableView: React.FC<MovieTableViewProps> = ({
  movies,
  onSelectMovie,
}) => {
  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-lime-500/20 bg-[#071307]/80 backdrop-blur-md shadow-2xl">
      <table className="w-full text-left border-collapse text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-lime-500/20 bg-lime-950/40 text-lime-300 font-bold uppercase tracking-wider text-[11px]">
            <th className="py-3 px-3 sm:px-4">Tên Phim</th>
            <th className="py-3 px-2 sm:px-3 text-center whitespace-nowrap">Tình Trạng</th>
            <th className="py-3 px-2 sm:px-3 text-center whitespace-nowrap hidden sm:table-cell">Năm</th>
            <th className="py-3 px-2 sm:px-3 text-center whitespace-nowrap hidden md:table-cell">Thời Lượng</th>
            <th className="py-3 px-2 sm:px-3 text-center whitespace-nowrap hidden sm:table-cell">Bản Dịch</th>
            <th className="py-3 px-3 sm:px-4 text-right">Xem</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-lime-500/10">
          {movies.map((movie) => {
            const yearStr =
              typeof movie.year === 'object' ? JSON.stringify(movie.year) : movie.year;

            return (
              <tr
                key={movie.slug}
                onClick={() => onSelectMovie(movie.slug)}
                className="hover:bg-lime-950/30 cursor-pointer transition-colors group"
              >
                {/* Tên Phim */}
                <td className="py-2.5 px-3 sm:px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-12 rounded-lg overflow-hidden bg-black/50 flex-shrink-0 border border-lime-500/20">
                      <img
                        src={getImageUrl(movie.thumb_url || movie.poster_url)}
                        alt={movie.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-[#f4fbf0] group-hover:text-lime-300 transition-colors line-clamp-1">
                        {movie.name}
                      </p>
                      {movie.original_name && (
                        <p className="text-[11px] text-[#8aa885] line-clamp-1">
                          {movie.original_name}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                {/* Tình Trạng */}
                <td className="py-2.5 px-2 sm:px-3 text-center whitespace-nowrap">
                  <span className="px-2 py-0.5 rounded-full bg-lime-500/20 text-lime-300 text-[11px] font-bold border border-lime-500/30">
                    {movie.current_episode || 'Full'}
                  </span>
                </td>

                {/* Năm */}
                <td className="py-2.5 px-2 sm:px-3 text-center text-[#cbe1c8] hidden sm:table-cell whitespace-nowrap">
                  {yearStr || '---'}
                </td>

                {/* Thời Lượng */}
                <td className="py-2.5 px-2 sm:px-3 text-center text-[#8aa885] hidden md:table-cell whitespace-nowrap">
                  {movie.time || 'Đang cập nhật'}
                </td>

                {/* Bản Dịch */}
                <td className="py-2.5 px-2 sm:px-3 text-center hidden sm:table-cell whitespace-nowrap">
                  <span className="px-2 py-0.5 rounded-md bg-black/50 text-[#cbe1c8] text-[11px] border border-lime-500/20">
                    {movie.language || 'Vietsub'}
                  </span>
                </td>

                {/* Xem Button */}
                <td className="py-2.5 px-3 sm:px-4 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectMovie(movie.slug);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-lime-500/20 hover:bg-lime-500 text-lime-300 hover:text-black font-bold text-xs transition-colors border border-lime-500/40"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span className="hidden sm:inline">Xem</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
