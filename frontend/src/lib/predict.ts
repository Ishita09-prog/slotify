import type { LotCategory, ParkingLot, Prediction } from "./types";
import { expectedOccupancy, expectedOccupancyAt, istDateKey, istHour } from "./sim/demand";
import { forecastWith, loadModel } from "./ml/forecast";
import { seeded } from "./utils";

/**
 * Lightweight demand model shared with the FastAPI backend (app/services/predictor.py).
 * Each lot category has a daily curve built from Gaussian peaks. Today's observed
 * deviation from the typical curve is carried forward with exponential decay,
 * so a lot that is busier than usual now is predicted to stay busier for a while.
 */
/** Typical occupancy curve for a lot type (JS weekday: Sunday = 0). Backed by the shared demand profiles. */
export function typicalOccupancy(category: LotCategory, hour: number, weekday: number, baseOccupancy = 0.85) {
  return expectedOccupancy({ category, baseOccupancy }, hour, { weekday: (weekday + 6) % 7, holiday: false, festival: false, rainMm: 0 });
}

export const hourLabel = (h: number) => {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? "am" : "pm";
  const d = hh % 12 === 0 ? 12 : hh % 12;
  return `${d}${suffix}`;
};

/**
 * Trained-model prediction (see lib/ml/forecast.ts and ml/train.py).
 * "Today so far" is the simulated camera history for earlier hours; the forecast is the
 * gradient-boosted model up to 3 h ahead with its 80% interval, then the lot's usual pattern.
 */
export async function predictLocal(
  lot: ParkingLot, currentOccupancy: number, totalSlots: number, arrivalInMin: number, rainMm = 0, nowMs = Date.now()
): Promise<Prediction> {
  const model = await loadModel();
  const horizon = Math.max(0, arrivalInMin);
  const f = horizon === 0 ? null : forecastWith(model, lot, nowMs, currentOccupancy, Math.min(180, horizon), rainMm);
  const predicted = f ? f.occupancy : currentOccupancy;

  const hourNow = istHour(nowMs);
  const dayStart = nowMs - hourNow * 3600_000;
  const rand = seeded(`today:${lot.id}:${istDateKey(nowMs)}`);
  const trend = Array.from({ length: 24 }, (_, h) => {
    const t = dayStart + h * 3600_000;
    const typical = expectedOccupancyAt(lot, t);
    const isPast = h <= Math.floor(hourNow);
    const actual = isPast
      ? h === Math.floor(hourNow)
        ? currentOccupancy
        : Math.min(0.99, Math.max(0.02, expectedOccupancyAt(lot, t, 0) + (rand() - 0.5) * 0.07))
      : null;
    let forecast: number | null = null;
    let band: [number, number] | null = null;
    if (h >= Math.floor(hourNow)) {
      const ahead = Math.round((t - nowMs) / 60000);
      if (ahead <= 0) {
        forecast = currentOccupancy;
        band = [currentOccupancy, currentOccupancy];
      } else if (ahead <= 180) {
        const g = forecastWith(model, lot, nowMs, currentOccupancy, Math.max(15, ahead), rainMm);
        forecast = g.occupancy;
        band = [g.low, g.high];
      } else {
        forecast = typical;
      }
    }
    const r = (v: number | null) => (v === null ? null : Math.round(v * 100));
    return {
      hour: hourLabel(h),
      typical: Math.round(typical * 100),
      actual: r(actual),
      forecast: r(forecast),
      band: band ? ([Math.round(band[0] * 100), Math.round(band[1] * 100)] as [number, number]) : null,
    };
  });

  const byHour = Array.from({ length: 24 }, (_, h) => ({ h, v: expectedOccupancyAt(lot, dayStart + h * 3600_000) }));
  const peaks = [...byHour].sort((a, b) => b.v - a.v).slice(0, 3).sort((a, b) => a.h - b.h);
  const upcoming = trend
    .map((p, h) => ({ h, v: p.forecast }))
    .filter((x) => x.v !== null && x.h > Math.floor(hourNow) && x.h <= Math.floor(hourNow) + 6) as { h: number; v: number }[];
  const quiet = upcoming.sort((a, b) => a.v - b.v)[0];

  return {
    lotId: lot.id,
    currentOccupancy,
    predictedOccupancy: predicted,
    predictedAvailable: Math.max(0, Math.round(totalSlots * (1 - predicted))),
    totalSlots,
    confidence: f ? f.confidence : 0.99,
    arrivalAt: nowMs + horizon * 60000,
    peakHours: peaks.map((p) => ({ label: `${hourLabel(p.h)} – ${hourLabel(p.h + 1)}`, occupancy: Math.round(p.v * 100) })),
    bestTimeToArrive: quiet ? `${hourLabel(quiet.h)} (≈${quiet.v}% full)` : "Now",
    trend,
    source: "local",
    low: f ? f.low : currentOccupancy,
    high: f ? f.high : currentOccupancy,
    factors: f ? f.factors : [],
    modelVersion: model.meta.version,
    horizonMin: horizon,
    rangeAvailable: f
      ? [Math.max(0, Math.round(totalSlots * (1 - f.high))), Math.max(0, Math.round(totalSlots * (1 - f.low)))]
      : [Math.round(totalSlots * (1 - currentOccupancy)), Math.round(totalSlots * (1 - currentOccupancy))],
  };
}

/** Owner analytics series derived from the same curves. */
export function ownerSeries(lot: ParkingLot, totalSlots: number, now = new Date()) {
  const weekday = now.getDay();
  const hourNow = now.getHours();
  const occupancy = Array.from({ length: 24 }, (_, h) => {
    const t = typicalOccupancy(lot.category, h, weekday);
    const y = typicalOccupancy(lot.category, h, (weekday + 6) % 7);
    return {
      hour: hourLabel(h),
      today: h <= hourNow ? Math.round(Math.min(0.99, t + Math.sin(h * 2.1) * 0.04) * 100) : null,
      yesterday: Math.round(y * 100),
    };
  });
  const revenueByHour = occupancy.map((o) => ((o.today ?? 0) / 100) * totalSlots * lot.pricePerHour * 0.62);
  const revenueToday = revenueByHour.reduce((a, b) => a + b, 0);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const revenue = Array.from({ length: 7 }, (_, i) => {
    const d = (weekday - 6 + i + 7) % 7;
    const dayTotal = Array.from({ length: 24 }, (_, h) => typicalOccupancy(lot.category, h, d)).reduce((a, b) => a + b, 0);
    const value = i === 6 ? revenueToday : dayTotal * totalSlots * lot.pricePerHour * 0.62 * (0.94 + ((i * 37) % 11) / 100);
    return { day: i === 6 ? "Today" : days[d], revenue: Math.round(value) };
  });
  const peak = Array.from({ length: 24 }, (_, h) => ({
    hour: hourLabel(h),
    vehicles: Math.round(typicalOccupancy(lot.category, h, weekday) * totalSlots * 1.4),
  }));
  return { occupancy, revenue, peak, revenueToday: Math.round(revenueToday) };
}
