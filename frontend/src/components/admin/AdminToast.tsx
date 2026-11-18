// frontend/src/components/admin/AdminToast.tsx
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { ToastState } from './adminTypes';

interface AdminToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

export const AdminToast: React.FC<AdminToastProps> = React.memo(({ toast, onDismiss }) => {
  if (!toast) return null;

  const isError = toast.variant === 'error';
  const isWarning = toast.variant === 'warning';

  const containerClass = isError
    ? 'bg-[#170a0a]/95 border-red-400/45 text-[#f4fbf0]'
    : isWarning
      ? 'bg-[#171207]/95 border-amber-400/45 text-[#f4fbf0]'
      : 'bg-[#0a170a]/95 border-lime-400/40 text-[#f4fbf0]';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`fixed top-20 right-4 z-50 max-w-[min(420px,calc(100vw-2rem))] rounded-xl border px-4 py-2.5 shadow-2xl backdrop-blur-md flex items-center gap-3 text-sm font-medium transition-opacity motion-reduce:transition-none ${containerClass}`}
    >
      {isError ? (
        <AlertCircle className="w-5 h-5 text-red-300 shrink-0" aria-hidden="true" />
      ) : isWarning ? (
        <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="w-5 h-5 text-lime-400 shrink-0" aria-hidden="true" />
      )}
      <span className="flex-1 leading-snug break-words">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Đóng thông báo"
        className="min-h-[44px] min-w-[44px] -my-2 -mr-2 inline-flex items-center justify-center rounded-lg text-[#9ab395] hover:text-[#f4fbf0] hover:bg-white/5 transition-colors motion-reduce:transition-none cursor-pointer"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
});

AdminToast.displayName = 'AdminToast';
