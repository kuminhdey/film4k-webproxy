// frontend/src/components/admin/AdminCrawlerControls.tsx
import React from 'react';
import { Flame, FolderSync, Loader2, Lock, Play, RefreshCw, RotateCw, Square, Trash2 } from 'lucide-react';
import { AdminStats } from '../../types';
import { CrawlerMode, SUPPORTED_CRAWLER_MODES } from '../../crawlerStatus';

interface AdminCrawlerControlsProps {
  stats: AdminStats;
  actionLoading: string | null;
  onRequestFullCrawl: () => void;
  onTriggerMode: (mode: CrawlerMode, label: string) => void;
  onWarmupHotMovies: () => void;
  onStopCrawler: () => void;
  onRequestClearAllCache: () => void;
}

export const AdminCrawlerControls: React.FC<AdminCrawlerControlsProps> = React.memo(
  ({
    stats,
    actionLoading,
    onRequestFullCrawl,
    onTriggerMode,
    onWarmupHotMovies,
    onStopCrawler,
    onRequestClearAllCache,
  }) => {
    const isRunning = stats.crawler_is_running;
    const isAuto = Boolean(stats.crawler_auto_enabled);
    const anyActionBusy = actionLoading !== null;

    const latestMeta = SUPPORTED_CRAWLER_MODES.find((m) => m.mode === 'latest')!;
    const fullMeta = SUPPORTED_CRAWLER_MODES.find((m) => m.mode === 'full')!;
    const forceMeta = SUPPORTED_CRAWLER_MODES.find((m) => m.mode === 'force')!;
    const prewarmMeta = SUPPORTED_CRAWLER_MODES.find((m) => m.mode === 'prewarm')!;

    return (
      <section
        aria-labelledby="crawler-controls-heading"
        className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-5 sm:p-6 mb-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 id="crawler-controls-heading" className="text-base font-bold text-[#f4fbf0]">
              Trung Tâm Điều Khiển Crawler &amp; Cache M3U8
            </h2>
            <p className="mt-0.5 text-[13px] text-[#9ab395]">
              Các chế độ đồng bộ chính thức trên máy chủ (`latest`, `full`, `force`, `prewarm`) và quản trị bộ nhớ đệm playlist.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
          {/* 1. Full Mode (Confirmation Gated) */}
          <div className="rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.14)] p-3.5 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-lime-300 mb-1">
                Chế độ: full
              </div>
              <p className="text-xs text-[#9ab395] leading-relaxed">{fullMeta.description}</p>
            </div>
            <button
              type="button"
              onClick={onRequestFullCrawl}
              disabled={anyActionBusy || isRunning || isAuto}
              className="w-full min-h-[44px] min-w-[44px] px-4 rounded-xl bg-lime-400 enabled:hover:bg-lime-300 text-[#060b05] text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'start_full' || actionLoading === 'full' ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none shrink-0" aria-hidden="true" />
              ) : isRunning ? (
                <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4 fill-current shrink-0" aria-hidden="true" />
              )}
              <span>
                {isRunning
                  ? 'Crawler đang chạy...'
                  : isAuto
                    ? 'Tự động đang bật'
                    : stats.remaining_movies != null
                      ? `Đồng Bộ Toàn Bộ Kho (${stats.remaining_movies.toLocaleString()})`
                      : fullMeta.label}
              </span>
            </button>
          </div>

          {/* 2. Latest Mode */}
          <div className="rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.14)] p-3.5 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-300 mb-1">
                Chế độ: latest
              </div>
              <p className="text-xs text-[#9ab395] leading-relaxed">{latestMeta.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onTriggerMode('latest', latestMeta.label)}
              disabled={anyActionBusy || isRunning}
              className="w-full min-h-[44px] min-w-[44px] px-4 rounded-xl bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 enabled:hover:bg-emerald-500/25 text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'latest' || actionLoading === 'update' ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none shrink-0" aria-hidden="true" />
              ) : (
                <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{latestMeta.label}</span>
            </button>
          </div>

          {/* 3. Force Mode */}
          <div className="rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.14)] p-3.5 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-1">
                Chế độ: force
              </div>
              <p className="text-xs text-[#9ab395] leading-relaxed">{forceMeta.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onTriggerMode('force', forceMeta.label)}
              disabled={anyActionBusy || isRunning}
              className="w-full min-h-[44px] min-w-[44px] px-4 rounded-xl bg-amber-500/15 border border-amber-400/35 text-amber-300 enabled:hover:bg-amber-500/25 text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'force' ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none shrink-0" aria-hidden="true" />
              ) : (
                <RotateCw className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{forceMeta.label}</span>
            </button>
          </div>

          {/* 4. Warmup / Prewarm Mode */}
          <div className="rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.14)] p-3.5 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-lime-300 mb-1">
                Chế độ: prewarm (warmup)
              </div>
              <p className="text-xs text-[#9ab395] leading-relaxed">{prewarmMeta.description}</p>
            </div>
            <button
              type="button"
              onClick={onWarmupHotMovies}
              disabled={anyActionBusy || isRunning}
              className="w-full min-h-[44px] min-w-[44px] px-4 rounded-xl bg-lime-400/15 border border-lime-400/35 text-lime-300 enabled:hover:bg-lime-400/25 text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'warmup' || actionLoading === 'prewarm' ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none shrink-0" aria-hidden="true" />
              ) : (
                <Flame className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{prewarmMeta.label}</span>
            </button>
          </div>
        </div>

        {/* Secondary Ops Bar: Stop Crawler + Clear All M3U8 Cache */}
        <div className="pt-3 border-t border-[rgba(163,230,53,0.1)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[#9ab395]">
            <FolderSync className="w-4 h-4 text-lime-400 shrink-0" aria-hidden="true" />
            <span>Tác vụ bảo trì tiến trình &amp; làm sạch toàn bộ thư mục playlist M3U8</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onStopCrawler}
              disabled={anyActionBusy || (!isRunning && !isAuto)}
              className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-amber-500/15 border border-amber-400/35 text-[13px] font-bold text-amber-200 enabled:hover:bg-amber-500/25 inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'stop' ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none shrink-0" aria-hidden="true" />
              ) : (
                <Square className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{isAuto ? 'Tắt Tự Động & Dừng' : 'Dừng Crawler'}</span>
            </button>

            <button
              type="button"
              onClick={onRequestClearAllCache}
              disabled={anyActionBusy}
              className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-red-500/15 border border-red-400/35 text-[13px] font-bold text-red-200 enabled:hover:bg-red-500/25 inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'clear_all_cache' ? (
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none shrink-0" aria-hidden="true" />
              ) : (
                <Trash2 className="w-4 h-4 text-red-300 shrink-0" aria-hidden="true" />
              )}
              <span>Xóa Toàn Bộ Cache M3U8</span>
            </button>
          </div>
        </div>
      </section>
    );
  }
);

AdminCrawlerControls.displayName = 'AdminCrawlerControls';
