import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadSleep — Find Hotels on the Road",
  description: "Mom-and-pop highway hotels by mile marker. No bookings, just call.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
