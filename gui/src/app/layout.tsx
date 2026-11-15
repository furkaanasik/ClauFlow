import type { Metadata } from "next";
import { Jost, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import LangHydrator from "@/components/Layout/LangHydrator";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const jost = Jost({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-jost",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClauFlow — An Almanac for Agentic Engineering",
  description:
    "Drag a task. Claude writes the code, opens a PR, applies your review. A kanban board for autonomous development.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="tr"
      className={`${jost.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <LangHydrator />
        {children}
      </body>
    </html>
  );
}
