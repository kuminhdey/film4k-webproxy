import React from 'react';
import { MovieSummary } from '../types';

interface MovieRailProps {
  title: string;
  movies: MovieSummary[];
  onSelect: (movie: MovieSummary) => void;
  onViewAll?: () => void;
  id?: string;
}

export const MovieRail: React.FC<MovieRailProps> = ({
  title,
  movies,
  onSelect,
  onViewAll,
  id,
}) => {
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
                    <span className="play" aria-hidden="true">
                      ▶
                    </span>
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
