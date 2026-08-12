import type { Metadata, Viewport } from "next";
import { Barlow, JetBrains_Mono } from "next/font/google";
import { HapticsListener } from "@/components/hub/HapticsListener";
import { OfflineNetworkBanner } from "@/components/hub/OfflineNetworkBanner";
import { ServiceWorkerRegister } from "@/components/hub/ServiceWorkerRegister";
import { ConflictResolutionModal } from "@/components/offline/ConflictResolutionModal";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "DeptSync Hub · Department & SIMS Audit",
  description:
    "Department & SIMS Inventory Audit Suite for Lowe's Stores",
  applicationName: "DeptSync Hub",
  appleWebApp: {
    capable: true,
    title: "DeptSync",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#090d16",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        <HapticsListener />
        <OfflineNetworkBanner />
        <ConflictResolutionModal />
        {children}
      </body>
    </html>
  );
}
