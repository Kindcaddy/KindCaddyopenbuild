import type { Metadata } from "next";
import { Source_Sans_3, Space_Grotesk, Space_Mono } from "next/font/google";
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
