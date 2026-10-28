import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Check, Play, Server, Tv, Search, ChevronLeft, ChevronRight, X, SkipBack, SkipForward } from 'lucide-react';
import { EpisodeServer } from '../types';
import { getHistory } from '../utils';

const RANGE_SIZE = 20; // 20 tập một dải cho phim bộ nhiều tập (UX-C01)
const RESUME_KEY_PREFIX = 'bofilm_resume_';

const normalizeEpKey = (value: string) =>
  value.replace(/^tap-/i, '').replace(/^Tập\s*/i, '').trim();

interface EpisodeSelectorProps {
  servers: EpisodeServer[];
  activeServerIndex: number;
  activeEpisodeSlug: string;
  movieSlug?: string;
  playerMode?: 'hls' | 'embed';
  onSelectServer: (index: number) => void;
  onSelectEpisode: (episodeSlug: string) => void;
  onSelectPlayerMode?: (mode: 'hls' | 'embed') => void;
  isSingleMovie?: boolean;
}

export const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  servers,
  activeServerIndex,
  activeEpisodeSlug,
  movieSlug,
  playerMode = 'hls',
  onSelectServer,
  onSelectEpisode,
  onSelectPlayerMode,
  isSingleMovie = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [pageRangeIndex, setPageRangeIndex] = useState(0);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const currentServer = servers[activeServerIndex] || servers[0];
  const allEpisodes = currentServer?.items || [];

  // ===== Episode Watched Checkmarks & Progress Bar (localStorage history) =====
  const [watchProgress, setWatchProgress] = useState<Record<string, { time: number; duration: number }>>({});
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!movieSlug) return;

    const computeWatchState = () => {
      try {
        const progress: Record<string, { time: number; duration: number }> = {};
        const watched = new Set<string>();

        // Saved playback positions per episode
        allEpisodes.forEach((item) => {
          const raw = localStorage.getItem(`${RESUME_KEY_PREFIX}${movieSlug}_${item.slug}`);
          if (!raw) return;
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.time === 'number' && parsed.time > 5) {
            progress[item.slug] = {
              time: parsed.time,
              duration: typeof parsed.duration === 'number' ? parsed.duration : 0,
            };
            const ratio = parsed.duration > 0 ? parsed.time / parsed.duration : 0;
            if (ratio >= 0.9) {
              watched.add(item.slug);
            }
          }
        });

        // History item marks the furthest watched episode; everything before it counts as watched
        const history = getHistory();
        const histItem = history.find((h) => h.slug === movieSlug);
        if (histItem?.episodeSlug) {
          const lastKey = normalizeEpKey(histItem.episodeSlug);
          const lastIndex = allEpisodes.findIndex(
            (item) =>
              normalizeEpKey(item.slug) === lastKey ||
              normalizeEpKey(item.name) === lastKey
          );
          if (lastIndex !== -1) {
            allEpisodes.forEach((item, idx) => {
              if (idx < lastIndex) watched.add(item.slug);
            });
          }
        }

        setWatchProgress(progress);
        setWatchedEpisodes(watched);
      } catch {
        setWatchProgress({});
        setWatchedEpisodes(new Set());
      }
    };

    computeWatchState();

    const handleHistoryUpdate = () => {
      computeWatchState();
    };
    window.addEventListener('bofilm_history_update', handleHistoryUpdate);
    window.addEventListener('storage', handleHistoryUpdate);

    return () => {
      window.removeEventListener('bofilm_history_update', handleHistoryUpdate);
      window.removeEventListener('storage', handleHistoryUpdate);
    };
  }, [movieSlug, allEpisodes]);

  // Reset paging & search when server changes
  useEffect(() => {
    setSearchQuery('');
    setPageRangeIndex(0);
  }, [activeServerIndex]);

  // Filter episodes by search query
  const filteredEpisodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allEpisodes;
    return allEpisodes.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.slug.toLowerCase().includes(q) ||
        item.name.replace(/^Tập\s*/i, '').toLowerCase().includes(q)
    );
  }, [allEpisodes, searchQuery]);

  const isSearching = searchQuery.trim().length > 0;

  // UX-C01: Dynamic range sizing — if > 24 episodes, group by 20; otherwise show all in 1 page
  const shouldSplitRanges = allEpisodes.length > 24;
  const episodesPerRange = shouldSplitRanges ? RANGE_SIZE : Math.max(1, allEpisodes.length);
  const totalRanges = Math.max(1, Math.ceil(allEpisodes.length / episodesPerRange));

  // Current active episode index
  const activeEpisodeIndex = useMemo(() => {
    return allEpisodes.findIndex(
      (item) => item.slug === activeEpisodeSlug || item.name === activeEpisodeSlug
    );
  }, [allEpisodes, activeEpisodeSlug]);

  // Auto-follow the active episode's range on first load / episode change
  useEffect(() => {
    if (!allEpisodes.length || isSearching) return;
    if (activeEpisodeIndex !== -1) {
      const targetRange = Math.floor(activeEpisodeIndex / episodesPerRange);
      setPageRangeIndex(targetRange);

      // Auto-scroll range tab into view smoothly
      if (tabsContainerRef.current) {
        const activeTabBtn = tabsContainerRef.current.querySelector(
          `[data-range-index="${targetRange}"]`
        ) as HTMLElement | null;
        if (activeTabBtn) {
          activeTabBtn.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
          });
        }
      }
    }
  }, [activeEpisodeIndex, allEpisodes.length, isSearching, episodesPerRange]);

  // Apply range paging when not searching
  const visibleEpisodes = useMemo(() => {
    if (isSearching) return filteredEpisodes;
    const start = pageRangeIndex * episodesPerRange;
    return filteredEpisodes.slice(start, start + episodesPerRange);
  }, [filteredEpisodes, isSearching, pageRangeIndex, episodesPerRange]);

  // Next / Previous Episode helpers
  const prevEpisode = activeEpisodeIndex > 0 ? allEpisodes[activeEpisodeIndex - 1] : null;
  const nextEpisode =
    activeEpisodeIndex >= 0 && activeEpisodeIndex < allEpisodes.length - 1
      ? allEpisodes[activeEpisodeIndex + 1]
      : null;

  const isSingle = Boolean(isSingleMovie || allEpisodes.length <= 1);

  if (!servers || servers.length === 0 || isSingle) {
    return null;
  }

  return (
    <div className="space-y-4 bg-[#071307] border border-lime-500/20 rounded-3xl p-4 sm:p-5 shadow-2xl">
      {/* Chọn Server / Phiên bản (chỉ hiện khi có từ 2 server trở lên) */}
      {servers.length > 1 && (
        <div className="space-y-2.5 border-b border-lime-500/15 pb-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-lime-400 uppercase tracking-wider flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" />
              <span>Chọn Server / Phiên bản</span>
            </span>
            <span className="text-[11px] font-semibold text-[#a8cca2]">
              {servers.length} phiên bản có sẵn
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {servers.map((srv, idx) => {
              const isActive = idx === activeServerIndex;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectServer(idx)}
                  className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                    isActive
                      ? 'bg-lime-500 text-black shadow-[0_0_14px_rgba(132,204,22,0.45)] ring-1 ring-lime-400 font-extrabold'
                      : 'bg-[#0a180b] hover:bg-lime-950/60 text-[#cbe1c8] hover:text-lime-300 border border-lime-500/20 hover:border-lime-400/40'
                  }`}
                  aria-label={`Chọn server ${srv.server_name || `#${idx + 1}`}`}
                >
                  {isActive && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  <span>{srv.server_name || `Server #${idx + 1}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Danh Sách Tập Phim */}
      {!isSingle && (
        <div className="space-y-3 pt-1">
        {/* Episodes Header + Prev/Next Quick Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lime-300 text-sm">
              Danh Sách Tập ({isSearching ? `${visibleEpisodes.length}/${allEpisodes.length}` : allEpisodes.length} tập)
            </span>
          </div>

          {/* Prev/Next Episode Fast Controls */}
          {allEpisodes.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => prevEpisode && onSelectEpisode(prevEpisode.slug)}
                disabled={!prevEpisode}
                className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#0a180b] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400/50 disabled:opacity-30 disabled:pointer-events-none transition-all flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                title={prevEpisode ? `Tập trước (${prevEpisode.name})` : 'Không có tập trước'}
                aria-label="Tập trước đó"
              >
                <SkipBack className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tập trước</span>
              </button>

              <button
                type="button"
                onClick={() => nextEpisode && onSelectEpisode(nextEpisode.slug)}
                disabled={!nextEpisode}
                className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#0a180b] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400/50 disabled:opacity-30 disabled:pointer-events-none transition-all flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                title={nextEpisode ? `Tập tiếp theo (${nextEpisode.name})` : 'Hết tập'}
                aria-label="Tập tiếp theo"
              >
                <span className="hidden sm:inline">Tập tiếp</span>
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Search Quick Filter */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8aa885] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm nhanh số tập... (vd: 12, tập 24)"
            className="w-full min-h-[42px] pl-10 pr-9 py-2 rounded-xl bg-[#0a180b] border border-lime-500/20 text-xs sm:text-[13px] text-[#f4fbf0] placeholder:text-[#8aa885]/70 focus:outline-none focus:border-lime-400/80 focus:ring-1 focus:ring-lime-400/50 transition-all"
            aria-label="Tìm nhanh tập phim"
          />
          {isSearching && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#8aa885] hover:text-lime-300 hover:bg-lime-950/60 transition-colors cursor-pointer"
              title="Xóa tìm kiếm tập"
              aria-label="Xóa từ khóa tìm kiếm tập"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* UX-C01: Range Tabs for Series > 24 episodes (Horizontal Scroll with Snap) */}
        {!isSearching && shouldSplitRanges && totalRanges > 1 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] font-bold text-[#a8cca2]">
              <span>Chọn dải tập ({RANGE_SIZE} tập / dải):</span>
              <span className="text-lime-400">Dải {pageRangeIndex + 1}/{totalRanges}</span>
            </div>

            <div
              ref={tabsContainerRef}
              className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1 scroll-smooth"
            >
              <button
                type="button"
                onClick={() => setPageRangeIndex((prev) => Math.max(0, prev - 1))}
                disabled={pageRangeIndex === 0}
                className="min-w-[38px] min-h-[38px] p-2 rounded-xl bg-[#0a180b] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400/50 disabled:opacity-30 disabled:pointer-events-none transition-all flex items-center justify-center cursor-pointer flex-shrink-0"
                title="Dải tập trước"
                aria-label="Dải tập trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {Array.from({ length: totalRanges }).map((_, idx) => {
                const start = idx * episodesPerRange + 1;
                const end = Math.min(allEpisodes.length, (idx + 1) * episodesPerRange);
                const isActive = idx === pageRangeIndex;
                const containsActive = allEpisodes
                  .slice(idx * episodesPerRange, (idx + 1) * episodesPerRange)
                  .some(
                    (item) => item.slug === activeEpisodeSlug || item.name === activeEpisodeSlug
                  );

                return (
                  <button
                    key={idx}
                    type="button"
                    data-range-index={idx}
                    onClick={() => setPageRangeIndex(idx)}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex-shrink-0 active:scale-95 ${
                      isActive
                        ? 'bg-lime-500 text-black shadow-[0_0_12px_rgba(132,204,22,0.45)] font-black ring-1 ring-lime-400'
                        : containsActive
                        ? 'bg-lime-500/20 text-lime-300 border border-lime-500/50 hover:bg-lime-500/30 font-extrabold'
                        : 'bg-[#0a180b] text-[#cbe1c8] border border-lime-500/20 hover:bg-lime-950/60 hover:text-lime-300'
                    }`}
                    title={`Xem tập ${start} đến ${end}`}
                    aria-label={`Dải tập ${start} đến ${end}`}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span>{start} - {end}</span>
                    {containsActive && !isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-lime-400 inline-block ml-1.5 animate-pulse" />
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setPageRangeIndex((prev) => Math.min(totalRanges - 1, prev + 1))}
                disabled={pageRangeIndex >= totalRanges - 1}
                className="min-w-[38px] min-h-[38px] p-2 rounded-xl bg-[#0a180b] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 hover:border-lime-400/50 disabled:opacity-30 disabled:pointer-events-none transition-all flex items-center justify-center cursor-pointer flex-shrink-0"
                title="Dải tập sau"
                aria-label="Dải tập sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Empty Search State */}
        {isSearching && visibleEpisodes.length === 0 ? (
          <div className="p-8 text-center bg-[#0a180b] rounded-2xl border border-lime-500/20 space-y-2">
            <p className="text-sm font-bold text-[#f4fbf0]">
              Không tìm thấy tập nào khớp với "{searchQuery}"
            </p>
            <p className="text-xs text-[#a8cca2]">
              Thử tìm kiếm với số nguyên (ví dụ: 1, 2, 10...)
            </p>
          </div>
        ) : (
          /* Episodes Grid with 44px min touch target */
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 sm:gap-2.5 max-h-96 overflow-y-auto pr-1">
            {visibleEpisodes.map((item) => {
              const isActive =
                item.slug === activeEpisodeSlug ||
                item.name === activeEpisodeSlug;

              const isWatched = watchedEpisodes.has(item.slug);
              const epProgress = watchProgress[item.slug];
              const progressPercent =
                epProgress && epProgress.duration > 0
                  ? Math.min(100, Math.max(0, (epProgress.time / epProgress.duration) * 100))
                  : 0;

              return (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => onSelectEpisode(item.slug)}
                  className={`relative flex items-center justify-center overflow-hidden p-2 rounded-xl text-xs font-bold transition-all min-h-[44px] min-w-[44px] touch-manipulation cursor-pointer active:scale-95 ${
                    isActive
                      ? 'bg-lime-500 text-black shadow-[0_0_18px_rgba(132,204,22,0.6)] scale-[1.03] font-black ring-1 ring-lime-400 z-10'
                      : isWatched
                      ? 'bg-[#0f2413] text-[#cbe1c8] border border-lime-500/40 hover:bg-lime-950/60 hover:text-lime-300'
                      : 'bg-[#0a180b] hover:bg-lime-950/60 text-[#d8ebd5] hover:text-lime-300 border border-lime-500/20 hover:border-lime-400/50'
                  }`}
                  title={
                    isWatched
                      ? `Tập ${item.name} — Đã xem${progressPercent > 0 ? ` (${Math.round(progressPercent)}%)` : ''}`
                      : `Tập ${item.name}`
                  }
                  aria-label={`Chọn xem tập ${item.name}`}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {!isActive && isWatched && (
                    <Check className="w-3.5 h-3.5 stroke-[3] text-lime-400 mr-1 flex-shrink-0" />
                  )}
                  {isActive && <Play className="w-3.5 h-3.5 fill-black mr-1 animate-pulse" />}
                  <span className="truncate">{item.name}</span>
                  {epProgress && epProgress.duration > 0 && progressPercent > 0 && (
                    <span
                      className={`absolute bottom-0 left-0 h-1 rounded-r-full pointer-events-none ${
                        isActive ? 'bg-black/60' : 'bg-lime-400'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
};
