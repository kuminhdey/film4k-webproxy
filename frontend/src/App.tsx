import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { HeroBanner } from './components/HeroBanner';
import { FilterBar } from './components/FilterBar';
import { TopRail } from './components/TopRail';
import { MovieRail } from './components/MovieRail';
import { MobileNav } from './components/MobileNav';
import { MovieSummary, MoviesResponse } from './types';

const PlayerModal = React.lazy(() =>
  import('./components/PlayerModal').then((m) => ({ default: m.PlayerModal }))
);

export const App: React.FC = () => {
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [sort, setSort] = useState('latest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedResolution, setSelectedResolution] = useState('all');
  const [selectedMovieSlug, setSelectedMovieSlug] = useState<string | null>(null);

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

    // Filter by genre
    if (selectedGenre) {
      result = result.filter(
        (m) => m.genres && m.genres.some((g) => g.toLowerCase().includes(selectedGenre.toLowerCase()))
      );
    }

    // Filter by resolution
    if (selectedResolution !== 'all') {
      result = result.filter((m) =>
        m.quality?.toLowerCase().includes(selectedResolution.toLowerCase())
      );
    }

    // Sort
    if (sort === 'score') {
      result.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sort === 'year') {
      result.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else if (sort === 'views') {
      result.sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    return result;
  }, [movies, selectedGenre, selectedResolution, sort]);

  // Featured movies for HeroBanner (up to 5 movies with backdrops)
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

  const handlePlayMovie = (movie: MovieSummary) => {
    setSelectedMovieSlug(movie.slug);
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

      {/* 2. Main Content Area */}
      <div className="shell-main">
        {/* Sticky Header */}
        <Header
          onSearch={(q) => setSearchQuery(q)}
          onBrandClick={() => {
            setActiveTab('all');
            setSearchQuery('');
            setSelectedGenre('');
          }}
          onPairClick={() => alert('Ghép nối TV / Device')}
          onAppClick={() => alert('Ứng dụng Film4k cho Android TV & Mobile')}
          onSignInClick={() => alert('Đăng nhập Film4k')}
        />

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

            {/* Standard Catalog Homepage or Filtered Grid View */}
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
                    <span style={{ fontSize: '14px', color: 'var(--muted, #8b95ad)', marginLeft: '12px', fontWeight: 500 }}>
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
                              handlePlayMovie(movie);
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
                )}
              </section>
            ) : (
              <>
                {/* 3. Hero Carousel Banner */}
                {heroMovies.length > 0 && (
                  <HeroBanner
                    movies={heroMovies}
                    onPlay={handlePlayMovie}
                    onInfo={handlePlayMovie}
                  />
                )}

                {/* 4. Top 10 Rail */}
                {top10Movies.length > 0 && (
                  <TopRail movies={top10Movies} onSelect={handlePlayMovie} />
                )}

                {/* 5. TV Series Rail */}
                {seriesMovies.length > 0 && (
                  <MovieRail
                    id="new"
                    title="Phim bộ mới cập nhật"
                    movies={seriesMovies}
                    onSelect={handlePlayMovie}
                    onViewAll={() => setActiveTab('tv')}
                  />
                )}

                {/* 6. Feature Movies Rail */}
                {singleMovies.length > 0 && (
                  <MovieRail
                    title="Phim lẻ mới cập nhật"
                    movies={singleMovies}
                    onSelect={handlePlayMovie}
                    onViewAll={() => setActiveTab('movie')}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* 3. Mobile Bottom Navigation */}
      <MobileNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab === 'all') {
            setSelectedGenre('');
            setSearchQuery('');
          }
        }}
      />

      {/* 4. Cinema Player Modal */}
      {selectedMovieSlug && (
        <Suspense
          fallback={
            <div className="cinema-modal" style={{ justifyContent: 'center', alignItems: 'center', color: '#fff' }}>
              Đang khởi tạo rạp chiếu phim 4K...
            </div>
          }
        >
          <PlayerModal
            slug={selectedMovieSlug}
            onClose={() => setSelectedMovieSlug(null)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
