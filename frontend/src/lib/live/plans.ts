import { at, istDateKey, windowRange } from "./time";
import type { Bay, LiveBooking, LiveLot, PlanLease } from "./types";

/* ------------------------------------------------------------------ */
/* Weekly / monthly parking plans.                                     */
/* Pure functions only (no React, no database) so the rules are easy   */
/* to test. The booking transaction in service.ts is the only writer.  */
/* ------------------------------------------------------------------ */

export type PlanType = "weekly" | "monthly";
export type BookingType = "hourly" | PlanType;

/** What the driver picked. Everything else (dates, price) is derived from this. */
export interface PlanSpec {
  type: PlanType;
  units: number;
  /** first day of the plan, IST, yyyymmdd */
  startKey: string;
  /**
   * Time-limited pass: the bay is yours only from `start` for `hours` every day,
   * and is free for others (hourly / overnight) the rest of the time. Omitted = whole day (24h).
   */
  daily?: DailyWindow | null;
}

export interface DailyWindow {
  /** "HH:00", IST */
  start: string;
  hours: number;
}

/**
 * TIME-LIMITED PRICING: 20% base + 5% per hour of the daily window, capped at 90% of the 24h price.
 * 4h = 40%, 8h = 60%, 12h = 80%. The base share keeps short passes worth the bay being reserved.
 */
export const DAILY_HOURS = [4, 6, 8, 10, 12, 14];
export const dailyFactor = (hours: number) => Math.min(0.9, 0.2 + 0.05 * hours);
export const dailyEnd = (d: DailyWindow) => {
  const m = (Number(d.start.slice(0, 2)) * 60 + Number(d.start.slice(3, 5)) + d.hours * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
export const dailyLabel = (d?: DailyWindow | null) => (d ? `${d.start}–${dailyEnd(d)} daily (${d.hours} h)` : "Whole day (24 h)");

/**
 * PRICING CONFIG: change numbers here, nothing else needs to move.
 * A lot can override the base rate with `lot.planRates` (see LiveLot).
 * `discountPct` is keyed by number of units (weeks / months).
 */
export const PLAN_PRICING: Record<PlanType, { unit: string; rate: number; options: number[]; discountPct: Record<number, number> }> = {
  weekly: { unit: "week", rate: 500, options: [1, 2, 3, 4], discountPct: { 1: 0, 2: 5, 3: 8, 4: 10 } },
  monthly: { unit: "month", rate: 1500, options: [1, 3, 6, 12], discountPct: { 1: 0, 3: 15, 6: 20, 12: 25 } },
};

/** How far ahead a plan may start. */
export const PLAN_MAX_LEAD_DAYS = 60;

const DAY = 24 * 3600_000;

export const planRate = (lot: Pick<LiveLot, "planRates">, type: PlanType) => lot.planRates?.[type] ?? PLAN_PRICING[type].rate;

export const keyToIso = (k: string) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
export const isoToKey = (iso: string) => iso.replace(/-/g, "");

/** Start (inclusive) and end (EXCLUSIVE) of a plan, both at 00:00 IST. */
export function planRange(spec: PlanSpec): { startAt: number; endAt: number } {
  const startAt = at(spec.startKey, "00:00");
  if (spec.type === "weekly") return { startAt, endAt: startAt + spec.units * 7 * DAY };
  // Monthly: same day-of-month N months later, clamped (31 Jan + 1 month -> 28/29 Feb).
  const y = Number(spec.startKey.slice(0, 4));
  const m = Number(spec.startKey.slice(4, 6)) - 1;
  const d = Number(spec.startKey.slice(6, 8));
  const total = m + spec.units;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const key = `${String(ty).padStart(4, "0")}${String(tm + 1).padStart(2, "0")}${String(Math.min(d, lastDay)).padStart(2, "0")}`;
  return { startAt, endAt: at(key, "00:00") };
}

export interface PlanQuote extends PlanSpec {
  startAt: number;
  endAt: number;
  /** price for one week/month at the chosen coverage */
  rate: number;
  /** 24h rate before the time-limited reduction */
  fullRate: number;
  gross: number;
  discountPct: number;
  discount: number;
  total: number;
  /** e.g. "3 months" */
  durationLabel: string;
}

/** Validates the spec and prices it. Throws Error with a driver-readable message. */
export function quotePlan(lot: Pick<LiveLot, "planRates">, spec: PlanSpec, now = Date.now()): PlanQuote {
  const cfg = PLAN_PRICING[spec.type];
  if (!cfg) throw new Error("Unknown plan type.");
  if (!cfg.options.includes(spec.units)) throw new Error(`Choose ${cfg.options.join(", ")} ${cfg.unit}s.`);
  if (!/^\d{8}$/.test(spec.startKey)) throw new Error("Pick a start date.");
  const today = istDateKey(now);
  if (spec.startKey < today) throw new Error("Start date can't be in the past.");
  if (spec.startKey > istDateKey(now + PLAN_MAX_LEAD_DAYS * DAY)) throw new Error(`Plans can start at most ${PLAN_MAX_LEAD_DAYS} days ahead.`);
  if (spec.daily) {
    if (!DAILY_HOURS.includes(spec.daily.hours)) throw new Error(`Choose ${DAILY_HOURS.join(", ")} hours a day.`);
    if (!/^([01]\d|2[0-3]):00$/.test(spec.daily.start)) throw new Error("Pick a daily start time.");
  }
  const { startAt, endAt } = planRange(spec);
  const fullRate = planRate(lot, spec.type);
  const rate = spec.daily ? Math.round((fullRate * dailyFactor(spec.daily.hours)) / 10) * 10 : fullRate;
  const gross = rate * spec.units;
  const discountPct = cfg.discountPct[spec.units] ?? 0;
  const discount = Math.round((gross * discountPct) / 100);
  return { ...spec, daily: spec.daily ?? null, startAt, endAt, rate, fullRate, gross, discountPct, discount, total: gross - discount, durationLabel: `${spec.units} ${cfg.unit}${spec.units > 1 ? "s" : ""}` };
}

/* ------------------------------ overlap ------------------------------ */

/** Half-open intervals [aStart, aEnd) and [bStart, bEnd). Touching ranges do NOT overlap. */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

const leases = (bay: Bay) => Object.values(bay.plans ?? {});

/**
 * Does a plan running [startAt, endAt) with an optional daily window occupy any part of [s, e)?
 * Whole-day plans block everything in range; time-limited plans only their daily hours
 * (a window may run past midnight, e.g. 20:00 for 12 h).
 */
export function covers(p: { startAt: number; endAt: number; daily?: DailyWindow | null }, s: number, e: number): boolean {
  if (!overlaps(p.startAt, p.endAt, s, e)) return false;
  if (!p.daily) return true;
  const len = p.daily.hours * 3600_000;
  // walk the plan's days that could touch [s, e): from the day before s to the day of e
  for (let d = Math.max(p.startAt, s - DAY); d < Math.min(p.endAt, e + DAY); d += DAY) {
    const ws = at(istDateKey(d), p.daily.start);
    if (ws < p.startAt || ws >= p.endAt) continue;
    if (overlaps(ws, ws + len, s, e)) return true;
  }
  return false;
}

/** Each daily window of a plan, for plan-vs-plan checks. Whole-day plans yield one interval. */
function* intervals(p: { startAt: number; endAt: number; daily?: DailyWindow | null }) {
  if (!p.daily) { yield [p.startAt, p.endAt] as const; return; }
  const len = p.daily.hours * 3600_000;
  for (let d = p.startAt; d < p.endAt; d += DAY) {
    const ws = at(istDateKey(d), p.daily.start);
    yield [ws, ws + len] as const;
  }
}

/** First plan on this bay that occupies any part of [startAt, endAt). */
export const leaseOverlapping = (bay: Bay, startAt: number, endAt: number): PlanLease | undefined =>
  leases(bay).find((l) => covers(l, startAt, endAt));

/** First existing plan that clashes with a new plan spec (respecting both daily windows). */
export function leaseClashing(bay: Bay, spec: PlanSpec): PlanLease | undefined {
  const p = { ...planRange(spec), daily: spec.daily };
  return leases(bay).find((l) => {
    if (!overlaps(l.startAt, l.endAt, p.startAt, p.endAt)) return false;
    for (const [s, e] of intervals(p)) if (covers(l, s, e)) return true;
    return false;
  });
}

/** The plan covering instant `t`, if any (a time-limited pass only during its daily hours). */
export const leaseAt = (bay: Bay, t: number): PlanLease | undefined => leases(bay).find((l) => covers(l, t, t + 1));

/** End of today in IST (= 00:00 tomorrow). Hourly "no time limit" stays are assumed to finish before this. */
const endOfToday = (now: number) => at(istDateKey(now + DAY), "00:00");

/**
 * Why a PLAN can't be placed on this bay for [startAt, endAt) (null = free).
 * Checks, in order: other plans, a no-time-limit stay, and every timed hourly slot.
 */
export function planConflict(bay: Bay, lot: LiveLot, spec: PlanSpec, now: number): string | null {
  const p = { ...planRange(spec), daily: spec.daily };
  if (leaseClashing(bay, spec)) return "Reserved on another weekly/monthly plan";
  if (bay.open && covers(p, now, endOfToday(now))) return "Taken today (no time limit)";
  for (const key of Object.keys(bay.slots ?? {})) {
    const [d, wid] = key.split("_");
    const w = lot.windows.find((x) => x.id === wid);
    // a slot whose window was later deleted still blocks its whole day
    const r = w ? windowRange(d, w) : { start: at(d, "00:00"), end: at(d, "00:00") + DAY };
    if (r.end > now && covers(p, r.start, r.end)) return "Has hourly bookings in that period";
  }
  return null;
}

/** Why an HOURLY request (timed slot or no-time-limit) is blocked by a plan (null = not blocked). */
export function hourlyBlockedByPlan(bay: Bay, req: { mode: string; dateKey?: string; window?: Parameters<typeof windowRange>[1] }, now: number): string | null {
  if (!bay.plans) return null;
  let start = now;
  let end = endOfToday(now);
  if (req.mode === "timed") {
    if (!req.dateKey || !req.window) return null;
    const r = windowRange(req.dateKey, req.window);
    start = r.start;
    end = r.end;
  }
  return leaseOverlapping(bay, start, end) ? "Reserved on a weekly/monthly plan" : null;
}

/* ------------------------------ status ------------------------------- */

export type PlanStatus = "upcoming" | "active" | "expired" | "cancelled";

/** Derived at read time so it can never go stale in the database. */
export function planStatus(b: Pick<LiveBooking, "status" | "startAt" | "endAt">, now: number): PlanStatus {
  if (b.status === "cancelled") return "cancelled";
  if (now < b.startAt) return "upcoming";
  if (b.endAt != null && now >= b.endAt) return "expired";
  return "active";
}

export const bookingTypeOf = (b: Pick<LiveBooking, "mode" | "bookingType">): BookingType => (b.mode === "plan" ? b.bookingType ?? "weekly" : "hourly");

/** Money returned when a plan is cancelled: whole unused time, pro-rata, nothing once expired. */
export function planRefund(b: Pick<LiveBooking, "startAt" | "endAt" | "amount">, now: number): number {
  if (b.endAt == null || !b.amount) return 0;
  const unused = Math.max(0, b.endAt - Math.max(now, b.startAt));
  return Math.round((b.amount * unused) / (b.endAt - b.startAt));
}
