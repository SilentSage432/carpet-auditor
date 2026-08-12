/**
 * Executive Floor Pad typography — Google Font family stacks for TipTap marks.
 * Loaded dynamically when the pad opens (see loadFloorPadFonts).
 */

export type FloorPadFontCategory =
  | "sans"
  | "serif"
  | "mono"
  | "handwriting";

export type FloorPadFont = {
  id: string;
  label: string;
  /** CSS font-family stack applied to TipTap TextStyle. */
  css: string;
  category: FloorPadFontCategory;
};

export const FLOOR_PAD_FONTS: FloorPadFont[] = [
  // Sans
  {
    id: "inter",
    label: "Inter",
    css: '"Inter", ui-sans-serif, sans-serif',
    category: "sans",
  },
  {
    id: "montserrat",
    label: "Montserrat",
    css: '"Montserrat", ui-sans-serif, sans-serif',
    category: "sans",
  },
  {
    id: "poppins",
    label: "Poppins",
    css: '"Poppins", ui-sans-serif, sans-serif',
    category: "sans",
  },
  {
    id: "open-sans",
    label: "Open Sans",
    css: '"Open Sans", ui-sans-serif, sans-serif',
    category: "sans",
  },
  // Serif
  {
    id: "merriweather",
    label: "Merriweather",
    css: '"Merriweather", ui-serif, Georgia, serif',
    category: "serif",
  },
  {
    id: "playfair",
    label: "Playfair Display",
    css: '"Playfair Display", ui-serif, Georgia, serif',
    category: "serif",
  },
  {
    id: "lora",
    label: "Lora",
    css: '"Lora", ui-serif, Georgia, serif',
    category: "serif",
  },
  {
    id: "cormorant",
    label: "Cormorant Garamond",
    css: '"Cormorant Garamond", ui-serif, Georgia, serif',
    category: "serif",
  },
  // Mono
  {
    id: "roboto-mono",
    label: "Roboto Mono",
    css: '"Roboto Mono", ui-monospace, monospace',
    category: "mono",
  },
  {
    id: "fira-code",
    label: "Fira Code",
    css: '"Fira Code", ui-monospace, monospace',
    category: "mono",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    css: '"JetBrains Mono", var(--font-jetbrains), ui-monospace, monospace',
    category: "mono",
  },
  // Handwriting / script
  {
    id: "caveat",
    label: "Caveat",
    css: '"Caveat", cursive',
    category: "handwriting",
  },
  {
    id: "kalam",
    label: "Kalam",
    css: '"Kalam", cursive',
    category: "handwriting",
  },
  {
    id: "dancing-script",
    label: "Dancing Script",
    css: '"Dancing Script", cursive',
    category: "handwriting",
  },
  {
    id: "shadows-into-light",
    label: "Shadows Into Light",
    css: '"Shadows Into Light", cursive',
    category: "handwriting",
  },
];

export const FLOOR_PAD_FONT_GROUPS: {
  id: FloorPadFontCategory;
  label: string;
}[] = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
  { id: "handwriting", label: "Handwriting" },
];

export const FLOOR_PAD_SIZES = [
  { id: "sm", label: "S", css: "0.875rem" },
  { id: "md", label: "M", css: "1rem" },
  { id: "lg", label: "L", css: "1.25rem" },
  { id: "xl", label: "XL", css: "1.5rem" },
] as const;

/** Google Fonts CSS2 URL for the Floor Pad suite (loaded once when pad opens). */
export const FLOOR_PAD_GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?" +
  [
    "family=Inter:wght@400;600;700",
    "family=Montserrat:wght@400;600;700",
    "family=Poppins:wght@400;600;700",
    "family=Open+Sans:wght@400;600;700",
    "family=Merriweather:wght@400;700",
    "family=Playfair+Display:wght@400;700",
    "family=Lora:wght@400;700",
    "family=Cormorant+Garamond:wght@400;600;700",
    "family=Roboto+Mono:wght@400;600;700",
    "family=Fira+Code:wght@400;600;700",
    "family=JetBrains+Mono:wght@400;600;700",
    "family=Caveat:wght@400;600;700",
    "family=Kalam:wght@400;700",
    "family=Dancing+Script:wght@400;600;700",
    "family=Shadows+Into+Light",
  ].join("&") +
  "&display=swap";

const FLOOR_PAD_FONTS_LINK_ID = "floor-pad-google-fonts";

/** Inject Google Fonts stylesheet once (idempotent). */
export function loadFloorPadFonts(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(FLOOR_PAD_FONTS_LINK_ID)) return;
  const link = document.createElement("link");
  link.id = FLOOR_PAD_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = FLOOR_PAD_GOOGLE_FONTS_HREF;
  document.head.appendChild(link);
}
