"use client";

import Link from "next/link";
import { Clock, Navigation, Route } from "lucide-react";
import type { LotWithStats } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { OccupancyBar, occupancyTone } from "./occupancy";
import { cn, formatINR, googleMapsDirectionsUrl } from "@/lib/utils";

export function LotCard({
  lot, origin, active, onHover,
}: {
  lot: LotWithStats;
  origin?: { lat: number; lng: number };
  active?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const tone = occupancyTone(lot.occupancy);
  const full = lot.available === 0 || !!lot.stale;
  return (
    <article
      onMouseEnter={() => onHover?.(lot.id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        "glass rounded-2xl p-4 transition-shadow",
        active && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold">{lot.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{lot.area} · {lot.openHours}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {lot.distanceKm !== undefined && (
              <span className="flex items-center gap-1"><Route className="size-3.5" />{lot.distanceKm.toFixed(1)} km</span>
            )}
            {lot.etaMin !== undefined && (
              <span className="flex items-center gap-1"><Clock className="size-3.5" />{lot.etaMin} min drive</span>
            )}
            <span className="font-semibold text-foreground">{formatINR(lot.pricePerHour)}/h</span>
          </div>
        </div>
        <div className="text-right">
          <p className={cn("font-display text-3xl font-extrabold leading-none tabular-nums", lot.stale ? "text-muted-foreground" : tone.text)}>
            {lot.stale ? "~" : ""}{lot.available}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{lot.stale ? "estimate · camera offline" : `of ${lot.total} free`}</p>
        </div>
      </div>
      <OccupancyBar value={lot.occupancy} className="mt-3" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button asChild size="sm" disabled={full} className={cn(full && "pointer-events-none opacity-50")}>
          <Link href={`/user/lots/${lot.id}`}>{lot.stale ? "Bookings paused" : full ? "Full right now" : "Choose a slot"}</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={googleMapsDirectionsUrl(lot, origin)} target="_blank" rel="noopener noreferrer">
            <Navigation /> Navigate
          </a>
        </Button>
      </div>
    </article>
  );
}
