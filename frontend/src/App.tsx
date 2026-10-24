import React, { useEffect, useState, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { HeroBanner } from './components/HeroBanner';
import { FilterBar } from './components/FilterBar';
import { TopRail } from './components/TopRail';
import { MovieRail } from './components/MovieRail';
import { MobileNav } from './components/MobileNav';
import { MovieDetailPage } from './components/MovieDetailPage';
import { WatchPage } from './components/WatchPage';
import { MovieSummary, MoviesResponse } from './types';

interface RouteState {
  view: 'home' | 'movie' | 'watch';
  slug?: string;
  episode?: number;
}

function parseCurrentRoute(): RouteState {
  const path = window.location.pathname;

  // Watch route: /watch/:slug or /watch/:slug/:ep
  const watchMatch = path.match(/^\/watch\/([^/]+)(?:\/(\d+))?/);
  if (watchMatch) {
    return {
      view: 'watch',
      slug: watchMatch[1],
      episode: watchMatch[2] ? parseInt(watchMatch[2], 10) : undefined,
    };
  }

  // Movie detail route: /movie/:slug
  const movieMatch = path.match(/^\/movie\/([^/]+)/);
  if (movieMatch) {
    return {
      view: 'movie',
      slug: movieMatch[1],
    };
  }

  return { view: 'home' };
}

export const App: React.FC = () => {
  const [route, setRoute] = useState<RouteState>(parseCurrentRoute);
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [sort, setSort] = useState('latest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedResolution, setSelectedResolution] = useState('all');

  // Client-side Navigation Handler
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(parseCurrentRoute());
  };

  // Listen to browser Back/Forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseCurrentRoute());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sync route if pathname tab changes (e.g. /explore, /genres)
  useEffect(() => {
    const p = window.location.pathname.replace(/^\//, '');
    if (['explore', 'genres', 'television', 'sports', 'mylist'].includes(p)) {
      setActiveTab(p);
    }
  }, []);

  // Fetch movies from API
  const fetchMovies = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeTab === 'movie' || activeTab === 'tv') {
      params.set('type', activeTab);
    }
    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }
    params.set('limit', '100');

    fetch(`/api/movies?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data: MoviesResponse) => {
        setMovies(data.movies || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch movies:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMovies();
  }, [activeTab, searchQuery]);

  // Client-side filtering & sorting
  const filteredMovies = useMemo(() => {
    let result = [...movies];

    if (selectedGenre) {
      result = result.filter(
        (m) => m.genres && m.genres.some((g) => g.toLowerCase().includes(selectedGenre.toLowerCase()))
      );
    }

    if (selectedResolution !== 'all') {
      result = result.filter((m) =>
        m.quality?.toLowerCase().includes(selectedResolution.toLowerCase())
      );
    }

    if (sort === 'score') {
      result.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sort === 'year') {
      result.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else if (sort === 'views') {
      result.sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    return result;
  }, [movies, selectedGenre, selectedResolution, sort]);

  // Featured movies for HeroBanner
  const heroMovies = useMemo(() => {
    const pool = movies.filter((m) => m.backdrop);
    return pool.length > 0 ? pool.slice(0, 5) : movies.slice(0, 5);
  }, [movies]);

  // Top 10 movies for TopRail
  const top10Movies = useMemo(() => {
    const sorted = [...movies].sort((a, b) => (b.score || 0) - (a.score || 0));
    return sorted.slice(0, 10);
  }, [movies]);

  // TV Series for MovieRail
  const seriesMovies = useMemo(() => {
    return movies.filter((m) => m.movie_type === 'tv' || (m.total_episodes && m.total_episodes > 1));
  }, [movies]);

  // Single Feature Movies for MovieRail
  const singleMovies = useMemo(() => {
    return movies.filter((m) => m.movie_type === 'movie' || !m.total_episodes || m.total_episodes <= 1);
  }, [movies]);

  const handleCardClick = (movie: MovieSummary) => {
    navigateTo(`/movie/${movie.slug}`);
  };

  const handlePlayClick = (movie: MovieSummary) => {
    navigateTo(`/watch/${movie.slug}`);
  };

  const isFilteredView = Boolean(
    searchQuery.trim() ||
      selectedGenre ||
      activeTab === 'explore' ||
      activeTab === 'genres' ||
      activeTab === 'television' ||
      activeTab === 'sports' ||
      activeTab === 'favourites'
  );

  return (
    <div className="shell">
      {/* 1. Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (route.view !== 'home') {
            navigateTo('/');
          }
          if (tab === 'all') {
            setSelectedGenre('');
            setSearchQuery('');
          }
        }}
        onQuickCode={() => alert('Chức năng Ghép nối TV / Quick Code Login')}
        onSignIn={() => alert('Đăng nhập tài khoản Film4k')}
        onPairDevice={() => alert('Ghép nối thiết bị TV')}
        onSettings={() => alert('Cài đặt giao diện và hệ thống')}
      />

      {/* 2. Main Content Shell */}
      <div className="shell-main">
        {/* Sticky Header */}
        <Header
          onSearch={(q) => {
            setSearchQuery(q);
            if (route.view !== 'home') {
              navigateTo('/');
            }
          }}
          onBrandClick={() => {
            setActiveTab('all');
            setSearchQuery('');
            setSelectedGenre('');
            navigateTo('/');
          }}
          onPairClick={() => alert('Ghép nối TV / Device')}
          onAppClick={() => alert('Ứng dụng Film4k cho Android TV & Mobile')}
          onSignInClick={() => alert('Đăng nhập Film4k')}
        />

        {/* View Switcher based on current URL route */}
        {route.view === 'movie' && route.slug ? (
          <MovieDetailPage slug={route.slug} onNavigate={navigateTo} />
        ) : route.view === 'watch' && route.slug ? (
          <WatchPage
            slug={route.slug}
            initialEpisode={route.episode}
            onNavigate={navigateTo}
          />
        ) : (
          <main className="wrap">
            <div className="home">
              {/* Filter Bar */}
              <FilterBar
                sort={sort}
                onSortChange={setSort}
                type={activeTab}
                onTypeChange={(t) => setActiveTab(t)}
                selectedGenre={selectedGenre}
                onGenreChange={setSelectedGenre}
                selectedCountry={selectedCountry}
                onCountryChange={setSelectedCountry}
                selectedResolution={selectedResolution}
                onResolutionChange={setSelectedResolution}
              />

              {/* Filtered Grid or Full Catalog Rails */}
              {isFilteredView ? (
                <section className="row-sec" style={{ marginTop: '24px' }}>
                  <div className="head">
                    <h2>
                      {searchQuery
                        ? `Kết quả tìm kiếm cho "${searchQuery}"`
                        : selectedGenre
                        ? `Thể loại: ${selectedGenre}`
                        : activeTab === 'tv'
                        ? 'Tất cả Phim Bộ'
                        : activeTab === 'movie'
                        ? 'Tất cả Phim Lẻ'
                        : 'Danh sách phim'}
                      <span
                        style={{
                          fontSize: '14px',
                          color: 'var(--muted, #8b95ad)',
                          marginLeft: '12px',
                          fontWeight: 500,
                        }}
                      >
                        ({filteredMovies.length} phim)
                      </span>
                    </h2>
                  </div>

                  {loading ? (
                    <div style={{ color: 'var(--muted)', padding: '40px 0', textAlign: 'center' }}>
                      Đang nạp dữ liệu phim...
                    </div>
                  ) : filteredMovies.length === 0 ? (
                    <div style={{ color: 'var(--muted)', padding: '40px 0', textAlign: 'center' }}>
                      Không tìm thấy phim phù hợp với bộ lọc hiện tại.
                    </div>
                  ) : (
                    <div className="catalog-grid">
                      {filteredMovies.map((movie) => {
                        const displayTitle = movie.title_vi || movie.title_en || 'Phim';
                        const year = movie.year || 2026;
                        const genre =
                          movie.genres && movie.genres.length > 0 ? movie.genres[0] : 'Phim 4K';
                        const score = movie.score ? movie.score.toFixed(1) : '8.0';
                        const res = movie.quality || '1080p';

                        return (
                          <div className="hov" key={movie.slug}>
                            <a
                              className="card"
                              href={`/movie/${movie.slug}`}
                              onClick={(e) => {
                                e.preventDefault();
                                handleCardClick(movie);
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
                                    e.stopPropagation();
                                    e.preventDefault();
                                    handlePlayClick(movie);
                                  }}
                                >
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
                  )}
                </section>
              ) : (
                <>
                  {/* Hero Carousel Banner */}
                  {heroMovies.length > 0 && (
                    <HeroBanner
                      movies={heroMovies}
                      onPlay={handlePlayClick}
                      onInfo={handleCardClick}
                    />
                  )}

                  {/* Top 10 Rail */}
                  {top10Movies.length > 0 && (
                    <TopRail
                      movies={top10Movies}
                      onSelect={handleCardClick}
                    />
                  )}

                  {/* TV Series Rail */}
                  {seriesMovies.length > 0 && (
                    <MovieRail
                      id="new"
                      title="Phim bộ mới cập nhật"
                      movies={seriesMovies}
                      onSelect={handleCardClick}
                      onPlay={handlePlayClick}
                      onViewAll={() => setActiveTab('tv')}
                    />
                  )}

                  {/* Feature Movies Rail */}
                  {singleMovies.length > 0 && (
                    <MovieRail
                      title="Phim lẻ mới cập nhật"
                      movies={singleMovies}
                      onSelect={handleCardClick}
                      onPlay={handlePlayClick}
                      onViewAll={() => setActiveTab('movie')}
                    />
                  )}
                </>
              )}
            </div>
          </main>
        )}
      </div>

      {/* 3. Mobile Bottom Navigation */}
      <MobileNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (route.view !== 'home') {
            navigateTo('/');
          }
          if (tab === 'all') {
            setSelectedGenre('');
            setSearchQuery('');
          }
        }}
      />
    </div>
  );
};

export default App;

