import type { Metadata } from "next";
import "./globals.css";
import Nav from "./Nav";
// Vercel Web Analytics — anonymous, GDPR-compliant page-view tracking.
// Free up to 2,500 events/month; scales automatically. Once deployed,
// stats appear at vercel.com/<account>/<project>/analytics:
//   - Page views per route (/ vs /search vs /hotelier vs /admin)
//   - Unique visitors per day/week/month
//   - Geographic + device breakdowns
//   - Top referrers (Google, direct, social, etc.)
// No cookies. No personal data. No setup beyond importing this component.
import { Analytics } from "@vercel/analytics/react";

export const metadata: Metadata = {
  title: "RoadSleep – Find a Stop by Mile Marker",
  description: "Hotels and RV parks along major interstates — find your next stop fast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
