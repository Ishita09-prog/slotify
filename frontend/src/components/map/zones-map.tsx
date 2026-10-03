"use client";

import { Circle, Tooltip } from "react-leaflet";
import type { Zone } from "@/lib/types";
import { useCity } from "@/lib/city";
import { BaseMap } from "./base-map";

export const DEMAND_COLOR: Record<Zone["demand"], string> = {
  high: "hsl(0 80% 56%)",
  medium: "hsl(40 95% 50%)",
  low: "hsl(142 70% 42%)",
};

export default function ZonesMap({ zones, activeId }: { zones: Zone[]; activeId?: string | null }) {
  const { city } = useCity();
  return (
    <BaseMap center={city.center} zoom={city.zoom}>
      {zones.map((z) => (
        <Circle
          key={z.id}
          center={[z.lat, z.lng]}
          radius={z.radius}
          pathOptions={{
            color: DEMAND_COLOR[z.demand],
            weight: activeId === z.id ? 4 : 2,
            fillColor: DEMAND_COLOR[z.demand],
            fillOpacity: activeId === z.id ? 0.35 : 0.2,
          }}
        >
          <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none">
            <span className="font-display text-[11px] font-bold">{z.name}</span>
          </Tooltip>
        </Circle>
      ))}
    </BaseMap>
  );
}
