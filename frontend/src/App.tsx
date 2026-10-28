import React, { useState, useEffect, useCallback } from 'react';
import {
  Film,
  Sparkles,
  LayoutGrid,
  List,
  ChevronRight,
  Flame,
  Tv,
  Clapperboard,
  Loader2,
} from 'lucide-react';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HeroBanner } from './components/HeroBanner';
import { MovieCard } from './components/MovieCard';
import { MovieTableView } from './components/MovieTableView';
import { MovieDetailPage } from './components/MovieDetailPage';
import { CatalogView } from './components/CatalogView';
import { MyListPage } from './components/MyListPage';
import { HistoryPage } from './components/HistoryPage';
import { ContinueWatchingRow } from './components/ContinueWatchingRow';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';

// Code-splitting (PERF-01): Lazy load heavy components to isolate hls.js and admin assets
const WatchPage = React.lazy(() =>
  import('./components/WatchPage').then((m) => ({ default: m.WatchPage }))
);
const AdminDashboard = React.lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
import { getHome, getMovies } from './api';
import { HomeResponse, MovieItem, Paginate, FilterOptions } from './types';
import { CATEGORIES, GENRES, COUNTRIES } from './constants';

interface RouteState {
  view:
    | 'home'
    | 'detail'
    | 'watch'
    | 'category'
    | 'genre'
    | 'country'
    | 'year'
    | 'search'
    | 'favorites'
    | 'history'
    | 'admin';
  slug?: string;
  episodeSlug?: string;
  keyword?: string;
}

function parseRoute(): RouteState {
  const path = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);

  // Admin route: /admin or /admin/*
  if (path === '/admin' || path.startsWith('/admin/')) {
    return { view: 'admin' };
  }

  if (path === '/yeu-thich') {
    return { view: 'favorites' };
  }
  if (path === '/lich-su') {
    return { view: 'history' };
  }
  if (path === '/tim-kiem') {
    return { view: 'search', keyword: searchParams.get('keyword') || '' };
  }

  // Watch route: /xem-phim/:slug/:ep or /watch/:slug/:ep
  const watchMatch =
    path.match(/^\/xem-phim\/([^/]+)(?:\/([^/]+))?/) ||
    path.match(/^\/watch\/([^/]+)(?:\/([^/]+))?/);
  if (watchMatch) {
    return {
      view: 'watch',
      slug: watchMatch[1],
      episodeSlug: watchMatch[2],
    };
  }

  // Detail route: /phim/:slug or /movie/:slug
  const detailMatch =
    path.match(/^\/phim\/([^/]+)/) || path.match(/^\/movie\/([^/]+)/);
  if (detailMatch) {
    return {
      view: 'detail',
      slug: detailMatch[1],
    };
  }

  // Category: /danh-sach/:slug
  const catMatch = path.match(/^\/danh-sach\/([^/]+)/);
  if (catMatch) {
    return { view: 'category', slug: catMatch[1] };
  }

  // Genre: /the-loai/:slug
  const genreMatch = path.match(/^\/the-loai\/([^/]+)/);
  if (genreMatch) {
    return { view: 'genre', slug: genreMatch[1] };
  }

  // Country: /quoc-gia/:slug
  const countryMatch = path.match(/^\/quoc-gia\/([^/]+)/);
  if (countryMatch) {
    return { view: 'country', slug: countryMatch[1] };
  }

  // Year: /nam-phat-hanh/:year
  const yearMatch = path.match(/^\/nam-phat-hanh\/([^/]+)/);
  if (yearMatch) {
    return { view: 'year', slug: yearMatch[1] };
  }

  return { view: 'home' };
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(parseRoute);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [homeData, setHomeData] = useState<HomeResponse | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);

  // Home latest shelf view mode: grid vs table
  const [latestViewMode, setLatestViewMode] = useState<'grid' | 'table'>('grid');

  // Catalog state for non-home routes
  const [catalogMovies, setCatalogMovies] = useState<MovieItem[]>([]);
  const [catalogPaginate, setCatalogPaginate] = useState<Paginate | undefined>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogFilters, setCatalogFilters] = useState<FilterOptions>({
    page: 1,
  });

  // Client-side Navigation
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    setRoute(parseRoute());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
      setRoute(parseRoute());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Load Home Data on initial mount
  useEffect(() => {
    getHome().then((data) => {
      if (data) {
        setHomeData(data);
      }
      setHomeLoading(false);
    });
  }, []);

  // Load Catalog Data when on catalog/search/category/genre/country/year view
  useEffect(() => {
    if (
      route.view === 'category' ||
      route.view === 'genre' ||
      route.view === 'country' ||
      route.view === 'year' ||
      route.view === 'search'
    ) {
      setCatalogLoading(true);

      const params: FilterOptions = {
        page: catalogFilters.page || 1,
        category: route.view === 'category' ? route.slug : catalogFilters.category,
        genre: route.view === 'genre' ? route.slug : catalogFilters.genre,
        country: route.view === 'country' ? route.slug : catalogFilters.country,
        year: route.view === 'year' ? route.slug : catalogFilters.year,
        sort: catalogFilters.sort,
        keyword: route.view === 'search' ? route.keyword : catalogFilters.keyword,
      };

      getMovies(params).then((res) => {
        if (res) {
          setCatalogMovies(res.items || []);
          setCatalogPaginate(res.paginate);
        } else {
          setCatalogMovies([]);
        }
        setCatalogLoading(false);
      });
    }
  }, [route, catalogFilters]);

  // Catalog Title Generator
  const getCatalogMeta = () => {
    if (route.view === 'category') {
      const cat = CATEGORIES.find((c) => c.slug === route.slug);
      return {
        title: cat?.name || 'Danh Sách Phim',
        subtitle: cat?.description || 'Tuyển tập phim đặc sắc trên Bơ Film',
      };
    }
    if (route.view === 'genre') {
      const g = GENRES.find((item) => item.slug === route.slug);
      return {
        title: `Phim Thể Loại ${g?.name || route.slug}`,
        subtitle: `Tổng hợp các bộ phim thuộc thể loại ${g?.name || route.slug}`,
      };
    }
    if (route.view === 'country') {
      const c = COUNTRIES.find((item) => item.slug === route.slug);
      return {
        title: `Phim Quốc Gia ${c?.name || route.slug}`,
        subtitle: `Tuyển chọn điện ảnh và truyền hình từ ${c?.name || route.slug}`,
      };
    }
    if (route.view === 'year') {
      return {
        title: `Phim Phát Hành Năm ${route.slug}`,
        subtitle: `Những tác phẩm điện ảnh ra mắt trong năm ${route.slug}`,
      };
    }
    if (route.view === 'search') {
      return {
        title: `Kết Quả Tìm Kiếm: "${route.keyword || ''}"`,
        subtitle: 'Các bộ phim phù hợp với từ khóa của bạn',
      };
    }
    return { title: 'Kho Phim Bơ Film', subtitle: 'Khám phá hàng ngàn bộ phim' };
  };

// Route loading fallback component (Cinematic taste: subtle pulse, deep black backdrop)
function PageLoadingFallback({ label = 'Đang tải nội dung...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] py-16 px-4">
      <div className="relative flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-lime-500/20 border-t-lime-400 animate-spin" />
        <Film className="w-5 h-5 text-lime-400 absolute" />
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-widest text-zinc-400 animate-pulse">
        {label}
      </p>
    </div>
  );
}

  // Render Admin Dashboard full-page when on /admin
  if (route.view === 'admin') {
    return (
      <React.Suspense fallback={<PageLoadingFallback label="Đang tải trang quản trị..." />}>
        <AdminDashboard onNavigate={navigateTo} />
      </React.Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-[#060b05] text-[#f4fbf0] flex flex-col selection:bg-lime-500 selection:text-black">
      {/* Header */}
      <Header currentPath={currentPath} onNavigate={navigateTo} />

      {/* Main Body Content */}
      <main className="flex-1 pt-14 pb-20 sm:pb-0">
        <ErrorBoundary fallbackTitle="Không thể tải nội dung trang">
        {route.view === 'home' && (
          <div className="space-y-10 sm:space-y-12">
            {/* Hero Spotlight Banner */}
            {homeData?.hero_banners && homeData.hero_banners.length > 0 && (
              <HeroBanner
                movies={homeData.hero_banners}
                onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
                onWatchMovie={(slug) => navigateTo(`/xem-phim/${slug}/tap-1`)}
              />
            )}

            {/* Continue Watching Shelf (Loaded instantly from local storage) */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <ContinueWatchingRow
                onWatch={(slug, epSlug, time) => {
                  const timeQuery =
                    typeof time === 'number' && time > 5
                      ? `?t=${Math.floor(time)}`
                      : '';
                  navigateTo(`/xem-phim/${slug}/${epSlug || 'tap-1'}${timeQuery}`);
                }}
                onNavigateHistory={() => navigateTo('/lich-su')}
              />
            </div>

            {homeLoading && !homeData ? (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-12 h-12 text-lime-400 animate-spin mb-3" />
                <p className="text-sm font-semibold text-[#8aa885]">
                  Đang tải rạp chiếu Bơ Film Avocado Cinema...
                </p>
              </div>
            ) : (
              <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12">
                {/* Section 1: Phim Mới Cập Nhật (with View Toggle and Xem tất cả) */}
                <section className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-lime-500/20 pb-3">
                    <div className="flex items-center gap-2.5">
                      <Flame className="w-5 h-5 text-lime-400 animate-pulse" />
                      <h2 className="text-lg sm:text-xl font-black text-[#f4fbf0] uppercase tracking-wide">
                        Phim Mới Cập Nhật
                      </h2>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                      {/* View Mode Switcher: Grid View vs Table View */}
                      <div className="flex items-center gap-1.5 bg-[#071307] p-1 rounded-xl border border-lime-500/20">
                        <button
                          type="button"
                          onClick={() => setLatestViewMode('grid')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            latestViewMode === 'grid'
                              ? 'bg-lime-500 text-black shadow-sm'
                              : 'text-[#8aa885] hover:text-[#d8ebd5]'
                          }`}
                        >
                          <LayoutGrid className="w-3.5 h-3.5" />
                          <span>Grid View ⊞</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setLatestViewMode('table')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            latestViewMode === 'table'
                              ? 'bg-lime-500 text-black shadow-sm'
                              : 'text-[#8aa885] hover:text-[#d8ebd5]'
                          }`}
                        >
                          <List className="w-3.5 h-3.5" />
                          <span>Table View ☰</span>
                        </button>
                      </div>

                      <button
                        onClick={() => navigateTo('/danh-sach/phim-moi')}
                        className="flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors"
                      >
                        <span>Xem tất cả</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {latestViewMode === 'grid' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {homeData?.latest?.map((movie) => (
                        <MovieCard
                          key={movie.slug}
                          movie={movie}
                          onClick={() => navigateTo(`/phim/${movie.slug}`)}
                        />
                      ))}
                    </div>
                  ) : (
                    <MovieTableView
                      movies={homeData?.latest || []}
                      onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
                    />
                  )}
                </section>

                {/* Section 2: Phim Bộ Mới */}
                {homeData?.series && homeData.series.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between border-b border-lime-500/20 pb-3">
                      <div className="flex items-center gap-2.5">
                        <Tv className="w-5 h-5 text-lime-400" />
                        <h2 className="text-lg sm:text-xl font-black text-[#f4fbf0] uppercase tracking-wide">
                          Phim Bộ Đang Hot
                        </h2>
                      </div>
                      <button
                        onClick={() => navigateTo('/danh-sach/phim-bo')}
                        className="flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors"
                      >
                        <span>Xem tất cả</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {homeData.series.slice(0, 12).map((movie) => (
                        <MovieCard
                          key={movie.slug}
                          movie={movie}
                          onClick={() => navigateTo(`/phim/${movie.slug}`)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 3: Phim Lẻ Mới */}
                {homeData?.single && homeData.single.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between border-b border-lime-500/20 pb-3">
                      <div className="flex items-center gap-2.5">
                        <Clapperboard className="w-5 h-5 text-lime-400" />
                        <h2 className="text-lg sm:text-xl font-black text-[#f4fbf0] uppercase tracking-wide">
                          Phim Lẻ Chiếu Rạp
                        </h2>
                      </div>
                      <button
                        onClick={() => navigateTo('/danh-sach/phim-le')}
                        className="flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors"
                      >
                        <span>Xem tất cả</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {homeData.single.slice(0, 12).map((movie) => (
                        <MovieCard
                          key={movie.slug}
                          movie={movie}
                          onClick={() => navigateTo(`/phim/${movie.slug}`)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 4: TV Shows */}
                {homeData?.tv_shows && homeData.tv_shows.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between border-b border-lime-500/20 pb-3">
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="w-5 h-5 text-lime-400" />
                        <h2 className="text-lg sm:text-xl font-black text-[#f4fbf0] uppercase tracking-wide">
                          TV Shows & Gameshow
                        </h2>
                      </div>
                      <button
                        onClick={() => navigateTo('/danh-sach/tv-shows')}
                        className="flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors"
                      >
                        <span>Xem tất cả</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {homeData.tv_shows.slice(0, 12).map((movie) => (
                        <MovieCard
                          key={movie.slug}
                          movie={movie}
                          onClick={() => navigateTo(`/phim/${movie.slug}`)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Section 5: Hoạt Hình & Anime */}
                {homeData?.anime && homeData.anime.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between border-b border-lime-500/20 pb-3">
                      <div className="flex items-center gap-2.5">
                        <Film className="w-5 h-5 text-lime-400" />
                        <h2 className="text-lg sm:text-xl font-black text-[#f4fbf0] uppercase tracking-wide">
                          Hoạt Hình & Anime Đặc Sắc
                        </h2>
                      </div>
                      <button
                        onClick={() => navigateTo('/the-loai/hoat-hinh')}
                        className="flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors"
                      >
                        <span>Xem tất cả</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {homeData.anime.slice(0, 12).map((movie) => (
                        <MovieCard
                          key={movie.slug}
                          movie={movie}
                          onClick={() => navigateTo(`/phim/${movie.slug}`)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {/* Movie Detail View */}
        {route.view === 'detail' && route.slug && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <MovieDetailPage
              slug={route.slug}
              onBack={() => navigateTo('/')}
              onWatch={(slug, ep) =>
                navigateTo(`/xem-phim/${slug}/${ep || 'tap-1'}`)
              }
              onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
            />
          </div>
        )}

        {/* Watch Movie View */}
        {route.view === 'watch' && route.slug && (
          <div className="max-w-7xl mx-auto px-2 sm:px-6 py-4 sm:py-6">
            <React.Suspense
              fallback={
                <PageLoadingFallback label="Đang nạp trình phát và dữ liệu tập phim..." />
              }
            >
              <WatchPage
                slug={route.slug}
                episodeSlug={route.episodeSlug}
                onBack={() => navigateTo(`/phim/${route.slug}`)}
                onNavigateEpisode={(slug, ep) =>
                  navigateTo(`/xem-phim/${slug}/${ep}`)
                }
                onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
              />
            </React.Suspense>
          </div>
        )}

        {/* Catalog Views (Category, Genre, Country, Year, Search) */}
        {(route.view === 'category' ||
          route.view === 'genre' ||
          route.view === 'country' ||
          route.view === 'year' ||
          route.view === 'search') && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <CatalogView
              title={getCatalogMeta().title}
              subtitle={getCatalogMeta().subtitle}
              movies={catalogMovies}
              paginate={catalogPaginate}
              filters={catalogFilters}
              isLoading={catalogLoading}
              onFilterChange={(newFilters) => setCatalogFilters(newFilters)}
              onFilterReset={() => setCatalogFilters({ page: 1 })}
              onPageChange={(page) =>
                setCatalogFilters((prev) => ({ ...prev, page }))
              }
              onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
            />
          </div>
        )}

        {/* Favorites View */}
        {route.view === 'favorites' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <MyListPage
              onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
              onBack={() => navigateTo('/')}
            />
          </div>
        )}

        {/* History View */}
        {route.view === 'history' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <HistoryPage
              onWatch={(slug, ep) =>
                navigateTo(`/xem-phim/${slug}/${ep || 'tap-1'}`)
              }
              onBack={() => navigateTo('/')}
            />
          </div>
        )}
        </ErrorBoundary>
      </main>

      {/* Footer */}
      <Footer onNavigate={navigateTo} />

      {/* Mobile Bottom Navigation Bar (sm:hidden) */}
      <MobileBottomNav currentPath={currentPath} onNavigate={navigateTo} />
    </div>
  );
}
