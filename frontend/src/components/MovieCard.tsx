import React from 'react';
import { Play, Star } from 'lucide-react';
import { MovieSummary } from '../types';

interface MovieCardProps {
  movie: MovieSummary;
  onClick: (movie: MovieSummary) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, onClick }) => {
  const posterUrl = movie.poster || movie.backdrop;

  return (
    <div className="movie-card" onClick={() => onClick(movie)} style={{ aspectRatio: '2/3' }}>
      {posterUrl ? (
        <img src={posterUrl} alt={movie.title_vi || movie.title_en || 'Poster'} loading="lazy" />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: '#1a1a24',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666',
          }}
        >
          No Image
        </div>
      )}

      {/* Top Badges */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          right: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 2,
        }}
      >
        <span className="badge-4k">4K</span>
        {movie.score && (
          <span className="badge-score">
            <Star size={11} fill="#f5c518" strokeWidth={0} />
            {movie.score.toFixed(1)}
          </span>
        )}
      </div>

      {/* Hover overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(10,10,12,0.95) 0%, rgba(10,10,12,0.4) 50%, transparent 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: '12px',
          zIndex: 2,
        }}
      >
        <h3
          style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1.2,
            marginBottom: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {movie.title_vi || movie.title_en}
        </h3>

        {movie.title_en && movie.title_vi && (
          <p
            style={{
              fontSize: '0.75rem',
              color: '#9494a8',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: '6px',
            }}
          >
            {movie.title_en}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: '#7e7e96' }}>
            {movie.year || ''} {movie.total_episodes ? `• ${movie.total_episodes} Tập` : ''}
          </span>
          <div
            style={{
              background: '#e50914',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Play size={14} fill="#fff" style={{ marginLeft: '2px' }} />
          </div>
        </div>
      </div>
    </div>
  );
};
