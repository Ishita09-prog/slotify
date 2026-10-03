"use client";

import { useEffect, useMemo, useState } from "react";
import { useCity } from "../city";
import { summarize, useSlotify } from "../store";
import { forecastWith, modelIfLoaded, type Forecast } from "../ml/forecast";
import type { LotSummary, ParkingLot } from "../types";
import { THRESHOLDS } from "./engine";
import { useCommand } from "./store";

export interface LotLive {
  lot: ParkingLot;
  s: LotSummary;
  usable: number;
  stale: boolean;
  lastSeen: number;
  /** model estimate shown when the camera feed is down */
  estimate?: Forecast;
  zoneId: string;
  localityId: string;
}

export function useCityLive() {
  const { city } = useCity();
  const { state } = useSlotify();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(t);
  }, []);

  return useMemo(() => {
    const model = modelIfLoaded();
    const where = new Map<string, { zoneId: string; localityId: string }>();
    city.commandZones.forEach((z) => z.localities.forEach((l) => l.lotIds.forEach((id) => where.set(id, { zoneId: z.id, localityId: l.id }))));
    const lots: LotLive[] = city.lots.map((lot) => {
      const s = summarize(state.slots[lot.id] ?? []);
      const lastSeen = state.lastSeen[lot.id] ?? now;
      const stale = !!state.offline[lot.id] && now - lastSeen > THRESHOLDS.staleMs;
      const estimate =
        stale && model ? forecastWith(model, lot, lastSeen, s.occupancy, Math.max(15, Math.round((now - lastSeen) / 60000)), state.rainMm) : undefined;
      return { lot, s, usable: s.total - s.maintenance, stale, lastSeen, estimate, ...(where.get(lot.id) ?? { zoneId: "", localityId: "" }) };
    });
    const occOf = (l: LotLive) => l.estimate?.occupancy ?? l.s.occupancy;
    const zones = city.commandZones.map((z) => {
      const zl = lots.filter((l) => l.zoneId === z.id);
      const usable = zl.reduce((a, l) => a + l.usable, 0);
      const used = zl.reduce((a, l) => a + occOf(l) * l.usable, 0);
      return {
        zone: z,
        lots: zl,
        usable,
        free: Math.round(usable - used),
        occupancy: usable ? used / usable : 0,
        cameras: z.localities.reduce((a, l) => a + l.anprCameras, 0),
        staleLots: zl.filter((l) => l.stale).length,
      };
    });
    const usable = lots.reduce((a, l) => a + l.usable, 0);
    const used = lots.reduce((a, l) => a + occOf(l) * l.usable, 0);
    return {
      city,
      now,
      lots,
      zones,
      totals: {
        bays: lots.reduce((a, l) => a + l.s.total, 0),
        usable,
        free: Math.round(usable - used),
        occupancy: usable ? used / usable : 0,
        fullLots: lots.filter((l) => occOf(l) >= THRESHOLDS.saturation).length,
        staleLots: lots.filter((l) => l.stale).length,
        cameras: city.commandZones.reduce((a, z) => a + z.localities.reduce((b, l) => b + l.anprCameras, 0), 0) + city.lots.length * 6,
      },
      occOf,
      rainMm: state.rainMm,
      events: state.events,
      violations: state.violations,
      history: state.history,
    };
  }, [city, state.slots, state.lastSeen, state.offline, state.rainMm, state.events, state.violations, state.history, now]);
}

/** 60-min forecasts for every lot (refreshed every 15 s). */
export function useForecasts(horizonMin = 60) {
  const live = useCityLive();
  const { modelReady } = useCommand();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 15000);
    return () => window.clearInterval(t);
  }, []);
  const key = live.lots.map((l) => Math.round(live.occOf(l) * 50)).join(",") + `|${live.rainMm}|${tick}|${modelReady}`;
  return useMemo(() => {
    const model = modelIfLoaded();
    if (!model) return null;
    const now = Date.now();
    const out: Record<string, Forecast> = {};
    for (const l of live.lots) out[l.lot.id] = forecastWith(model, l.lot, now, live.occOf(l), horizonMin, live.rainMm);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, horizonMin]);
}

const clock = (t: number) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Observed occupancy from the camera history ring buffer (bay-weighted over `lotIds`)
 * followed by the model's forecast for the next 2 h with its 80% band.
 */
export function useTrend(lotIds: string[] | null, opts: { counterfactualFrom?: { t: number; occ: number } } = {}) {
  const live = useCityLive();
  const { modelReady } = useCommand();
  const ids = lotIds ?? live.lots.map((l) => l.lot.id);
  const idKey = ids.join(",");
  const bucket = Math.floor(live.now / 10000);
  return useMemo(() => {
    const model = modelIfLoaded();
    const lots = live.lots.filter((l) => ids.includes(l.lot.id));
    const weight = (id: string) => lots.find((l) => l.lot.id === id)?.usable ?? 0;
    const W = lots.reduce((a, l) => a + l.usable, 0) || 1;
    const hist = live.history.filter((_, i, arr) => i === arr.length - 1 || i % 2 === 0 || arr.length < 80);
    const pts: { label: string; t: number; observed?: number | null; forecast?: number | null; band?: [number, number] | null; counterfactual?: number | null }[] = hist.map((h) => ({
      label: clock(h.t),
      t: h.t,
      observed: Math.round((ids.reduce((a, id) => a + (h.occ[id] ?? 0) * weight(id), 0) / W) * 100),
    }));
    const now = Date.now();
    const nowOcc = lots.reduce((a, l) => a + live.occOf(l) * l.usable, 0) / W;
    pts.push({ label: clock(now), t: now, observed: Math.round(nowOcc * 100), forecast: Math.round(nowOcc * 100), band: [Math.round(nowOcc * 100), Math.round(nowOcc * 100)] });
    if (model) {
      for (const h of [15, 30, 45, 60, 90, 120]) {
        let p = 0, lo = 0, hi = 0;
        for (const l of lots) {
          const f = forecastWith(model, l.lot, now, live.occOf(l), h, live.rainMm);
          p += f.occupancy * l.usable; lo += f.low * l.usable; hi += f.high * l.usable;
        }
        pts.push({ label: clock(now + h * 60000), t: now + h * 60000, forecast: Math.round((p / W) * 100), band: [Math.round((lo / W) * 100), Math.round((hi / W) * 100)] });
      }
    }
    return { points: pts, nowLabel: clock(now), nowOcc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, bucket, modelReady, live.rainMm]);
}

export { clock as istClock };
