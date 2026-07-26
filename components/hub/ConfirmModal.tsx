"use client";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onClose,
  onConfirm,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative z-[61] w-full max-w-md overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl sm:rounded-2xl"
      >
        <h2
          id="confirm-modal-title"
          className="text-lg font-bold text-slate-50"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{message}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-12 items-center justify-center rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex h-12 items-center justify-center rounded-xl text-sm font-bold ${
              danger
                ? "bg-red-500 text-white"
                : "bg-emerald-500 text-slate-950"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
