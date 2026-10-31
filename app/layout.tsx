import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./light-theme.css";
import "./design-system.css";
import ServiceWorkerRegister from "./sw-register";

export const metadata: Metadata = {
  title: "Atlantic Home",
  description: "Керування кліматом Atlantic Cozytouch",
  applicationName: "Atlantic Home",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Atlantic Home" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f4f8fc"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="uk"><head><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" /></head><body><ServiceWorkerRegister />{children}</body></html>;
}
