"use client";

/**
 * Floor Pad typography fonts — CSS families (next/font variables on <html>).
 */

export const FLOOR_PAD_FONTS = [
  {
    id: "inter",
    label: "Inter",
    css: "var(--font-inter), ui-sans-serif, sans-serif",
  },
  {
    id: "roboto-mono",
    label: "Roboto Mono",
    css: "var(--font-roboto-mono), ui-monospace, monospace",
  },
  {
    id: "merriweather",
    label: "Merriweather",
    css: "var(--font-merriweather), ui-serif, Georgia, serif",
  },
  {
    id: "caveat",
    label: "Handwriting",
    css: "var(--font-caveat), cursive",
  },
] as const;

export const FLOOR_PAD_SIZES = [
  { id: "sm", label: "S", css: "0.875rem" },
  { id: "md", label: "M", css: "1rem" },
  { id: "lg", label: "L", css: "1.25rem" },
  { id: "xl", label: "XL", css: "1.5rem" },
] as const;
