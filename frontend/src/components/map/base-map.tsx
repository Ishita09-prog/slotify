"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, useMap } from "react-leaflet";
import { BasemapLayer } from "./basemap-layer";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

function FlyTo({ target, zoom }: { target?: { lat: number; lng: number } | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], zoom ?? Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [target, zoom, map]);
  return null;
}

export function BaseMap({
  center, zoom = 13, className, children, flyTo,
}: {
  center: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  children?: React.ReactNode;
  flyTo?: { lat: number; lng: number } | null;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      scrollWheelZoom
      className={cn("h-full w-full", className)}
      attributionControl
    >
      <BasemapLayer theme={resolvedTheme === "light" ? "light" : "dark"} />
      <FlyTo target={flyTo} />
      {children}
    </MapContainer>
  );
}
