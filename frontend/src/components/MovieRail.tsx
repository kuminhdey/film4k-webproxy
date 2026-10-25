import React, { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import { MovieSummary } from '../types';
import { isInMyList, toggleMyList } from '../utils/myList';

interface MovieRailProps {
  title: string;
  movies: MovieSummary[];
  onSelect: (movie: MovieSummary) => void;
  onPlay?: (movie: MovieSummary) => void;
  onViewAll?: () => void;
  id?: string;
}

export const MovieRail: React.FC<MovieRailProps> = ({
  title,
  movies,
  onSelect,
  onPlay,
  onViewAll,
  id,
}) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const handleUpdate = () => setTick((t) => t + 1);
    window.addEventListener('bofilm_mylist_updated', handleUpdate);
    return () => window.removeEventListener('bofilm_mylist_updated', handleUpdate);
  }, []);

  if (!movies || movies.length === 0) return null;

  return (
    <section className="row-sec" id={id}>
      <div className="head">
        {onViewAll ? (
          <a
            className="head-link"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onViewAll();
            }}
          >
            <h2>{title}</h2>
            <span className="head-more" aria-hidden="true">
              Xem tất cả ›
            </span>
          </a>
        ) : (
          <h2>{title}</h2>
        )}
      </div>

      <div className="rail-box">
        <div className="rail">
          {movies.map((movie) => {
            const displayTitle = movie.title_vi || movie.title_en || 'Phim';
            const year = movie.year || 2026;
            const genre =
              movie.genres && movie.genres.length > 0
                ? movie.genres[0]
                : 'Phim 4K';
            const score = movie.score ? movie.score.toFixed(1) : '8.0';
            const res = movie.quality || '1080p';

            return (
              <div className="hov" key={movie.slug}>
                <a
                  className="card"
                  href={`/movie/${movie.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelect(movie);
                  }}
                >
                  <div className="thumb">
                    <img
                      alt={displayTitle}
                      loading="lazy"
                      decoding="async"
                      src={
                        movie.poster ||
                        'https://image.tmdb.org/t/p/w500/wqGZVSCUSXE92WH2zyol2REaqT4.jpg'
                      }
                    />
                    <span
                      className="play"
                      aria-hidden="true"
                      onClick={(e) => {
                        if (onPlay) {
                          e.stopPropagation();
                          e.preventDefault();
                          onPlay(movie);
                        }
                      }}
                    >
                      ▶
                    </span>
                    <button
                      type="button"
                      className="card-bookmark-btn"
                      title={isInMyList(movie.slug) ? 'Xóa khỏi Danh sách của tôi' : 'Thêm vào Danh sách của tôi'}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleMyList(movie);
                      }}
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: 'rgba(7, 14, 8, 0.8)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: isInMyList(movie.slug) ? '#fbbf24' : '#cbd8cb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        zIndex: 4,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Bookmark size={13} fill={isInMyList(movie.slug) ? '#fbbf24' : 'none'} color={isInMyList(movie.slug) ? '#fbbf24' : '#cbd8cb'} />
                    </button>
                    <span className="card-res">{res}</span>
                    <span className="card-vi">TM|PD</span>
                    <span className="card-score">
                      <b aria-hidden="true">★</b>
                      {score}
                    </span>
                    {movie.total_episodes && movie.total_episodes > 1 && (
                      <span className="card-eps">
                        {movie.total_episodes >= 10
                          ? `Full ${movie.total_episodes}/${movie.total_episodes}`
                          : `${movie.total_episodes} Tập`}
                      </span>
                    )}
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
      </div>
    </section>
  );
};
