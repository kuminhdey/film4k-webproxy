import React, { useState, useEffect } from 'react';
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
import { HeroBanner, HeroBannerSkeleton } from './components/HeroBanner';
import { MovieCard } from './components/MovieCard';
import { MovieTableView } from './components/MovieTableView';
import { CatalogView } from './components/CatalogView';
import { MyListPage } from './components/MyListPage';
import { HistoryPage } from './components/HistoryPage';
import { ContinueWatchingRow } from './components/ContinueWatchingRow';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getHome, getMovies } from './api';
import { HomeResponse, MovieItem, Paginate, FilterOptions } from './types';
import { CATEGORIES, GENRES, COUNTRIES } from './constants';

// Code-splitting (PERF-01): Lazy load heavy route components to keep initial index bundle small
const MovieDetailPage = React.lazy(() =>
  import('./components/MovieDetailPage').then((m) => ({ default: m.MovieDetailPage }))
);
const WatchPage = React.lazy(() =>
  import('./components/WatchPage').then((m) => ({ default: m.WatchPage }))
);
const AdminDashboard = React.lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);

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
  server?: number;
}

function parseRoute(): RouteState {
  const path = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);
  const serverParam = searchParams.get('server');
  const parsedServer =
    serverParam !== null && /^\d+$/.test(serverParam)
      ? parseInt(serverParam, 10)
      : undefined;

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

  const watchMatch =
    path.match(/^\/xem-phim\/([^/]+)(?:\/([^/]+))?/) ||
    path.match(/^\/watch\/([^/]+)(?:\/([^/]+))?/);
  if (watchMatch) {
    return {
      view: 'watch',
      slug: watchMatch[1],
      episodeSlug: watchMatch[2],
      server: parsedServer,
    };
  }

  const detailMatch =
    path.match(/^\/phim\/([^/]+)/) || path.match(/^\/movie\/([^/]+)/);
  if (detailMatch) {
    return {
      view: 'detail',
      slug: detailMatch[1],
      server: parsedServer,
    };
  }

  const catMatch = path.match(/^\/danh-sach\/([^/]+)/);
  if (catMatch) {
    return { view: 'category', slug: catMatch[1] };
  }

  const genreMatch = path.match(/^\/the-loai\/([^/]+)/);
  if (genreMatch) {
    return { view: 'genre', slug: genreMatch[1] };
  }

  const countryMatch = path.match(/^\/quoc-gia\/([^/]+)/);
  if (countryMatch) {
    return { view: 'country', slug: countryMatch[1] };
  }

  const yearMatch = path.match(/^\/nam-phat-hanh\/([^/]+)/);
  if (yearMatch) {
    return { view: 'year', slug: yearMatch[1] };
  }

  return { view: 'home' };
}

function buildFiltersFromRoute(r: RouteState): FilterOptions {
  return {
    page: 1,
    category:
      r.view === 'category' && r.slug && r.slug !== 'phim-moi' ? r.slug : undefined,
    genre: r.view === 'genre' ? r.slug : undefined,
    country: r.view === 'country' ? r.slug : undefined,
    year: r.view === 'year' ? r.slug : undefined,
    keyword: r.view === 'search' ? r.keyword : undefined,
    sort: 'latest',
  };
}

// Hoisted route loading fallback component (`MED-11`: never declare inside App render)
function PageLoadingFallback({ label = 'Đang tải nội dung...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[125svh] py-16 px-4">
      <div className="relative flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-lime-500/20 border-t-lime-400 animate-spin" />
        <Film className="w-5 h-5 text-lime-400 absolute" />
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-widest text-[#9ab395] animate-pulse">
        {label}
      </p>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(parseRoute);
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);
  const [homeData, setHomeData] = useState<HomeResponse | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);

  const [latestViewMode, setLatestViewMode] = useState<'grid' | 'table'>('grid');

  const [catalogMovies, setCatalogMovies] = useState<MovieItem[]>([]);
  const [catalogPaginate, setCatalogPaginate] = useState<Paginate | undefined>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [catalogFilters, setCatalogFilters] = useState<FilterOptions>(() =>
    buildFiltersFromRoute(parseRoute())
  );

  // Client-side SPA Navigation (resets catalog pagination & syncs filters to target route)
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(window.location.pathname);
    const nextRoute = parseRoute();
    setRoute(nextRoute);
    setCatalogFilters(buildFiltersFromRoute(nextRoute));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLinkClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    path: string
  ) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey
    ) {
      return;
    }
    e.preventDefault();
    navigateTo(path);
  };

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
      const nextRoute = parseRoute();
      setRoute(nextRoute);
      setCatalogFilters(buildFiltersFromRoute(nextRoute));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Load Home Data on initial mount
  useEffect(() => {
    getHome()
      .then((data) => {
        if (data) {
          setHomeData(data);
        }
        setHomeLoading(false);
      })
      .catch(() => {
        setHomeLoading(false);
      });
  }, []);

  // Keep URL & Route synchronized when user adjusts FilterBar on a single-dimension catalog URL
  const handleCatalogFilterChange = (newFilters: FilterOptions) => {
    setCatalogFilters(newFilters);

    const hasSubFilters = Boolean(
      newFilters.genre || newFilters.country || newFilters.year || newFilters.keyword
    );
    if (!hasSubFilters && newFilters.category && route.view !== 'search') {
      const targetPath = `/danh-sach/${newFilters.category}`;
      if (window.location.pathname !== targetPath) {
        window.history.replaceState({}, '', targetPath);
        setCurrentPath(targetPath);
        setRoute({ view: 'category', slug: newFilters.category });
      }
    } else if (
      (route.view === 'category' && route.slug !== 'phim-moi' && newFilters.category !== route.slug) ||
      (route.view === 'genre' && newFilters.genre !== route.slug) ||
      (route.view === 'country' && newFilters.country !== route.slug) ||
      (route.view === 'year' && newFilters.year !== route.slug)
    ) {
      const fallbackPath = '/danh-sach/phim-moi';
      window.history.replaceState({}, '', fallbackPath);
      setCurrentPath(fallbackPath);
      setRoute({ view: 'category', slug: 'phim-moi' });
    }
  };

  const handleCatalogFilterReset = () => {
    const resetPath = '/danh-sach/phim-moi';
    window.history.replaceState({}, '', resetPath);
    setCurrentPath(resetPath);
    setRoute({ view: 'category', slug: 'phim-moi' });
    setCatalogFilters({ page: 1, sort: 'latest' });
  };

  const isCatalogRoute =
    route.view === 'category' ||
    route.view === 'genre' ||
    route.view === 'country' ||
    route.view === 'year' ||
    route.view === 'search';

  // Load Catalog Data using unified `catalogFilters` state
  useEffect(() => {
    let cancelled = false;
    if (isCatalogRoute) {
      setCatalogLoading(true);
      setCatalogError(false);
      setCatalogMovies([]);
      setCatalogPaginate(undefined);

      const params: FilterOptions = {
        page: catalogFilters.page || 1,
        category: catalogFilters.category,
        genre: catalogFilters.genre,
        country: catalogFilters.country,
        year: catalogFilters.year,
        sort: catalogFilters.sort || 'latest',
        keyword: catalogFilters.keyword,
      };

      getMovies(params)
        .then((res) => {
          if (cancelled) return;
          if (res) {
            setCatalogMovies(res.items || []);
            setCatalogPaginate(res.paginate);
          } else {
            setCatalogMovies([]);
            setCatalogPaginate(undefined);
            setCatalogError(true);
          }
          setCatalogLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setCatalogMovies([]);
          setCatalogPaginate(undefined);
          setCatalogError(true);
          setCatalogLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [isCatalogRoute, catalogFilters, catalogRetry]);

  // Catalog Title Generator
  const getCatalogMeta = () => {
    if (catalogFilters.keyword) {
      return {
        title: `Kết Quả Tìm Kiếm: "${catalogFilters.keyword}"`,
        subtitle: 'Các bộ phim phù hợp với từ khóa của bạn',
      };
    }
    if (catalogFilters.category) {
      const cat = CATEGORIES.find((c) => c.slug === catalogFilters.category);
      if (cat) {
        return {
          title: cat.name,
          subtitle: cat.description,
        };
      }
    }
    if (route.view === 'category') {
      const cat = CATEGORIES.find((c) => c.slug === route.slug);
      return {
        title: cat?.name || 'Phim Mới Cập Nhật',
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

  if (route.view === 'admin') {
    return (
      <React.Suspense fallback={<PageLoadingFallback label="Đang tải trang quản trị..." />}>
        <AdminDashboard onNavigate={navigateTo} />
      </React.Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-[#060b05] text-[#f4fbf0] flex flex-col selection:bg-lime-500 selection:text-black">
      {/* Accessible Skip-to-Main Link (`LOW-08`) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:px-4 focus:py-2.5 focus:rounded-xl focus:bg-lime-500 focus:text-black focus:font-extrabold focus:text-xs focus:shadow-lg"
      >
        Bỏ qua điều hướng tới nội dung chính
      </a>

      {/* Header */}
      <Header currentPath={currentPath} onNavigate={navigateTo} />

      {/* Main Body Content */}
      <main id="main-content" className="flex-1 pt-14 pb-20 sm:pb-0">
        <ErrorBoundary fallbackTitle="Không thể tải nội dung trang">
          {route.view === 'home' && (
            <div className="space-y-10 sm:space-y-12">
              {/* Hero Spotlight Banner or Fixed-Height Skeleton (`CRIT-08`: zero CLS jump) */}
              {homeLoading && !homeData ? (
                <HeroBannerSkeleton />
              ) : (
                homeData?.hero_banners &&
                homeData.hero_banners.length > 0 && (
                  <HeroBanner
                    movies={homeData.hero_banners}
                    onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
                    onWatchMovie={(slug, epSlug) =>
                      navigateTo(`/xem-phim/${slug}/${epSlug || 'tap-1'}`)
                    }
                  />
                )
              )}

              {/* Continue Watching Shelf */}
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
                <div className="py-20 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-10 h-10 text-lime-400 animate-spin mb-3" />
                  <p className="text-sm font-semibold text-[#9ab395]">
                    Đang tải rạp chiếu Bơ Film Avocado Cinema...
                  </p>
                </div>
              ) : (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12">
                  {/* Section 1: Phim Mới Cập Nhật */}
                  <section className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-lime-500/20 pb-3">
                      <div className="flex items-center gap-2.5">
                        <Flame className="w-5 h-5 text-lime-400" />
                        <h2 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] uppercase tracking-wide">
                          Phim Mới Cập Nhật
                        </h2>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                        <div className="flex items-center gap-1.5 bg-[#071307] p-1 rounded-xl border border-lime-500/20">
                          <button
                            type="button"
                            onClick={() => setLatestViewMode('grid')}
                            aria-pressed={latestViewMode === 'grid'}
                            className={`min-h-[38px] flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              latestViewMode === 'grid'
                                ? 'bg-lime-500 text-black shadow-sm'
                                : 'text-[#9ab395] hover:text-[#d8ebd5]'
                            }`}
                          >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            <span>Grid View</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setLatestViewMode('table')}
                            aria-pressed={latestViewMode === 'table'}
                            className={`min-h-[38px] flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              latestViewMode === 'table'
                                ? 'bg-lime-500 text-black shadow-sm'
                                : 'text-[#9ab395] hover:text-[#d8ebd5]'
                            }`}
                          >
                            <List className="w-3.5 h-3.5" />
                            <span>Table View</span>
                          </button>
                        </div>

                        <a
                          href="/danh-sach/phim-moi"
                          onClick={(e) => handleLinkClick(e, '/danh-sach/phim-moi')}
                          className="min-h-[38px] px-2 inline-flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors cursor-pointer"
                        >
                          <span>Xem thêm</span>
                          <ChevronRight className="w-4 h-4" />
                        </a>
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
                          <h2 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] uppercase tracking-wide">
                            Phim Bộ Đang Hot
                          </h2>
                        </div>
                        <a
                          href="/danh-sach/phim-bo"
                          onClick={(e) => handleLinkClick(e, '/danh-sach/phim-bo')}
                          className="min-h-[38px] px-2 inline-flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors cursor-pointer"
                        >
                          <span>Xem thêm</span>
                          <ChevronRight className="w-4 h-4" />
                        </a>
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
                          <h2 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] uppercase tracking-wide">
                            Phim Lẻ Chiếu Rạp
                          </h2>
                        </div>
                        <a
                          href="/danh-sach/phim-le"
                          onClick={(e) => handleLinkClick(e, '/danh-sach/phim-le')}
                          className="min-h-[38px] px-2 inline-flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors cursor-pointer"
                        >
                          <span>Xem thêm</span>
                          <ChevronRight className="w-4 h-4" />
                        </a>
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

                  {/* Section 4: TV Shows (hidden cleanly when empty instead of cloning Phim Bộ) */}
                  {homeData?.tv_shows && homeData.tv_shows.length > 0 && (
                    <section className="space-y-4">
                      <div className="flex items-center justify-between border-b border-lime-500/20 pb-3">
                        <div className="flex items-center gap-2.5">
                          <Sparkles className="w-5 h-5 text-lime-400" />
                          <h2 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] uppercase tracking-wide">
                            TV Shows &amp; Gameshow
                          </h2>
                        </div>
                        <a
                          href="/danh-sach/tv-shows"
                          onClick={(e) => handleLinkClick(e, '/danh-sach/tv-shows')}
                          className="min-h-[38px] px-2 inline-flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors cursor-pointer"
                        >
                          <span>Xem thêm</span>
                          <ChevronRight className="w-4 h-4" />
                        </a>
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

                  {/* Section 5: Hoạt Hình & Anime (renders real Anime items or hides cleanly) */}
                  {homeData?.anime && homeData.anime.length > 0 && (
                    <section className="space-y-4">
                      <div className="flex items-center justify-between border-b border-lime-500/20 pb-3">
                        <div className="flex items-center gap-2.5">
                          <Film className="w-5 h-5 text-lime-400" />
                          <h2 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] uppercase tracking-wide">
                            Hoạt Hình &amp; Anime Đặc Sắc
                          </h2>
                        </div>
                        <a
                          href="/the-loai/hoat-hinh"
                          onClick={(e) => handleLinkClick(e, '/the-loai/hoat-hinh')}
                          className="min-h-[38px] px-2 inline-flex items-center gap-1 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors cursor-pointer"
                        >
                          <span>Xem thêm</span>
                          <ChevronRight className="w-4 h-4" />
                        </a>
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
              <React.Suspense
                fallback={<PageLoadingFallback label="Đang tải thông tin chi tiết phim..." />}
              >
                <MovieDetailPage
                  slug={route.slug}
                  initialServerIndex={route.server}
                  onBack={() => navigateTo('/')}
                  onWatch={(slug, ep, server) => {
                    const sParam =
                      typeof server === 'number' && server > 0 ? `?server=${server}` : '';
                    navigateTo(`/xem-phim/${slug}/${ep || 'tap-1'}${sParam}`);
                  }}
                  onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
                />
              </React.Suspense>
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
                  initialServerIndex={route.server}
                  onBack={() => {
                    const sParam =
                      typeof route.server === 'number' && route.server > 0
                        ? `?server=${route.server}`
                        : '';
                    navigateTo(`/phim/${route.slug}${sParam}`);
                  }}
                  onNavigateEpisode={(slug, ep, server) => {
                    const sParam =
                      typeof server === 'number' && server > 0
                        ? `?server=${server}`
                        : '';
                    navigateTo(`/xem-phim/${slug}/${ep}${sParam}`);
                  }}
                  onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
                />
              </React.Suspense>
            </div>
          )}

          {/* Catalog Views (Category, Genre, Country, Year, Search) */}
          {isCatalogRoute && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
              <CatalogView
                title={getCatalogMeta().title}
                subtitle={getCatalogMeta().subtitle}
                movies={catalogMovies}
                paginate={catalogPaginate}
                filters={{
                  ...catalogFilters,
                  keyword:
                    route.view === 'search'
                      ? route.keyword
                      : catalogFilters.keyword,
                }}
                isLoading={catalogLoading}
                error={catalogError}
                onRetry={() => setCatalogRetry((value) => value + 1)}
                onFilterChange={handleCatalogFilterChange}
                onFilterReset={handleCatalogFilterReset}
                onPageChange={(page) =>
                  setCatalogFilters((prev) => ({ ...prev, page }))
                }
                onSelectMovie={(slug) => navigateTo(`/phim/${slug}`)}
                onNavigateHome={() => navigateTo('/')}
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
                onWatch={(slug, ep) => navigateTo(`/xem-phim/${slug}/${ep || 'tap-1'}`)}
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
