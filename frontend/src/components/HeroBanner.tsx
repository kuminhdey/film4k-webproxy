import React, { useState, useEffect, useMemo } from 'react';
import { MovieSummary } from '../types';

interface HeroBannerProps {
  movies: MovieSummary[];
  onPlay: (movie: MovieSummary) => void;
  onInfo: (movie: MovieSummary) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ movies, onPlay, onInfo }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Pick top 5 featured movies with backdrops or posters
  const featured = useMemo(() => {
    if (!movies || movies.length === 0) return [];
    const withBackdrop = movies.filter((m) => m.backdrop);
    const pool = withBackdrop.length >= 3 ? withBackdrop : movies;
    return pool.slice(0, 5);
  }, [movies]);

  // Auto-rotate every 8 seconds
  useEffect(() => {
    if (featured.length <= 1) return;
    const interval = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % featured.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [featured.length]);

  if (featured.length === 0) {
    return null;
  }

  const activeMovie = featured[currentIndex] || featured[0];
  const title = activeMovie.title_vi || activeMovie.title_en || 'Phim 4K';
  const backdropUrl =
    activeMovie.backdrop ||
    activeMovie.poster ||
    'https://image.tmdb.org/t/p/w1280/qRN8eqYwG6HPSy0i3fKzuLrUOhp.jpg';

  return (
    <section className="hero" aria-roledescription="carousel" aria-label="Mới cập nhật">
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {title}
      </span>

      <img
        className="hero-bg sharp"
        alt=""
        aria-hidden="true"
        src={backdropUrl}
        key={activeMovie.slug}
      />

      <div className="hero-in">
        <span className="tag">Mới cập nhật</span>
        <h1>{title}</h1>
        <div className="meta">
          {activeMovie.year && <span>{activeMovie.year}</span>}
          {activeMovie.genres &&
            activeMovie.genres.slice(0, 3).map((genre) => (
              <span key={genre} className="chip">
                {genre}
              </span>
            ))}
        </div>

        <p>
          {activeMovie.title_en && activeMovie.title_en !== activeMovie.title_vi
            ? `(${activeMovie.title_en}) `
            : ''}
          Trải nghiệm phát trực tuyến độ phân giải siêu nét 4K HDR với băng thông cực đại từ TikTok CDN. Âm thanh vòm Dolby 5.1 sống động.
        </p>

        <div className="hero-cta">
          <button
            type="button"
            className="btn"
            onClick={() => onPlay(activeMovie)}
          >
            ▶ Xem ngay
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onInfo(activeMovie)}
          >
            <span aria-hidden="true">ⓘ</span> Thông tin khác
          </button>
        </div>
      </div>

      {featured.length > 1 && (
        <div className="hero-dots">
          {featured.map((m, idx) => (
            <button
              key={m.slug || idx}
              type="button"
              className={`hero-dot ${idx === currentIndex ? 'on' : ''}`}
              tabIndex={-1}
              aria-label={m.title_vi || m.title_en || `Slide ${idx + 1}`}
              aria-current={idx === currentIndex ? 'true' : 'false'}
              onClick={() => setCurrentIndex(idx)}
            ></button>
          ))}
        </div>
      )}
    </section>
  );
};
