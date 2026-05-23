import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import BackgroundFx from "@/components/BackgroundFx";

export const metadata: Metadata = {
  title: "Treble Trouble — Conduct your orchestra",
  description: "A digital concert hall for composers, conductors and ensembles.",
};

export const viewport: Viewport = {
  width: 1440,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <BackgroundFx />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
