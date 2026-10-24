import React, { useRef } from 'react';

interface FilterBarProps {
  sort: string;
  onSortChange: (sort: string) => void;
  type: string;
  onTypeChange: (type: string) => void;
  selectedGenre: string;
  onGenreChange: (genre: string) => void;
  selectedCountry?: string;
  onCountryChange?: (country: string) => void;
  selectedResolution?: string;
  onResolutionChange?: (res: string) => void;
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
  selectedResolution = 'all',
  onResolutionChange,
}) => {
  const genreRef = useRef<HTMLDivElement | null>(null);
  const countryRef = useRef<HTMLDivElement | null>(null);

  const scrollRight = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      ref.current.scrollBy({ left: 240, behavior: 'smooth' });
    }
  };

  return (
    <div className="filter-bar" id="filters" aria-label="Bộ lọc">
      <div className="filter-bar-header">
        <div className="filter-bar-title">
          <svg
            className="filter-icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
          </svg>
          <span>Bộ lọc</span>
        </div>
      </div>

      {/* Sắp xếp */}
      <div className="filter-row">
        <span className="filter-label">Sắp xếp:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips">
            <button
              type="button"
              className={`chip ${sort === 'latest' ? 'on' : ''}`}
              onClick={() => onSortChange('latest')}
            >
              Mới nhất
            </button>
            <button
              type="button"
              className={`chip ${sort === 'views' ? 'on' : ''}`}
              onClick={() => onSortChange('views')}
            >
              Xem nhiều nhất
            </button>
            <button
              type="button"
              className={`chip ${sort === 'score' ? 'on' : ''}`}
              onClick={() => onSortChange('score')}
            >
              Điểm TMDB
            </button>
            <button
              type="button"
              className={`chip ${sort === 'year' ? 'on' : ''}`}
              onClick={() => onSortChange('year')}
            >
              Năm phát hành
            </button>
          </div>
        </div>
      </div>

      {/* Phân loại */}
      <div className="filter-row">
        <span className="filter-label">Phân loại:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips">
            <button
              type="button"
              className={`chip ${type === 'all' ? 'on' : ''}`}
              onClick={() => onTypeChange('all')}
            >
              Tất cả
            </button>
            <button
              type="button"
              className={`chip ${type === 'movie' ? 'on' : ''}`}
              onClick={() => onTypeChange('movie')}
            >
              Phim Lẻ
            </button>
            <button
              type="button"
              className={`chip ${type === 'tv' ? 'on' : ''}`}
              onClick={() => onTypeChange('tv')}
            >
              Phim Bộ
            </button>
          </div>
        </div>
      </div>

      {/* Độ phân giải */}
      <div className="filter-row">
        <span className="filter-label">Độ phân giải:</span>
        <div className="filter-chips-wrapper">
          <div className="filter-chips">
            {['all', '4K', '2K', '1080p', '720p'].map((r) => (
              <button
                key={r}
                type="button"
                className={`chip ${selectedResolution === r ? 'on' : ''}`}
                onClick={() => onResolutionChange?.(r)}
              >
                {r === 'all' ? 'Tất cả' : r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quốc gia */}
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

      {/* Thể loại */}
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
