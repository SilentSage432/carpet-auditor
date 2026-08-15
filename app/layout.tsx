import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { HapticsListener } from "@/components/hub/HapticsListener";
import { OfflineNetworkBanner } from "@/components/hub/OfflineNetworkBanner";
import { ServiceWorkerRegister } from "@/components/hub/ServiceWorkerRegister";
import { ConflictResolutionModal } from "@/components/offline/ConflictResolutionModal";
import { Toaster } from "@/components/ui/Toaster";
import { ThemeProvider } from "@/lib/theme-context";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { UserPreferencesHost } from "@/components/hub/UserPreferencesHost";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeptSync Hub · Department & SIMS Audit",
  description:
    "Department & SIMS Inventory Audit Suite for Lowe's Stores",
  applicationName: "DeptSync Hub",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      nosnippet: true,
      noarchive: true,
    },
  },
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
      data-theme="midnight"
      data-contrast="normal"
      data-density="comfortable"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <ThemeProvider>
          <ServiceWorkerRegister />
          <HapticsListener />
          <UserPreferencesHost />
          <OfflineNetworkBanner />
          <ConflictResolutionModal />
          <Toaster />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
