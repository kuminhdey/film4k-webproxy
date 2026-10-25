import React, { useRef } from 'react';
import { RotateCcw, X, SlidersHorizontal } from 'lucide-react';

export interface FilterBarProps {
  sort: string;
  onSortChange: (sort: string) => void;
  type: string;
  onTypeChange: (type: string) => void;
  selectedGenre: string;
  onGenreChange: (genre: string) => void;
  selectedCountry?: string;
  onCountryChange?: (country: string) => void;
  selectedYear?: string;
  onYearChange?: (year: string) => void;
  selectedResolution?: string;
  onResolutionChange?: (res: string) => void;
  selectedTrack?: string;
  onTrackChange?: (track: string) => void;
  onResetFilters?: () => void;
}

const GENRES = [
  'Tất cả',
  'Phim Hành Động',
  'Phim Chính Kịch',
  'Phim Hài',
  'Phim Hoạt Hình',
  'Phim Khoa Học Viễn Tưởng',
  'Phim Kinh Dị',
  'Phim Lãng Mạn',
  'Phim Phiêu Lưu',
  'Phim Gây Cấn',
  'Phim Bí Ẩn',
  'Phim Chiến Tranh',
  'Phim Tài Liệu',
  'Phim Cổ Trang',
  'Phim Võ Thuật',
  'Phim Gia Đình',
  'Phim Âm Nhạc',
];

const TYPES = [
  { id: 'all', label: 'Tất cả' },
  { id: 'movie', label: 'Phim Lẻ' },
  { id: 'tv', label: 'Phim Bộ' },
];

const COUNTRIES = [
  { id: 'all', label: 'Tất cả quốc gia' },
  { id: 'au-my', label: 'Âu Mỹ' },
  { id: 'han-quoc', label: 'Hàn Quốc' },
  { id: 'trung-quoc', label: 'Trung Quốc' },
  { id: 'nhat-ban', label: 'Nhật Bản' },
  { id: 'thai-lan', label: 'Thái Lan' },
  { id: 'viet-nam', label: 'Việt Nam' },
  { id: 'hong-kong', label: 'Hồng Kông' },
  { id: 'anh', label: 'Anh' },
  { id: 'phap', label: 'Pháp' },
  { id: 'an-do', label: 'Ấn Độ' },
];

const YEARS = [
  { id: 'all', label: 'Tất cả năm' },
  { id: '2026', label: '2026' },
  { id: '2025', label: '2025' },
  { id: '2024', label: '2024' },
  { id: '2023', label: '2023' },
  { id: '2022', label: '2022' },
  { id: '2020-2021', label: '2020 - 2021' },
  { id: '2015-2019', label: '2015 - 2019' },
  { id: 'before-2015', label: 'Trước 2015' },
];

const RESOLUTIONS = [
  { id: 'all', label: 'Tất cả' },
  { id: '4K', label: '4K Ultra HD' },
  { id: '2K', label: '2K QHD' },
  { id: '1080p', label: '1080p Full HD' },
  { id: '720p', label: '720p HD' },
];

const TRACKS = [
  { id: 'all', label: 'Tất cả bản dịch' },
  { id: 'tm', label: 'Thuyết minh (TM)' },
  { id: 'pd', label: 'Phụ đề (PD)' },
  { id: 'lt', label: 'Lồng tiếng (LT)' },
];

const SORTS = [
  { id: 'latest', label: 'Mới nhất' },
  { id: 'views', label: 'Xem nhiều nhất' },
  { id: 'score', label: 'Điểm TMDB cao' },
  { id: 'year', label: 'Năm phát hành' },
];

export const FilterBar: React.FC<FilterBarProps> = ({
  sort,
  onSortChange,
  type,
  onTypeChange,
  selectedGenre,
  onGenreChange,
  selectedCountry = 'all',
  onCountryChange,
  selectedYear = 'all',
  onYearChange,
  selectedResolution = 'all',
  onResolutionChange,
  selectedTrack = 'all',
  onTrackChange,
  onResetFilters,
}) => {
  const genreRef = useRef<HTMLDivElement | null>(null);
  const countryRef = useRef<HTMLDivElement | null>(null);
  const yearRef = useRef<HTMLDivElement | null>(null);

  const scrollRight = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      ref.current.scrollBy({ left: 240, behavior: 'smooth' });
    }
  };

  // Compile list of active filters
  const activeFilters: { id: string; label: string; onRemove: () => void }[] = [];

  if (selectedGenre) {
    activeFilters.push({
      id: 'genre',
      label: `Thể loại: ${selectedGenre}`,
      onRemove: () => onGenreChange(''),
    });
  }

  if (selectedCountry && selectedCountry !== 'all') {
    const cObj = COUNTRIES.find((c) => c.id === selectedCountry);
    activeFilters.push({
      id: 'country',
      label: `Quốc gia: ${cObj ? cObj.label : selectedCountry}`,
      onRemove: () => onCountryChange?.('all'),
    });
  }

  if (selectedYear && selectedYear !== 'all') {
    const yObj = YEARS.find((y) => y.id === selectedYear);
    activeFilters.push({
      id: 'year',
      label: `Năm: ${yObj ? yObj.label : selectedYear}`,
      onRemove: () => onYearChange?.('all'),
    });
  }

  if (selectedResolution && selectedResolution !== 'all') {
    activeFilters.push({
      id: 'resolution',
      label: `Chất lượng: ${selectedResolution}`,
      onRemove: () => onResolutionChange?.('all'),
    });
  }

  if (selectedTrack && selectedTrack !== 'all') {
    const tObj = TRACKS.find((t) => t.id === selectedTrack);
    activeFilters.push({
      id: 'track',
      label: `Bản dịch: ${tObj ? tObj.label : selectedTrack}`,
      onRemove: () => onTrackChange?.('all'),
    });
  }

  if (type && type !== 'all') {
    activeFilters.push({
      id: 'type',
      label: `Định dạng: ${type === 'movie' ? 'Phim Lẻ' : 'Phim Bộ'}`,
      onRemove: () => onTypeChange('all'),
    });
  }

  if (sort && sort !== 'latest') {
    const sObj = SORTS.find((s) => s.id === sort);
    activeFilters.push({
      id: 'sort',
      label: `Sắp xếp: ${sObj ? sObj.label : sort}`,
      onRemove: () => onSortChange('latest'),
    });
  }

  const hasActiveFilters = activeFilters.length > 0;

  const handleClearAll = () => {
    if (onResetFilters) {
      onResetFilters();
    } else {
      onSortChange('latest');
      onTypeChange('all');
      onGenreChange('');
      onCountryChange?.('all');
      onYearChange?.('all');
      onResolutionChange?.('all');
      onTrackChange?.('all');
    }
  };

  return (
    <div className="filter-bar" id="filters" aria-label="Bộ lọc đa chiều" style={{ background: '#0a150c', border: '1px solid #1e3f28', borderRadius: '16px', padding: '16px 20px', marginTop: '16px' }}>
      <div className="filter-bar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid rgba(30, 63, 40, 0.7)', paddingBottom: '12px' }}>
        <div className="filter-bar-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fcfdf7', fontSize: '15px', fontWeight: 700 }}>
          <SlidersHorizontal size={18} color="#aeea00" />
          <span>Bộ Lọc Đa Chiều Cinema</span>
          <span style={{ fontSize: '11px', background: 'rgba(174, 234, 0, 0.12)', color: '#aeea00', border: '1px solid rgba(174, 234, 0, 0.3)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
            Avocado Matrix
          </span>
        </div>

        {/* Clear Filters Button (When filters are active) */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearAll}
            className="filter-clear-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#fcfdf7',
              background: 'rgba(132, 204, 22, 0.15)',
              border: '1px solid #84cc16',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#84cc16';
              e.currentTarget.style.color = '#070e08';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(132, 204, 22, 0.15)';
              e.currentTarget.style.color = '#fcfdf7';
            }}
          >
            <RotateCcw size={13} />
            <span>Xóa tất cả bộ lọc ({activeFilters.length})</span>
          </button>
        )}
      </div>

      {/* Active Filter Tags Summary */}
      {hasActiveFilters && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            padding: '10px 14px',
            background: '#0f2214',
            border: '1px dashed #285436',
            borderRadius: '10px',
            marginBottom: '16px',
            fontSize: '12px',
          }}
        >
          <span style={{ color: 'var(--muted, #94a896)', fontWeight: 600 }}>Đang áp dụng:</span>
          {activeFilters.map((af) => (
            <span
              key={af.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 10px',
                background: '#132b1a',
                border: '1px solid #aeea00',
                borderRadius: '999px',
                color: '#c6ff00',
                fontWeight: 600,
              }}
            >
              <span>{af.label}</span>
              <button
                type="button"
                onClick={af.onRemove}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#c6ff00',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Bỏ tiêu chí này"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 1. Sắp xếp (Sort) */}
      <div className="filter-row">
        <span className="filter-label">Sắp xếp:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${sort === s.id ? 'on' : ''}`}
                onClick={() => onSortChange(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Phân loại (Type) */}
      <div className="filter-row">
        <span className="filter-label">Phân loại:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`chip ${type === t.id ? 'on' : ''}`}
                onClick={() => onTypeChange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Độ phân giải (Quality) */}
      <div className="filter-row">
        <span className="filter-label">Độ phân giải:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`chip ${selectedResolution === r.id ? 'on' : ''}`}
                onClick={() => onResolutionChange?.(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Bản dịch & Âm thanh (Track: Thuyết minh / Phụ đề) */}
      <div className="filter-row">
        <span className="filter-label">Bản dịch:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips">
            {TRACKS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`chip ${selectedTrack === t.id ? 'on' : ''}`}
                onClick={() => onTrackChange?.(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Năm phát hành (Year) */}
      <div className="filter-row">
        <span className="filter-label">Năm phát hành:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips" ref={yearRef}>
            {YEARS.map((y) => (
              <button
                key={y.id}
                type="button"
                className={`chip ${selectedYear === y.id ? 'on' : ''}`}
                onClick={() => onYearChange?.(y.id)}
              >
                {y.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="filter-arrow filter-arrow-right"
            aria-label="Cuộn sang phải"
            onClick={() => scrollRight(yearRef)}
          >
            ›
          </button>
        </div>
      </div>

      {/* 6. Quốc gia (Country) */}
      <div className="filter-row">
        <span className="filter-label">Quốc gia:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips" ref={countryRef}>
            {COUNTRIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${selectedCountry === c.id ? 'on' : ''}`}
                onClick={() => onCountryChange?.(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="filter-arrow filter-arrow-right"
            aria-label="Cuộn sang phải"
            onClick={() => scrollRight(countryRef)}
          >
            ›
          </button>
        </div>
      </div>

      {/* 7. Thể loại (Genre) */}
      <div className="filter-row">
        <span className="filter-label">Thể loại:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips" ref={genreRef}>
            {GENRES.map((g) => (
              <button
                key={g}
                type="button"
                className={`chip ${(g === 'Tất cả' && !selectedGenre) || selectedGenre === g ? 'on' : ''}`}
                onClick={() => onGenreChange(g === 'Tất cả' ? '' : g)}
              >
                {g}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="filter-arrow filter-arrow-right"
            aria-label="Cuộn sang phải"
            onClick={() => scrollRight(genreRef)}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
};
