import React, { useEffect, useState, useRef } from 'react';
import { Play, Clock, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { getWatchProgress, removeWatchProgress, WatchProgressItem } from '../utils/watchProgress';

interface ContinueWatchingRailProps {
  onPlay: (item: WatchProgressItem) => void;
}

export const ContinueWatchingRail: React.FC<ContinueWatchingRailProps> = ({ onPlay }) => {
  const [items, setItems] = useState<WatchProgressItem[]>([]);
  const railRef = useRef<HTMLDivElement | null>(null);

  const loadItems = () => {
    setItems(getWatchProgress());
  };

  useEffect(() => {
    loadItems();
    const handleUpdate = () => loadItems();
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'bofilm_continue_watching') {
        loadItems();
      }
    };
    window.addEventListener('bofilm_progress_updated', handleUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('bofilm_progress_updated', handleUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  const scroll = (direction: 'left' | 'right') => {
    if (railRef.current) {
      const scrollAmount = direction === 'left' ? -380 : 380;
      railRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleRemove = (e: React.MouseEvent, item: WatchProgressItem) => {
    e.stopPropagation();
    e.preventDefault();
    removeWatchProgress(item.slug, item.episode);
    setItems((prev) =>
      prev.filter((it) => !(it.slug === item.slug && (item.episode === undefined || it.episode === item.episode)))
    );
  };

  return (
    <section
      className="row-sec continue-watching-section"
      style={{
        marginTop: '28px',
        marginBottom: '16px',
        animation: 'fadeIn 0.25s ease',
      }}
    >
      <div
        className="head"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: '#fcfdf7',
              margin: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span role="img" aria-label="avocado">🥑</span>
            <span>Tiếp tục xem</span>
            <Clock size={18} color="#aeea00" style={{ marginLeft: '2px' }} />
          </h2>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#aeea00',
              background: 'rgba(174, 234, 0, 0.12)',
              border: '1px solid rgba(174, 234, 0, 0.3)',
              padding: '2px 8px',
              borderRadius: '999px',
            }}
          >
            {items.length} phim
          </span>
        </div>

        {items.length > 3 && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => scroll('left')}
              className="rail-nav-btn"
              aria-label="Cuộn trái"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#0f2214',
                border: '1px solid #1e3f28',
                color: '#fcfdf7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              className="rail-nav-btn"
              aria-label="Cuộn phải"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#0f2214',
                border: '1px solid #1e3f28',
                color: '#fcfdf7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      <div className="rail-box">
        <div
          className="rail"
          ref={railRef}
          style={{
            display: 'flex',
            gap: '16px',
            overflowX: 'auto',
            paddingBottom: '12px',
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'thin',
          }}
        >
          {items.map((item) => {
            const percent = item.duration > 0 ? Math.min(100, Math.max(0, (item.currentTime / item.duration) * 100)) : 0;
            const remainingSec = Math.max(0, item.duration - item.currentTime);
            const remainingMinutes = Math.max(1, Math.round(remainingSec / 60));
            const imageSrc = item.backdrop || item.poster || 'https://image.tmdb.org/t/p/w500/wqGZVSCUSXE92WH2zyol2REaqT4.jpg';

            return (
              <div
                key={`${item.slug}-${item.episode || 1}`}
                className="hov"
                style={{
                  flex: '0 0 280px',
                  scrollSnapAlign: 'start',
                  position: 'relative',
                }}
              >
                <div
                  className="card continue-card"
                  onClick={() => onPlay(item)}
                  style={{
                    background: '#0f2214',
                    border: '1px solid #1e3f28',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {/* Thumbnail Container */}
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      aspectRatio: '16/9',
                      background: '#070e08',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={imageSrc}
                      alt={item.title}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />

                    {/* Gradient Overlay */}
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background:
                          'linear-gradient(to top, rgba(7, 14, 8, 0.9) 0%, rgba(7, 14, 8, 0.2) 60%, transparent 100%)',
                      }}
                    />

                    {/* Center Play Button Overlay */}
                    <div
                      className="continue-play-overlay"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '50%',
                          background: 'rgba(10, 21, 12, 0.85)',
                          border: '2px solid #aeea00',
                          boxShadow: '0 4px 16px rgba(174, 234, 0, 0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#aeea00',
                          transition: 'transform 0.2s ease',
                        }}
                      >
                        <Play size={18} fill="#aeea00" style={{ marginLeft: '3px' }} />
                      </div>
                    </div>

                    {/* Quick Remove Button (X) */}
                    <button
                      type="button"
                      onClick={(e) => handleRemove(e, item)}
                      title="Xóa khỏi danh sách tiếp tục xem"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: 'rgba(0, 0, 0, 0.65)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#cbd8cb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        zIndex: 3,
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#ef4444';
                        e.currentTarget.style.color = '#fff';
                        e.currentTarget.style.borderColor = '#ef4444';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.65)';
                        e.currentTarget.style.color = '#cbd8cb';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                      }}
                    >
                      <X size={14} />
                    </button>

                    {/* Episode Tag (if series) */}
                    {item.episode && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: '10px',
                          left: '10px',
                          background: 'rgba(10, 21, 12, 0.9)',
                          color: '#aeea00',
                          border: '1px solid #1e3f28',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      >
                        Tập {item.episode}
                      </span>
                    )}

                    {/* Remaining Time */}
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '10px',
                        right: '10px',
                        color: '#cbd8cb',
                        fontSize: '11px',
                        fontWeight: 600,
                        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                      }}
                    >
                      Còn {remainingMinutes} phút
                    </span>

                    {/* Progress Bar */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '4px',
                        background: 'rgba(255, 255, 255, 0.18)',
                      }}
                    >
                      <div
                        style={{
                          width: `${percent}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #8cb85c 0%, #aeea00 100%)',
                          boxShadow: '0 0 8px rgba(174, 234, 0, 0.6)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Card Title & Info */}
                  <div style={{ padding: '10px 12px' }}>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#fcfdf7',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.title}
                    </div>
                    {item.title_en && item.title_en !== item.title && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted, #94a896)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '2px',
                        }}
                      >
                        {item.title_en}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
