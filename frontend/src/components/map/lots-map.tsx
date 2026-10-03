"use client";

import L from "leaflet";
import Link from "next/link";
import { CircleMarker, Marker, Popup } from "react-leaflet";
import type { LotWithStats } from "@/lib/types";
import { BaseMap } from "./base-map";
import { formatINR, googleMapsDirectionsUrl } from "@/lib/utils";

function colorFor(o: number) {
  if (o >= 0.85) return "hsl(var(--status-occupied))";
  if (o >= 0.6) return "hsl(var(--status-reserved))";
  return "hsl(var(--status-available))";
}

function lotIcon(lot: LotWithStats, active: boolean) {
  const c = colorFor(lot.occupancy);
  const size = active ? 50 : 42;
  return L.divIcon({
    className: "slotify-pin",
    iconSize: [size, size + 10],
    iconAnchor: [size / 2, size + 8],
    popupAnchor: [0, -size],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))">
        <div style="min-width:${size}px;height:${size - 10}px;padding:0 8px;border-radius:10px;background:hsl(var(--card));border:2.5px solid ${c};display:flex;align-items:center;justify-content:center;gap:4px;font:800 ${active ? 15 : 13}px 'Archivo Variable',sans-serif;color:hsl(var(--foreground))">
          <span style="width:16px;height:16px;border-radius:4px;background:hsl(var(--primary));color:#fff;font-size:11px;display:grid;place-items:center">P</span>${lot.available}
        </div>
        <div style="width:3px;height:10px;background:${c}"></div>
      </div>`,
  });
}

export default function LotsMap({
  lots, origin, activeId, onSelect, flyTo, hrefFor,
}: {
  hrefFor?: (id: string) => string;
  lots: LotWithStats[];
  origin: { lat: number; lng: number };
  activeId?: string | null;
  onSelect?: (id: string) => void;
  flyTo?: { lat: number; lng: number } | null;
}) {
  return (
    <BaseMap center={origin} zoom={13} flyTo={flyTo}>
      <CircleMarker
        center={[origin.lat, origin.lng]}
        radius={8}
        pathOptions={{ color: "#fff", weight: 3, fillColor: "hsl(224 100% 60%)", fillOpacity: 1 }}
      >
        <Popup>You are here</Popup>
      </CircleMarker>
      {lots.map((lot) => (
        <Marker
          key={lot.id}
          position={[lot.lat, lot.lng]}
          icon={lotIcon(lot, activeId === lot.id)}
          eventHandlers={{ click: () => onSelect?.(lot.id) }}
          zIndexOffset={activeId === lot.id ? 1000 : 0}
        >
          <Popup>
            <div className="w-56 space-y-2">
              <p className="font-display text-sm font-bold leading-tight">{lot.name}</p>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div><p className="text-base font-extrabold text-status-available">{lot.available}</p>free</div>
                <div><p className="text-base font-extrabold">{Math.round(lot.occupancy * 100)}%</p>full</div>
                <div><p className="text-base font-extrabold">{formatINR(lot.pricePerHour)}</p>per hour</div>
              </div>
              <div className="flex gap-2 pt-1">
                <Link href={hrefFor ? hrefFor(lot.id) : `/user/lots/${lot.id}`} className="flex-1 rounded-md bg-primary px-2 py-1.5 text-center text-xs font-semibold !text-white">
                  Choose a slot
                </Link>
                <a
                  href={googleMapsDirectionsUrl(lot, origin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-md border px-2 py-1.5 text-center text-xs font-semibold"
                >
                  Navigate
                </a>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </BaseMap>
  );
}
