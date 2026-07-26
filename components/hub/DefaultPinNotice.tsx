"use client";

type Props = {
  open: boolean;
  onSetNewPin: () => void;
  onRemindLater: () => void;
};

export function DefaultPinNotice({ open, onSetNewPin, onRemindLater }: Props) {
  if (!open) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-16 z-[55] mx-auto w-full max-w-md px-4 pb-4"
    >
      <div className="rounded-2xl border border-amber-500/40 bg-amber-950/95 p-4 shadow-2xl backdrop-blur">
        <p className="text-sm font-semibold text-amber-100">Security Notice</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-100/85">
          You are using the default PIN (1234). Would you like to set a new custom
          PIN now?
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRemindLater}
            className="flex min-h-12 items-center justify-center rounded-xl border border-amber-500/30 text-sm font-semibold text-amber-100"
          >
            Remind Me Later
          </button>
          <button
            type="button"
            onClick={onSetNewPin}
            className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-500 text-sm font-bold text-slate-950"
          >
            Set New PIN
          </button>
        </div>
      </div>
    </div>
  );
}
