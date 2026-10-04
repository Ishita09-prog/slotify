import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/public-sans";
import "./globals.css";
import { Providers } from "@/components/layout/providers";
import { Ambient } from "@/components/fx/ambient";

export const metadata: Metadata = {
  title: { default: "Slotify — Smart Parking Command Platform", template: "%s · Slotify" },
  description:
    "See live parking availability, reserve a bay, pay with FASTag, and give city police real-time visibility of illegal parking.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDF0F4" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1420" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
        <Ambient />
      </body>
    </html>
  );
}
