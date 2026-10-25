import React, { useState, useEffect, useRef } from 'react';
import { MovieSummary } from '../types';
import { Star, Loader2, ArrowRight } from 'lucide-react';

interface HeaderProps {
  onSearch: (query: string) => void;
  onSelectMovie?: (slug: string) => void;
  onBrandClick?: () => void;
  onPairClick?: () => void;
  onAppClick?: () => void;
  onSignInClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onSearch,
  onSelectMovie,
  onBrandClick,
  onPairClick,
  onAppClick,
  onSignInClick,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [suggestions, setSuggestions] = useState<MovieSummary[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Debounced search auto-suggest (200ms)
  useEffect(() => {
    const trimmed = searchValue.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggest(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoadingSuggest(true);
      fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`)
        .then((res) => {
          if (!res.ok) throw new Error('Suggest endpoint returned error');
          return res.json();
        })
        .then((data) => {
          const items: MovieSummary[] = Array.isArray(data)
            ? data
            : Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.movies)
            ? data.movies
            : [];
          if (items.length > 0) {
            setSuggestions(items.slice(0, 6));
            setShowSuggest(true);
          } else {
            throw new Error('Empty suggestions from suggest endpoint');
          }
          setLoadingSuggest(false);
        })
        .catch(() => {
          // Fallback to /api/movies?search=...&limit=6
          fetch(`/api/movies?search=${encodeURIComponent(trimmed)}&limit=6`)
            .then((r) => r.json())
            .then((data) => {
              const items = data.movies || [];
              setSuggestions(items.slice(0, 6));
              setShowSuggest(items.length > 0);
              setLoadingSuggest(false);
            })
            .catch(() => {
              setSuggestions([]);
              setShowSuggest(false);
              setLoadingSuggest(false);
            });
        });
    }, 200);

    return () => clearTimeout(timer);
  }, [searchValue]);

  // Click outside listener to dismiss suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchValue(val);
    onSearch(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggest(false);
    onSearch(searchValue);
  };

  const handleSelectSuggestion = (slug: string) => {
    setShowSuggest(false);
    setSearchValue('');
    if (onSelectMovie) {
      onSelectMovie(slug);
    } else {
      window.location.href = `/movie/${slug}`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggest(false);
    }
  };

  return (
    <header className="site">
      <div className="wrap">
        <a
          className="brand side-only-hidden"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onBrandClick?.();
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
        >
          <img
            src="/logo.png"
            alt="Bơ Film"
            className="h-9 w-auto object-contain drop-shadow"
            style={{ height: '36px', width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(174, 234, 0, 0.4))' }}
          />
          <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', display: 'inline-flex', gap: '4px' }}>
            <span style={{ color: '#aeea00' }}>Bơ</span>
            <span style={{ color: '#fcfdf7' }}>Film</span>
          </span>
        </a>

        {/* Live Search Box with Auto-suggest Dropdown */}
        <div ref={searchContainerRef} style={{ position: 'relative', width: '100%', maxWidth: '380px' }}>
          <form className="search" onSubmit={handleSubmit}>
            <input
              inputMode="search"
              autoComplete="off"
              placeholder="Search…"
              aria-label="Search movies"
              type="search"
              value={searchValue}
              onChange={handleChange}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggest(true);
              }}
              onKeyDown={handleKeyDown}
              name="q"
            />
            {loadingSuggest && (
              <div
                style={{
                  position: 'absolute',
                  right: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: '#aeea00',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Loader2 size={15} className="animate-spin" />
              </div>
            )}
          </form>

          {/* Auto-suggest Floating Dropdown */}
          {showSuggest && suggestions.length > 0 && (
            <div
              className="suggest-dropdown"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: 0,
                right: 0,
                background: '#0f2214',
                border: '1px solid #1e3f28',
                borderRadius: '14px',
                boxShadow: '0 18px 40px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(174, 234, 0, 0.25)',
                zIndex: 100,
                overflow: 'hidden',
                backdropFilter: 'blur(16px)',
                animation: 'fade-in 0.15s ease-out',
              }}
            >
              <div
                style={{
                  padding: '8px 12px 6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--muted, #94a896)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid rgba(30, 63, 40, 0.6)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Gợi ý phim ({suggestions.length})</span>
                <span style={{ fontSize: '10px', color: '#aeea00' }}>Bơ Film Search</span>
              </div>

              <ul style={{ listStyle: 'none', margin: 0, padding: '4px' }}>
                {suggestions.map((item) => {
                  const displayTitle = item.title_vi || item.title_en || item.slug;
                  const year = item.year || 2026;
                  const score = item.score ? item.score.toFixed(1) : null;
                  const quality = item.quality || '4K';
                  const poster = item.poster || item.backdrop || '/placeholder.png';

                  return (
                    <li key={item.slug} style={{ margin: '2px 0' }}>
                      <button
                        type="button"
                        onClick={() => handleSelectSuggestion(item.slug)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 10px',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease',
                          color: 'inherit',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#132b1a';
                          e.currentTarget.style.boxShadow = 'inset 3px 0 0 #aeea00';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        {/* Mini Poster */}
                        <img
                          src={poster}
                          alt={displayTitle}
                          style={{
                            width: '38px',
                            height: '52px',
                            borderRadius: '5px',
                            objectFit: 'cover',
                            background: '#070e08',
                            border: '1px solid #1e3f28',
                            flexShrink: 0,
                          }}
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />

                        {/* Title and Meta Details */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '13.5px',
                              fontWeight: 700,
                              color: '#fcfdf7',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {displayTitle}
                          </div>

                          {item.title_en && item.title_en !== item.title_vi && (
                            <div
                              style={{
                                fontSize: '11.5px',
                                color: 'var(--muted, #94a896)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                marginBottom: '2px',
                              }}
                            >
                              {item.title_en}
                            </div>
                          )}

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', fontSize: '11px' }}>
                            <span style={{ color: '#cbd8cb' }}>{year}</span>
                            {score && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#fbbf24', fontWeight: 700 }}>
                                <Star size={11} fill="#fbbf24" strokeWidth={0} />
                                {score}
                              </span>
                            )}
                            <span
                              style={{
                                color: '#aeea00',
                                background: 'rgba(174, 234, 0, 0.12)',
                                border: '1px solid rgba(174, 234, 0, 0.35)',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                              }}
                            >
                              {quality}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* View all search results link */}
              <div
                onClick={handleSubmit}
                style={{
                  padding: '10px 14px',
                  background: 'rgba(10, 21, 12, 0.95)',
                  borderTop: '1px solid #1e3f28',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#aeea00',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#132b1a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(10, 21, 12, 0.95)';
                }}
              >
                <span>Xem tất cả kết quả cho "{searchValue}"</span>
                <ArrowRight size={14} />
              </div>
            </div>
          )}
        </div>

        <span className="spacer"></span>

        <a
          className="app-soon"
          title="Tải ứng dụng Bơ Film"
          href="/app"
          onClick={(e) => {
            e.preventDefault();
            onAppClick?.();
          }}
        >
          Tải ứng dụng
        </a>

        <a
          className="side-pair header-pair-btn"
          title="Ghép nối TV / Thiết bị"
          href="/login?mode=code"
          onClick={(e) => {
            e.preventDefault();
            onPairClick?.();
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M4 6h16v10H4zM9 8 6 4M15 8l3-4M9 21h6M8 11h8M12 9v4"></path>
          </svg>
          <span>Ghép nối TV</span>
        </a>

        <button className="ghost locale" type="button" aria-label="Thay đổi ngôn ngữ">
          VI
        </button>

        <div className="header-account side-only-hidden">
          <div className="auth-btns">
            <a
              className="ghost side-pair"
              title="Đăng nhập bằng mã TV"
              href="/login?mode=code"
              onClick={(e) => {
                e.preventDefault();
                onPairClick?.();
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M4 6h16v10H4zM9 8 6 4M15 8l3-4M9 21h6M8 11h8M12 9v4"></path>
              </svg>
              <span>Mã nhanh TV</span>
            </a>
            <a
              className="ghost side-signin"
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                onSignInClick?.();
              }}
            >
              Đăng nhập
            </a>
          </div>
        </div>
      </div>
    </header>
  );
};
