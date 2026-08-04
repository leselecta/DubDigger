import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dub Digger",
  description: "Follow the credits. A map of scenes, drawn from Discogs data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-line px-4 py-2">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Dub Digger
          </Link>
        </header>
        <main className="px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
