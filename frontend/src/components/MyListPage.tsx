import React, { useState, useEffect, useMemo } from 'react';
import { Bookmark, Trash2, Film, ArrowRight } from 'lucide-react';
import { getMyList, removeFromMyList, MyListItem } from '../utils/myList';

interface MyListPageProps {
  onNavigate: (path: string) => void;
}

export const MyListPage: React.FC<MyListPageProps> = ({ onNavigate }) => {
  const [list, setList] = useState<MyListItem[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'tv'>('all');

  const loadList = () => {
    setList(getMyList());
  };

  useEffect(() => {
    loadList();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const handleUpdate = () => loadList();
    window.addEventListener('bofilm_mylist_updated', handleUpdate);
    return () => window.removeEventListener('bofilm_mylist_updated', handleUpdate);
  }, []);

  const filteredList = useMemo(() => {
    if (filterType === 'all') return list;
    return list.filter((item) => {
      const type = (item.movie_type || '').toLowerCase();
      if (filterType === 'movie') {
        return type === 'movie' || type === 'single' || (item.total_episodes && item.total_episodes <= 1);
      }
      if (filterType === 'tv') {
        return type === 'tv' || type === 'series' || (item.total_episodes && item.total_episodes > 1);
      }
      return true;
    });
  }, [list, filterType]);

  const handleRemove = (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeFromMyList(slug);
  };

  return (
    <main className="wrap mylist-page" style={{ minHeight: '80vh', padding: '32px 0 64px' }}>
      {/* 1. Header Section */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          borderBottom: '1px solid #1e3f28',
          paddingBottom: '20px',
          marginBottom: '28px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(174, 234, 0, 0.2), rgba(132, 204, 22, 0.05))',
              border: '1px solid #285436',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Bookmark size={24} color="#aeea00" fill="#aeea00" />
          </div>
          <div>
            <h1
              style={{
                fontSize: '26px',
                fontWeight: 800,
                color: '#fcfdf7',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span>Danh Sách Của Tôi</span>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#070e08',
                  background: '#aeea00',
                  padding: '2px 10px',
                  borderRadius: '999px',
                }}
              >
                {list.length} bộ phim
              </span>
            </h1>
            <p style={{ color: 'var(--muted, #94a896)', fontSize: '13.5px', margin: '4px 0 0' }}>
              Kho phim yêu thích và dự định xem của bạn trên Bơ Film 4K
            </p>
          </div>
        </div>

        {/* Filter Chips */}
        {list.length > 0 && (
          <div className="filter-chips" style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className={`chip ${filterType === 'all' ? 'on' : ''}`}
              onClick={() => setFilterType('all')}
            >
              Tất cả ({list.length})
            </button>
            <button
              type="button"
              className={`chip ${filterType === 'movie' ? 'on' : ''}`}
              onClick={() => setFilterType('movie')}
            >
              Phim Lẻ
            </button>
            <button
              type="button"
              className={`chip ${filterType === 'tv' ? 'on' : ''}`}
              onClick={() => setFilterType('tv')}
            >
              Phim Bộ
            </button>
          </div>
        )}
      </div>

      {/* 2. Empty State */}
      {list.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 20px',
            maxWidth: '520px',
            margin: '0 auto',
            background: 'rgba(15, 34, 20, 0.4)',
            border: '1px dashed #1e3f28',
            borderRadius: '20px',
          }}
        >
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: '#0f2214',
              border: '2px solid #285436',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              boxShadow: '0 8px 24px rgba(174, 234, 0, 0.15)',
            }}
          >
            <Film size={34} color="#aeea00" />
          </div>

          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fcfdf7', margin: '0 0 10px' }}>
            Danh sách của bạn đang trống
          </h2>
          <p style={{ color: 'var(--muted, #94a896)', fontSize: '14px', lineHeight: 1.6, margin: '0 0 24px' }}>
            Hãy bấm nút <strong>"+ Danh sách của tôi"</strong> trên bất kỳ bộ phim nào bạn yêu thích để dễ dàng theo dõi và xem lại sau nhé!
          </p>

          <button
            type="button"
            className="btn"
            onClick={() => onNavigate('/')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 28px',
              fontSize: '15px',
              fontWeight: 700,
              borderRadius: '12px',
              cursor: 'pointer',
            }}
          >
            <span>🎬 Khám phá phim ngay</span>
            <ArrowRight size={16} />
          </button>
        </div>
      ) : filteredList.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          Không có phim nào thuộc phân loại này trong danh sách của bạn.
        </div>
      ) : (
        /* 3. Movie Grid */
        <div className="catalog-grid">
          {filteredList.map((movie) => {
            const displayTitle = movie.title_vi || movie.title_en || 'Phim';
            const year = movie.year || 2026;
            const genre = movie.genres && movie.genres.length > 0 ? movie.genres[0] : 'Phim 4K';
            const score = movie.score ? movie.score.toFixed(1) : '8.0';
            const res = movie.quality || '4K UHD';
            const poster = movie.poster || movie.backdrop || 'https://image.tmdb.org/t/p/w500/wqGZVSCUSXE92WH2zyol2REaqT4.jpg';

            return (
              <div className="hov" key={movie.slug} style={{ position: 'relative' }}>
                <a
                  className="card"
                  href={`/movie/${movie.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(`/movie/${movie.slug}`);
                  }}
                >
                  <div className="thumb">
                    <img alt={displayTitle} loading="lazy" decoding="async" src={poster} />
                    <span
                      className="play"
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onNavigate(`/watch/${movie.slug}`);
                      }}
                    >
                      ▶
                    </span>
                    <span className="card-res">{res}</span>
                    <span className="card-vi">TM|PD</span>
                    <span className="card-score">
                      <b aria-hidden="true" style={{ color: '#fbbf24' }}>★</b>
                      {score}
                    </span>

                    {/* Quick remove from My List button */}
                    <button
                      type="button"
                      onClick={(e) => handleRemove(e, movie.slug)}
                      title="Xóa khỏi Danh sách của tôi"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: 'rgba(7, 14, 8, 0.75)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#cbd8cb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        zIndex: 4,
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#ef4444';
                        e.currentTarget.style.color = '#fff';
                        e.currentTarget.style.borderColor = '#ef4444';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(7, 14, 8, 0.75)';
                        e.currentTarget.style.color = '#cbd8cb';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <h3>{displayTitle}</h3>
                  <p>
                    {year} · {genre}
                  </p>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
};
