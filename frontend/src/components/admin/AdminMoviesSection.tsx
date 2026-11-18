// frontend/src/components/admin/AdminMoviesSection.tsx
import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Film,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Star,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { MovieSummary } from '../../types';
import { AdminFilterType, AdminSortOption, resolveAdminPosterSrc } from './adminTypes';

interface AdminMoviesSectionProps {
  movies: MovieSummary[];
  moviesTotal: number;
  moviesLoading: boolean;
  moviesError: string | null;
  searchQuery: string;
  filterType: AdminFilterType;
  sortBy: AdminSortOption;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  jumpPageInput: string;
  clearingCacheSlug: string | null;
  deletingMovieSlug: string | null;
  onSearchChange: (q: string) => void;
  onFilterTypeChange: (t: AdminFilterType) => void;
  onSortChange: (s: AdminSortOption) => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (size: number) => void;
  onJumpPageInputChange: (val: string) => void;
  onJumpPageSubmit: (e: React.FormEvent) => void;
  onRetryFetch: () => void;
  onOpenCreateMovie: () => void;
  onOpenEditMovie: (movie: MovieSummary) => void;
  onRequestDeleteMovie: (movie: MovieSummary) => void;
  onRequestClearMovieCache: (movie: MovieSummary) => void;
  onWatchMovie: (slug: string) => void;
}

const MoviePosterThumb: React.FC<{ poster?: string | null; alt: string; className?: string }> = ({
  poster,
  alt,
  className = 'w-10 h-14',
}) => {
  const [failed, setFailed] = useState(false);
  const src = resolveAdminPosterSrc(poster);

  if (failed || !poster || poster.trim() === '' || poster.trim() === '/placeholder.png') {
    return (
      <div
        className={`${className} rounded-lg bg-[#060b05] border border-[rgba(163,230,53,0.16)] flex items-center justify-center shrink-0`}
        aria-hidden="true"
      >
        <img
          src="/logo-64.png"
          alt=""
          width={28}
          height={28}
          decoding="async"
          className="w-7 h-7 object-contain opacity-85"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={40}
      height={56}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${className} rounded-lg object-cover bg-[#060b05] border border-[rgba(163,230,53,0.14)] shrink-0`}
    />
  );
};

function buildPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
  pages.push(1);
  if (currentPage > 3) pages.push('...');
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (currentPage < totalPages - 2) pages.push('...');
  pages.push(totalPages);
  return pages;
}

const SORT_OPTIONS: readonly { id: AdminSortOption; label: string }[] = [
  { id: 'latest', label: 'Mới cập nhật' },
  { id: 'year', label: 'Năm' },
  { id: 'score', label: 'Điểm' },
  { id: 'name_asc', label: 'Tên A-Z' },
];

export const AdminMoviesSection: React.FC<AdminMoviesSectionProps> = ({
  movies,
  moviesTotal,
  moviesLoading,
  moviesError,
  searchQuery,
  filterType,
  sortBy,
  currentPage,
  pageSize,
  totalPages,
  jumpPageInput,
  clearingCacheSlug,
  deletingMovieSlug,
  onSearchChange,
  onFilterTypeChange,
  onSortChange,
  onPageChange,
  onPageSizeChange,
  onJumpPageInputChange,
  onJumpPageSubmit,
  onRetryFetch,
  onOpenCreateMovie,
  onOpenEditMovie,
  onRequestDeleteMovie,
  onRequestClearMovieCache,
  onWatchMovie,
}) => {
  const pageNumbers = buildPageNumbers(currentPage, totalPages);

  return (
    <section
      aria-labelledby="admin-movies-heading"
      className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-4 sm:p-6"
    >
      {/* Top Header + Create Movie CTA */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h2 id="admin-movies-heading" className="text-lg font-bold text-[#f4fbf0]">
            Quản Lý Danh Sách Phim &amp; Cache M3U8
          </h2>
          <p className="mt-1 text-[13px] text-[#9ab395] tabular-nums">
            Tổng cộng <strong className="text-lime-300 font-semibold">{moviesTotal.toLocaleString()}</strong> phim
            trong cơ sở dữ liệu
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenCreateMovie}
          className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-lime-400 hover:bg-lime-300 text-[#060b05] text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Thêm Phim Mới</span>
        </button>
      </div>

      {/* Filter Tabs + Sort Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div role="group" aria-label="Lọc theo định dạng phim" className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: 'Tất cả' },
              { id: 'movie', label: 'Phim lẻ' },
              { id: 'tv', label: 'Phim bộ' },
            ] as const
          ).map((tab) => {
            const active = filterType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterTypeChange(tab.id)}
                className={`min-h-[44px] min-w-[44px] px-3.5 rounded-xl text-xs font-bold border transition-colors motion-reduce:transition-none cursor-pointer ${
                  active
                    ? 'bg-lime-400/20 border-lime-400/50 text-lime-300'
                    : 'bg-[#060b05] border-[rgba(163,230,53,0.14)] text-[#9ab395] hover:text-[#f4fbf0]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div role="group" aria-label="Sắp xếp danh sách phim" className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-[#9ab395] mr-1">Sắp xếp:</span>
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSortChange(opt.id)}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-xl text-xs font-semibold border inline-flex items-center justify-center gap-1.5 transition-colors motion-reduce:transition-none cursor-pointer ${
                  active
                    ? 'bg-emerald-500/15 border-emerald-400/45 text-emerald-300'
                    : 'bg-[#060b05] border-[rgba(163,230,53,0.14)] text-[#9ab395] hover:text-[#f4fbf0]'
                }`}
              >
                {opt.id === 'name_asc' ? (
                  <ArrowUpAZ className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <ArrowDownWideNarrow className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search Input */}
      <div className="mb-5">
        <label htmlFor="admin-movie-search" className="block text-xs font-bold text-[#9ab395] mb-1.5">
          Tìm kiếm phim theo tên tiếng Việt, tên gốc hoặc slug
        </label>
        <div className="relative flex items-center">
          <Search
            className="w-4 h-4 text-[#9ab395] absolute left-3.5 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="admin-movie-search"
            type="search"
            aria-label="Tìm kiếm phim theo tên tiếng Việt, tên gốc hoặc slug"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm kiếm phim theo tên tiếng Việt, tên gốc hoặc slug..."
            className="w-full min-h-[46px] pl-10 pr-12 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.18)] text-[#f4fbf0] placeholder-[#9ab395]/75 text-base sm:text-sm transition-colors motion-reduce:transition-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Xóa từ khóa tìm kiếm"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#9ab395] hover:text-[#f4fbf0] hover:bg-white/5 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Loading / Error / Empty / Data States */}
      {moviesLoading ? (
        <div className="py-12 text-center text-[#9ab395]">
          <Loader2
            className="w-7 h-7 text-lime-400 animate-spin motion-reduce:animate-none mx-auto mb-3"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">Đang tải danh sách phim...</p>
        </div>
      ) : moviesError ? (
        <div
          role="alert"
          className="my-4 p-6 rounded-2xl bg-red-500/12 border border-red-400/35 text-center"
        >
          <AlertTriangle className="w-9 h-9 text-red-300 mx-auto mb-3" aria-hidden="true" />
          <h3 className="text-base font-bold text-red-200 mb-1.5">
            Không thể tải danh sách phim từ máy chủ
          </h3>
          <p className="text-[13px] text-red-200/90 max-w-md mx-auto mb-4">{moviesError}</p>
          <button
            type="button"
            onClick={onRetryFetch}
            className="min-h-[44px] min-w-[44px] px-5 rounded-xl bg-lime-400 hover:bg-lime-300 text-[#060b05] text-[13px] font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Thử lại</span>
          </button>
        </div>
      ) : movies.length === 0 ? (
        <div className="py-12 text-center rounded-2xl bg-[#060b05] border border-[rgba(163,230,53,0.12)] px-4">
          <Film className="w-8 h-8 text-[#9ab395] mx-auto mb-2.5" aria-hidden="true" />
          <p className="text-sm font-medium text-[#9ab395]">
            Không tìm thấy phim phù hợp với từ khóa tìm kiếm.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop & Tablet Table (hidden on < 768px) */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-[rgba(163,230,53,0.12)] bg-[#060b05]">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="bg-[#0a170a] border-b border-[rgba(163,230,53,0.14)] text-xs font-bold uppercase tracking-wider text-[#9ab395]">
                <tr>
                  <th
                    scope="col"
                    aria-sort={
                      sortBy === 'name_asc'
                        ? 'ascending'
                        : sortBy === 'latest'
                          ? 'descending'
                          : 'none'
                    }
                    className="py-1.5 px-3.5"
                  >
                    <button
                      type="button"
                      onClick={() => onSortChange(sortBy === 'name_asc' ? 'latest' : 'name_asc')}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#9ab395] hover:text-lime-300 cursor-pointer"
                    >
                      <span>Phim ({sortBy === 'name_asc' ? 'Tên A-Z' : 'Mới cập nhật'})</span>
                      {sortBy === 'name_asc' ? (
                        <ArrowUpAZ className="w-3.5 h-3.5 text-lime-400" aria-hidden="true" />
                      ) : (
                        <ArrowDownWideNarrow
                          className={`w-3.5 h-3.5 ${sortBy === 'latest' ? 'text-lime-400' : 'opacity-60'}`}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-3.5">
                    Loại &amp; Thể loại
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortBy === 'year' ? 'descending' : 'none'}
                    className="py-1.5 px-3"
                  >
                    <button
                      type="button"
                      onClick={() => onSortChange('year')}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#9ab395] hover:text-lime-300 cursor-pointer"
                    >
                      <span>Năm</span>
                      <ArrowDownWideNarrow
                        className={`w-3.5 h-3.5 ${sortBy === 'year' ? 'text-lime-400' : 'opacity-60'}`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortBy === 'score' ? 'descending' : 'none'}
                    className="py-1.5 px-3"
                  >
                    <button
                      type="button"
                      onClick={() => onSortChange('score')}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#9ab395] hover:text-lime-300 cursor-pointer"
                    >
                      <span>Điểm</span>
                      <ArrowDownWideNarrow
                        className={`w-3.5 h-3.5 ${sortBy === 'score' ? 'text-lime-400' : 'opacity-60'}`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-3.5">
                    Trạng Thái Cache M3U8
                  </th>
                  <th scope="col" className="py-3 px-3.5 text-right">
                    Hành Động
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[rgba(163,230,53,0.08)]">
                {movies.map((m) => {
                  const isClearing = clearingCacheSlug === m.slug;
                  const isDeleting = deletingMovieSlug === m.slug;
                  const displayTitle = m.title_vi || m.name || m.title_en || m.slug;

                  return (
                    <tr
                      key={m.id || m.slug}
                      className="hover:bg-lime-400/[0.04] transition-colors motion-reduce:transition-none"
                    >
                      <td className="py-3 px-3.5 min-w-[240px]">
                        <div className="flex items-center gap-3">
                          <MoviePosterThumb poster={m.poster} alt={displayTitle} />
                          <div className="min-w-0">
                            <div className="font-semibold text-[#f4fbf0] line-clamp-2 leading-snug">
                              {displayTitle}
                            </div>
                            <div className="mt-0.5 text-xs text-[#9ab395] truncate font-mono">
                              {m.title_en && m.title_en !== displayTitle
                                ? `${m.title_en} • ${m.slug}`
                                : m.slug}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border ${
                              m.movie_type === 'tv'
                                ? 'bg-teal-500/15 border-teal-400/35 text-teal-300'
                                : 'bg-lime-400/15 border-lime-400/35 text-lime-300'
                            }`}
                          >
                            {m.movie_type === 'tv' ? 'Phim bộ' : 'Phim lẻ'}
                          </span>
                          <span className="text-xs text-[#9ab395]">
                            {m.genres && m.genres.length > 0
                              ? m.genres.slice(0, 2).join(', ')
                              : 'Điện ảnh'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-[#f4fbf0] tabular-nums whitespace-nowrap">
                        {m.year || '—'}
                      </td>

                      <td className="py-3 px-3 tabular-nums whitespace-nowrap">
                        {m.score != null && Number(m.score) > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                            <Star className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                            <span>{Number(m.score).toFixed(1)}</span>
                          </span>
                        ) : (
                          <span className="text-[#9ab395]">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
                        {m.has_cached_m3u8 ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-lime-400/15 border border-lime-400/35 text-lime-300">
                            <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>Có mục playlist cache</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white/5 border border-[rgba(163,230,53,0.16)] text-[#9ab395]">
                            <Square className="w-3 h-3 shrink-0 opacity-75" aria-hidden="true" />
                            <span>Chưa có cache</span>
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onWatchMovie(m.slug)}
                            aria-label={`Xem phim ${displayTitle}`}
                            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#0a170a] border border-[rgba(163,230,53,0.18)] text-xs font-semibold text-[#f4fbf0] hover:bg-lime-400/10 hover:border-lime-400/35 inline-flex items-center justify-center gap-1.5 transition-colors motion-reduce:transition-none cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current text-lime-400" aria-hidden="true" />
                            <span>Xem</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenEditMovie(m)}
                            aria-label={`Sửa thông tin phim ${displayTitle}`}
                            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-emerald-500/12 border border-emerald-400/30 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/22 inline-flex items-center justify-center gap-1.5 transition-colors motion-reduce:transition-none cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Sửa</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onRequestClearMovieCache(m)}
                            disabled={isClearing}
                            aria-label={`Xóa cache M3U8 phim ${displayTitle}`}
                            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-amber-500/12 border border-amber-400/30 text-xs font-semibold text-amber-200 enabled:hover:bg-amber-500/22 inline-flex items-center justify-center gap-1.5 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isClearing ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                            )}
                            <span>Xóa Cache</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onRequestDeleteMovie(m)}
                            disabled={isDeleting}
                            aria-label={`Xóa phim ${displayTitle}`}
                            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-red-500/12 border border-red-400/30 text-xs font-semibold text-red-200 enabled:hover:bg-red-500/22 inline-flex items-center justify-center gap-1.5 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isDeleting ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5 text-red-300" aria-hidden="true" />
                            )}
                            <span>Xóa</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card List (visible on < 768px so 390x844 never crushes titles) */}
          <div className="md:hidden space-y-3" role="list" aria-label="Danh sách phim quản trị trên di động">
            {movies.map((m) => {
              const isClearing = clearingCacheSlug === m.slug;
              const isDeleting = deletingMovieSlug === m.slug;
              const displayTitle = m.title_vi || m.name || m.title_en || m.slug;

              return (
                <article
                  key={m.id || m.slug}
                  role="listitem"
                  className="rounded-2xl bg-[#060b05] border border-[rgba(163,230,53,0.14)] p-3.5 space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <MoviePosterThumb poster={m.poster} alt={displayTitle} className="w-12 h-16" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-[#f4fbf0] leading-snug line-clamp-2 break-words">
                        {displayTitle}
                      </h3>
                      <p className="mt-0.5 text-xs text-[#9ab395] font-mono truncate">
                        {m.title_en || m.slug}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold border ${
                            m.movie_type === 'tv'
                              ? 'bg-teal-500/15 border-teal-400/35 text-teal-300'
                              : 'bg-lime-400/15 border-lime-400/35 text-lime-300'
                          }`}
                        >
                          {m.movie_type === 'tv' ? 'Phim bộ' : 'Phim lẻ'}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-[#0a170a] border border-[rgba(163,230,53,0.14)] text-[#f4fbf0]">
                          {m.year || '—'}
                        </span>
                        {m.score != null && Number(m.score) > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/12 border border-amber-400/30 text-amber-300 font-semibold">
                            <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                            <span>{Number(m.score).toFixed(1)}</span>
                          </span>
                        )}
                        {m.has_cached_m3u8 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-lime-400/15 border border-lime-400/35 text-lime-300 font-semibold">
                            <Zap className="w-3 h-3" aria-hidden="true" />
                            <span>Có cache</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-[rgba(163,230,53,0.14)] text-[#9ab395]">
                            <span>Chưa có cache</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[rgba(163,230,53,0.1)]">
                    <button
                      type="button"
                      onClick={() => onWatchMovie(m.slug)}
                      className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#0a170a] border border-[rgba(163,230,53,0.18)] text-xs font-semibold text-[#f4fbf0] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current text-lime-400" aria-hidden="true" />
                      <span>Xem</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenEditMovie(m)}
                      className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-emerald-500/12 border border-emerald-400/30 text-xs font-semibold text-emerald-300 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Sửa</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onRequestClearMovieCache(m)}
                      disabled={isClearing}
                      className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-amber-500/12 border border-amber-400/30 text-xs font-semibold text-amber-200 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isClearing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                      )}
                      <span>Xóa Cache</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onRequestDeleteMovie(m)}
                      disabled={isDeleting}
                      className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-red-500/12 border border-red-400/30 text-xs font-semibold text-red-200 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5 text-red-300" aria-hidden="true" />
                      )}
                      <span>Xóa</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Pagination Footer */}
          <div className="mt-5 pt-4 border-t border-[rgba(163,230,53,0.14)] flex flex-wrap items-center justify-between gap-4 text-[13px] text-[#9ab395]">
            <div className="flex flex-wrap items-center gap-4 tabular-nums">
              <div>
                Hiển thị trang <strong className="text-[#f4fbf0] font-bold">{currentPage}</strong> /{' '}
                <strong className="text-[#f4fbf0] font-bold">{totalPages}</strong> (Tổng cộng{' '}
                <strong className="text-lime-300 font-bold">{moviesTotal.toLocaleString()}</strong> phim)
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="admin-page-size" className="text-xs font-semibold text-[#9ab395]">
                  Hiển thị:
                </label>
                <select
                  id="admin-page-size"
                  aria-label="Số lượng phim mỗi trang"
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.18)] text-[#f4fbf0] text-base sm:text-xs font-semibold cursor-pointer"
                >
                  <option value={20}>20 phim</option>
                  <option value={25}>25 phim</option>
                  <option value={50}>50 phim</option>
                  <option value={100}>100 phim</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPageChange(1)}
                disabled={currentPage <= 1}
                aria-label="Trang đầu"
                className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.16)] text-xs font-semibold text-[#f4fbf0] enabled:hover:border-lime-400/40 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronsLeft className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Trang đầu</span>
              </button>

              <button
                type="button"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                aria-label="Trang trước"
                className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.16)] text-xs font-semibold text-[#f4fbf0] enabled:hover:border-lime-400/40 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Trang trước</span>
              </button>

              <div className="flex items-center gap-1">
                {pageNumbers.map((p, idx) => {
                  if (p === '...') {
                    return (
                      <span key={`ellipsis-${idx}`} className="px-2 text-[#9ab395] select-none">
                        ...
                      </span>
                    );
                  }
                  const isCurrent = p === currentPage;
                  return (
                    <button
                      key={`page-${p}`}
                      type="button"
                      onClick={() => onPageChange(p)}
                      aria-label={`Trang ${p}`}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={`min-h-[44px] min-w-[44px] px-2.5 rounded-xl text-xs font-bold tabular-nums border inline-flex items-center justify-center cursor-pointer transition-colors motion-reduce:transition-none ${
                        isCurrent
                          ? 'bg-lime-400/20 border-lime-400/55 text-lime-300'
                          : 'bg-[#060b05] border-[rgba(163,230,53,0.16)] text-[#f4fbf0] hover:border-lime-400/35'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                aria-label="Trang sau"
                className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.16)] text-xs font-semibold text-[#f4fbf0] enabled:hover:border-lime-400/40 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Trang sau</span>
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onPageChange(totalPages)}
                disabled={currentPage >= totalPages}
                aria-label="Trang cuối"
                className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.16)] text-xs font-semibold text-[#f4fbf0] enabled:hover:border-lime-400/40 inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Trang cuối</span>
                <ChevronsRight className="w-4 h-4" aria-hidden="true" />
              </button>

              <form onSubmit={onJumpPageSubmit} className="flex items-center gap-2 ml-1">
                <label htmlFor="admin-jump-page" className="text-xs font-semibold text-[#9ab395]">
                  Đến:
                </label>
                <input
                  id="admin-jump-page"
                  type="number"
                  min={1}
                  max={totalPages}
                  aria-label="Nhập số trang cần chuyển đến"
                  value={jumpPageInput}
                  onChange={(e) => onJumpPageInputChange(e.target.value)}
                  placeholder={String(currentPage)}
                  className="w-16 min-h-[44px] min-w-[44px] px-2 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.18)] text-[#f4fbf0] text-center text-base sm:text-xs tabular-nums"
                />
                <button
                  type="submit"
                  className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.2)] text-xs font-bold text-[#f4fbf0] hover:bg-lime-400/15 hover:border-lime-400/40 cursor-pointer"
                >
                  Chuyển
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
