import React from 'react';
import { ChevronRight } from 'lucide-react';
import { MovieSummary } from '../types';

interface TopRailProps {
  movies: MovieSummary[];
  onSelect: (movie: MovieSummary) => void;
  onViewAll?: () => void;
}

export const TopRail: React.FC<TopRailProps> = ({ movies, onSelect, onViewAll }) => {
  if (!movies || movies.length === 0) return null;

  // Take top 10
  const top10 = movies.slice(0, 10);

  return (
    <section className="row-sec">
      <div
        className="head"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
        }}
      >
        <h2
          style={onViewAll ? { cursor: 'pointer' } : undefined}
          onClick={onViewAll}
        >
          Top 10 hôm nay
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            style={{
              background: 'none',
              border: 'none',
              color: '#aeea00',
              fontSize: '13px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            <span>Xem thêm</span>
            <ChevronRight size={16} />
          </button>
        )}
      </div>
      <div className="rail-box">
        <ol className="rail top-rail">
          {top10.map((movie, index) => {
            const title = movie.title_vi || movie.title_en || 'Phim';
            const score = movie.score ? movie.score.toFixed(1) : '8.0';

            return (
              <li className="top-item" key={movie.slug || index}>
                <a
                  className="top-card"
                  href={`/movie/${movie.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelect(movie);
                  }}
                >
                  <span className="top-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="top-thumb">
                    <img
                      alt={title}
                      loading="lazy"
                      src={
                        movie.poster ||
                        'https://image.tmdb.org/t/p/w500/wqGZVSCUSXE92WH2zyol2REaqT4.jpg'
                      }
                    />
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
                  </span>
                  <span className="sr-only">{title}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
};
