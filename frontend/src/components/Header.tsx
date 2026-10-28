import React, { useState, useEffect } from 'react';
import {
  Menu,
  X,
  Bookmark,
  History,
  ChevronDown,
} from 'lucide-react';
import { CATEGORIES, GENRES, COUNTRIES, YEARS, SITE_NAME, SITE_TAGLINE } from '../constants';
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
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const updateCounts = () => {
      setFavCount(getFavorites().length);
      setHistoryCount(getHistory().length);
    };
    updateCounts();
    window.addEventListener('storage', updateCounts);
    return () => window.removeEventListener('storage', updateCounts);
  }, [currentPath]);

  const handleNavClick = (path: string) => {
    onNavigate(path);
    setMobileMenuOpen(false);
    setActiveDropdown(null);
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
        isScrolled
          ? 'bg-[#060b05]/95 backdrop-blur-xl border-b border-lime-500/20 py-2.5 shadow-[0_4px_30px_rgba(0,0,0,0.8)]'
          : 'bg-gradient-to-b from-[#060b05]/90 via-[#060b05]/60 to-transparent py-3.5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand Logo & Name */}
        <div
          onClick={() => handleNavClick('/')}
          className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group flex-shrink-0"
        >
          <div className="relative w-9 h-9 sm:w-11 sm:h-11 rounded-xl overflow-hidden p-0.5 bg-gradient-to-br from-lime-400 to-[#1e3a1b] shadow-[0_0_15px_rgba(132,204,22,0.4)] group-hover:shadow-[0_0_22px_rgba(132,204,22,0.6)] transition-all">
            <img
              src="/logo.png"
              alt="Bơ Film Avocado Cinema"
              className="w-full h-full object-cover rounded-[10px] transform group-hover:scale-105 transition-transform duration-300"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-lg sm:text-2xl font-black tracking-tight text-[#f4fbf0] group-hover:text-lime-300 transition-colors flex items-center gap-1.5">
              <span>{SITE_NAME}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse" />
            </span>
            <span className="text-[9px] sm:text-[10px] font-bold text-lime-400/90 tracking-widest uppercase">
              Avocado Cinema
            </span>
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1 xl:gap-2 text-xs xl:text-sm font-semibold text-[#d4ebd2] flex-shrink-0">
          <button
            onClick={() => handleNavClick('/')}
            className={`px-2 xl:px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 whitespace-nowrap ${
              currentPath === '/' ? 'text-lime-300 bg-lime-950/60 font-bold border border-lime-500/30' : 'hover:text-lime-300 hover:bg-lime-950/30'
            }`}
          >
            Trang Chủ
          </button>

          <button
            onClick={() => handleNavClick('/danh-sach/phim-bo')}
            className={`px-2 xl:px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 whitespace-nowrap ${
              currentPath === '/danh-sach/phim-bo' ? 'text-lime-300 bg-lime-950/60 font-bold border border-lime-500/30' : 'hover:text-lime-300 hover:bg-lime-950/30'
            }`}
          >
            Phim Bộ
          </button>

          <button
            onClick={() => handleNavClick('/danh-sach/phim-le')}
            className={`px-2 xl:px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 whitespace-nowrap ${
              currentPath === '/danh-sach/phim-le' ? 'text-lime-300 bg-lime-950/60 font-bold border border-lime-500/30' : 'hover:text-lime-300 hover:bg-lime-950/30'
            }`}
          >
            Phim Lẻ
          </button>

          <button
            onClick={() => handleNavClick('/danh-sach/tv-shows')}
            className={`px-2 xl:px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 whitespace-nowrap ${
              currentPath === '/danh-sach/tv-shows' ? 'text-lime-300 bg-lime-950/60 font-bold border border-lime-500/30' : 'hover:text-lime-300 hover:bg-lime-950/30'
            }`}
          >
            TV Shows
          </button>

          {/* Thể Loại Dropdown */}
          <div
            className="relative flex-shrink-0"
            onMouseEnter={() => setActiveDropdown('genres')}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button className="flex items-center gap-1 px-2 xl:px-3 py-1.5 rounded-lg hover:text-lime-300 hover:bg-lime-950/30 transition-colors flex-shrink-0 whitespace-nowrap">
              <span>Thể Loại</span>
              <ChevronDown className="w-3.5 h-3.5 text-lime-400" />
            </button>
            {activeDropdown === 'genres' && (
              <div className="absolute top-full right-0 mt-1 w-80 p-3 bg-[#071307] border border-lime-500/30 rounded-2xl shadow-2xl backdrop-blur-2xl grid grid-cols-2 gap-1 z-50 animate-in fade-in duration-150">
                {GENRES.map((g) => (
                  <button
                    key={g.slug}
                    onClick={() => handleNavClick(`/the-loai/${g.slug}`)}
                    className="text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#cbe1c8] hover:bg-lime-500/20 hover:text-lime-300 transition-colors truncate"
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quốc Gia Dropdown */}
          <div
            className="relative flex-shrink-0"
            onMouseEnter={() => setActiveDropdown('countries')}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button className="flex items-center gap-1 px-2 xl:px-3 py-1.5 rounded-lg hover:text-lime-300 hover:bg-lime-950/30 transition-colors flex-shrink-0 whitespace-nowrap">
              <span>Quốc Gia</span>
              <ChevronDown className="w-3.5 h-3.5 text-lime-400" />
            </button>
            {activeDropdown === 'countries' && (
              <div className="absolute top-full right-0 mt-1 w-64 p-3 bg-[#071307] border border-lime-500/30 rounded-2xl shadow-2xl backdrop-blur-2xl grid grid-cols-2 gap-1 z-50 animate-in fade-in duration-150">
                {COUNTRIES.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => handleNavClick(`/quoc-gia/${c.slug}`)}
                    className="text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#cbe1c8] hover:bg-lime-500/20 hover:text-lime-300 transition-colors truncate"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Năm Dropdown */}
          <div
            className="relative flex-shrink-0"
            onMouseEnter={() => setActiveDropdown('years')}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button className="flex items-center gap-1 px-2 xl:px-3 py-1.5 rounded-lg hover:text-lime-300 hover:bg-lime-950/30 transition-colors flex-shrink-0 whitespace-nowrap">
              <span>Năm</span>
              <ChevronDown className="w-3.5 h-3.5 text-lime-400" />
            </button>
            {activeDropdown === 'years' && (
              <div className="absolute top-full right-0 mt-1 w-48 p-2.5 bg-[#071307] border border-lime-500/30 rounded-2xl shadow-2xl backdrop-blur-2xl grid grid-cols-3 gap-1 z-50 animate-in fade-in duration-150">
                {YEARS.map((y) => (
                  <button
                    key={y}
                    onClick={() => handleNavClick(`/nam-phat-hanh/${y}`)}
                    className="text-center px-2 py-1.5 rounded-lg text-xs font-medium text-[#cbe1c8] hover:bg-lime-500/20 hover:text-lime-300 transition-colors"
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Live Search & Utility Links */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-initial justify-end">
          <div className="w-full max-w-[200px] sm:max-w-[240px] md:max-w-[280px]">
            <LiveSearch onSelectMovie={(slug) => handleNavClick(`/phim/${slug}`)} />
          </div>

          {/* Yêu thích Button */}
          <button
            onClick={() => handleNavClick('/yeu-thich')}
            title="Phim Yêu Thích"
            aria-label="Phim Yêu Thích"
            className="relative min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-lime-950/40 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-500/40 transition-colors hidden sm:flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
          >
            <Bookmark className="w-4 h-4" />
            {favCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-lime-500 text-black text-[10px] font-extrabold shadow-sm">
                {favCount}
              </span>
            )}
          </button>

          {/* Lịch sử Button */}
          <button
            onClick={() => handleNavClick('/lich-su')}
            title="Lịch Sử Xem Phim"
            aria-label="Lịch Sử Xem Phim"
            className="relative min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-lime-950/40 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-500/40 transition-colors hidden sm:flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
          >
            <History className="w-4 h-4" />
            {historyCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-lime-500 text-black text-[10px] font-extrabold shadow-sm">
                {historyCount}
              </span>
            )}
          </button>

          {/* Mobile Hamburger Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-xl bg-lime-950/40 border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 lg:hidden flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
            aria-label={mobileMenuOpen ? 'Đóng Menu Di Động' : 'Mở Menu Di Động'}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Slide-in Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 top-[56px] z-50 bg-[#060b05]/98 backdrop-blur-2xl border-t border-lime-500/20 p-5 overflow-y-auto space-y-6 animate-in slide-in-from-top-4 duration-200">
          <div className="space-y-2">
            <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
              Danh Mục Phim
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleNavClick('/')}
                className="text-left p-3 rounded-xl bg-lime-950/40 border border-lime-500/20 text-sm font-semibold text-[#f4fbf0]"
              >
                Trang Chủ
              </button>
              <button
                onClick={() => handleNavClick('/danh-sach/phim-bo')}
                className="text-left p-3 rounded-xl bg-lime-950/40 border border-lime-500/20 text-sm font-semibold text-[#f4fbf0]"
              >
                Phim Bộ
              </button>
              <button
                onClick={() => handleNavClick('/danh-sach/phim-le')}
                className="text-left p-3 rounded-xl bg-lime-950/40 border border-lime-500/20 text-sm font-semibold text-[#f4fbf0]"
              >
                Phim Lẻ
              </button>
              <button
                onClick={() => handleNavClick('/danh-sach/tv-shows')}
                className="text-left p-3 rounded-xl bg-lime-950/40 border border-lime-500/20 text-sm font-semibold text-[#f4fbf0]"
              >
                TV Shows
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
              Thể Loại
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {GENRES.map((g) => (
                <button
                  key={g.slug}
                  onClick={() => handleNavClick(`/the-loai/${g.slug}`)}
                  className="p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-xs text-[#cbe1c8] hover:text-lime-300 truncate"
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
              Quốc Gia
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {COUNTRIES.map((c) => (
                <button
                  key={c.slug}
                  onClick={() => handleNavClick(`/quoc-gia/${c.slug}`)}
                  className="p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-xs text-[#cbe1c8] hover:text-lime-300 truncate"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
