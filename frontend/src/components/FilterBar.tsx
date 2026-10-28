import React from 'react';
import { Filter, RotateCcw, Clapperboard, Film, Tv, Sparkles } from 'lucide-react';
import { CATEGORIES, GENRES, COUNTRIES, YEARS } from '../constants';
import { FilterOptions } from '../types';

interface FilterBarProps {
  filters: FilterOptions;
  onChange: (newFilters: FilterOptions) => void;
  onReset: () => void;
}

const QUICK_CATEGORY_PILLS = [
  { label: 'Tất Cả', slug: '', icon: Sparkles },
  { label: 'Phim Lẻ', slug: 'phim-le', icon: Film },
  { label: 'Phim Bộ', slug: 'phim-bo', icon: Tv },
  { label: 'Hoạt Hình', slug: 'hoat-hinh', icon: Clapperboard },
  { label: 'TV Shows', slug: 'tv-shows', icon: Tv },
];

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onChange,
  onReset,
}) => {
  const hasActiveFilters = Boolean(
    filters.category ||
    filters.genre ||
    filters.country ||
    filters.year ||
    filters.sort
  );

  return (
    <div className="bg-[#071307] border border-lime-500/20 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
      {/* Top Header: Title & Reset Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-black text-lime-400 uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5" />
          <span>Bộ Lọc Nhanh Bơ Film</span>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-lime-950/60 hover:bg-lime-900/60 border border-lime-500/30 text-xs font-bold text-lime-300 hover:text-lime-200 transition-all cursor-pointer active:scale-95"
            aria-label="Đặt lại toàn bộ bộ lọc"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Đặt lại</span>
          </button>
        )}
      </div>

      {/* UX-B01: Mobile-friendly Quick Category Pills (Horizontal Scroll) */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
        {QUICK_CATEGORY_PILLS.map((pill) => {
          const isSelected = (filters.category || '') === pill.slug;
          const Icon = pill.icon;
          return (
            <button
              key={pill.slug || 'all'}
              type="button"
              onClick={() =>
                onChange({
                  ...filters,
                  category: pill.slug || undefined,
                  page: 1,
                })
              }
              className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer flex-shrink-0 active:scale-95 ${
                isSelected
                  ? 'bg-lime-500 text-black shadow-[0_0_12px_rgba(132,204,22,0.45)] font-extrabold ring-1 ring-lime-400'
                  : 'bg-[#0a180b] hover:bg-lime-950/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 hover:border-lime-400/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{pill.label}</span>
            </button>
          );
        })}
      </div>

      {/* Select Dropdowns Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
        {/* Category Dropdown */}
        <div>
          <label className="block text-[11px] font-bold text-[#a8cca2] mb-1.5">
            Định dạng
          </label>
          <select
            value={filters.category || ''}
            onChange={(e) =>
              onChange({
                ...filters,
                category: e.target.value || undefined,
                page: 1,
              })
            }
            className="w-full min-h-[42px] bg-[#0a180b] border border-lime-500/25 rounded-xl px-3 py-2 text-xs sm:text-[13px] text-[#f4fbf0] focus:outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-400 cursor-pointer transition-colors"
            aria-label="Chọn định dạng phim"
          >
            <option value="">Tất cả định dạng</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Genre Dropdown */}
        <div>
          <label className="block text-[11px] font-bold text-[#a8cca2] mb-1.5">
            Thể loại
          </label>
          <select
            value={filters.genre || ''}
            onChange={(e) =>
              onChange({
                ...filters,
                genre: e.target.value || undefined,
                page: 1,
              })
            }
            className="w-full min-h-[42px] bg-[#0a180b] border border-lime-500/25 rounded-xl px-3 py-2 text-xs sm:text-[13px] text-[#f4fbf0] focus:outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-400 cursor-pointer transition-colors"
            aria-label="Chọn thể loại phim"
          >
            <option value="">Tất cả thể loại</option>
            {GENRES.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {/* Country Dropdown */}
        <div>
          <label className="block text-[11px] font-bold text-[#a8cca2] mb-1.5">
            Quốc gia
          </label>
          <select
            value={filters.country || ''}
            onChange={(e) =>
              onChange({
                ...filters,
                country: e.target.value || undefined,
                page: 1,
              })
            }
            className="w-full min-h-[42px] bg-[#0a180b] border border-lime-500/25 rounded-xl px-3 py-2 text-xs sm:text-[13px] text-[#f4fbf0] focus:outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-400 cursor-pointer transition-colors"
            aria-label="Chọn quốc gia sản xuất"
          >
            <option value="">Tất cả quốc gia</option>
            {COUNTRIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Year Dropdown */}
        <div>
          <label className="block text-[11px] font-bold text-[#a8cca2] mb-1.5">
            Năm phát hành
          </label>
          <select
            value={filters.year || ''}
            onChange={(e) =>
              onChange({
                ...filters,
                year: e.target.value || undefined,
                page: 1,
              })
            }
            className="w-full min-h-[42px] bg-[#0a180b] border border-lime-500/25 rounded-xl px-3 py-2 text-xs sm:text-[13px] text-[#f4fbf0] focus:outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-400 cursor-pointer transition-colors"
            aria-label="Chọn năm phát hành"
          >
            <option value="">Tất cả năm</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                Năm {y}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Dropdown */}
        <div>
          <label className="block text-[11px] font-bold text-[#a8cca2] mb-1.5">
            Sắp xếp
          </label>
          <select
            value={filters.sort || ''}
            onChange={(e) =>
              onChange({
                ...filters,
                sort: e.target.value || undefined,
                page: 1,
              })
            }
            className="w-full min-h-[42px] bg-[#0a180b] border border-lime-500/25 rounded-xl px-3 py-2 text-xs sm:text-[13px] text-[#f4fbf0] focus:outline-none focus:border-lime-400 focus:ring-1 focus:ring-lime-400 cursor-pointer transition-colors"
            aria-label="Sắp xếp kết quả"
          >
            <option value="">Mới cập nhật</option>
            <option value="year_desc">Năm giảm dần</option>
            <option value="name_asc">Tên A-Z</option>
          </select>
        </div>
      </div>
    </div>
  );
};
