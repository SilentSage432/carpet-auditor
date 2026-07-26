import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flooring Hub — SIMS Audit",
    short_name: "Flooring Hub",
    description:
      "Universal flooring & SIMS location audits, catalog building, and remnant rack.",
    start_url: "/",
    display: "standalone",
    background_color: "#022c22",
    theme_color: "#022c22",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
