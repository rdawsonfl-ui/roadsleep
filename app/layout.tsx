import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "./Nav";
import PWAInit from "./PWAInit";
// Vercel Web Analytics — anonymous, GDPR-compliant page-view tracking.
// Free up to 2,500 events/month; scales automatically. Once deployed,
// stats appear at vercel.com/<account>/<project>/analytics:
//   - Page views per route (/ vs /search vs /hotelier vs /admin)
//   - Unique visitors per day/week/month
//   - Geographic + device breakdowns
//   - Top referrers (Google, direct, social, etc.)
// No cookies. No personal data. No setup beyond importing this component.
import { Analytics } from "@vercel/analytics/react";
import SourceTracker from "./components/SourceTracker";

export const metadata: Metadata = {
  title: "RoadSleep™ – Find a Stop by Mile Marker",
  description: "Hotels and RV parks along major interstates — find your next stop fast.",
  // PWA metadata. The manifest tells phones we're installable; the
  // apple-touch-icon is what iOS uses on the home screen since iOS
  // doesn't read the manifest's icons directly.
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RoadSleep™",
  },
};

// Viewport metadata — separate from `metadata` per Next.js 16 conventions.
// theme-color drives the Android Chrome address bar color and the splash
// background on PWA launch.
export const viewport: Viewport = {
  themeColor: "#0d0f14",
  width: "device-width",
  initialScale: 1,
  // Don't let the user zoom out past 1x; the layout already handles small
  // screens. Pinch-to-zoom IN is still allowed (default).
  minimumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint.

          This has to be a blocking inline script in <head>, not a useEffect.
          React effects run after the first paint, so a driver who picked Day
          mode would get a full-screen flash of the dark theme on every single
          page load — worse on slow connections, and unmissable on a phone.

          Defaults to dark when nothing is stored, matching the server-rendered
          data-theme="dark" above so hydration stays consistent.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('rs_theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Nav />
        {children}
        <Analytics />
        <SourceTracker />
        <PWAInit />
      </body>
    </html>
  );
}
