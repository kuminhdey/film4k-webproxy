import React, { useState, useEffect } from 'react';
import {
  Menu,
  X,
  Bookmark,
  History,
  ChevronDown,
} from 'lucide-react';
import { GENRES, COUNTRIES, YEARS, SITE_NAME } from '../constants';
import { getFavorites, getHistory } from '../utils';
import LiveSearch from './LiveSearch';

interface HeaderProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentPath, onNavigate }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [favCount, setFavCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const updateCounts = () => {
      setFavCount(getFavorites().length);
      setHistoryCount(getHistory().length);
    };
    updateCounts();
    window.addEventListener('storage', updateCounts);
    window.addEventListener('bofilm_favorites_update', updateCounts);
    window.addEventListener('bofilm_history_update', updateCounts);
    return () => {
      window.removeEventListener('storage', updateCounts);
      window.removeEventListener('bofilm_favorites_update', updateCounts);
      window.removeEventListener('bofilm_history_update', updateCounts);
    };
  }, [currentPath]);

  const handleNavClick = (
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
    onNavigate(path);
    setMobileMenuOpen(false);
    setActiveDropdown(null);
  };

  const navigateDirect = (path: string) => {
    onNavigate(path);
    setMobileMenuOpen(false);
    setActiveDropdown(null);
  };

  const navLinks = [
    { label: 'Trang Chủ', path: '/' },
    { label: 'Phim Bộ', path: '/danh-sach/phim-bo' },
    { label: 'Phim Lẻ', path: '/danh-sach/phim-le' },
    { label: 'TV Shows', path: '/danh-sach/tv-shows' },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
        isScrolled
          ? 'bg-[#060b05]/95 backdrop-blur-xl border-b border-lime-500/20 py-2.5 shadow-[0_4px_30px_rgba(0,0,0,0.8)]'
          : 'bg-gradient-to-b from-[#060b05]/90 via-[#060b05]/60 to-transparent py-3'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand Logo & Name */}
        <a
          href="/"
          onClick={(e) => handleNavClick(e, '/')}
          aria-current={currentPath === '/' ? 'page' : undefined}
          className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group flex-shrink-0 text-left focus-visible:ring-2 focus-visible:ring-lime-400 rounded-xl min-h-[44px]"
        >
          <div className="relative w-9 h-9 sm:w-11 sm:h-11 rounded-xl overflow-hidden p-0.5 bg-gradient-to-br from-lime-400 to-[#1e3a1b] shadow-[0_0_12px_rgba(132,204,22,0.3)] group-hover:shadow-[0_0_18px_rgba(132,204,22,0.45)] transition-all">
            <img
              src="/logo.png"
              alt="Bơ Film Avocado Cinema"
              width={44}
              height={44}
              decoding="async"
              className="w-full h-full object-cover rounded-[10px] transform group-hover:scale-105 transition-transform duration-300"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-lg sm:text-2xl font-extrabold tracking-tight text-[#f4fbf0] group-hover:text-lime-300 transition-colors flex items-center gap-1.5">
              <span>{SITE_NAME}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-lime-400" />
            </span>
            <span className="text-[11px] font-bold text-lime-400/90 tracking-wider uppercase leading-tight">
              Avocado Cinema
            </span>
          </div>
        </a>

        {/* Desktop Navigation */}
        <nav
          aria-label="Điều hướng chính"
          className="hidden lg:flex items-center gap-1 xl:gap-1.5 text-xs xl:text-sm font-semibold text-[#d4ebd2] flex-shrink-0"
        >
          {navLinks.map((link) => {
            const isActive = currentPath === link.path;
            return (
              <a
                key={link.path}
                href={link.path}
                onClick={(e) => handleNavClick(e, link.path)}
                aria-current={isActive ? 'page' : undefined}
                className={`min-h-[38px] inline-flex items-center px-2.5 xl:px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 whitespace-nowrap ${
                  isActive
                    ? 'text-lime-300 bg-lime-950/60 font-bold border border-lime-500/30'
                    : 'hover:text-lime-300 hover:bg-lime-950/30'
                }`}
              >
                {link.label}
              </a>
            );
          })}

          {/* Thể Loại Dropdown */}
          <div
            className="relative flex-shrink-0"
            onMouseEnter={() => setActiveDropdown('genres')}
            onMouseLeave={() => setActiveDropdown(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setActiveDropdown(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setActiveDropdown(null);
                (event.currentTarget.querySelector('button') as HTMLButtonElement | null)?.focus();
              }
            }}
          >
            <button
              type="button"
              aria-expanded={activeDropdown === 'genres'}
              aria-haspopup="true"
              onClick={() => setActiveDropdown(activeDropdown === 'genres' ? null : 'genres')}
              className="min-h-[38px] flex items-center gap-1 px-2.5 xl:px-3 py-1.5 rounded-lg hover:text-lime-300 hover:bg-lime-950/30 transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer"
            >
              <span>Thể Loại</span>
              <ChevronDown className="w-3.5 h-3.5 text-lime-400" />
            </button>
            {activeDropdown === 'genres' && (
              <div className="absolute top-full right-0 mt-1 w-80 p-3 bg-[#071307] border border-lime-500/30 rounded-2xl shadow-2xl backdrop-blur-2xl grid grid-cols-2 gap-1 z-50 animate-in fade-in duration-150">
                {GENRES.map((g) => {
                  const path = `/the-loai/${g.slug}`;
                  const isActive = currentPath === path;
                  return (
                    <a
                      key={g.slug}
                      href={path}
                      onClick={(e) => handleNavClick(e, path)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`min-h-[36px] flex items-center text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors truncate ${
                        isActive
                          ? 'bg-lime-500/20 text-lime-300 font-bold'
                          : 'text-[#cbe1c8] hover:bg-lime-500/20 hover:text-lime-300'
                      }`}
                    >
                      {g.name}
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quốc Gia Dropdown */}
          <div
            className="relative flex-shrink-0"
            onMouseEnter={() => setActiveDropdown('countries')}
            onMouseLeave={() => setActiveDropdown(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setActiveDropdown(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setActiveDropdown(null);
                (event.currentTarget.querySelector('button') as HTMLButtonElement | null)?.focus();
              }
            }}
          >
            <button
              type="button"
              aria-expanded={activeDropdown === 'countries'}
              aria-haspopup="true"
              onClick={() => setActiveDropdown(activeDropdown === 'countries' ? null : 'countries')}
              className="min-h-[38px] flex items-center gap-1 px-2.5 xl:px-3 py-1.5 rounded-lg hover:text-lime-300 hover:bg-lime-950/30 transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer"
            >
              <span>Quốc Gia</span>
              <ChevronDown className="w-3.5 h-3.5 text-lime-400" />
            </button>
            {activeDropdown === 'countries' && (
              <div className="absolute top-full right-0 mt-1 w-64 p-3 bg-[#071307] border border-lime-500/30 rounded-2xl shadow-2xl backdrop-blur-2xl grid grid-cols-2 gap-1 z-50 animate-in fade-in duration-150">
                {COUNTRIES.map((c) => {
                  const path = `/quoc-gia/${c.slug}`;
                  const isActive = currentPath === path;
                  return (
                    <a
                      key={c.slug}
                      href={path}
                      onClick={(e) => handleNavClick(e, path)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`min-h-[36px] flex items-center text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors truncate ${
                        isActive
                          ? 'bg-lime-500/20 text-lime-300 font-bold'
                          : 'text-[#cbe1c8] hover:bg-lime-500/20 hover:text-lime-300'
                      }`}
                    >
                      {c.name}
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Năm Dropdown */}
          <div
            className="relative flex-shrink-0"
            onMouseEnter={() => setActiveDropdown('years')}
            onMouseLeave={() => setActiveDropdown(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setActiveDropdown(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setActiveDropdown(null);
                (event.currentTarget.querySelector('button') as HTMLButtonElement | null)?.focus();
              }
            }}
          >
            <button
              type="button"
              aria-expanded={activeDropdown === 'years'}
              aria-haspopup="true"
              onClick={() => setActiveDropdown(activeDropdown === 'years' ? null : 'years')}
              className="min-h-[38px] flex items-center gap-1 px-2.5 xl:px-3 py-1.5 rounded-lg hover:text-lime-300 hover:bg-lime-950/30 transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer"
            >
              <span>Năm</span>
              <ChevronDown className="w-3.5 h-3.5 text-lime-400" />
            </button>
            {activeDropdown === 'years' && (
              <div className="absolute top-full right-0 mt-1 w-48 p-2.5 bg-[#071307] border border-lime-500/30 rounded-2xl shadow-2xl backdrop-blur-2xl grid grid-cols-3 gap-1 z-50 animate-in fade-in duration-150">
                {YEARS.map((y) => {
                  const path = `/nam-phat-hanh/${y}`;
                  const isActive = currentPath === path;
                  return (
                    <a
                      key={y}
                      href={path}
                      onClick={(e) => handleNavClick(e, path)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`min-h-[36px] flex items-center justify-center text-center px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-lime-500/20 text-lime-300 font-bold'
                          : 'text-[#cbe1c8] hover:bg-lime-500/20 hover:text-lime-300'
                      }`}
                    >
                      {y}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Live Search & Utility Links (`< 640px` uses MobileBottomNav for Search/Explore to avoid cramming) */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-initial justify-end">
          <div className="hidden sm:block w-full max-w-[240px] md:max-w-[280px]">
            <LiveSearch onSelectMovie={(slug) => navigateDirect(`/phim/${slug}`)} />
          </div>

          {/* Yêu thích Link */}
          <a
            href="/yeu-thich"
            onClick={(e) => handleNavClick(e, '/yeu-thich')}
            title="Phim Yêu Thích"
            aria-label={`Phim Yêu Thích${favCount > 0 ? ` (${favCount})` : ''}`}
            aria-current={currentPath === '/yeu-thich' ? 'page' : undefined}
            className="relative min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-lime-950/40 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-500/40 transition-colors flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
          >
            <Bookmark className="w-4 h-4" />
            {favCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-lime-500 text-black text-[11px] leading-none font-extrabold shadow-sm tabular-nums">
                {favCount}
              </span>
            )}
          </a>

          {/* Lịch sử Link */}
          <a
            href="/lich-su"
            onClick={(e) => handleNavClick(e, '/lich-su')}
            title="Lịch Sử Xem Phim"
            aria-label={`Lịch Sử Xem Phim${historyCount > 0 ? ` (${historyCount})` : ''}`}
            aria-current={currentPath === '/lich-su' ? 'page' : undefined}
            className="relative min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-lime-950/40 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-500/40 transition-colors hidden sm:flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
          >
            <History className="w-4 h-4" />
            {historyCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-lime-500 text-black text-[11px] leading-none font-extrabold shadow-sm tabular-nums">
                {historyCount}
              </span>
            )}
          </a>

          {/* Tablet Hamburger Toggle (640px - 1023px; `< 640px` uses MobileBottomNav) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-lime-950/40 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hidden sm:flex lg:hidden items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400 cursor-pointer"
            aria-label={mobileMenuOpen ? 'Đóng Menu Điều Hướng' : 'Mở Menu Điều Hướng'}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Tablet Slide-in Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 top-[60px] z-50 bg-[#060b05]/98 backdrop-blur-2xl border-t border-lime-500/20 p-5 overflow-y-auto space-y-6 animate-in slide-in-from-top-4 duration-200">
          <div className="space-y-2">
            <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
              Danh Mục Phim
            </span>
            <div className="grid grid-cols-2 gap-2">
              {navLinks.map((link) => (
                <a
                  key={link.path}
                  href={link.path}
                  onClick={(e) => handleNavClick(e, link.path)}
                  aria-current={currentPath === link.path ? 'page' : undefined}
                  className="min-h-[44px] flex items-center text-left p-3 rounded-xl bg-lime-950/40 border border-lime-500/20 text-sm font-semibold text-[#f4fbf0] hover:text-lime-300"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
              Thể Loại
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {GENRES.map((g) => {
                const path = `/the-loai/${g.slug}`;
                return (
                  <a
                    key={g.slug}
                    href={path}
                    onClick={(e) => handleNavClick(e, path)}
                    aria-current={currentPath === path ? 'page' : undefined}
                    className="min-h-[44px] flex items-center justify-center p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-xs text-[#cbe1c8] hover:text-lime-300 truncate"
                  >
                    {g.name}
                  </a>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
              Quốc Gia
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {COUNTRIES.map((c) => {
                const path = `/quoc-gia/${c.slug}`;
                return (
                  <a
                    key={c.slug}
                    href={path}
                    onClick={(e) => handleNavClick(e, path)}
                    aria-current={currentPath === path ? 'page' : undefined}
                    className="min-h-[44px] flex items-center justify-center p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-xs text-[#cbe1c8] hover:text-lime-300 truncate"
                  >
                    {c.name}
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
