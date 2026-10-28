import React, { useState } from 'react';
import { LayoutGrid, List, ChevronLeft, ChevronRight, Loader2, Film, SearchX, Home, RotateCcw, Sparkles } from 'lucide-react';
import { MovieItem, Paginate, FilterOptions } from '../types';
import { MovieCard } from './MovieCard';
import { MovieTableView } from './MovieTableView';
import { FilterBar } from './FilterBar';

interface CatalogViewProps {
  title: string;
  subtitle?: string;
  movies: MovieItem[];
  paginate?: Paginate;
  filters: FilterOptions;
  isLoading: boolean;
  error?: boolean;
  onRetry?: () => void;
  onFilterChange: (filters: FilterOptions) => void;
  onFilterReset: () => void;
  onPageChange: (page: number) => void;
  onSelectMovie: (slug: string) => void;
}

const POPULAR_SUGGESTIONS = [
  { label: 'Phim Lẻ Mới', category: 'phim-le' },
  { label: 'Phim Bộ Hot', category: 'phim-bo' },
  { label: 'Hành Động', genre: 'hanh-dong' },
  { label: 'Cổ Trang', genre: 'co-trang' },
  { label: 'Anime / Hoạt Hình', category: 'hoat-hinh' },
  { label: 'Tình Cảm', genre: 'tinh-cam' },
  { label: 'Kinh Dị', genre: 'kinh-di' },
  { label: 'Hàn Quốc', country: 'han-quoc' },
];

export const CatalogView: React.FC<CatalogViewProps> = ({
  title,
  subtitle,
  movies,
  paginate,
  filters,
  isLoading,
  error,
  onRetry,
  onFilterChange,
  onFilterReset,
  onPageChange,
  onSelectMovie,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const currentPage = paginate?.current_page || filters.page || 1;
  const totalPages = paginate?.total_page || 1;

  const handlePageClick = (page: number) => {
    if (page === currentPage || page < 1 || page > totalPages) return;
    onPageChange(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Generate pagination items: e.g. [1, '...', 4, 5, 6, '...', 20]
  const renderPaginationButtons = () => {
    if (totalPages <= 1) return null;

    const pages: (number | string)[] = [];
    const delta = 1; // Số trang lân cận trang hiện tại hiển thị trên mobile

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - delta && i <= currentPage + delta)
      ) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }

    return (
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-center">
        {/* Nút Trước */}
        <button
          type="button"
          onClick={() => handlePageClick(currentPage - 1)}
          disabled={currentPage <= 1}
          className="min-w-[44px] min-h-[44px] px-3 py-2 rounded-xl bg-[#0a180b] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400/50 disabled:opacity-30 disabled:pointer-events-none transition-all flex items-center justify-center cursor-pointer shadow-sm active:scale-95"
          aria-label="Trang trước"
          title="Trang trước"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Các nút số trang */}
        {pages.map((p, idx) => {
          if (p === '...') {
            return (
              <span
                key={`ellipsis-${idx}`}
                className="w-8 text-center text-xs font-bold text-[#8aa885] select-none"
              >
                ...
              </span>
            );
          }

          const pageNum = p as number;
          const isActive = pageNum === currentPage;

          return (
            <button
              key={`page-${pageNum}`}
              type="button"
              onClick={() => handlePageClick(pageNum)}
              className={`min-w-[44px] min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center cursor-pointer active:scale-95 ${
                isActive
                  ? 'bg-lime-500 text-black font-extrabold shadow-[0_0_14px_rgba(132,204,22,0.5)] ring-1 ring-lime-400'
                  : 'bg-[#0a180b] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400/50 hover:bg-lime-950/40'
              }`}
              aria-label={`Trang ${pageNum}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {pageNum}
            </button>
          );
        })}

        {/* Nút Sau */}
        <button
          type="button"
          onClick={() => handlePageClick(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="min-w-[44px] min-h-[44px] px-3 py-2 rounded-xl bg-[#0a180b] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400/50 disabled:opacity-30 disabled:pointer-events-none transition-all flex items-center justify-center cursor-pointer shadow-sm active:scale-95"
          aria-label="Trang sau"
          title="Trang sau"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  };

  const isSearchOrFilterActive = Boolean(
    filters.keyword ||
    filters.category ||
    filters.genre ||
    filters.country ||
    filters.year
  );

  return (
    <div className="space-y-6">
      {/* Header & View Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-lime-500/15 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#f4fbf0] tracking-tight flex items-center gap-2">
            <span className="w-2.5 h-6 rounded-full bg-lime-400 shadow-[0_0_10px_rgba(132,204,22,0.5)]" />
            <span>{title}</span>
          </h1>
          {subtitle && (
            <p className="text-xs text-[#a8cca2] mt-1 ml-4.5 font-medium">
              {subtitle}
            </p>
          )}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto bg-[#071307] p-1 rounded-xl border border-lime-500/20">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-lime-500 text-black shadow-sm font-extrabold'
                : 'text-[#8aa885] hover:text-[#d8ebd5]'
            }`}
            aria-label="Chế độ hiển thị dạng lưới"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Lưới (Grid)</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'table'
                ? 'bg-lime-500 text-black shadow-sm font-extrabold'
                : 'text-[#8aa885] hover:text-[#d8ebd5]'
            }`}
            aria-label="Chế độ hiển thị dạng bảng"
          >
            <List className="w-3.5 h-3.5" />
            <span>Bảng (Table)</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onChange={onFilterChange}
        onReset={onFilterReset}
      />

      {/* Content Area */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-10 h-10 text-lime-400 animate-spin mb-3" />
          <p className="text-sm font-semibold text-[#a8cca2]">
            Đang tải danh sách phim Bơ Film...
          </p>
        </div>
      ) : error ? (
        <div role="alert" className="py-16 text-center space-y-4">
          <p className="text-red-300">Không tải được danh sách phim. Vui lòng thử lại.</p>
          <button type="button" onClick={onRetry} className="rounded-xl bg-lime-500 px-5 py-2 font-bold text-black">Thử lại</button>
        </div>
      ) : movies.length === 0 ? (
        /* UX-D01: Redesigned Empty State with Cinema Taste & Suggestions */
        <div className="py-12 sm:py-16 text-center bg-[#071307] rounded-3xl border border-lime-500/20 p-6 sm:p-10 space-y-6 shadow-2xl relative overflow-hidden">
          {/* Subtle Ambient Glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-lime-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Icon Halo */}
          <div className="relative mx-auto w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-[#0a180b] border border-lime-500/30 flex items-center justify-center shadow-[0_0_25px_rgba(132,204,22,0.15)]">
            {filters.keyword ? (
              <SearchX className="w-8 h-8 sm:w-10 sm:h-10 text-lime-400 stroke-[1.5]" />
            ) : (
              <Film className="w-8 h-8 sm:w-10 sm:h-10 text-lime-400 stroke-[1.5]" />
            )}
          </div>

          <div className="space-y-2 relative">
            <h3 className="text-lg sm:text-xl font-black text-[#f4fbf0] tracking-tight">
              {filters.keyword
                ? `Không tìm thấy phim cho "${filters.keyword}"`
                : 'Không có phim phù hợp với tiêu chí lọc'}
            </h3>
            <p className="text-xs sm:text-sm text-[#a8cca2] max-w-lg mx-auto leading-relaxed">
              {filters.keyword
                ? 'Gợi ý: Kiểm tra lỗi chính tả từ khóa, tìm bằng tên tiếng Anh / gốc, hoặc khám phá các danh mục phim hot bên dưới.'
                : 'Vui lòng điều chỉnh hoặc xóa bớt tiêu chí trong bộ lọc phía trên để hiển thị thêm nhiều tác phẩm hấp dẫn.'}
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 relative">
            {isSearchOrFilterActive && (
              <button
                type="button"
                onClick={onFilterReset}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-lime-500 text-black text-xs font-black hover:bg-lime-400 transition-all shadow-[0_0_15px_rgba(132,204,22,0.35)] flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Đặt lại bộ lọc & tìm kiếm</span>
              </button>
            )}
            <a
              href="/"
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0a180b] border border-lime-500/25 text-[#d8ebd5] hover:text-lime-300 hover:border-lime-400/50 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Về Trang Chủ Bơ Film</span>
            </a>
          </div>

          {/* Popular Search Suggestions (No Dead-End) */}
          <div className="pt-4 border-t border-lime-500/15 max-w-xl mx-auto relative">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-lime-400 mb-3 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gợi ý khám phá thịnh hành</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {POPULAR_SUGGESTIONS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onFilterChange({
                      page: 1,
                      category: item.category,
                      genre: item.genre,
                      country: item.country,
                    });
                  }}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-full bg-[#0a180b] hover:bg-lime-950/60 text-xs font-semibold text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 hover:border-lime-400/50 transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {movies.map((movie) => (
            <MovieCard
              key={movie.slug}
              movie={movie}
              onClick={() => onSelectMovie(movie.slug)}
            />
          ))}
        </div>
      ) : (
        <MovieTableView
          movies={movies}
          onSelectMovie={onSelectMovie}
        />
      )}

      {/* UX-B01: Enhanced Pagination with Touch Targets >= 44px */}
      {totalPages > 1 && !isLoading && (
        <div className="pt-6 pb-4 space-y-3">
          {renderPaginationButtons()}
          <div className="text-center">
            <span className="text-[11px] font-semibold text-[#8aa885]">
              Đang xem trang {currentPage} trên tổng số {totalPages} trang
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
