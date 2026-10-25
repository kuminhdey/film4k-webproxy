import React from 'react';
import { Play, Info, Star } from 'lucide-react';
import { MovieSummary } from '../types';

interface BillboardProps {
  movie: MovieSummary | null;
  onPlay: (movie: MovieSummary) => void;
  onMoreInfo: (movie: MovieSummary) => void;
}

export const Billboard: React.FC<BillboardProps> = ({ movie, onPlay, onMoreInfo }) => {
  if (!movie) return null;

  const bgImage = movie.backdrop || movie.poster;

  return (
    <div
      style={{
        position: 'relative',
        height: '70vh',
        minHeight: '480px',
        maxHeight: '700px',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-end',
        padding: '0 48px 60px',
      }}
    >
      {/* Background Image with Gradients */}
      {bgImage && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            filter: 'brightness(0.75)',
            transform: 'scale(1.02)',
          }}
        />
      )}

      {/* Vignette & Gradient Overlays */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, #0a0a0c 10%, rgba(10,10,12,0.6) 50%, rgba(10,10,12,0.2) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to right, rgba(10,10,12,0.95) 20%, rgba(10,10,12,0.4) 60%, transparent 100%)',
        }}
      />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 10, maxWidth: '640px' }}>
        {/* Meta badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <span className="badge-4k">4K ULTRA HD</span>
          {movie.score && (
            <span className="badge-score">
              <Star size={13} fill="#f5c518" strokeWidth={0} />
              {movie.score.toFixed(1)}
            </span>
          )}
          {movie.year && (
            <span style={{ fontSize: '0.8rem', color: '#9494a8', fontWeight: 600 }}>
              {movie.year}
            </span>
          )}
          {movie.total_episodes && (
            <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px', color: '#ccc' }}>
              {movie.total_episodes} Tập
            </span>
          )}
        </div>

        {/* Titles */}
        <h1
          style={{
            fontSize: '2.8rem',
            fontWeight: 800,
            lineHeight: 1.1,
            marginBottom: '8px',
            color: '#fff',
            textShadow: '0 2px 10px rgba(0,0,0,0.8)',
          }}
        >
          {movie.title_vi || movie.title_en}
        </h1>

        {movie.title_en && movie.title_vi && (
          <h2 style={{ fontSize: '1.1rem', color: '#9494a8', fontWeight: 500, marginBottom: '14px' }}>
            {movie.title_en}
          </h2>
        )}

        {/* Genres */}
        {movie.genres && movie.genres.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {movie.genres.slice(0, 4).map((g) => (
              <span
                key={g}
                style={{
                  fontSize: '0.75rem',
                  background: 'rgba(255,255,255,0.08)',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  color: '#e0e0e0',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={() => onPlay(movie)}>
            <Play size={18} fill="#070e08" color="#070e08" />
            Xem Phim Ngay
          </button>
          <button className="btn-secondary" onClick={() => onMoreInfo(movie)}>
            <Info size={18} />
            Chi Tiết
          </button>
        </div>
      </div>
    </div>
  );
};
