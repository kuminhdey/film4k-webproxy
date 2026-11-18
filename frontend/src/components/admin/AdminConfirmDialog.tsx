// frontend/src/components/admin/AdminConfirmDialog.tsx
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, Play, Trash2 } from 'lucide-react';
import { ConfirmDialogState } from './adminTypes';

interface AdminConfirmDialogProps {
  dialogState: ConfirmDialogState | null;
  busy: boolean;
  onClose: () => void;
}

export const AdminConfirmDialog: React.FC<AdminConfirmDialogProps> = ({
  dialogState,
  busy,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialogState || !dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [dialogState]);

  if (!dialogState) return null;

  const isDanger = dialogState.variant === 'danger';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="admin-confirm-title"
      aria-describedby="admin-confirm-desc"
      onCancel={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClose();
      }}
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 m-0 w-screen h-screen max-w-none max-h-none bg-black/80 backdrop-blur-sm p-4 z-50 flex items-center justify-center border-0 text-[#f4fbf0]"
    >
      <div className="w-full max-w-[480px] rounded-2xl bg-[#0a170a] border border-[rgba(163,230,53,0.18)] p-6 shadow-2xl">
        <div className="flex items-start gap-3.5 mb-4">
          <div
            className={`w-11 h-11 rounded-xl shrink-0 flex items-center justify-center border ${
              isDanger
                ? 'bg-red-500/15 border-red-400/35 text-red-300'
                : 'bg-lime-400/15 border-lime-400/35 text-lime-400'
            }`}
          >
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="admin-confirm-title" className="text-lg font-bold text-[#f4fbf0] leading-snug">
              {dialogState.title}
            </h2>
            {dialogState.subtitle && (
              <p className="mt-1 text-[13px] text-[#9ab395]">{dialogState.subtitle}</p>
            )}
          </div>
        </div>

        <p id="admin-confirm-desc" className="text-sm text-[#f4fbf0]/90 leading-relaxed mb-6">
          {dialogState.description}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-[#060b05] border border-[rgba(163,230,53,0.18)] text-[13px] font-semibold text-[#f4fbf0] enabled:hover:bg-white/5 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Hủy bỏ
          </button>

          <button
            type="button"
            onClick={() => {
              void dialogState.onConfirm();
            }}
            disabled={busy}
            className={`min-h-[44px] min-w-[44px] px-5 rounded-xl text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isDanger
                ? 'bg-red-400 enabled:hover:bg-red-300 text-[#060b05]'
                : 'bg-lime-400 enabled:hover:bg-lime-300 text-[#060b05]'
            }`}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : isDanger ? (
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
            )}
            <span>{dialogState.confirmLabel}</span>
          </button>
        </div>
      </div>
    </dialog>
  );
};
