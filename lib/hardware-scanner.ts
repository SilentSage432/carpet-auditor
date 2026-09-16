/**
 * Window-level hardware barcode scanner listener.
 * Detects Bluetooth / Zebra / Honeywell keyboard-wedge bursts without
 * requiring the soft keyboard or an focused input.
 * Presentation sections register a scan handler while mounted.
 */

"use client";

import { useEffect, useRef } from "react";
import {
  SCANNER_BURST_MIN_DIGITS,
  SCANNER_DEBOUNCE_MS,
  SCANNER_INTER_KEY_MS,
  sanitizeBarcodeScan,
} from "./barcode";

export type GlobalBarcodeScannerOptions = {
  /**
   * Normalize wedge buffer before onScan. Default: sanitizeBarcodeScan (digits,
   * strip leading zeros) for flooring. Appliance path must pass canonical
   * physical-scan normalization (APP-UPC-001A) so leading zeros / ESL chars survive.
   */
  normalize?: (raw: string) => string;
};

function isDedicatedScanField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.closest("[data-barcode-scan='true']") != null;
}

function dialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"]') != null;
}

/**
 * Listen for rapid key bursts at the window level and invoke onScan.
 * Skips when a dedicated scan input already has focus (NumberField handles it)
 * or when a modal dialog is open.
 */
export function useGlobalBarcodeScanner(
  onScan: (barcode: string) => void,
  enabled = true,
  options: GlobalBarcodeScannerOptions = {}
): void {
  const onScanRef = useRef(onScan);
  const normalizeRef = useRef(options.normalize ?? sanitizeBarcodeScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    normalizeRef.current = options.normalize ?? sanitizeBarcodeScan;
  }, [options.normalize]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let buffer = "";
    let lastKeyAt = 0;
    let burstActive = false;
    let debounceTimer: number | null = null;

    function reset() {
      buffer = "";
      lastKeyAt = 0;
      burstActive = false;
      if (debounceTimer != null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }

    function commit() {
      const normalized = normalizeRef.current(buffer);
      reset();
      if (!normalized || normalized.length < SCANNER_BURST_MIN_DIGITS) return;
      onScanRef.current(normalized);
    }

    function scheduleCommit() {
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        commit();
      }, SCANNER_DEBOUNCE_MS);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (dialogOpen()) return;

      const target = e.target;
      // Dedicated SKU scan fields already resolve via NumberField.
      if (isDedicatedScanField(target)) return;

      if (e.key === "Enter") {
        if (
          burstActive &&
          normalizeRef.current(buffer).length >= SCANNER_BURST_MIN_DIGITS
        ) {
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else {
          reset();
        }
        return;
      }

      if (e.key === "Escape") {
        reset();
        return;
      }

      // Single printable character (scanner wedges emit these rapidly)
      if (e.key.length !== 1) return;

      const now = Date.now();
      const gap = lastKeyAt > 0 ? now - lastKeyAt : 0;

      if (lastKeyAt > 0 && gap > SCANNER_INTER_KEY_MS) {
        // Human typing pace — abandon burst; allow normal input.
        buffer = e.key;
        lastKeyAt = now;
        burstActive = false;
        if (debounceTimer != null) {
          window.clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        return;
      }

      if (lastKeyAt > 0 && gap <= SCANNER_INTER_KEY_MS) {
        burstActive = true;
      }

      buffer += e.key;
      lastKeyAt = now;

      if (!burstActive) return;

      // Divert wedge keystrokes away from measure / qty / other fields.
      e.preventDefault();
      e.stopPropagation();

      if (normalizeRef.current(buffer).length >= SCANNER_BURST_MIN_DIGITS) {
        scheduleCommit();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      reset();
    };
  }, [enabled]);
}
