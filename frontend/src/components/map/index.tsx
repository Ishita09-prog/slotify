"use client";

import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";

function MapLoading() {
  return (
    <div className="grid h-full w-full place-items-center rounded-xl bg-secondary/50">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="size-4 animate-bounce" /> Loading map…
      </span>
    </div>
  );
}

// Leaflet touches `window`, so maps only render on the client.
export const LotsMap = dynamic(() => import("./lots-map"), { ssr: false, loading: MapLoading });
export const PoliceMap = dynamic(() => import("./police-map"), { ssr: false, loading: MapLoading });
export const ZonesMap = dynamic(() => import("./zones-map"), { ssr: false, loading: MapLoading });
export const PickMap = dynamic(() => import("./pick-map"), { ssr: false, loading: MapLoading });
