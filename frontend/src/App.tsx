import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { HeroBanner } from './components/HeroBanner';
import { FilterBar } from './components/FilterBar';
import { TopRail } from './components/TopRail';
import { MovieRail } from './components/MovieRail';
import { MobileNav } from './components/MobileNav';
import { MovieDetailPage } from './components/MovieDetailPage';
import { WatchPage } from './components/WatchPage';
import { AdminDashboard } from './components/AdminDashboard';
import { ContinueWatchingRail } from './components/ContinueWatchingRail';
import { MyListPage } from './components/MyListPage';
import { MovieSummary, MoviesResponse, HomeResponse } from './types';
import { Loader2, Bookmark } from 'lucide-react';
import { isInMyList, toggleMyList } from './utils/myList';

const PAGE_LIMIT = 48;

interface RouteState {
  view: 'home' | 'movie' | 'watch' | 'admin' | 'mylist';
  slug?: string;
  episode?: number;
}

function parseCurrentRoute(): RouteState {
  const path = window.location.pathname;

  // Admin route: /admin or /admin/*
  if (path === '/admin' || path.startsWith('/admin/')) {
    return {
      view: 'admin',
    };
  }

  // My List route: /mylist or /favourites
  if (path === '/mylist' || path === '/favourites') {
    return {
      view: 'mylist',
    };
  }

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
  const [total, setTotal] = useState(0);
  const [homeData, setHomeData] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [sort, setSort] = useState('latest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedResolution, setSelectedResolution] = useState('all');
  const [selectedTrack, setSelectedTrack] = useState('all');

  // Client-side Navigation Handler
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(parseCurrentRoute());
  };

  // Reset all active filters to default
  const handleResetFilters = useCallback(() => {
    setSort('latest');
    setActiveTab('all');
    setSelectedGenre('');
    setSelectedCountry('all');
    setSelectedYear('all');
    setSelectedResolution('all');
    setSelectedTrack('all');
    setSearchQuery('');
  }, []);

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

  // Listen to My List updates for catalog cards
  const [, setBookmarkTick] = useState(0);
  useEffect(() => {
    const handleListUpdate = () => setBookmarkTick((t) => t + 1);
    window.addEventListener('bofilm_mylist_updated', handleListUpdate);
    return () => window.removeEventListener('bofilm_mylist_updated', handleListUpdate);
  }, []);

  // Build query params helper for multi-dimensional filter matrix
  const buildParams = useCallback(
    (offset: number, search?: string, type?: string) => {
      const params = new URLSearchParams();
      const tabType = type ?? activeTab;
      const q = search !== undefined ? search : searchQuery;
      if (tabType === 'movie' || tabType === 'tv') {
        params.set('type', tabType);
      }
      if (q.trim()) {
        params.set('search', q.trim());
      }
      if (selectedGenre) {
        params.set('genre', selectedGenre);
      }
      if (selectedCountry && selectedCountry !== 'all') {
        params.set('country', selectedCountry);
      }
      if (selectedYear && selectedYear !== 'all') {
        params.set('year', selectedYear);
      }
      if (selectedResolution && selectedResolution !== 'all') {
        params.set('quality', selectedResolution);
      }
      if (selectedTrack && selectedTrack !== 'all') {
        params.set('track', selectedTrack);
      }
      if (sort && sort !== 'latest') {
        params.set('sort', sort);
      }
      params.set('limit', String(PAGE_LIMIT));
      params.set('offset', String(offset));
      return params;
    },
    [activeTab, searchQuery, selectedGenre, selectedCountry, selectedYear, selectedResolution, selectedTrack, sort]
  );

  // Fetch initial page (replaces current list)
  const fetchMovies = useCallback(
    (search?: string, type?: string) => {
      setLoading(true);
      const params = buildParams(0, search, type);
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
    },
    [buildParams]
  );

  // Fetch Home curated layout (/api/home matching web gốc)
  const fetchHome = useCallback(() => {
    setLoading(true);
    fetch('/api/home')
      .then((res) => {
        if (!res.ok) throw new Error(`Home endpoint returned status ${res.status}`);
        return res.json();
      })
      .then((data: HomeResponse) => {
        const list = Array.isArray(data.list)
          ? data.list
          : Array.isArray((data as any).movies)
          ? (data as any).movies
          : [];
        setHomeData(data);
        setMovies(list);
        setTotal(typeof data.total === 'number' ? data.total : list.length);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('/api/home not ready or failed, falling back to /api/movies:', err);
        setHomeData(null);
        fetchMovies('', 'all');
      });
  }, [fetchMovies]);

  // "Load More" – appends to current list
  const fetchMore = useCallback(() => {
    if (loadingMore || loading) return;
    setLoadingMore(true);
    const params = buildParams(movies.length);
    fetch(`/api/movies?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data: MoviesResponse) => {
        setMovies((prev) => [...prev, ...(data.movies || [])]);
        setTotal(data.total || 0);
        setLoadingMore(false);
      })
      .catch((err) => {
        console.error('Failed to fetch more movies:', err);
        setLoadingMore(false);
      });
  }, [loadingMore, loading, movies.length, buildParams]);

  // When activeTab, searchQuery, or filters change → load appropriate data
  useEffect(() => {
    setMovies([]);
    const isDefaultHome =
      route.view === 'home' &&
      !searchQuery.trim() &&
      !selectedGenre &&
      selectedCountry === 'all' &&
      selectedYear === 'all' &&
      selectedResolution === 'all' &&
      selectedTrack === 'all' &&
      sort === 'latest' &&
      activeTab === 'all';

    if (isDefaultHome) {
      fetchHome();
    } else {
      setHomeData(null);
      fetchMovies(searchQuery, activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchQuery, selectedGenre, selectedCountry, selectedYear, selectedResolution, selectedTrack, sort, route.view]);

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

    if (selectedYear !== 'all') {
      if (selectedYear === '2020-2021') {
        result = result.filter((m) => (m.year || 0) >= 2020 && (m.year || 0) <= 2021);
      } else if (selectedYear === '2015-2019') {
        result = result.filter((m) => (m.year || 0) >= 2015 && (m.year || 0) <= 2019);
      } else if (selectedYear === 'before-2015') {
        result = result.filter((m) => (m.year || 0) < 2015);
      } else {
        const yr = parseInt(selectedYear, 10);
        if (!isNaN(yr)) {
          result = result.filter((m) => m.year === yr);
        }
      }
    }

    if (selectedCountry !== 'all') {
      result = result.filter((m) => {
        const c = (m.country || '').toLowerCase();
        const t = (m.title_vi || '').toLowerCase() + ' ' + (m.title_en || '').toLowerCase();
        if (selectedCountry === 'au-my') return c.includes('mỹ') || c.includes('âu') || c.includes('us') || c.includes('uk') || t.includes('mỹ');
        if (selectedCountry === 'han-quoc') return c.includes('hàn') || c.includes('korea');
        if (selectedCountry === 'trung-quoc') return c.includes('trung') || c.includes('china');
        if (selectedCountry === 'nhat-ban') return c.includes('nhật') || c.includes('japan');
        if (selectedCountry === 'thai-lan') return c.includes('thái') || c.includes('thai');
        if (selectedCountry === 'viet-nam') return c.includes('việt') || c.includes('vietnam');
        if (selectedCountry === 'hong-kong') return c.includes('hồng kông') || c.includes('hong kong');
        if (selectedCountry === 'anh') return c.includes('anh') || c.includes('uk');
        if (selectedCountry === 'phap') return c.includes('pháp') || c.includes('france');
        if (selectedCountry === 'an-do') return c.includes('ấn độ') || c.includes('india');
        return c.includes(selectedCountry);
      });
    }

    if (selectedTrack !== 'all') {
      result = result.filter((m) => {
        const combined = ((m.title_vi || '') + ' ' + (m.title_en || '') + ' ' + (m.quality || '')).toLowerCase();
        if (selectedTrack === 'tm') return combined.includes('thuyết minh') || combined.includes('tm') || !combined.includes('raw');
        if (selectedTrack === 'pd') return combined.includes('phụ đề') || combined.includes('vietsub') || combined.includes('pd');
        if (selectedTrack === 'lt') return combined.includes('lồng tiếng') || combined.includes('lt');
        return true;
      });
    }

    if (sort === 'score') {
      result.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sort === 'year') {
      result.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else if (sort === 'views') {
      result.sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    return result;
  }, [movies, selectedGenre, selectedResolution, selectedYear, selectedCountry, selectedTrack, sort]);

  // Featured movies for HeroBanner (priority: data.hero -> backdrop pool -> slice)
  const heroMovies = useMemo(() => {
    if (homeData?.hero && homeData.hero.length > 0) {
      return homeData.hero;
    }
    const pool = movies.filter((m) => m.backdrop);
    return pool.length > 0 ? pool.slice(0, 5) : movies.slice(0, 5);
  }, [homeData?.hero, movies]);

  // Top 10 movies for TopRail (priority: data.top -> sort score)
  const top10Movies = useMemo(() => {
    if (homeData?.top && homeData.top.length > 0) {
      return homeData.top;
    }
    const sorted = [...movies].sort((a, b) => (b.score || 0) - (a.score || 0));
    return sorted.slice(0, 10);
  }, [homeData?.top, movies]);

  // TV Series for MovieRail (priority: data.newSeries -> filter tv)
  const seriesMovies = useMemo(() => {
    if (homeData?.newSeries && homeData.newSeries.length > 0) {
      return homeData.newSeries;
    }
    return movies.filter((m) => m.movie_type === 'tv' || (m.total_episodes && m.total_episodes > 1));
  }, [homeData?.newSeries, movies]);

  // Single Feature Movies for MovieRail (priority: data.newMovies -> filter movie)
  const singleMovies = useMemo(() => {
    if (homeData?.newMovies && homeData.newMovies.length > 0) {
      return homeData.newMovies;
    }
    return movies.filter((m) => m.movie_type === 'movie' || !m.total_episodes || m.total_episodes <= 1);
  }, [homeData?.newMovies, movies]);

  const handleCardClick = (movie: MovieSummary) => {
    navigateTo(`/movie/${movie.slug}`);
  };

  const handlePlayClick = (movie: MovieSummary) => {
    navigateTo(`/watch/${movie.slug}`);
  };

  const isFilteredView = Boolean(
    searchQuery.trim() ||
      selectedGenre ||
      selectedCountry !== 'all' ||
      selectedYear !== 'all' ||
      selectedResolution !== 'all' ||
      selectedTrack !== 'all' ||
      sort !== 'latest' ||
      activeTab === 'movie' ||
      activeTab === 'tv' ||
      activeTab === 'explore' ||
      activeTab === 'genres' ||
      activeTab === 'television' ||
      activeTab === 'sports' ||
      activeTab === 'favourites'
  );

  const hasMore = movies.length < total;
  const allLoaded = !loading && movies.length >= total && total > 0;

  if (route.view === 'admin') {
    return <AdminDashboard onNavigate={navigateTo} />;
  }

  return (
    <div className="shell">
      {/* 1. Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab === 'mylist' || tab === 'favourites') {
            navigateTo('/mylist');
            return;
          }
          if (route.view !== 'home') {
            navigateTo('/');
          }
          if (tab === 'all') {
            setSelectedGenre('');
            setSearchQuery('');
          }
        }}
        onQuickCode={() => alert('Chức năng Ghép nối TV / Quick Code Login')}
        onSignIn={() => alert('Đăng nhập tài khoản Bơ Film')}
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
          onSelectMovie={(slug) => {
            navigateTo(`/movie/${slug}`);
          }}
          onBrandClick={() => {
            setActiveTab('all');
            setSearchQuery('');
            setSelectedGenre('');
            navigateTo('/');
          }}
          onPairClick={() => alert('Ghép nối TV / Device')}
          onAppClick={() => alert('Ứng dụng Bơ Film cho Android TV & Mobile')}
          onSignInClick={() => alert('Đăng nhập Bơ Film')}
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
        ) : route.view === 'mylist' ? (
          <MyListPage onNavigate={navigateTo} />
        ) : (
          <>
            <main className="wrap">
              <div className="home">
              {/* Continue Watching Rail (Resumes unfinished movies) */}
              <ContinueWatchingRail
                onPlay={(item) => {
                  const targetPath =
                    item.episode && item.episode > 1
                      ? `/watch/${item.slug}/${item.episode}`
                      : `/watch/${item.slug}`;
                  navigateTo(targetPath);
                }}
              />

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
                selectedYear={selectedYear}
                onYearChange={setSelectedYear}
                selectedResolution={selectedResolution}
                onResolutionChange={setSelectedResolution}
                selectedTrack={selectedTrack}
                onTrackChange={setSelectedTrack}
                onResetFilters={handleResetFilters}
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
                        (Đang hiển thị {filteredMovies.length.toLocaleString()}{total > 0 ? ` / ${total.toLocaleString()}` : ''} phim)
                      </span>
                    </h2>
                  </div>

                  {loading ? (
                    <div style={{ color: 'var(--muted)', padding: '40px 0', textAlign: 'center' }}>
                      <Loader2
                        size={24}
                        style={{ display: 'inline-block', animation: 'spin 1s linear infinite', marginBottom: '8px' }}
                      />
                      <div>Đang nạp dữ liệu phim...</div>
                    </div>
                  ) : filteredMovies.length === 0 ? (
                    <div style={{ color: 'var(--muted)', padding: '40px 0', textAlign: 'center' }}>
                      Không tìm thấy phim phù hợp với bộ lọc hiện tại.
                    </div>
                  ) : (
                    <>
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

                      {/* Load More / All Loaded Footer */}
                      <div
                        style={{
                          marginTop: '32px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '12px',
                          paddingBottom: '24px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--muted, #8b95ad)',
                          }}
                        >
                          Đang hiển thị{' '}
                          <span style={{ color: '#fff', fontWeight: 600 }}>
                            {movies.length.toLocaleString()}
                          </span>{' '}
                          /{' '}
                          <span style={{ color: '#f5c518', fontWeight: 600 }}>
                            {total.toLocaleString()}
                          </span>{' '}
                          phim
                        </div>

                        {hasMore && (
                          <button
                            type="button"
                            onClick={fetchMore}
                            disabled={loadingMore}
                            style={{
                              background: 'linear-gradient(135deg, rgba(174, 234, 0, 0.15) 0%, rgba(132, 204, 22, 0.25) 100%)',
                              border: '1px solid rgba(174, 234, 0, 0.5)',
                              color: '#fcfdf7',
                              padding: '12px 32px',
                              borderRadius: '10px',
                              fontSize: '14px',
                              fontWeight: 700,
                              cursor: loadingMore ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              boxShadow: '0 4px 18px rgba(174, 234, 0, 0.25)',
                              transition: 'all 0.2s',
                              opacity: loadingMore ? 0.7 : 1,
                            }}
                          >
                            {loadingMore ? (
                              <>
                                <Loader2
                                  size={16}
                                  style={{ animation: 'spin 1s linear infinite' }}
                                />
                                <span>Đang tải thêm...</span>
                              </>
                            ) : (
                              <>
                                <span>🎬</span>
                                <span>Tải thêm phim</span>
                                <span
                                  style={{
                                    fontSize: '12px',
                                    color: 'rgba(255,255,255,0.6)',
                                    fontWeight: 400,
                                  }}
                                >
                                  ({(total - movies.length).toLocaleString()} phim còn lại)
                                </span>
                              </>
                            )}
                          </button>
                        )}

                        {allLoaded && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '13px',
                              color: '#10b981',
                              background: 'rgba(16, 185, 129, 0.08)',
                              border: '1px solid rgba(16, 185, 129, 0.2)',
                              borderRadius: '10px',
                              padding: '10px 20px',
                            }}
                          >
                            <span>✅</span>
                            <span>
                              Đã tải hết toàn bộ{' '}
                              <strong>{total.toLocaleString()}</strong> phim trong kho 4K Cinema
                            </span>
                          </div>
                        )}
                      </div>
                    </>
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

                  {/* Home Load-More footer */}
                  {(hasMore || allLoaded) && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '24px 0 32px',
                      }}
                    >
                      <div style={{ fontSize: '13px', color: 'var(--muted, #8b95ad)' }}>
                        Đang hiển thị{' '}
                        <span style={{ color: '#fff', fontWeight: 600 }}>
                          {movies.length.toLocaleString()}
                        </span>{' '}
                        /{' '}
                        <span style={{ color: '#f5c518', fontWeight: 600 }}>
                          {total.toLocaleString()}
                        </span>{' '}
                        phim
                      </div>

                      {hasMore && (
                        <button
                          type="button"
                          onClick={fetchMore}
                          disabled={loadingMore}
                          style={{
                            background: 'linear-gradient(135deg, rgba(174, 234, 0, 0.15) 0%, rgba(132, 204, 22, 0.25) 100%)',
                            border: '1px solid rgba(174, 234, 0, 0.5)',
                            color: '#fcfdf7',
                            padding: '12px 32px',
                            borderRadius: '10px',
                            fontSize: '14px',
                            fontWeight: 700,
                            cursor: loadingMore ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 18px rgba(174, 234, 0, 0.25)',
                            transition: 'all 0.2s',
                            opacity: loadingMore ? 0.7 : 1,
                          }}
                        >
                          {loadingMore ? (
                            <>
                              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                              <span>Đang tải thêm...</span>
                            </>
                          ) : (
                            <>
                              <span>🎬</span>
                              <span>Xem thêm phim</span>
                              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', fontWeight: 400 }}>
                                ({(total - movies.length).toLocaleString()} phim còn lại)
                              </span>
                            </>
                          )}
                        </button>
                      )}

                      {allLoaded && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '13px',
                            color: '#10b981',
                            background: 'rgba(16, 185, 129, 0.08)',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            borderRadius: '10px',
                            padding: '10px 20px',
                          }}
                        >
                          <span>✅</span>
                          <span>
                            Đã tải hết toàn bộ{' '}
                            <strong>{total.toLocaleString()}</strong> phim trong kho 4K Cinema
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </main>

          {/* Footer */}
          <footer
            style={{
              borderTop: '1px solid #1e3f28',
              background: '#070e08',
              padding: '36px 24px 48px',
              marginTop: '48px',
              textAlign: 'center',
            }}
          >
            <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img
                  src="/logo.png"
                  alt="Bơ Film"
                  style={{ height: '32px', width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(174, 234, 0, 0.4))' }}
                />
                <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', display: 'inline-flex', gap: '4px' }}>
                  <span style={{ color: '#aeea00' }}>Bơ</span>
                  <span style={{ color: '#fcfdf7' }}>Film</span>
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: '#cbd8cb', fontWeight: 600 }}>
                Bơ Film - Rạp chiếu phim 4K Cinema chất lượng cao
              </p>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a896', maxWidth: '600px', lineHeight: 1.6 }}>
                Trải nghiệm xem phim 4K UHD siêu nét, âm thanh vòm Dolby Atmos đa kênh và phụ đề song ngữ Vietsub mượt mà hàng đầu.
              </p>
              <div style={{ fontSize: '11px', color: 'rgba(148, 168, 150, 0.6)', marginTop: '8px' }}>
                © 2026 Bơ Film Cinema. All rights reserved.
              </div>
            </div>
          </footer>
        </>
      )}
      </div>

      {/* 3. Mobile Bottom Navigation */}
      <MobileNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab === 'mylist' || tab === 'favourites') {
            navigateTo('/mylist');
            return;
          }
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
