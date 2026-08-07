import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

/*
 * next/font self-hosts at build time, so the design's IBM Plex Mono arrives
 * with no request to Google at runtime. That matters here beyond performance:
 * the deploy target is one small VPS serving one SQLite file, and a webfont CDN
 * would be the only third party the app touches.
 *
 * Helvetica Neue is a system font on the machines this is designed for and is
 * left as a plain stack, since downloading a fallback for it would defeat the
 * point.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dub Digger — the dub techno index",
  description:
    "Follow the credits, not the algorithm. A map of scenes drawn from Discogs credit data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plexMono.variable}>
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
