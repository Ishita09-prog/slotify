"use client";

import { MapPinned } from "lucide-react";
import { CITY_LIST, type CityId } from "@/lib/cities";
import { useCity } from "@/lib/city";
import { cn } from "@/lib/utils";

/** Deployment switcher: the same platform serving multiple cities. */
export function CitySwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const { city, setCity } = useCity();
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/40 py-1 pl-2.5 pr-1 text-xs font-semibold",
        className
      )}
    >
      <MapPinned className="size-3.5 text-primary" aria-hidden />
      {!compact && <span className="hidden text-muted-foreground md:inline">City</span>}
      <select
        value={city.id}
        onChange={(e) => setCity(e.target.value as CityId)}
        aria-label="Switch city deployment"
        className="max-w-[5.5rem] cursor-pointer appearance-none truncate rounded-full bg-transparent py-0.5 pl-1 pr-5 sm:max-w-none font-semibold text-foreground focus:outline-none"
      >
        {CITY_LIST.map((c) => (
          <option key={c.id} value={c.id} className="bg-card text-foreground">
            {c.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 text-[9px] text-muted-foreground">▼</span>
    </label>
  );
}
