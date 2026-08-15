"use client";

/**
 * Global Sonner host — mutation toasts for bay, roster, and walk logs.
 * Theme tokens come from the document; this is presentation only.
 */

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      richColors
      closeButton
      duration={2800}
      toastOptions={{
        className: "glass-card !rounded-xl border text-sm font-semibold",
      }}
    />
  );
}
