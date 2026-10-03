"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, Tooltip, useMap } from "react-leaflet";
import type { useCityLive } from "@/lib/command/hooks";
import type { Forecast } from "@/lib/ml/forecast";
import type { Incident, UnitState } from "@/lib/command/types";
import { centroid, paddedHull } from "@/lib/geo";
import { SEVERITY } from "./ui";
import { BasemapLayer } from "@/components/map/basemap-layer";

export type Layers = { zones: boolean; heat: boolean; lots: boolean; violations: boolean; incidents: boolean; units: boolean; vms: boolean };
export const DEFAULT_LAYERS: Layers = { zones: true, heat: true, lots: true, violations: true, incidents: true, units: true, vms: true };

const DASH = [undefined, "8 6", "2 6", "12 4 2 4"];
const SEV_HEX = { critical: "#ef4444", high: "#fb923c", medium: "#eab308", low: "#38bdf8" };

const occColor = (v: number) => (v >= 0.95 ? "#ef4444" : v >= 0.8 ? "#eab308" : "#22c55e");

function Fit({ bounds, padding = 24 }: { bounds: [number, number][] | null; padding?: number }) {
  const map = useMap();
  const key = bounds ? bounds.map((b) => b.join(",")).join("|") : "";
  const first = useRef(true);
  useEffect(() => {
    if (!bounds || !bounds.length) return;
    const t = window.setTimeout(() => {
      map.invalidateSize();
      const b = L.latLngBounds(bounds);
      if (first.current) map.fitBounds(b, { padding: [padding, padding], maxZoom: 16 });
      else map.flyToBounds(b, { padding: [padding, padding], duration: 0.7, maxZoom: 16 });
      first.current = false;
    }, first.current ? 250 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function Resize() {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 200);
    return () => window.clearTimeout(t);
  }, [map]);
  return null;
}

export default function CommandMap({
  live, forecasts, incidents, units, vms, layers, selectedZone, selectedLot, onZone, onLot, onIncident, height = "100%",
}: {
  live: ReturnType<typeof useCityLive>;
  forecasts: Record<string, Forecast> | null;
  incidents: Incident[];
  units: Record<string, UnitState>;
  vms: Record<string, { message: string }>;
  layers: Layers;
  selectedZone: string | null;
  selectedLot: string | null;
  onZone: (id: string | null) => void;
  onLot: (id: string) => void;
  onIncident?: (id: string) => void;
  height?: string;
}) {
  const { city } = live;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const hulls = useMemo(
    () => city.commandZones.map((z) => ({ zone: z, hull: paddedHull(z.localities, 0.5), c: centroid(z.localities) })),
    [city]
  );

  const bounds = useMemo<[number, number][] | null>(() => {
    if (selectedLot) {
      const l = city.lots.find((x) => x.id === selectedLot);
      if (l) return [[l.lat - 0.004, l.lng - 0.004], [l.lat + 0.004, l.lng + 0.004]];
    }
    if (selectedZone) return hulls.find((h) => h.zone.id === selectedZone)?.hull ?? null;
    return hulls.flatMap((h) => h.hull);
  }, [selectedZone, selectedLot, hulls, city]);

  const locOcc = (lotIds: string[], fallback: number) => {
    const ls = live.lots.filter((l) => lotIds.includes(l.lot.id));
    return ls.length ? ls.reduce((a, l) => a + live.occOf(l), 0) / ls.length : fallback;
  };

  const unitPos = (u: UnitState) => {
    const inc = incidents.find((i) => i.id === u.incidentId);
    if (!inc || !inc.unitDepartAt || !inc.unitEtaAt || u.status === "on_scene") return { lat: u.lat, lng: u.lng, target: null as null | Incident };
    const start = inc.unitDepartAt + 2500;
    const p = Math.max(0, Math.min(1, (now - start) / Math.max(1, inc.unitEtaAt - start)));
    return { lat: u.lat + (inc.lat - u.lat) * p, lng: u.lng + (inc.lng - u.lng) * p, target: inc };
  };

  return (
    <div style={{ height }} className="relative">
      <MapContainer center={[city.center.lat, city.center.lng]} zoom={city.zoom} zoomSnap={0.25} zoomDelta={0.5} scrollWheelZoom className="h-full w-full" zoomControl attributionControl>
        <BasemapLayer theme="dark" />
        <Fit bounds={bounds} padding={16} />
        <Resize />

        {layers.zones &&
          hulls.map(({ zone, hull, c }, i) => {
            const active = selectedZone === zone.id;
            const dim = selectedZone && !active;
            return (
              <Polygon
                key={zone.id}
                positions={hull}
                pathOptions={{
                  color: zone.color,
                  weight: active ? 3 : 1.5,
                  dashArray: DASH[i % DASH.length],
                  fillColor: zone.color,
                  fillOpacity: dim ? 0.02 : active ? 0.1 : 0.06,
                  opacity: dim ? 0.35 : 0.9,
                }}
                eventHandlers={{ click: () => onZone(active ? null : zone.id) }}
              >
                <Tooltip permanent direction="center" className="cc-zone-label" position={[c.lat, c.lng]} opacity={dim ? 0.4 : 1}>
                  {zone.name}
                </Tooltip>
              </Polygon>
            );
          })}

        {layers.heat &&
          city.commandZones.flatMap((z) =>
            z.localities.map((loc) => {
              const zoneStat = live.zones.find((x) => x.zone.id === z.id);
              const occ = locOcc(loc.lotIds, zoneStat?.occupancy ?? 0.6);
              const intensity = Math.min(1, occ * 0.7 + (loc.vehiclesPerHour / 2600) * 0.3);
              const col = intensity > 0.82 ? "#ef4444" : intensity > 0.65 ? "#f97316" : intensity > 0.5 ? "#eab308" : "#22c55e";
              return [
                <Circle key={`${loc.id}-o`} center={[loc.lat, loc.lng]} radius={180 + loc.vehiclesPerHour / 5} pathOptions={{ stroke: false, fillColor: col, fillOpacity: 0.12 }} interactive={false} />,
                <Circle key={`${loc.id}-i`} center={[loc.lat, loc.lng]} radius={90 + loc.vehiclesPerHour / 12} pathOptions={{ stroke: false, fillColor: col, fillOpacity: 0.22 }} interactive={false} />,
              ];
            })
          )}

        {/* locality hotspots (visible when drilled into a zone) */}
        {selectedZone &&
          city.commandZones
            .find((z) => z.id === selectedZone)
            ?.localities.map((loc) => (
              <CircleMarker key={loc.id} center={[loc.lat, loc.lng]} radius={4} pathOptions={{ color: "#94a3b8", weight: 1, fillColor: "#0f172a", fillOpacity: 1 }}>
                <Tooltip direction="top" offset={[0, -4]}>
                  <b>{loc.name}</b> · {loc.vehiclesPerHour.toLocaleString("en-IN")} veh/h peak · {loc.anprCameras} ANPR cams
                </Tooltip>
              </CircleMarker>
            ))}

        {layers.violations &&
          live.violations
            .filter((v) => v.status === "detected" && now - v.at < 30 * 60_000)
            .map((v) => (
              <CircleMarker key={v.id} center={[v.lat, v.lng]} radius={3.5} pathOptions={{ color: "#fecaca", weight: 1, fillColor: "#ef4444", fillOpacity: 0.95 }}>
                <Tooltip direction="top">
                  <b>{v.vehicleNumber}</b> · {v.type} · {Math.round(v.confidence * 100)}% · {v.camera}
                </Tooltip>
              </CircleMarker>
            ))}

        {layers.lots &&
          live.lots.map((l) => {
            const occ = live.occOf(l);
            const f = forecasts?.[l.lot.id];
            const sel = selectedLot === l.lot.id;
            return (
              <CircleMarker
                key={l.lot.id}
                center={[l.lot.lat, l.lot.lng]}
                radius={sel ? 11 : 6 + Math.sqrt(l.s.total) / 2.2}
                pathOptions={{
                  color: l.stale ? "#94a3b8" : sel ? "#e0f2fe" : "#0b1220",
                  weight: sel ? 3 : 2,
                  dashArray: l.stale ? "3 3" : undefined,
                  fillColor: l.stale ? "#64748b" : occColor(occ),
                  fillOpacity: 0.95,
                }}
                eventHandlers={{ click: () => onLot(l.lot.id) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <div className="text-xs">
                    <b>{l.lot.name}</b>
                    <br />
                    {l.stale ? "ESTIMATED " : ""}
                    {Math.round(occ * 100)}% full · {l.stale ? "camera offline" : `${l.s.available} free of ${l.usable}`}
                    {f && (
                      <>
                        <br />
                        In 60 min: {Math.round(f.occupancy * 100)}% ({Math.round(f.low * 100)}–{Math.round(f.high * 100)})
                      </>
                    )}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}

        {layers.vms &&
          city.vmsBoards.map((b) => {
            const m = vms[b.id];
            return (
              <Marker
                key={b.id}
                position={[b.lat, b.lng]}
                icon={L.divIcon({
                  className: "slotify-pin",
                  iconSize: [18, 12],
                  html: `<div style="width:18px;height:12px;border-radius:2px;border:1px solid ${m ? "#fbbf24" : "#475569"};background:${m ? "#422006" : "#0f172a"};box-shadow:${m ? "0 0 10px #f59e0b" : "none"}"></div>`,
                })}
              >
                <Tooltip direction="top" permanent={!!m} offset={[0, -6]}>
                  <span className="text-[10px]">
                    <b>{b.name}</b>
                    {m ? <><br /><span className="cc-mono font-bold text-amber-500">{m.message}</span></> : " · default message"}
                  </span>
                </Tooltip>
              </Marker>
            );
          })}

        {layers.units &&
          Object.values(units).map((u) => {
            const meta = city.units.find((x) => x.id === u.id)!;
            const pos = unitPos(u);
            const busy = u.status !== "available";
            return (
              <span key={u.id}>
                {pos.target && <Polyline positions={[[pos.lat, pos.lng], [pos.target.lat, pos.target.lng]]} pathOptions={{ color: "#38bdf8", weight: 1.5, dashArray: "4 6" }} />}
                <Marker
                  position={[pos.lat, pos.lng]}
                  icon={L.divIcon({
                    className: "slotify-pin",
                    iconSize: [20, 20],
                    html: `<div style="width:20px;height:20px;border-radius:5px;display:grid;place-items:center;font:700 9px ui-monospace,monospace;color:${busy ? "#0b1220" : "#7dd3fc"};background:${busy ? "#38bdf8" : "#0f172a"};border:1.5px solid #38bdf8">${meta.kind === "tow" ? "TW" : meta.kind === "warden" ? "W" : "P"}</div>`,
                  })}
                >
                  <Tooltip direction="top" offset={[0, -8]}>
                    <b>{meta.name}</b> · {u.status.replace("_", " ")}
                  </Tooltip>
                </Marker>
              </span>
            );
          })}

        {layers.incidents &&
          incidents
            .filter((i) => i.status !== "resolved" && i.status !== "rejected")
            .map((i) => (
              <Marker
                key={i.id}
                position={[i.lat, i.lng]}
                eventHandlers={{ click: () => onIncident?.(i.id) }}
                icon={L.divIcon({
                  className: "slotify-pin",
                  iconSize: [34, 34],
                  html: `<div style="position:relative;width:34px;height:34px">
                    <span class="cc-ping" style="position:absolute;inset:0;border-radius:9999px;border:2px solid ${SEV_HEX[i.severity]}"></span>
                    <span style="position:absolute;inset:9px;border-radius:9999px;background:${SEV_HEX[i.severity]};box-shadow:0 0 14px ${SEV_HEX[i.severity]};display:grid;place-items:center;color:#0b1220;font:800 10px sans-serif">!</span>
                  </div>`,
                })}
                zIndexOffset={1000}
              >
                <Tooltip direction="top" offset={[0, -14]}>
                  <b>{i.title}</b> · {SEVERITY[i.severity].label} · risk {i.risk.score}
                </Tooltip>
              </Marker>
            ))}
      </MapContainer>
    </div>
  );
}
