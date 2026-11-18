// frontend/src/components/admin/AdminHeader.tsx
import React from 'react';
import { ExternalLink, LogOut } from 'lucide-react';
import { AdminClock } from './AdminClock';

interface AdminHeaderProps {
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = React.memo(({ onNavigate, onLogout }) => {
  return (
    <header className="admin-dashboard-header sticky top-0 z-40 w-full min-h-[64px] py-2 px-4 sm:px-6 bg-[#060b05]/92 backdrop-blur-md border-b border-[rgba(163,230,53,0.14)] flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <a
          href="/"
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
              e.preventDefault();
              onNavigate('/');
            }
          }}
          aria-label="Về trang chủ Bơ Film Cinema"
          className="min-h-[44px] min-w-[44px] inline-flex items-center gap-2.5 rounded-xl px-1.5 hover:bg-white/5 transition-colors motion-reduce:transition-none"
        >
          <img
            src="/logo-64.png"
            alt="Bơ Film"
            width={34}
            height={34}
            decoding="async"
            className="w-[34px] h-[34px] object-contain shrink-0"
          />
          <span className="text-lg font-extrabold tracking-tight inline-flex items-center gap-1 whitespace-nowrap">
            <span className="text-lime-400">Bơ</span>
            <span className="text-[#f4fbf0]">Film</span>
            <span className="text-[#9ab395] font-semibold">Admin</span>
          </span>
          <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-lime-400/15 text-lime-300 border border-lime-400/30">
            AVOCADO OPS
          </span>
        </a>

        <div className="hidden xl:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/12 border border-emerald-400/25 text-xs font-medium text-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <span>Hệ Thống Trực Tuyến</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <AdminClock />

        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="min-h-[44px] min-w-[44px] px-3.5 rounded-xl bg-[#0a170a] border border-[rgba(163,230,53,0.18)] text-[13px] font-semibold text-[#f4fbf0] hover:bg-lime-400/10 hover:border-lime-400/35 inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer"
        >
          <ExternalLink className="w-4 h-4 text-lime-400 shrink-0" aria-hidden="true" />
          <span>Xem Web Cinema</span>
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="min-h-[44px] min-w-[44px] px-3.5 rounded-xl bg-red-500/15 border border-red-400/35 text-[13px] font-semibold text-red-200 hover:bg-red-500/25 hover:border-red-400/50 inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer"
        >
          <LogOut className="w-4 h-4 text-red-300 shrink-0" aria-hidden="true" />
          <span>Đăng xuất</span>
        </button>
      </div>
    </header>
  );
});

AdminHeader.displayName = 'AdminHeader';
