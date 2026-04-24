import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import LangHydrator from "@/components/Layout/LangHydrator";

const geist = Geist({
  subsets: ["latin"],
  variable: "--geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClauFlow",
  description: "Agentic Kanban board — TODO → DOING → REVIEW → DONE",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme');if(t==='light')document.documentElement.classList.add('light');})()` }} />
      </head>
      <body className="min-h-screen text-zinc-100 antialiased">
        <LangHydrator />
        {children}
      </body>
    </html>
  );
}
