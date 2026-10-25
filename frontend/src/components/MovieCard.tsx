import React, { useState, useEffect } from 'react';
import { Play, Star, Bookmark } from 'lucide-react';
import { MovieSummary } from '../types';
import { isInMyList, toggleMyList } from '../utils/myList';

interface MovieCardProps {
  movie: MovieSummary;
  onClick: (movie: MovieSummary) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, onClick }) => {
  const [bookmarked, setBookmarked] = useState(() => isInMyList(movie.slug));

  useEffect(() => {
    setBookmarked(isInMyList(movie.slug));
    const handleUpdate = () => setBookmarked(isInMyList(movie.slug));
    window.addEventListener('bofilm_mylist_updated', handleUpdate);
    return () => window.removeEventListener('bofilm_mylist_updated', handleUpdate);
  }, [movie.slug]);

  const posterUrl = movie.poster || movie.backdrop;

  return (
    <div className="movie-card" onClick={() => onClick(movie)} style={{ aspectRatio: '2/3', position: 'relative' }}>
      {posterUrl ? (
        <img src={posterUrl} alt={movie.title_vi || movie.title_en || 'Poster'} loading="lazy" />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'var(--card, #0f2214)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted, #94a896)',
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
          zIndex: 3,
        }}
      >
        <span className="badge-4k">4K</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {movie.score && (
            <span className="badge-score">
              <Star size={11} fill="#fbbf24" strokeWidth={0} />
              {movie.score.toFixed(1)}
            </span>
          )}
          <button
            type="button"
            className="card-bookmark-btn"
            title={bookmarked ? 'Xóa khỏi Danh sách của tôi' : 'Thêm vào Danh sách của tôi'}
            onClick={(e) => {
              e.stopPropagation();
              toggleMyList(movie);
            }}
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: 'rgba(7, 14, 8, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: bookmarked ? '#fbbf24' : '#cbd8cb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Bookmark size={13} fill={bookmarked ? '#fbbf24' : 'none'} color={bookmarked ? '#fbbf24' : '#cbd8cb'} />
          </button>
        </div>
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
              background: 'var(--accent, #aeea00)',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(174, 234, 0, 0.4)',
            }}
          >
            <Play size={14} fill="#070e08" color="#070e08" style={{ marginLeft: '2px' }} />
          </div>
        </div>
      </div>
    </div>
  );
};
