"use client";

import { BrainCircuit, CalendarDays, CloudRain, Radar, ShieldAlert, Sparkles } from "lucide-react";
import { useMemo } from "react";
import type { useCityLive } from "@/lib/command/hooks";
import type { Forecast } from "@/lib/ml/forecast";
import { modelIfLoaded } from "@/lib/ml/forecast";
import { isFestivalSeason, isHoliday } from "@/lib/sim/demand";
import { haversineKm } from "@/lib/utils";

interface Insight {
  icon: React.ElementType;
  text: React.ReactNode;
  source: string;
  tone: "info" | "warn" | "good";
}

/** Plain-language insights computed from live data + model output (no LLM, fully reproducible). */
export function AiInsights({ live, forecasts }: { live: ReturnType<typeof useCityLive>; forecasts: Record<string, Forecast> | null }) {
  const version = modelIfLoaded()?.meta.version ?? "model";
  const items = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    if (!forecasts) return out;
    // 1. zone heading for trouble
    const zf = live.zones.map((z) => {
      const W = z.usable || 1;
      const occ60 = z.lots.reduce((a, l) => a + (forecasts[l.lot.id]?.occupancy ?? live.occOf(l)) * l.usable, 0) / W;
      const willFill = z.lots.filter((l) => (forecasts[l.lot.id]?.occupancy ?? 0) >= 0.9).length;
      return { z, occ60, willFill };
    });
    const worst = [...zf].sort((a, b) => b.occ60 - a.occ60)[0];
    if (worst) {
      const delta = Math.round((worst.occ60 - worst.z.occupancy) * 100);
      out.push({
        icon: Sparkles,
        tone: worst.occ60 > 0.88 ? "warn" : "info",
        source: version,
        text: (
          <>
            <b>{worst.z.zone.name}</b> heads to <b>{Math.round(worst.occ60 * 100)}%</b> in 60 min ({delta >= 0 ? "+" : ""}{delta} pts)
            {worst.willFill ? <> — {worst.willFill} lot{worst.willFill > 1 ? "s" : ""} likely ≥ 90%.</> : "."}
          </>
        ),
      });
    }
    // 2. best spare capacity near the busiest zone
    if (worst) {
      const busiest = [...worst.z.lots].sort((a, b) => live.occOf(b) - live.occOf(a))[0];
      const c = busiest ? busiest.lot : worst.z.zone.localities[0];
      const spare = live.lots
        .filter((l) => !l.stale && l.lot.id !== busiest?.lot.id && live.occOf(l) < 0.85)
        .map((l) => ({ l, free: Math.round(l.usable * (1 - (forecasts[l.lot.id]?.high ?? live.occOf(l)))), km: haversineKm(c, l.lot) }))
        .filter((x) => x.km < 5 && x.free > 4)
        .sort((a, b) => b.free / (1 + b.km) - a.free / (1 + a.km))[0];
      if (spare)
        out.push({
          icon: Radar,
          tone: "good",
          source: `${version} · conservative (upper bound)`,
          text: (
            <>
              Best overflow near {busiest ? busiest.lot.name : worst.z.zone.name}: <b>{spare.l.lot.name}</b> — at least <b>{spare.free}</b> bays free in 60 min, {spare.km.toFixed(1)} km away.
            </>
          ),
        });
    }
    // 3. calendar / weather context
    const now = live.now;
    if (isHoliday(now))
      out.push({ icon: CalendarDays, tone: "info", source: "TN holiday calendar", text: <>Public holiday today: commercial, beach and temple demand runs higher; IT corridor and transit lower. The model accounts for this.</> });
    else if (isFestivalSeason(now))
      out.push({ icon: CalendarDays, tone: "info", source: "Festival calendar", text: <>Festival shopping season: T. Nagar–type markets run ~20% above a normal day. Model adjusted.</> });
    if (live.rainMm > 2)
      out.push({ icon: CloudRain, tone: "warn", source: "Weather feed (simulated)", text: <>Rain {live.rainMm} mm/h: beach parking demand roughly halves, malls fill faster. Forecasts already include the rain input.</> });
    // 4. enforcement hotspot
    const recent = live.violations.filter((v) => now - v.at < 30 * 60_000);
    if (recent.length) {
      const by = new Map<string, number>();
      recent.forEach((v) => by.set(v.location, (by.get(v.location) ?? 0) + 1));
      const [loc, n] = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({ icon: ShieldAlert, tone: n >= 4 ? "warn" : "info", source: "ANPR cameras", text: <><b>{loc}</b>: {n} illegal-parking detections in 30 min — highest in the city.</> });
    }
    // 5. data trust
    const stale = live.lots.filter((l) => l.stale);
    out.push(
      stale.length
        ? { icon: BrainCircuit, tone: "warn", source: "Heartbeat monitor", text: <>{stale.map((s) => s.lot.name).join(", ")}: camera offline — figures shown as <b>model estimates</b> with ranges.</> }
        : { icon: BrainCircuit, tone: "good", source: "Heartbeat monitor", text: <>All {live.lots.length} lots reporting live; data no older than 3 s.</> }
    );
    return out;
  }, [live, forecasts, version]);

  if (!forecasts) return <p className="text-xs text-[hsl(var(--cc-dim))]">Loading forecast model…</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <li key={i} className="flex gap-2.5">
            <Icon className={`mt-0.5 size-4 shrink-0 ${it.tone === "warn" ? "text-status-reserved" : it.tone === "good" ? "text-status-available" : "text-sky-400"}`} />
            <div className="min-w-0">
              <p className="text-[13px] leading-snug text-slate-200">{it.text}</p>
              <p className="cc-mono mt-0.5 text-[10px] text-[hsl(var(--cc-dim))]">source: {it.source}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
