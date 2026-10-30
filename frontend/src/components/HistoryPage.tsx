import React, { useState, useEffect } from 'react';
import { History, Play, Trash2, ArrowLeft, Clock } from 'lucide-react';
import { getHistory, removeHistoryItem, clearHistory, getImageUrl } from '../utils';
import { HistoryItem } from '../types';

interface HistoryPageProps {
  onWatch: (slug: string, epSlug?: string) => void;
  onBack: () => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({
  onWatch,
  onBack,
}) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const loadHistory = () => {
    setHistory(getHistory());
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleRemove = (e: React.MouseEvent, slug: string) => {
    e.stopPropagation();
    removeHistoryItem(slug);
    loadHistory();
  };

  const handleClear = () => {
    if (window.confirm('Bạn có chắc muốn xóa toàn bộ lịch sử xem phim?')) {
      clearHistory();
      loadHistory();
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between border-b border-lime-500/15 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-[#071307] border border-lime-500/20 text-[#cbe1c8] hover:text-lime-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-[#f4fbf0] tracking-tight flex items-center gap-2">
              <History className="w-6 h-6 text-lime-400" />
              <span>Lịch Sử Xem Phim</span>
            </h1>
            <p className="text-xs text-[#8aa885] mt-0.5">
              Các bộ phim và tập phim bạn đã xem gần đây
            </p>
          </div>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/40 border border-red-500/25 text-red-300 hover:bg-red-900/60 text-xs font-bold transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Xóa tất cả</span>
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="py-20 text-center bg-[#071307] rounded-3xl border border-lime-500/20 p-8 space-y-3 max-w-md mx-auto">
          <History className="w-12 h-12 text-[#8aa885] mx-auto opacity-40" />
          <h3 className="text-base font-bold text-[#f4fbf0]">
            Chưa có lịch sử xem phim
          </h3>
          <p className="text-xs text-[#8aa885]">
            Khi bạn xem bất kỳ bộ phim nào, tiến trình xem sẽ tự động được lưu lại tại đây.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {history.map((item) => {
            const dateStr = new Date(item.timestamp).toLocaleDateString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: '2-digit',
            });

            return (
              <div
                key={item.slug}
                className="flex items-center gap-3 rounded-2xl bg-[#071307] border border-lime-500/20 hover:border-lime-400/50 hover:bg-lime-950/20 transition-all group shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => onWatch(item.slug, item.episodeSlug)}
                  aria-label={`Xem tiếp ${item.name}${item.episodeName ? `, ${item.episodeName}` : ''}`}
                  className="flex flex-1 min-w-0 items-center gap-3 p-3 text-left rounded-l-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-400"
                >
                <div className="w-14 h-20 rounded-xl overflow-hidden bg-black/60 flex-shrink-0 border border-lime-500/20 relative">
                  <img
                    src={getImageUrl(item.posterUrl)}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="w-5 h-5 fill-lime-400 text-lime-400" />
                  </div>
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <h3 className="text-xs font-bold text-[#f4fbf0] group-hover:text-lime-300 transition-colors line-clamp-1">
                    {item.name}
                  </h3>
                  {item.episodeName && (
                    <span className="inline-block px-2 py-0.5 rounded-md bg-lime-500/20 text-lime-300 border border-lime-500/30 text-[10px] font-extrabold">
                      {item.episodeName}
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-[#8aa885]">
                    <Clock className="w-3 h-3 text-lime-400/80" />
                    <span>{dateStr}</span>
                  </div>
                </div>

                </button>
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, item.slug)}
                  aria-label={`Xóa ${item.name} khỏi lịch sử xem`}
                  className="p-1.5 rounded-lg text-[#8aa885] hover:text-red-400 hover:bg-red-950/40 transition-colors"
                  title="Xóa khỏi lịch sử"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
