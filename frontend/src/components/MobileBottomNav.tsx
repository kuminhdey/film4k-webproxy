import React, { useState, useEffect, useRef } from 'react';
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
  const searchDialogRef = useRef<HTMLDialogElement | null>(null);
  const exploreDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!showSearchModal) return;
    const dialog = searchDialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [showSearchModal]);

  useEffect(() => {
    if (!showExploreSheet) return;
    const dialog = exploreDialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [showExploreSheet]);

  const handleLinkClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    path: string,
    afterClose?: () => void
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
    afterClose?.();
    onNavigate(path);
  };

  const navItems = [
    {
      label: 'Trang chủ',
      href: '/',
      action: () => onNavigate('/'),
      icon: Home,
      isActive: currentPath === '/',
    },
    {
      label: 'Khám phá',
      href: undefined,
      action: () => setShowExploreSheet(true),
      icon: Compass,
      isActive:
        showExploreSheet ||
        currentPath.startsWith('/danh-sach') ||
        currentPath.startsWith('/the-loai'),
    },
    {
      label: 'Tìm kiếm',
      href: undefined,
      action: () => setShowSearchModal(true),
      icon: Search,
      isActive: showSearchModal || currentPath.startsWith('/tim-kiem'),
    },
    {
      label: 'Yêu thích',
      href: '/yeu-thich',
      action: () => onNavigate('/yeu-thich'),
      icon: Bookmark,
      isActive: currentPath === '/yeu-thich',
    },
    {
      label: 'Lịch sử',
      href: '/lich-su',
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
          {navItems.map((item) => {
            const Icon = item.icon;
            const inner = (
              <span className="flex flex-col items-center justify-center py-1 px-2 relative min-w-[56px] min-h-[48px] touch-manipulation">
                <Icon
                  className={`w-5 h-5 transition-transform duration-200 ${
                    item.isActive
                      ? 'text-lime-300 scale-105'
                      : 'text-[#9cb897] hover:text-[#d8ebd5]'
                  }`}
                />
                <span
                  className={`text-[11px] mt-1 font-semibold tracking-tight transition-colors ${
                    item.isActive ? 'text-lime-300 font-bold' : 'text-[#a8cca2]'
                  }`}
                >
                  {item.label}
                </span>
                {item.isActive && (
                  <span className="absolute bottom-0.5 w-1.5 h-1 rounded-full bg-lime-400" />
                )}
              </span>
            );

            if (item.href) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={(e) => handleLinkClick(e, item.href!)}
                  aria-label={item.label}
                  aria-current={item.isActive ? 'page' : undefined}
                  className="flex-1 flex justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-lime-400"
                >
                  {inner}
                </a>
              );
            }

            return (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                aria-label={item.label}
                aria-expanded={
                  item.label === 'Khám phá' ? showExploreSheet : showSearchModal
                }
                className="flex-1 flex justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-lime-400 cursor-pointer"
              >
                {inner}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Accessible Native <dialog> Quick Search Modal for Mobile */}
      {showSearchModal && (
        <dialog
          ref={searchDialogRef}
          aria-label="Tìm kiếm phim"
          onCancel={() => setShowSearchModal(false)}
          className="fixed inset-0 z-50 w-screen h-screen max-w-none max-h-none m-0 border-0 bg-black/90 backdrop-blur-md flex flex-col p-4 sm:hidden text-[#f4fbf0]"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-extrabold text-[#f4fbf0] flex items-center gap-2">
              <Search className="w-5 h-5 text-lime-400" />
              <span>Tìm Kiếm Phim</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowSearchModal(false)}
              aria-label="Đóng cửa sổ tìm kiếm"
              className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-lime-950/50 border border-lime-500/30 text-[#d4ebd2] hover:text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400 cursor-pointer"
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
              {[
                'Anime',
                'Hàn Quốc',
                'Chiếu rạp',
                'Cổ trang',
                'Hành động',
                'Kinh dị',
                'TV Shows',
              ].map((tag) => {
                const path = `/tim-kiem?keyword=${encodeURIComponent(tag)}`;
                return (
                  <a
                    key={tag}
                    href={path}
                    onClick={(e) =>
                      handleLinkClick(e, path, () => setShowSearchModal(false))
                    }
                    className="min-h-[44px] inline-flex items-center px-3.5 py-2 rounded-full bg-lime-950/40 border border-lime-500/20 text-xs font-semibold text-[#cbe1c8] hover:text-lime-300"
                  >
                    {tag}
                  </a>
                );
              })}
            </div>
          </div>
        </dialog>
      )}

      {/* Accessible Native <dialog> Quick Explore Bottom Sheet for Mobile */}
      {showExploreSheet && (
        <dialog
          ref={exploreDialogRef}
          aria-label="Khám phá danh mục phim"
          onCancel={() => setShowExploreSheet(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowExploreSheet(false);
          }}
          className="fixed inset-0 z-50 w-screen h-screen max-w-none max-h-none m-0 border-0 bg-black/80 backdrop-blur-md flex flex-col justify-end sm:hidden text-[#f4fbf0] p-0"
        >
          <div
            className="bg-[#071307] border-t border-lime-500/30 rounded-t-3xl max-h-[82vh] overflow-y-auto p-5 space-y-5 shadow-2xl w-full"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="w-12 h-1.5 rounded-full bg-lime-500/30 mx-auto -mt-1" />

            <div className="flex items-center justify-between border-b border-lime-500/15 pb-3">
              <h3 className="text-base font-extrabold text-[#f4fbf0] flex items-center gap-2">
                <Compass className="w-5 h-5 text-lime-400" />
                <span>Khám Phá Danh Mục Phim</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowExploreSheet(false)}
                aria-label="Đóng bảng khám phá danh mục"
                className="min-w-[44px] min-h-[44px] p-2.5 rounded-full hover:bg-lime-950/60 text-[#d4ebd2] hover:text-white flex items-center justify-center focus-visible:ring-2 focus-visible:ring-lime-400 cursor-pointer"
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
                {CATEGORIES.map((cat) => {
                  const path = `/danh-sach/${cat.slug}`;
                  return (
                    <a
                      key={cat.slug}
                      href={path}
                      onClick={(e) =>
                        handleLinkClick(e, path, () => setShowExploreSheet(false))
                      }
                      className="min-h-[44px] flex items-center justify-between p-3 rounded-xl bg-lime-950/40 border border-lime-500/20 text-xs font-bold text-[#f4fbf0] hover:text-lime-300 text-left"
                    >
                      <span>{cat.name}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-lime-400" />
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Genres */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
                Thể loại nổi bật
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {GENRES.slice(0, 12).map((genre) => {
                  const path = `/the-loai/${genre.slug}`;
                  return (
                    <a
                      key={genre.slug}
                      href={path}
                      onClick={(e) =>
                        handleLinkClick(e, path, () => setShowExploreSheet(false))
                      }
                      className="min-h-[44px] flex items-center justify-center p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-xs font-semibold text-[#cbe1c8] hover:text-lime-300 truncate"
                    >
                      {genre.name}
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Countries */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-lime-400 uppercase tracking-wider block">
                Quốc gia
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {COUNTRIES.slice(0, 9).map((country) => {
                  const path = `/quoc-gia/${country.slug}`;
                  return (
                    <a
                      key={country.slug}
                      href={path}
                      onClick={(e) =>
                        handleLinkClick(e, path, () => setShowExploreSheet(false))
                      }
                      className="min-h-[44px] flex items-center justify-center p-2 text-center rounded-lg bg-[#050e05] border border-lime-500/15 text-xs font-semibold text-[#cbe1c8] hover:text-lime-300 truncate"
                    >
                      {country.name}
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
};
