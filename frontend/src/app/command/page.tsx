"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, ArrowLeft, Camera, Car, ChevronRight, Clock, Gauge, Layers as LayersIcon, MapPin, ParkingSquare, ShieldAlert, Siren,
} from "lucide-react";
import { useCityLive, useForecasts, useTrend } from "@/lib/command/hooks";
import { useCommand } from "@/lib/command/store";
import { DEFAULT_LAYERS, type Layers } from "@/components/command/command-map";
import { CCButton, Kpi, OccBar, Panel, occTone } from "@/components/command/ui";
import { IncidentQueue } from "@/components/command/incident-queue";
import { AiInsights } from "@/components/command/insights";
import { OccupancyForecastChart } from "@/components/command/charts";
import { cn, timeAgo } from "@/lib/utils";
import { useSlotify } from "@/lib/store";

const CommandMap = dynamic(() => import("@/components/command/command-map"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-[hsl(var(--cc-dim))]">Loading GIS…</div>,
});

const LAYER_LABELS: Record<keyof Layers, string> = {
  zones: "Zones", heat: "Demand heat", lots: "Lots", violations: "Illegal parking", incidents: "Incidents", units: "Field units", vms: "VMS boards",
};

export default function SituationPage() {
  const router = useRouter();
  const live = useCityLive();
  const forecasts = useForecasts(60);
  const cmd = useCommand();
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [lotId, setLotId] = useState<string | null>(null);
  const [showLayers, setShowLayers] = useState(false);

  const zone = live.zones.find((z) => z.zone.id === zoneId) ?? null;
  const lotLive = live.lots.find((l) => l.lot.id === lotId) ?? null;
  const trend = useTrend(lotId ? [lotId] : zone ? zone.lots.map((l) => l.lot.id) : null);

  const open = cmd.incidents.filter((i) => i.status !== "resolved" && i.status !== "rejected");
  const awaiting = open.filter((i) => i.status === "awaiting_approval").length;
  const viol30 = live.violations.filter((v) => live.now - v.at < 30 * 60_000);
  const search = useMemo(() => {
    // minutes spent searching rises steeply as a zone fills (empirical 2 + 16·occ³ curve)
    const W = live.totals.usable || 1;
    return live.zones.reduce((a, z) => a + (2 + 16 * z.occupancy ** 3) * z.usable, 0) / W;
  }, [live]);
  const occ60 = forecasts
    ? live.lots.reduce((a, l) => a + (forecasts[l.lot.id]?.occupancy ?? 0) * l.usable, 0) / (live.totals.usable || 1)
    : null;

  const selectZone = (id: string | null) => {
    setZoneId(id);
    setLotId(null);
  };
  const selectLot = (id: string) => {
    const l = live.lots.find((x) => x.lot.id === id);
    if (l) setZoneId(l.zoneId);
    setLotId(id);
  };

  return (
    <div className="space-y-3">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="City occupancy" value={`${Math.round(live.totals.occupancy * 100)}%`} icon={Gauge} tone={live.totals.occupancy > 0.9 ? "bad" : live.totals.occupancy > 0.8 ? "warn" : "good"}
          sub={occ60 !== null ? `${Math.round(occ60 * 100)}% forecast in 60 min` : "forecast loading…"} />
        <Kpi label="Free bays" value={live.totals.free.toLocaleString("en-IN")} icon={ParkingSquare} tone="info" sub={`of ${live.totals.usable.toLocaleString("en-IN")} usable · ${live.lots.length} lots`} />
        <Kpi label="Lots ≥ 95% full" value={live.totals.fullLots} icon={AlertTriangle} tone={live.totals.fullLots ? "bad" : "good"} sub="saturation threshold" />
        <Kpi label="Open incidents" value={open.length} icon={Siren} tone={awaiting ? "warn" : "default"} sub={`${awaiting} awaiting human approval`} />
        <Kpi label="Illegal parking · 30 min" value={viol30.length} icon={ShieldAlert} tone={viol30.length > 10 ? "warn" : "default"} sub={`${viol30.filter((v) => v.status === "detected").length} not yet actioned`} />
        <Kpi label="Avg. search time" value={`${search.toFixed(1)}m`} icon={Clock} tone={search > 8 ? "warn" : "default"} sub="estimated from zone occupancy" />
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        {/* Map */}
        <Panel
          className="xl:col-span-8"
          bodyClassName="p-0"
          title={
            <span className="flex items-center gap-1.5 normal-case tracking-normal">
              <button onClick={() => selectZone(null)} className={cn("uppercase tracking-[0.08em] hover:text-sky-300", !zone && "text-sky-300")}>{live.city.name}</button>
              {zone && (
                <>
                  <ChevronRight className="size-3.5 text-[hsl(var(--cc-dim))]" />
                  <button onClick={() => setLotId(null)} className={cn("uppercase tracking-[0.08em] hover:text-sky-300", !lotLive && "text-sky-300")}>{zone.zone.name}</button>
                </>
              )}
              {lotLive && (
                <>
                  <ChevronRight className="size-3.5 text-[hsl(var(--cc-dim))]" />
                  <span className="truncate uppercase tracking-[0.08em] text-sky-300">{lotLive.lot.name}</span>
                </>
              )}
            </span>
          }
          subtitle="Click a zone to drill down, a lot for detail. Live GIS · OpenStreetMap-based basemap"
          actions={
            <div className="relative">
              <CCButton onClick={() => setShowLayers((v) => !v)} aria-expanded={showLayers}>
                <LayersIcon className="size-3.5" /> Layers
              </CCButton>
              {showLayers && (
                <div className="cc-panel absolute right-0 top-9 z-[1050] w-48 p-2">
                  {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white/5">
                      <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} className="accent-sky-500" />
                      {LAYER_LABELS[k]}
                    </label>
                  ))}
                </div>
              )}
            </div>
          }
        >
          <div className="relative h-[460px] sm:h-[560px]">
            <CommandMap
              live={live}
              forecasts={forecasts}
              incidents={cmd.incidents}
              units={cmd.units}
              vms={cmd.vms}
              layers={layers}
              selectedZone={zoneId}
              selectedLot={lotId}
              onZone={selectZone}
              onLot={selectLot}
              onIncident={(id) => router.push(`/command/incidents?id=${id}`)}
            />
            <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-2 rounded-md border border-[hsl(var(--cc-line))] bg-[hsl(222_47%_5%/0.85)] px-2.5 py-1.5 text-[10px] text-slate-300">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-status-available" /> &lt;80%</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-status-reserved" /> 80–95%</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-status-occupied" /> ≥95%</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full border border-dashed border-slate-400 bg-slate-500" /> camera offline (estimate)</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-red-500" /> illegal parking</span>
            </div>
          </div>
        </Panel>

        {/* Right column */}
        <div className="flex flex-col gap-3 xl:col-span-4">
          <Panel
            title="Incident queue"
            subtitle="Ranked by approval need, severity, recency"
            actions={<Link href="/command/incidents" className="text-[11px] font-semibold text-sky-400 hover:text-sky-300">All →</Link>}
            bodyClassName="max-h-[270px] overflow-y-auto py-1"
          >
            <IncidentQueue incidents={cmd.incidents} limit={6} />
          </Panel>
          <Panel title="AI insights" subtitle="Computed from live data + forecast model" className="flex-1">
            <AiInsights live={live} forecasts={forecasts} />
          </Panel>
        </div>
      </div>

      {/* Drill-down + trend */}
      <div className="grid gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          title={lotLive ? lotLive.lot.name : zone ? `${zone.zone.name} · ${zone.zone.division}` : "Operational zones"}
          subtitle={lotLive ? lotLive.lot.address : zone ? `${zone.zone.localities.length} monitored localities · ${zone.cameras} ANPR cameras` : "Select a zone to see its localities and lots"}
          actions={(zone || lotLive) && <CCButton variant="ghost" onClick={() => (lotLive ? setLotId(null) : selectZone(null))}><ArrowLeft className="size-3.5" /> Back</CCButton>}
        >
          {!zone && (
            <div className="grid gap-2 sm:grid-cols-2">
              {live.zones.map((z) => {
                const f = forecasts ? z.lots.reduce((a, l) => a + (forecasts[l.lot.id]?.occupancy ?? 0) * l.usable, 0) / (z.usable || 1) : null;
                const inc = open.filter((i) => i.zoneId === z.zone.id).length;
                return (
                  <motion.button
                    key={z.zone.id}
                    whileHover={{ y: -2 }}
                    onClick={() => selectZone(z.zone.id)}
                    className="rounded-lg border border-[hsl(var(--cc-line))] p-3 text-left hover:border-sky-500/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ background: z.zone.color }} />
                      <span className="font-display text-sm font-bold text-slate-100">{z.zone.name}</span>
                      {inc > 0 && <span className="ml-auto rounded bg-status-occupied/15 px-1.5 text-[10px] font-bold text-status-occupied">{inc} incident{inc > 1 ? "s" : ""}</span>}
                    </div>
                    <div className="mt-2 flex items-end justify-between">
                      <span className={cn("cc-mono text-2xl font-bold", occTone(z.occupancy))}>{Math.round(z.occupancy * 100)}%</span>
                      <span className="text-right text-[11px] text-[hsl(var(--cc-dim))]">
                        {z.free} free · {z.lots.length} lots
                        <br />
                        {f !== null && <>60 min → <b className={occTone(f)}>{Math.round(f * 100)}%</b></>}
                      </span>
                    </div>
                    <OccBar value={z.occupancy} className="mt-2" />
                    <p className="mt-2 truncate text-[10px] text-[hsl(var(--cc-dim))]">{z.zone.localities.map((l) => l.name).join(" · ")}</p>
                  </motion.button>
                );
              })}
            </div>
          )}

          {zone && !lotLive && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="cc-label">
                  <tr className="border-b border-[hsl(var(--cc-line))]">
                    <th className="py-2 font-semibold">Locality / lot</th>
                    <th className="py-2 font-semibold">Now</th>
                    <th className="py-2 font-semibold">Free</th>
                    <th className="py-2 font-semibold">60 min (80% range)</th>
                    <th className="py-2 font-semibold">Feed</th>
                  </tr>
                </thead>
                <tbody>
                  {zone.zone.localities.map((loc) => {
                    const ls = zone.lots.filter((l) => l.localityId === loc.id);
                    return [
                      <tr key={loc.id} className="border-b border-[hsl(var(--cc-line))]/60 bg-white/[0.02]">
                        <td className="py-1.5 font-semibold text-slate-300" colSpan={5}>
                          <MapPin className="mr-1 inline size-3 text-[hsl(var(--cc-dim))]" />
                          {loc.name}
                          <span className="ml-2 font-normal text-[hsl(var(--cc-dim))]">{loc.vehiclesPerHour.toLocaleString("en-IN")} veh/h peak · {loc.anprCameras} ANPR{ls.length === 0 && " · on-street monitoring only"}</span>
                        </td>
                      </tr>,
                      ...ls.map((l) => {
                        const f = forecasts?.[l.lot.id];
                        const occ = live.occOf(l);
                        return (
                          <tr key={l.lot.id} onClick={() => selectLot(l.lot.id)} className="cursor-pointer border-b border-[hsl(var(--cc-line))]/40 hover:bg-sky-500/5">
                            <td className="py-2 pl-5 text-slate-100">{l.lot.name}</td>
                            <td className={cn("cc-mono py-2 font-bold", occTone(occ))}>{l.stale && "~"}{Math.round(occ * 100)}%</td>
                            <td className="cc-mono py-2">{l.stale ? "—" : l.s.available}</td>
                            <td className="cc-mono py-2">{f ? <><span className={occTone(f.occupancy)}>{Math.round(f.occupancy * 100)}%</span> <span className="text-[hsl(var(--cc-dim))]">({Math.round(f.low * 100)}–{Math.round(f.high * 100)})</span></> : "…"}</td>
                            <td className="py-2">{l.stale ? <span className="text-status-reserved">offline · estimate</span> : <span className="text-status-available">live</span>}</td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}

          {lotLive && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["Occupancy", `${lotLive.stale ? "~" : ""}${Math.round(live.occOf(lotLive) * 100)}%`],
                    ["Free bays", lotLive.stale ? "—" : String(lotLive.s.available)],
                    ["Reserved", String(lotLive.s.reserved)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-md border border-[hsl(var(--cc-line))] p-2">
                      <p className="cc-label">{k}</p>
                      <p className="cc-mono mt-1 text-lg font-bold text-slate-100">{v}</p>
                    </div>
                  ))}
                </div>
                {forecasts?.[lotLive.lot.id] && (
                  <div className="rounded-md border border-[hsl(var(--cc-line))] p-2.5">
                    <p className="cc-label">Why the model expects {Math.round(forecasts[lotLive.lot.id].occupancy * 100)}% in 60 min</p>
                    <ul className="mt-1.5 space-y-1">
                      {forecasts[lotLive.lot.id].factors.slice(0, 4).map((f) => (
                        <li key={f.label} className="flex justify-between gap-2">
                          <span className="text-slate-300">{f.label}{f.value ? <span className="opacity-60"> · {f.value}</span> : null}</span>
                          <span className={cn("cc-mono", f.points > 0 ? "text-status-occupied" : "text-status-available")}>{f.points > 0 ? "+" : ""}{f.points.toFixed(1)} pts</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[hsl(var(--cc-dim))]">
                  {lotLive.lot.category} · ₹{lotLive.lot.pricePerHour}/h · {lotLive.lot.openHours} · last frame {timeAgo(lotLive.lastSeen, live.now)}
                </p>
                <div className="flex flex-wrap gap-2">
                </div>
              </div>
              <BayStrip lotId={lotLive.lot.id} live={live} />
            </div>
          )}
        </Panel>

        <Panel
          className="xl:col-span-5"
          title={`Occupancy · ${lotLive ? lotLive.lot.name : zone ? zone.zone.name : live.city.name}`}
          subtitle="Last 40 min from cameras · next 2 h from the model (80% interval)"
        >
          <OccupancyForecastChart data={trend.points} nowLabel={trend.nowLabel} height={230} />
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-7" title="Live detection stream" subtitle="Edge camera events (bay state changes) as they arrive" bodyClassName="max-h-56 overflow-y-auto py-2">
          <ul className="cc-mono space-y-1 text-[11px]">
            {live.events.slice(0, 30).map((e) => {
              const lot = live.city.lots.find((l) => l.id === e.lotId);
              return (
                <li key={e.id} className="flex gap-2 text-slate-300">
                  <span className="text-[hsl(var(--cc-dim))]">{new Date(e.at).toLocaleTimeString("en-IN", { hour12: false })}</span>
                  <span className="w-16 shrink-0 text-sky-400">{e.camera}</span>
                  <span className="truncate">{lot?.name} · bay {e.slotId}: {e.from} → <b className={e.to === "available" ? "text-status-available" : e.to === "occupied" ? "text-status-occupied" : "text-status-reserved"}>{e.to}</b></span>
                  <span className="ml-auto shrink-0 text-[hsl(var(--cc-dim))]">{Math.round(e.confidence * 100)}%</span>
                </li>
              );
            })}
            {!live.events.length && <li className="text-[hsl(var(--cc-dim))]">Waiting for first frames…</li>}
          </ul>
        </Panel>
        <Panel className="xl:col-span-5" title="Network status" subtitle="Device heartbeats · data freshness">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-[hsl(var(--cc-line))] p-2.5">
              <p className="cc-label flex items-center gap-1"><Camera className="size-3" /> Camera nodes</p>
              <p className="cc-mono mt-1 text-lg font-bold text-slate-100">{live.lots.length - live.totals.staleLots}/{live.lots.length}</p>
              <p className="text-[hsl(var(--cc-dim))]">bay-camera edge nodes online</p>
            </div>
            <div className="rounded-md border border-[hsl(var(--cc-line))] p-2.5">
              <p className="cc-label flex items-center gap-1"><Car className="size-3" /> ANPR cameras</p>
              <p className="cc-mono mt-1 text-lg font-bold text-slate-100">{live.city.commandZones.reduce((a, z) => a + z.localities.reduce((b, l) => b + l.anprCameras, 0), 0)}</p>
              <p className="text-[hsl(var(--cc-dim))]">on-street enforcement cameras</p>
            </div>
            <div className="rounded-md border border-[hsl(var(--cc-line))] p-2.5">
              <p className="cc-label flex items-center gap-1"><Activity className="size-3" /> Events / min</p>
              <p className="cc-mono mt-1 text-lg font-bold text-slate-100">{live.events.filter((e) => live.now - e.at < 60_000).length}</p>
              <p className="text-[hsl(var(--cc-dim))]">bay state changes ingested</p>
            </div>
            <div className="rounded-md border border-[hsl(var(--cc-line))] p-2.5">
              <p className="cc-label">Incident engine</p>
              <p className="cc-mono mt-1 text-lg font-bold text-slate-100">{cmd.engineRunAt ? `${Math.max(0, Math.round((live.now - cmd.engineRunAt) / 1000))}s` : "—"}</p>
              <p className="text-[hsl(var(--cc-dim))]">since last evaluation (every 4 s)</p>
            </div>
          </div>
          <Link href="/command/health" className="mt-3 inline-block text-[11px] font-semibold text-sky-400 hover:text-sky-300">Full system health →</Link>
        </Panel>
      </div>
    </div>
  );
}

function BayStrip({ lotId, live }: { lotId: string; live: ReturnType<typeof useCityLive> }) {
  const l = live.lots.find((x) => x.lot.id === lotId)!;
  return <BayGrid lotId={lotId} stale={l.stale} />;
}

function BayGrid({ lotId, stale }: { lotId: string; stale: boolean }) {
  const { state } = useSlotify();
  const slots = state.slots[lotId] ?? [];
  const rows = Array.from(new Set(slots.map((s) => s.row)));
  return (
    <div>
      <p className="cc-label mb-1.5">Bay map {stale && <span className="text-status-reserved">· frozen at last frame</span>}</p>
      <div className={cn("space-y-1", stale && "opacity-40 grayscale")}>
        {rows.map((r) => (
          <div key={r} className="flex gap-[3px]">
            <span className="cc-mono w-3 text-[9px] text-[hsl(var(--cc-dim))]">{r}</span>
            {slots.filter((s) => s.row === r).map((s) => (
              <span
                key={s.id}
                title={`${s.id} · ${s.status}${s.vehicleNumber ? ` · ${s.vehicleNumber}` : ""}`}
                className={cn(
                  "h-3.5 flex-1 rounded-[2px] transition-colors duration-500",
                  s.status === "available" && "bg-status-available/80",
                  s.status === "occupied" && "bg-status-occupied/80",
                  s.status === "reserved" && "bg-status-reserved/80",
                  s.status === "maintenance" && "bg-slate-600"
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
