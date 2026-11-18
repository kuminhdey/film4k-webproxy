// frontend/src/components/admin/AdminStatsGrid.tsx
import React from 'react';
import { Activity, Clock, Film, HardDrive, Loader2, Lock, Play, Radio, Zap } from 'lucide-react';
import { AdminStats } from '../../types';
import { crawlerStatusLabel } from '../../crawlerStatus';
import { formatBytes } from './adminTypes';

interface AdminStatsGridProps {
  stats: AdminStats;
  sourceComparisonLabel: string;
  actionLoading: string | null;
  onRequestFullCrawl: () => void;
}

export const AdminStatsGrid: React.FC<AdminStatsGridProps> = React.memo(
  ({ stats, sourceComparisonLabel, actionLoading, onRequestFullCrawl }) => {
    const catalogCount = stats.catalog_rows ?? stats.total_movies;
    const detailCount = stats.detail_rows ?? 0;
    const crawlerPercent =
      stats.crawler_percent !== undefined ? stats.crawler_percent : (stats.crawler_progress_percent ?? 0);
    const clampedPercent = Math.min(100, Math.max(0, crawlerPercent));
    const totalDiscoveredCount = stats.crawler_total_discovered ?? stats.crawler_total ?? 0;
    const diskHuman =
      stats.disk_usage?.human_readable ||
      formatBytes((stats.disk_usage?.playlists_bytes ?? 0) + (stats.disk_usage?.database_bytes ?? 0));

    return (
      <>
        <section
          aria-label="Chỉ số vận hành thời gian thực"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6"
        >
          {/* Card 1: Total Movies */}
          <div className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#9ab395] whitespace-nowrap">
                  Tổng Số Phim
                </span>
                <div className="w-9 h-9 rounded-xl bg-lime-400/15 border border-lime-400/25 flex items-center justify-center shrink-0">
                  <Film className="w-5 h-5 text-lime-400" aria-hidden="true" />
                </div>
              </div>
              <div className="text-3xl font-extrabold text-[#f4fbf0] tabular-nums leading-none">
                {catalogCount.toLocaleString()}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[rgba(163,230,53,0.1)] space-y-1 text-xs text-[#9ab395] tabular-nums">
              <div>
                Có dữ liệu tập:{' '}
                <strong className="text-lime-300 font-semibold">{detailCount.toLocaleString()}</strong> phim
              </div>
              <div>
                Phim lẻ: <strong className="text-[#f4fbf0] font-semibold">{stats.total_single.toLocaleString()}</strong>{' '}
                • Phim bộ:{' '}
                <strong className="text-[#f4fbf0] font-semibold">{stats.total_series.toLocaleString()}</strong>
              </div>
              <div className="text-emerald-300 font-medium">{sourceComparisonLabel}</div>
            </div>
          </div>

          {/* Card 2: Cached M3U8 Playlists */}
          <div className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#9ab395] whitespace-nowrap">
                  Cache Playlist M3U8
                </span>
                <div className="w-9 h-9 rounded-xl bg-lime-400/15 border border-lime-400/25 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-lime-400" aria-hidden="true" />
                </div>
              </div>
              <div className="text-3xl font-extrabold text-lime-400 tabular-nums leading-none">
                {stats.cached_m3u8_count.toLocaleString()}
              </div>
            </div>

            <p className="mt-3 pt-3 border-t border-[rgba(163,230,53,0.1)] text-xs text-[#9ab395] leading-relaxed">
              Số thư mục playlist <code className="text-lime-300 font-mono">#EXTM3U</code> đã lưu sẵn trên đĩa đệm.
            </p>
          </div>

          {/* Card 3: Storage / Disk Usage */}
          <div className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#9ab395] whitespace-nowrap">
                  Dung Lượng Đĩa
                </span>
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center shrink-0">
                  <HardDrive className="w-5 h-5 text-emerald-300" aria-hidden="true" />
                </div>
              </div>
              <div className="text-3xl font-extrabold text-[#f4fbf0] tabular-nums leading-none">
                {diskHuman}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[rgba(163,230,53,0.1)] text-xs text-[#9ab395] tabular-nums leading-relaxed">
              {stats.disk_usage?.playlists_bytes !== undefined &&
              stats.disk_usage?.database_bytes !== undefined ? (
                <span>
                  Cache:{' '}
                  <strong className="text-lime-300 font-semibold">
                    {formatBytes(stats.disk_usage.playlists_bytes)}
                  </strong>{' '}
                  • DB:{' '}
                  <strong className="text-[#f4fbf0] font-semibold">
                    {formatBytes(stats.disk_usage.database_bytes)}
                  </strong>
                </span>
              ) : (
                <span>Tổng dung lượng Playlist Cache &amp; SQLite DB</span>
              )}
            </div>
          </div>

          {/* Card 4: Crawler Status */}
          <div className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#9ab395] whitespace-nowrap">
                  Trạng Thái Crawler
                </span>
                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                    stats.crawler_is_running
                      ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                      : 'bg-white/5 border-[rgba(163,230,53,0.14)] text-[#9ab395]'
                  }`}
                >
                  <Activity className="w-5 h-5" aria-hidden="true" />
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    stats.crawler_is_running ? 'bg-emerald-400 animate-pulse motion-reduce:animate-none' : 'bg-[#9ab395]'
                  }`}
                  aria-hidden="true"
                />
                <span
                  className={`text-base font-bold leading-snug ${
                    stats.crawler_is_running ? 'text-emerald-300' : 'text-[#f4fbf0]'
                  }`}
                >
                  {crawlerStatusLabel(stats.crawler_is_running, Boolean(stats.crawler_auto_enabled))}
                </span>
              </div>
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={onRequestFullCrawl}
                disabled={actionLoading !== null || stats.crawler_is_running || Boolean(stats.crawler_auto_enabled)}
                className="w-full min-h-[44px] min-w-[44px] px-3 rounded-xl bg-lime-400/15 border border-lime-400/35 text-xs font-bold text-lime-300 enabled:hover:bg-lime-400/25 inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {stats.crawler_is_running ? (
                  <>
                    <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Crawler đang chạy...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current shrink-0" aria-hidden="true" />
                    <span>{stats.crawler_auto_enabled ? 'Đã bật tự động' : 'Kích hoạt cào dữ liệu'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 5: Last Run */}
          <div className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#9ab395] whitespace-nowrap">
                  Lần Chạy Gần Nhất
                </span>
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-emerald-300" aria-hidden="true" />
                </div>
              </div>
              <div className="text-lg font-bold text-[#f4fbf0] tabular-nums leading-snug">
                {stats.crawler_last_run && stats.crawler_last_run.trim()
                  ? stats.crawler_last_run.substring(0, 19).replace('T', ' ')
                  : 'Chưa chạy'}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[rgba(163,230,53,0.1)] text-xs text-[#9ab395] tabular-nums leading-relaxed">
              {stats.crawler_processed > 0
                ? `Đã duyệt ${stats.crawler_processed.toLocaleString()} phim trong phiên gần nhất`
                : 'Chu kỳ đồng bộ tự động mỗi 1 giờ'}
            </div>
          </div>
        </section>

        {/* Crawler Progress Bar */}
        <section
          aria-label="Tiến trình công việc crawler"
          className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl p-5 mb-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-bold text-[#f4fbf0]">Tiến Trình Job Crawler</h2>
              {stats.crawler_is_running ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-lime-400/15 border border-lime-400/35 text-xs font-semibold text-lime-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <span>Đang đồng bộ...</span>
                </span>
              ) : clampedPercent >= 100 ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-xs font-semibold text-emerald-300">
                  Hoàn tất 100%
                </span>
              ) : (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                    clampedPercent > 0
                      ? 'bg-amber-500/15 border-amber-400/35 text-amber-300'
                      : 'bg-white/5 border-[rgba(163,230,53,0.16)] text-[#9ab395]'
                  }`}
                >
                  {clampedPercent > 0
                    ? `Tạm dừng (${Math.round(clampedPercent)}%)`
                    : stats.crawler_last_status || 'Sẵn sàng'}
                </span>
              )}
            </div>

            <div className="text-[13px] text-[#9ab395] tabular-nums">
              <strong className="text-[#f4fbf0] font-bold">
                {stats.crawler_processed.toLocaleString()} / {totalDiscoveredCount.toLocaleString()}
              </strong>{' '}
              phim ({Math.round(clampedPercent)}%)
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="Tiến trình đồng bộ crawler"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clampedPercent)}
            className="w-full h-2.5 bg-[#060b05] rounded-full overflow-hidden border border-[rgba(163,230,53,0.12)]"
          >
            <div
              className="h-full bg-gradient-to-r from-lime-400 to-lime-500 rounded-full transition-all duration-300 motion-reduce:transition-none"
              style={{ width: `${clampedPercent > 0 ? Math.max(2, clampedPercent) : 0}%` }}
            />
          </div>

          {stats.crawler_is_running && stats.crawler_current_movie && (
            <div className="mt-3 text-xs text-[#9ab395] flex items-center gap-2">
              <Radio
                className="w-4 h-4 text-lime-400 animate-pulse motion-reduce:animate-none shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">
                Đang xử lý phim: <code className="text-lime-300 font-mono">{stats.crawler_current_movie}</code>
              </span>
            </div>
          )}
        </section>
      </>
    );
  }
);

AdminStatsGrid.displayName = 'AdminStatsGrid';
