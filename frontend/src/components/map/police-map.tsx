"use client";

import { CircleMarker, Popup, Tooltip } from "react-leaflet";
import type { LegalParking, Violation } from "@/lib/types";
import { useCity } from "@/lib/city";
import { BaseMap } from "./base-map";
import { formatDateTime } from "@/lib/utils";

export default function PoliceMap({
  violations, legal, showLegal = true, showIllegal = true, flyTo,
}: {
  violations: Violation[];
  legal: LegalParking[];
  showLegal?: boolean;
  showIllegal?: boolean;
  flyTo?: { lat: number; lng: number } | null;
}) {
  const { city } = useCity();
  return (
    <BaseMap center={city.center} zoom={city.zoom + 1} flyTo={flyTo}>
      {showLegal &&
        legal.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={6}
            pathOptions={{ color: "#fff", weight: 1.5, fillColor: "hsl(142 70% 42%)", fillOpacity: 0.95 }}
          >
            <Tooltip direction="top">{p.vehicleNumber} · legally parked at {p.lotName}</Tooltip>
          </CircleMarker>
        ))}
      {showIllegal &&
        violations
          .filter((v) => v.status !== "resolved")
          .map((v) => (
            <CircleMarker
              key={v.id}
              center={[v.lat, v.lng]}
              radius={v.status === "detected" ? 10 : 8}
              pathOptions={{ color: "#fff", weight: 2, fillColor: "hsl(0 80% 56%)", fillOpacity: 0.95 }}
            >
              <Popup>
                <div className="w-52 space-y-1 text-xs">
                  <p className="font-display text-sm font-bold">{v.vehicleNumber}</p>
                  <p>{v.type}</p>
                  <p className="text-muted-foreground">{v.location}</p>
                  <p className="text-muted-foreground">{formatDateTime(v.at)} · {v.camera}</p>
                  <p>AI confidence {Math.round(v.confidence * 100)}% · Fine ₹{v.fine}</p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
    </BaseMap>
  );
}
