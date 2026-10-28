import React, { useState } from 'react';
import {
  Home,
  Compass,
  Search,
  Bookmark,
  History,
  X,
  ChevronRight,
} from 'lucide-react';
import LiveSearch from './LiveSearch';
import { CATEGORIES, GENRES, COUNTRIES } from '../constants';

interface MobileBottomNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentPath,
  onNavigate,
}) => {
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showExploreSheet, setShowExploreSheet] = useState(false);

  const navItems = [
    {
      label: 'Trang chủ',
      action: () => onNavigate('/'),
      icon: Home,
      isActive: currentPath === '/',
    },
    {
      label: 'Khám phá',
      action: () => setShowExploreSheet(true),
      icon: Compass,
      isActive: showExploreSheet || currentPath.startsWith('/danh-sach') || currentPath.startsWith('/the-loai'),
    },
    {
      label: 'Tìm kiếm',
      action: () => setShowSearchModal(true),
      icon: Search,
      isActive: showSearchModal || currentPath.startsWith('/tim-kiem'),
    },
    {
      label: 'Yêu thích',
      action: () => onNavigate('/yeu-thich'),
      icon: Bookmark,
      isActive: currentPath === '/yeu-thich',
    },
    {
      label: 'Lịch sử',
      action: () => onNavigate('/lich-su'),
      icon: History,
      isActive: currentPath === '/lich-su',
    },
  ];

  return (
    <>
      {/* Mobile Bottom Navigation Bar - Fixed on mobile (sm:hidden) */}
      <nav
        aria-label="Điều hướng di động dưới đáy màn hình"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#060b05]/95 backdrop-blur-xl border-t border-lime-500/20 px-2 py-1 shadow-[0_-8px_25px_rgba(0,0,0,0.8)]"
        style={{ paddingBottom: 'max(0.45rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-around">
          {navItems.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={item.action}
                aria-label={item.label}
                className="flex-1 flex justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 rounded-lg"
              >
                <span className="flex flex-col items-center justify-center py-1 px-2 relative min-w-[56px] min-h-[48px] touch-manipulation">
                  <Icon
                    className={`w-5 h-5 transition-transform duration-200 ${
                      item.isActive
                        ? 'text-lime-300 scale-110'
                        : 'text-[#9cb897] hover:text-[#d8ebd5]'
                    }`}
                  />
                  <span
                    className={`text-[10px] mt-1 font-semibold tracking-tight transition-colors ${
                      item.isActive ? 'text-lime-300 font-bold' : 'text-[#a8cca2]'
                    }`}
                  >
                    {item.label}
                  </span>
                  {item.isActive && (
                    <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-lime-400 shadow-[0_0_6px_#84cc16]" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Quick Search Modal for Mobile */}
      {showSearchModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col p-4 sm:hidden animate-in fade-in duration-200"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-black text-[#f4fbf0] flex items-center gap-2">
              <Search className="w-5 h-5 text-lime-400" />
              <span>Tìm Kiếm Phim</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowSearchModal(false)}
              aria-label="Đóng cửa sổ tìm kiếm"
              className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-lime-950/50 border border-lime-500/30 text-[#d4ebd2] hover:text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="w-full">
            <LiveSearch
              onSelectMovie={(slug) => {
                setShowSearchModal(false);
                onNavigate(`/phim/${slug}`);
              }}
            />
          </div>

          <div className="mt-6 space-y-3">
            <p className="text-xs font-bold text-lime-400 uppercase tracking-wider">
              Gợi ý tìm kiếm phổ biến
            </p>
            <div className="flex flex-wrap gap-2">
              {['Anime', 'Hàn Quốc', 'Chiếu rạp', 'Cổ trang', 'Hành động', 'Kinh dị', 'TV Shows'].map(
                (tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      setShowSearchModal(false);
                      onNavigate(`/tim-kiem?keyword=${encodeURIComponent(tag)}`);
                    }}
                    className="px-3 py-1.5 rounded-full bg-lime-950/40 border border-lime-500/20 text-xs text-[#cbe1c8] hover:text-lime-300"
                  >
                    {tag}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Explore Bottom Sheet for Mobile */}
      {showExploreSheet && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end sm:hidden animate-in fade-in duration-200"
          onClick={() => setShowExploreSheet(false)}
        >
          <div
            className="bg-[#071307] border-t border-lime-500/30 rounded-t-3xl max-h-[80vh] overflow-y-auto p-5 space-y-5 animate-in slide-in-from-bottom duration-300 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="w-12 h-1.5 rounded-full bg-lime-500/30 mx-auto -mt-1" />

            <div className="flex items-center justify-between border-b border-lime-500/15 pb-3">
              <h3 className="text-base font-black text-[#f4fbf0] flex items-center gap-2">
                <Compass className="w-5 h-5 text-lime-400" />
                <span>Khám Phá Danh Mục Phim</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowExploreSheet(false)}
                aria-label="Đóng bảng khám phá danh mục"
                className="min-w-[44px] min-h-[44px] p-2.5 rounded-full hover:bg-lime-950/60 text-[#d4ebd2] hover:text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Formats */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
                Định dạng phim
              </span>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.slug}
                    onClick={() => {
                      setShowExploreSheet(false);
                      onNavigate(`/danh-sach/${cat.slug}`);
                    }}
                    className="flex items-center justify-between p-3 rounded-xl bg-lime-950/40 border border-lime-500/20 text-xs font-bold text-[#f4fbf0] hover:text-lime-300 text-left"
                  >
                    <span>{cat.name}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-lime-400" />
                  </button>
                ))}
              </div>
            </div>

            {/* Genres */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
                Thể loại nổi bật
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {GENRES.slice(0, 12).map((genre) => (
                  <button
                    key={genre.slug}
                    onClick={() => {
                      setShowExploreSheet(false);
                      onNavigate(`/the-loai/${genre.slug}`);
                    }}
                    className="p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-[11px] font-semibold text-[#cbe1c8] hover:text-lime-300 truncate"
                  >
                    {genre.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Countries */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
                Quốc gia
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {COUNTRIES.slice(0, 9).map((country) => (
                  <button
                    key={country.slug}
                    onClick={() => {
                      setShowExploreSheet(false);
                      onNavigate(`/quoc-gia/${country.slug}`);
                    }}
                    className="p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-[11px] font-semibold text-[#cbe1c8] hover:text-lime-300 truncate"
                  >
                    {country.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
