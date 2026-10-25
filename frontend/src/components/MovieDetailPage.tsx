import React, { useEffect, useState } from 'react';
import { Bookmark, Check } from 'lucide-react';
import { Movie, MovieSummary } from '../types';
import { isInMyList, toggleMyList } from '../utils/myList';

interface MovieDetailPageProps {
  slug: string;
  onNavigate: (path: string) => void;
}

export const MovieDetailPage: React.FC<MovieDetailPageProps> = ({ slug, onNavigate }) => {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [related, setRelated] = useState<MovieSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inMyList, setInMyList] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (movie) {
      setInMyList(isInMyList(movie.slug));
    }
    const handleUpdate = () => {
      if (movie) setInMyList(isInMyList(movie.slug));
    };
    window.addEventListener('bofilm_mylist_updated', handleUpdate);
    return () => window.removeEventListener('bofilm_mylist_updated', handleUpdate);
  }, [movie]);

  const handleToggleMyList = () => {
    if (!movie) return;
    const added = toggleMyList({
      slug: movie.slug,
      title_vi: movie.title_vi,
      title_en: movie.title_en,
      poster: movie.poster,
      backdrop: movie.backdrop,
      year: movie.year,
      quality: movie.quality,
      score: movie.score,
      movie_type: movie.type,
      genres: movie.genres,
      total_episodes: movie.totalEpisodes,
    });
    setToastMsg(added ? 'Đã thêm vào Danh sách của tôi' : 'Đã xóa khỏi Danh sách của tôi');
    setTimeout(() => setToastMsg(null), 3000);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    fetch(`/api/movies/${slug}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Movie not found (${res.status})`);
        }
        return res.json();
      })
      .then((data: Movie) => {
        setMovie(data);
        setLoading(false);

        // Fetch recommendations for this movie (/api/movies/:slug/recommendations with fallback)
        fetch(`/api/movies/${slug}/recommendations`)
          .then((r) => {
            if (!r.ok) throw new Error('Recommendations endpoint error');
            return r.json();
          })
          .then((recData) => {
            const list: MovieSummary[] = Array.isArray(recData)
              ? recData
              : Array.isArray(recData.recommendations)
              ? recData.recommendations
              : Array.isArray(recData.movies)
              ? recData.movies
              : [];
            if (list.length > 0) {
              setRelated(list.filter((m) => m.slug !== slug).slice(0, 12));
            } else {
              throw new Error('Empty recommendations');
            }
          })
          .catch(() => {
            // Fallback: fetch movies by primary genre or general pool
            const primaryGenre = data.genres && data.genres.length > 0 ? encodeURIComponent(data.genres[0]) : '';
            const fallbackUrl = primaryGenre
              ? `/api/movies?genre=${primaryGenre}&limit=12`
              : `/api/movies?limit=12`;

            fetch(fallbackUrl)
              .then((r) => r.json())
              .then((res) => {
                const items: MovieSummary[] = res.movies || [];
                const filtered = items.filter((m) => m.slug !== slug).slice(0, 10);
                if (filtered.length > 0) {
                  setRelated(filtered);
                } else if (primaryGenre) {
                  // Fallback further to general pool if genre filter returned empty
                  fetch('/api/movies?limit=12')
                    .then((r2) => r2.json())
                    .then((res2) => {
                      if (res2.movies) {
                        setRelated(res2.movies.filter((m: MovieSummary) => m.slug !== slug).slice(0, 10));
                      }
                    })
                    .catch(() => {});
                }
              })
              .catch(() => {});
          });
      })
      .catch((err) => {
        console.error('Error fetching movie details:', err);
        setError(err.message || 'Không thể tải thông tin phim');
        setLoading(false);
      });
  }, [slug]);

  if (loading) {
    return (
      <div className="title-loading wrap" style={{ padding: '40px 0' }}>
        <div
          style={{
            height: '380px',
            borderRadius: '20px',
            background: 'linear-gradient(105deg, var(--card) 20%, var(--card-hover) 38%, var(--card) 56%)',
            backgroundSize: '220% 100%',
            animation: '1.45s linear infinite skeleton-shimmer',
            marginBottom: '28px',
          }}
        />
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>
          Đang nạp chi tiết phim từ Bơ Film CDN...
        </div>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="wrap" style={{ padding: '60px 0', textAlign: 'center' }}>
        <div className="player-error" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'left' }}>
          <h3 style={{ margin: 0, color: '#fff' }}>Không tìm thấy phim</h3>
          <p className="player-error-text">
            Phim với mã định danh "{slug}" không tồn tại hoặc đã được chuyển vùng.
          </p>
          <button
            className="player-error-help"
            onClick={() => onNavigate('/')}
            style={{ cursor: 'pointer', border: 'none' }}
          >
            ← Quay lại Trang Chủ
          </button>
        </div>
      </div>
    );
  }

  const displayTitle = movie.title_vi || movie.title_en || 'Chi tiết phim';
  const year = movie.year || 2026;
  const score = movie.score ? movie.score.toFixed(1) : '8.5';
  const quality = movie.quality || '4K UHD';
  const posterUrl = movie.poster || 'https://image.tmdb.org/t/p/w500/wqGZVSCUSXE92WH2zyol2REaqT4.jpg';
  const backdropUrl = movie.backdrop || posterUrl;

  return (
    <div className="title" style={{ minHeight: '80vh' }}>
      {/* 1. Backdrop Hero Section */}
      <section
        className="title-hero"
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid var(--border-subtle)',
          minHeight: '440px',
        }}
      >
        {/* Backdrop Image */}
        <img
          className="title-art"
          src={backdropUrl}
          alt={displayTitle}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.28,
            filter: 'blur(3px) brightness(0.65)',
            transform: 'scale(1.05)',
          }}
        />

        {/* Gradient overlays for cinematic depth */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top, var(--bg) 0%, rgba(7, 9, 15, 0.75) 50%, rgba(7, 9, 15, 0.4) 100%)',
          }}
        />

        {/* Hero Content Container */}
        <div
          className="title-in wrap"
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            gap: '36px',
            paddingTop: '36px',
            paddingBottom: '36px',
            alignItems: 'flex-start',
          }}
        >
          {/* Movie Poster */}
          <div style={{ flexShrink: 0 }}>
            <img
              className="title-poster"
              src={posterUrl}
              alt={displayTitle}
              style={{
                width: '210px',
                borderRadius: '16px',
                boxShadow: '0 24px 50px rgba(0, 0, 0, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'block',
              }}
            />
          </div>

          {/* Metadata & Actions */}
          <div className="title-text" style={{ flex: 1 }}>
            <h1
              style={{
                fontSize: 'clamp(26px, 3.5vw, 42px)',
                fontWeight: 800,
                margin: '0 0 8px',
                color: '#fff',
                lineHeight: 1.15,
                letterSpacing: '-0.02em',
              }}
            >
              {displayTitle}{' '}
              <span className="year" style={{ color: 'var(--muted)', fontSize: '0.65em', fontWeight: 600 }}>
                ({year})
              </span>
            </h1>

            {movie.title_en && movie.title_vi && (
              <div
                style={{
                  color: 'var(--muted-light)',
                  fontSize: '17px',
                  marginBottom: '14px',
                  fontWeight: 500,
                }}
              >
                {movie.title_en}
              </div>
            )}

            {/* Badges / Meta row */}
            <div
              className="title-meta"
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                flexWrap: 'wrap',
                margin: '12px 0 16px',
              }}
            >
              <span
                className="score"
                style={{
                  background: 'var(--accent-gold-soft)',
                  color: 'var(--accent-gold)',
                  border: '1px solid #e8c48a59',
                  borderRadius: '999px',
                  padding: '4px 12px',
                  fontSize: '13px',
                  fontWeight: 700,
                }}
              >
                ★ {score}
              </span>

              <span
                className="res"
                style={{
                  background: '#ffffff0f',
                  color: '#b4bdd0',
                  border: '1px solid #ffffff1a',
                  borderRadius: '999px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {quality}
              </span>

              {movie.country && (
                <span
                  className="chip"
                  style={{
                    background: '#ffffff08',
                    border: '1px solid #ffffff14',
                    borderRadius: '999px',
                    padding: '4px 12px',
                    fontSize: '12px',
                  }}
                >
                  {movie.country}
                </span>
              )}

              {movie.genres?.map((g) => (
                <span
                  key={g}
                  className="chip"
                  style={{
                    background: '#ffffff08',
                    border: '1px solid #ffffff14',
                    borderRadius: '999px',
                    padding: '4px 12px',
                    fontSize: '12px',
                  }}
                >
                  {g}
                </span>
              ))}
            </div>

            {/* Audio & Subtitle Features */}
            <div
              className="title-langs"
              style={{
                display: 'flex',
                gap: '12px',
                color: 'var(--muted)',
                fontSize: '13px',
                marginBottom: '18px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                🔊 Dolby Atmos 5.1 / Stereo
              </span>
              <span>•</span>
              <span>💬 Phụ đề Tiếng Việt</span>
              <span>•</span>
              <span>🎙 Lồng tiếng / Thuyết minh</span>
            </div>

            {/* Synopsis / Overview */}
            <p
              className="ov"
              style={{
                color: 'var(--muted-light)',
                fontSize: '15px',
                lineHeight: 1.7,
                maxWidth: '78ch',
                marginBottom: '26px',
              }}
            >
              {movie.overview ||
                'Trải nghiệm tuyệt phẩm điện ảnh với chất lượng hình ảnh 4K Ultra HD sắc nét và hệ thống âm thanh vòm chuẩn rạp chiếu phim.'}
            </p>

            {/* Action CTA Buttons */}
            <div className="title-cta" style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => onNavigate(`/watch/${movie.slug}`)}
                style={{
                  padding: '12px 28px',
                  fontSize: '15px',
                  fontWeight: 700,
                  borderRadius: '12px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>▶</span>
                <span>Phát ngay (4K UHD)</span>
              </button>

              <button
                type="button"
                className="ghost-btn"
                onClick={handleToggleMyList}
                style={{
                  padding: '12px 22px',
                  fontSize: '14px',
                  fontWeight: 600,
                  borderRadius: '12px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  borderColor: inMyList ? '#aeea00' : undefined,
                  color: inMyList ? '#aeea00' : undefined,
                  background: inMyList ? 'rgba(174, 234, 0, 0.12)' : undefined,
                }}
              >
                {inMyList ? <Check size={18} color="#aeea00" /> : <Bookmark size={18} />}
                <span>{inMyList ? '✓ Đã trong Danh sách' : '+ Danh sách của tôi'}</span>
              </button>

              <button
                type="button"
                className="ghost-btn"
                onClick={() => onNavigate('/')}
                style={{
                  padding: '12px 20px',
                  fontSize: '14px',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                ← Quay lại Trang Chủ
              </button>
            </div>

            {/* Bookmark Toast Feedback */}
            {toastMsg && (
              <div
                style={{
                  marginTop: '14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 18px',
                  borderRadius: '30px',
                  background: 'rgba(10, 21, 12, 0.94)',
                  border: '1px solid #1e3f28',
                  color: '#aeea00',
                  fontSize: '13px',
                  fontWeight: 700,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                  animation: 'fadeIn 0.2s ease',
                }}
              >
                <span>🥑 {toastMsg}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Episode Selection Section (for TV Series) */}
      {movie.episodes && movie.episodes.length > 0 && (
        <section className="wrap eps-sec" style={{ marginTop: '36px' }}>
          <div className="eps-head" style={{ marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', margin: 0 }}>
                Danh sách tập phim ({movie.episodes.length})
              </h2>
              <span className="eps-current" style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '4px', display: 'block' }}>
                Chọn tập để xem trực tiếp với tốc độ cao 300+ Mbps
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: '10px',
              marginBottom: '32px',
            }}
          >
            {movie.episodes.map((ep) => (
              <button
                key={ep.episode}
                type="button"
                className="chip"
                onClick={() => onNavigate(`/watch/${movie.slug}/${ep.episode}`)}
                style={{
                  justifyContent: 'center',
                  padding: '12px 8px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                }}
              >
                Tập {ep.episode}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 3. Smart Recommendations Rail: Phim tương tự bạn có thể thích */}
      {related.length > 0 && (
        <section className="wrap row-sec" style={{ marginTop: '48px', marginBottom: '64px' }}>
          <div className="head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#fcfdf7', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Phim tương tự bạn có thể thích</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#070e08',
                    background: '#aeea00',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Gợi ý AI
                </span>
              </h2>
              <p style={{ color: 'var(--muted, #94a896)', fontSize: '13px', margin: '4px 0 0 0' }}>
                Đề xuất dựa trên thể loại, diễn viên và sở thích xem phim 4K của bạn
              </p>
            </div>
          </div>

          <div className="catalog-grid">
            {related.map((rel) => {
              const relTitle = rel.title_vi || rel.title_en || 'Phim';
              const relPoster = rel.poster || rel.backdrop || 'https://image.tmdb.org/t/p/w500/wqGZVSCUSXE92WH2zyol2REaqT4.jpg';
              const relScore = rel.score ? rel.score.toFixed(1) : '8.0';
              const relRes = rel.quality || '4K UHD';
              return (
                <div className="hov" key={rel.slug}>
                  <a
                    className="card"
                    href={`/movie/${rel.slug}`}
                    onClick={(e) => {
                      e.preventDefault();
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      onNavigate(`/movie/${rel.slug}`);
                    }}
                  >
                    <div className="thumb">
                      <img alt={relTitle} loading="lazy" decoding="async" src={relPoster} />
                      <span className="play" aria-hidden="true">
                        ▶
                      </span>
                      <span className="card-res">{relRes}</span>
                      <span className="card-vi">TM|PD</span>
                      <span className="card-score">
                        <b aria-hidden="true" style={{ color: '#fbbf24' }}>★</b>
                        {relScore}
                      </span>
                    </div>
                    <h3>{relTitle}</h3>
                    <p>
                      {rel.year || 2026} · {rel.genres?.[0] || 'Phim 4K'}
                    </p>
                  </a>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
