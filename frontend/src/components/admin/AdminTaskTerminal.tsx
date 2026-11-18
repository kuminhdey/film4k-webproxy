// frontend/src/components/admin/AdminTaskTerminal.tsx
import React from 'react';
import { ArrowDownToLine, Check, Copy, Download, History, Loader2, Terminal } from 'lucide-react';
import { AdminLogEntry } from '../../types';

interface AdminTaskTerminalProps {
  logs: AdminLogEntry[];
  logsConnected: boolean;
  logsError: string | null;
  logWriteError: string | null;
  hasOlderLogs: boolean;
  olderLogsLoading: boolean;
  autoScrollLogs: boolean;
  copiedLogs: boolean;
  logsContainerRef: React.RefObject<HTMLDivElement | null>;
  onToggleAutoScroll: () => void;
  onCopyLogs: () => void;
  onExportLogs: () => void;
  onLoadOlderLogs: () => void;
}

export const AdminTaskTerminal: React.FC<AdminTaskTerminalProps> = React.memo(
  ({
    logs,
    logsConnected,
    logsError,
    logWriteError,
    hasOlderLogs,
    olderLogsLoading,
    autoScrollLogs,
    copiedLogs,
    logsContainerRef,
    onToggleAutoScroll,
    onCopyLogs,
    onExportLogs,
    onLoadOlderLogs,
  }) => {
    return (
      <section
        aria-labelledby="admin-terminal-heading"
        className="bg-[#0a170a] border border-[rgba(163,230,53,0.14)] rounded-2xl overflow-hidden mb-6 shadow-xl"
      >
        <div className="min-h-[52px] py-2 px-4 bg-[#060b05] border-b border-[rgba(163,230,53,0.12)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Terminal className="w-4 h-4 text-lime-400 shrink-0" aria-hidden="true" />
            <h2
              id="admin-terminal-heading"
              className="text-xs sm:text-[13px] font-bold font-mono text-[#f4fbf0] truncate"
            >
              Nhật Ký Tác Vụ Máy Chủ (SQLite History)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleAutoScroll}
              aria-pressed={autoScrollLogs}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 border transition-colors motion-reduce:transition-none cursor-pointer ${
                autoScrollLogs
                  ? 'bg-lime-400/15 border-lime-400/35 text-lime-300'
                  : 'bg-[#0a170a] border-[rgba(163,230,53,0.16)] text-[#9ab395] hover:text-[#f4fbf0]'
              }`}
            >
              <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Auto-scroll {autoScrollLogs ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              onClick={onCopyLogs}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 border transition-colors motion-reduce:transition-none cursor-pointer ${
                copiedLogs
                  ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                  : 'bg-[#0a170a] border-[rgba(163,230,53,0.16)] text-[#9ab395] hover:text-[#f4fbf0]'
              }`}
            >
              {copiedLogs ? (
                <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{copiedLogs ? 'Đã sao chép' : `Sao chép (${logs.length})`}</span>
            </button>

            <button
              type="button"
              onClick={onExportLogs}
              className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-[#0a170a] border border-[rgba(163,230,53,0.16)] text-xs font-semibold text-[#9ab395] hover:text-[#f4fbf0] hover:border-lime-400/35 inline-flex items-center justify-center gap-1.5 transition-colors motion-reduce:transition-none cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-lime-400 shrink-0" aria-hidden="true" />
              <span>Xuất tất cả</span>
            </button>
          </div>
        </div>

        <div
          ref={logsContainerRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="p-4 font-mono text-xs leading-relaxed h-60 overflow-y-auto bg-[#060b05] text-[#f4fbf0]"
        >
          <div
            className={`mb-2.5 font-semibold ${
              logsError || logWriteError
                ? 'text-red-300'
                : logsConnected
                  ? 'text-emerald-300'
                  : 'text-[#9ab395]'
            }`}
          >
            {logWriteError
              ? `Không lưu được log mới: ${logWriteError}`
              : logsError
                ? `Mất kết nối nhật ký: ${logsError}`
                : logsConnected
                  ? '● Nhật ký máy chủ đang trực tuyến'
                  : 'Đang kết nối luồng nhật ký...'}
          </div>

          {hasOlderLogs && (
            <div className="mb-3">
              <button
                type="button"
                onClick={onLoadOlderLogs}
                disabled={olderLogsLoading}
                className="min-h-[44px] min-w-[44px] px-3.5 rounded-xl bg-[#0a170a] border border-[rgba(163,230,53,0.2)] text-xs font-semibold text-lime-300 enabled:hover:bg-lime-400/10 inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {olderLogsLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <History className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{olderLogsLoading ? 'Đang tải...' : 'Tải nhật ký cũ hơn'}</span>
              </button>
            </div>
          )}

          {logs.length === 0 ? (
            <div className="text-[#9ab395] italic">Chưa có bản ghi nhật ký trong phiên hiện tại.</div>
          ) : (
            logs.map((item) => {
              const badgeColor =
                item.level === 'success'
                  ? 'text-lime-300'
                  : item.level === 'warn'
                    ? 'text-amber-300'
                    : item.level === 'error'
                      ? 'text-red-300'
                      : 'text-teal-300';

              const formattedTime =
                typeof item.id === 'number'
                  ? new Date(item.timestamp).toLocaleString('vi-VN')
                  : item.timestamp;

              return (
                <div key={item.id} className="mb-1.5 break-words">
                  <span className="text-[#9ab395] tabular-nums mr-2">[{formattedTime}]</span>
                  <span className={`${badgeColor} font-bold uppercase mr-2`}>[{item.level}]</span>
                  <span className="text-[#f4fbf0]">{item.message}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    );
  }
);

AdminTaskTerminal.displayName = 'AdminTaskTerminal';
