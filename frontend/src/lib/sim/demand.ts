import profiles from "./profiles.json";
import type { LotCategory, ParkingLot } from "../types";

/**
 * Expected-demand model of the simulated city ("ground truth" generator).
 * The same profiles drive ml/generate_history.py, so the trained forecaster
 * learned the city the live simulator is playing back.
 */
/** Lots average out below this at their busiest; above it only happens when something unusual is going on. */
export const NATURAL_MAX = 0.92;

type Profile = { base: number; peaks: number[][]; weekend: number; holiday: number; rain: number; festival: number };
const P = profiles.categories as Record<LotCategory, Profile>;
const HOLIDAYS = new Set(profiles.holidays);
const SEASONS = profiles.festival_seasons as [string, string][];

/** yyyy-mm-dd in IST, independent of the viewer's timezone. */
export function istDateKey(t: number) {
  return new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);
}
/** fractional hour of day in IST */
export function istHour(t: number) {
  const d = new Date(t + 5.5 * 3600_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}
/** Monday = 0 … Sunday = 6 (matches Python's weekday()) */
export function istWeekday(t: number) {
  return (new Date(t + 5.5 * 3600_000).getUTCDay() + 6) % 7;
}
export const isHoliday = (t: number) => HOLIDAYS.has(istDateKey(t));
export function isFestivalSeason(t: number) {
  const k = istDateKey(t);
  return SEASONS.some(([a, b]) => k >= a && k <= b);
}

export function relativeDemand(category: LotCategory, hour: number) {
  const p = P[category];
  let v = p.base;
  for (const [peak, width, w] of p.peaks) {
    // wrap around midnight
    for (const shift of [-24, 0, 24]) v += w * Math.exp(-((hour - peak - shift) ** 2) / (2 * width ** 2));
  }
  return Math.min(1.05, v);
}

export interface DayContext {
  weekday: number;
  holiday: boolean;
  festival: boolean;
  rainMm: number;
}

export function dayContext(t: number, rainMm = 0): DayContext {
  return { weekday: istWeekday(t), holiday: isHoliday(t), festival: isFestivalSeason(t), rainMm };
}

export function expectedOccupancy(lot: Pick<ParkingLot, "category" | "baseOccupancy">, hour: number, ctx: DayContext) {
  const p = P[lot.category];
  let v = lot.baseOccupancy * (0.25 + 0.85 * relativeDemand(lot.category, hour));
  if (ctx.weekday >= 5) v *= p.weekend;
  if (ctx.holiday) v *= p.holiday;
  if (ctx.festival) v *= p.festival;
  if (ctx.rainMm > 2) v *= p.rain;
  return Math.min(NATURAL_MAX, Math.max(0.03, v));
}

export function expectedOccupancyAt(lot: Pick<ParkingLot, "category" | "baseOccupancy">, t: number, rainMm = 0) {
  return expectedOccupancy(lot, istHour(t), dayContext(t, rainMm));
}
