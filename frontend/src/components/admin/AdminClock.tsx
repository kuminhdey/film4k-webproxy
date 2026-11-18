// frontend/src/components/admin/AdminClock.tsx
import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

export const AdminClock: React.FC = React.memo(() => {
  const [timeStr, setTimeStr] = useState(() => new Date().toLocaleTimeString('vi-VN'));

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!document.hidden) {
        setTimeStr(new Date().toLocaleTimeString('vi-VN'));
      }
    };

    const start = () => {
      if (timer) clearInterval(timer);
      tick();
      timer = setInterval(tick, 1000);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    if (!document.hidden) {
      start();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return (
    <div
      className="hidden lg:inline-flex items-center gap-1.5 text-[13px] font-medium text-[#9ab395] tabular-nums select-none"
      aria-label={`Đồng hồ hệ thống: ${timeStr}`}
    >
      <Clock className="w-4 h-4 text-lime-400 shrink-0" aria-hidden="true" />
      <span>{timeStr}</span>
    </div>
  );
});

AdminClock.displayName = 'AdminClock';
