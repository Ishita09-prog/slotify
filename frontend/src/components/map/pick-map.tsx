"use client";

import L from "leaflet";
import { Marker, useMapEvents } from "react-leaflet";
import { BaseMap } from "./base-map";

const pin = L.divIcon({
  className: "slotify-pin",
  iconSize: [36, 46],
  iconAnchor: [18, 44],
  html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 6px 10px rgba(0,0,0,.4))">
    <div style="width:36px;height:36px;border-radius:12px;background:hsl(224 100% 59%);color:#fff;display:grid;place-items:center;font:800 18px sans-serif;border:2px solid #fff">P</div>
    <div style="width:3px;height:9px;background:#fff"></div></div>`,
});

function Clicker({ onPick }: { onPick: (p: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Owner taps the map to drop their parking entrance. */
export default function PickMap({ value, onPick, flyTo }: { value: { lat: number; lng: number }; onPick: (p: { lat: number; lng: number }) => void; flyTo?: { lat: number; lng: number } | null }) {
  return (
    <BaseMap center={value} zoom={15} flyTo={flyTo}>
      <Clicker onPick={onPick} />
      <Marker position={[value.lat, value.lng]} icon={pin} draggable eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); onPick({ lat: ll.lat, lng: ll.lng }); } }} />
    </BaseMap>
  );
}
