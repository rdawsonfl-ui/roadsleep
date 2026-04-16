import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadSleep – Find Hotels by Mile Marker",
  description: "Search highway hotels by interstate, direction, and mile marker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
