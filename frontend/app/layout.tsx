import type { Metadata } from "next";
import { Source_Sans_3, Space_Grotesk, Space_Mono } from "next/font/google";
import AppChrome from "@/components/AppChrome";
import "./globals.css";

// Self-hosted at build time so the fonts load under the production CSP
// (`font-src 'self' data:`), unlike a fonts.googleapis.com stylesheet.
const displayFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-kc-display",
  display: "swap",
});

const bodyFont = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-kc-body",
  display: "swap",
});

const monoFont = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-kc-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KindCaddy - Your AI-Powered SaaS Platform",
  description: "Modern SaaS platform built with Next.js",
};

/**
 * Render every page per-request, never from the build route cache.
 *
 * Why at the ROOT: the /app pages branch on live session state, and a
 * prerendered copy was served frozen to anonymous requests
 * (x-nextjs-cache: HIT, s-maxage=31536000) — the incident class from
 * POSTMORTEM-ROOT-LAYOUT-COLLISION.md. The obvious fix, a layout with
 * force-dynamic under app/app/, is NOT survivable: the Linux root/app
 * segment shadowing treats app/app/layout.tsx as the effective root
 * layout, which (a) dropped globals.css from the build graph entirely
 * (zero .next/static/css) and (b) replaced this shell for /app pages
 * (served without <html>/fonts/AppChrome). This root layout is the one
 * file that renders correctly on both macOS and Linux, so the export
 * lives here. Side effect: /login, /dashboard, /dev/login also go
 * dynamic — harmless at this traffic level.
 *
 * Verify post-deploy: `curl -sI /app` shows no x-nextjs-cache; served
 * /app HTML starts with <!DOCTYPE html> and contains kc-appbar.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <body className="antialiased">
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
