"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { MotionConfig } from "framer-motion";
import { SlotifyProvider } from "@/lib/store";
import { CityProvider } from "@/lib/city";
import { CommandProvider } from "@/lib/command/store";
import { DriverProvider } from "@/lib/driver";
import { LiveProvider } from "@/lib/live/provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <CityProvider>
          <SlotifyProvider>
            <CommandProvider>
              <LiveProvider>
                <DriverProvider>{children}</DriverProvider>
              </LiveProvider>
              <Toaster richColors position="bottom-right" closeButton />
            </CommandProvider>
          </SlotifyProvider>
        </CityProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
