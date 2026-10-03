"use client";

import { TileLayer } from "react-leaflet";

/**
 * Basemap tiles.
 * - With NEXT_PUBLIC_CARTO_KEY set: CARTO (free key from carto.com/basemaps/apikey).
 * - Without a key: Esri Canvas (dark) / OpenStreetMap (light) — no key needed.
 * CARTO started watermarking anonymous tiles ("API KEY REQUIRED"), so keyless CARTO is never used.
 */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY?.trim();

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function BasemapLayer({ theme }: { theme: "dark" | "light" }) {
  if (CARTO_KEY) {
    const style = theme === "dark" ? "dark_all" : "rastertiles/voyager";
    return (
      <TileLayer
        key={`carto-${theme}`}
        url={`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`}
        attribution={`${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`}
        subdomains="abcd"
        maxZoom={20}
      />
    );
  }
  if (theme === "dark") {
    return (
      <>
        <TileLayer
          key="esri-dark"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
          maxNativeZoom={16}
          maxZoom={20}
        />
        <TileLayer
          key="esri-dark-labels"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={16}
          maxZoom={20}
          zIndex={2}
        />
      </>
    );
  }
  return (
    <TileLayer
      key="osm"
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution={OSM_ATTR}
      maxNativeZoom={19}
      maxZoom={20}
    />
  );
}
