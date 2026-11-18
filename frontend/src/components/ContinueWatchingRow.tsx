import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  PlayCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Clock,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { HistoryItem } from '../types';
import {
  getContinueWatching,
  removeHistoryItem,
  clearHistory,
  clearAllPlaybackPositions,
  getImageUrl,
  formatTime,
} from '../utils';

interface ContinueWatchingRowProps {
  onWatch: (slug: string, episodeSlug?: string, time?: number) => void;
  onNavigateHistory: () => void;
}

export const ContinueWatchingRow: React.FC<ContinueWatchingRowProps> = ({
  onWatch,
  onNavigateHistory,
}) => {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const confirmDialogRef = useRef<HTMLDialogElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const loadItems = () => {
    const list = getContinueWatching();
    setItems(list);
  };

  useEffect(() => {
    loadItems();

    const handleUpdate = () => {
      loadItems();
    };

    window.addEventListener('bofilm_history_update', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener('bofilm_history_update', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  useEffect(() => {
    if (!showConfirmClear) return;
    const dialog = confirmDialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [showConfirmClear]);

  const checkScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollContainerRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll);
    }
    return () => {
      if (el) el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [items]);

  const handleScroll = (direction: 'left' | 'right') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.75;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const handleRemove = (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    removeHistoryItem(slug);
    loadItems();
  };

  const confirmClearAll = () => {
    clearHistory();
    clearAllPlaybackPositions();
    setShowConfirmClear(false);
    loadItems();
  };

  const handleHistoryLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
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
    onNavigateHistory();
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3.5 group/section animate-in fade-in duration-300">
      {/* Shelf Header */}
      <div className="flex items-center justify-between border-b border-lime-500/20 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-xl bg-lime-500/15 border border-lime-500/30 text-lime-400">
            <PlayCircle className="w-5 h-5 fill-lime-500/20" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-[#f4fbf0] uppercase tracking-wide flex items-center gap-2">
              <span>Tiếp Tục Xem</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-lime-500/20 text-lime-300 border border-lime-500/30 font-bold lowercase tabular-nums">
                {items.length} phim
              </span>
            </h2>
            <p className="text-xs text-[#9ab395] hidden sm:block">
              Tiếp tục tận hưởng những bộ phim bạn đang theo dõi dở
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Scroll Navigation Chevrons */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleScroll('left')}
              disabled={!canScrollLeft}
              aria-label="Cuộn sang trái"
              className={`min-w-[38px] min-h-[38px] p-1.5 rounded-xl border transition-all flex items-center justify-center ${
                canScrollLeft
                  ? 'bg-[#071307] border-lime-500/30 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400 cursor-pointer shadow-sm'
                  : 'bg-[#071307]/40 border-lime-500/10 text-white/20 cursor-not-allowed'
              }`}
              title="Cuộn sang trái"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleScroll('right')}
              disabled={!canScrollRight}
              aria-label="Cuộn sang phải"
              className={`min-w-[38px] min-h-[38px] p-1.5 rounded-xl border transition-all flex items-center justify-center ${
                canScrollRight
                  ? 'bg-[#071307] border-lime-500/30 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400 cursor-pointer shadow-sm'
                  : 'bg-[#071307]/40 border-lime-500/10 text-white/20 cursor-not-allowed'
              }`}
              title="Cuộn sang phải"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Clear All + View All */}
          <button
            type="button"
            onClick={() => setShowConfirmClear(true)}
            aria-label="Xóa toàn bộ danh sách tiếp tục xem"
            className="min-h-[38px] flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-950/40 border border-red-500/25 text-red-300 hover:bg-red-900/60 text-xs font-bold transition-colors cursor-pointer"
            title="Xóa toàn bộ danh sách tiếp tục xem"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Xóa hết</span>
          </button>

          <a
            href="/lich-su"
            onClick={handleHistoryLinkClick}
            className="min-h-[38px] inline-flex items-center gap-1 px-2 text-xs font-bold text-lime-400 hover:text-lime-300 transition-colors cursor-pointer"
          >
            <span>Lịch sử</span>
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Horizontal Carousel Row */}
      <div
        ref={scrollContainerRef}
        className="flex items-stretch gap-3.5 sm:gap-4 overflow-x-auto pb-2 scroll-smooth no-scrollbar select-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => {
          const hasProgress =
            item.time !== undefined &&
            item.duration !== undefined &&
            item.duration > 0;
          const progressPercent = hasProgress
            ? Math.min(100, Math.max(1, Math.round((item.time! / item.duration!) * 100)))
            : 0;

          const remainingSeconds =
            hasProgress && item.duration! > item.time!
              ? item.duration! - item.time!
              : 0;
          const remainingMinutes = Math.ceil(remainingSeconds / 60);

          return (
            <div
              key={`${item.slug}-${item.episodeSlug || 'default'}`}
              className="w-56 sm:w-64 flex-shrink-0 group relative"
            >
              <button
                type="button"
                onClick={() => onWatch(item.slug, item.episodeSlug, item.time)}
                aria-label={`Tiếp tục xem ${item.name}${item.episodeName ? `, ${item.episodeName}` : ''}`}
                className="w-full h-full text-left rounded-2xl bg-[#071307] border border-lime-500/20 hover:border-lime-400/50 hover:bg-[#0a1b0a] transition-all duration-200 overflow-hidden cursor-pointer flex flex-col justify-between focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-400"
              >
                {/* Media Thumbnail Container with 16:9 widescreen ratio */}
                <div className="relative aspect-video w-full bg-black/60 overflow-hidden">
                  <img
                    src={getImageUrl(item.posterUrl)}
                    alt={item.name}
                    width={320}
                    height={180}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/30 group-hover:via-black/20 transition-colors" />

                  <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                    <span className="px-2 py-0.5 rounded-lg bg-black/75 backdrop-blur-md text-lime-300 border border-lime-500/30 text-xs font-extrabold shadow-md">
                      {item.episodeName
                        ? item.episodeName.startsWith('Tập') || isNaN(Number(item.episodeName.trim()))
                          ? item.episodeName
                          : `Tập ${item.episodeName}`
                        : 'Đang xem'}
                    </span>
                  </div>

                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-11 h-11 rounded-full bg-lime-500/90 group-hover:bg-lime-400 text-black flex items-center justify-center shadow-lg transform scale-95 group-hover:scale-100 transition-all duration-200">
                      <Play className="w-5 h-5 fill-black ml-0.5" />
                    </div>
                  </div>

                  <div className="absolute bottom-2.5 left-2 z-10">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-lime-400 text-black font-black text-xs shadow-sm tabular-nums">
                      <Play className="w-2.5 h-2.5 fill-black" />
                      <span>{progressPercent}%</span>
                    </div>
                  </div>

                  <div className="absolute bottom-2.5 right-2 z-10">
                    {hasProgress && remainingMinutes > 0 ? (
                      <span className="px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-xs font-bold text-[#fef08a] border border-yellow-400/20 shadow tabular-nums">
                        Còn {remainingMinutes}p
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-xs font-bold text-[#9ab395]">
                        Xem tiếp
                      </span>
                    )}
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/70">
                    <div
                      className="h-full bg-gradient-to-r from-lime-400 via-lime-300 to-emerald-400 transition-all duration-300"
                      style={{ width: `${hasProgress ? progressPercent : 15}%` }}
                    />
                  </div>
                </div>

                {/* Card Meta Content */}
                <div className="p-3 space-y-1.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-[#f4fbf0] group-hover:text-lime-300 transition-colors line-clamp-2 leading-snug h-[2.5rem] min-h-[2.5rem]">
                      {item.name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-[#9ab395] mt-1 h-[1.25rem] min-h-[1.25rem] tabular-nums">
                      <Clock className="w-3 h-3 text-lime-400/70 shrink-0" />
                      <span className="truncate">
                        {hasProgress
                          ? `Đã xem ${formatTime(item.time!)} / ${formatTime(item.duration!)}`
                          : 'Vừa xem gần đây'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-lime-500/10 text-xs font-bold text-lime-400/90 group-hover:text-lime-300 tabular-nums">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-lime-400" />
                      <span>Xem tiếp ngay</span>
                    </span>
                    <span className="text-xs font-extrabold text-lime-400">
                      {progressPercent}%
                    </span>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => handleRemove(e, item.slug)}
                aria-label={`Xóa ${item.name} khỏi danh sách tiếp tục xem`}
                className="touch-target-44 absolute top-1.5 right-1.5 p-2 rounded-xl bg-black/75 hover:bg-red-950/90 text-white/80 hover:text-red-300 border border-white/15 hover:border-red-500/40 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer z-10"
                title="Xóa khỏi danh sách tiếp tục xem"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Accessible Confirmation Dialog replacing window.confirm() */}
      {showConfirmClear && (
        <dialog
          ref={confirmDialogRef}
          aria-label="Xác nhận xóa lịch sử tiếp tục xem"
          onCancel={() => setShowConfirmClear(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirmClear(false);
          }}
          className="fixed inset-0 z-50 w-screen h-screen max-w-none max-h-none m-0 border-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#0a170a] border border-lime-500/25 p-5 space-y-4 text-[#f4fbf0] shadow-2xl"
          >
            <h3 className="text-base font-extrabold">Xóa danh sách Tiếp tục xem?</h3>
            <p className="text-xs text-[#9ab395] leading-relaxed">
              Toàn bộ lịch sử xem gần đây và mốc thời gian xem dở của các bộ phim trên trình duyệt này sẽ được xóa sạch.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmClear(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-[#cbe1c8] cursor-pointer"
              >
                Giữ lại
              </button>
              <button
                type="button"
                onClick={confirmClearAll}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-extrabold text-white cursor-pointer"
              >
                Xóa toàn bộ
              </button>
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
};
