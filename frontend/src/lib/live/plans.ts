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
}

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
  rate: number;
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
  const { startAt, endAt } = planRange(spec);
  const rate = planRate(lot, spec.type);
  const gross = rate * spec.units;
  const discountPct = cfg.discountPct[spec.units] ?? 0;
  const discount = Math.round((gross * discountPct) / 100);
  return { ...spec, startAt, endAt, rate, gross, discountPct, discount, total: gross - discount, durationLabel: `${spec.units} ${cfg.unit}${spec.units > 1 ? "s" : ""}` };
}

/* ------------------------------ overlap ------------------------------ */

/** Half-open intervals [aStart, aEnd) and [bStart, bEnd). Touching ranges do NOT overlap. */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

const leases = (bay: Bay) => Object.values(bay.plans ?? {});

/** First plan on this bay that overlaps [startAt, endAt). */
export const leaseOverlapping = (bay: Bay, startAt: number, endAt: number): PlanLease | undefined =>
  leases(bay).find((l) => overlaps(l.startAt, l.endAt, startAt, endAt));

/** The plan covering instant `t`, if any. */
export const leaseAt = (bay: Bay, t: number): PlanLease | undefined => leases(bay).find((l) => l.startAt <= t && t < l.endAt);

/** End of today in IST (= 00:00 tomorrow). Hourly "no time limit" stays are assumed to finish before this. */
const endOfToday = (now: number) => at(istDateKey(now + DAY), "00:00");

/**
 * Why a PLAN can't be placed on this bay for [startAt, endAt) (null = free).
 * Checks, in order: other plans, a no-time-limit stay, and every timed hourly slot.
 */
export function planConflict(bay: Bay, lot: LiveLot, spec: PlanSpec, now: number): string | null {
  const { startAt, endAt } = planRange(spec);
  if (leaseOverlapping(bay, startAt, endAt)) return "Reserved on another weekly/monthly plan";
  if (bay.open && startAt < endOfToday(now)) return "Taken today (no time limit)";
  for (const key of Object.keys(bay.slots ?? {})) {
    const [d, wid] = key.split("_");
    const w = lot.windows.find((x) => x.id === wid);
    // a slot whose window was later deleted still blocks its whole day
    const r = w ? windowRange(d, w) : { start: at(d, "00:00"), end: at(d, "00:00") + DAY };
    if (r.end > now && overlaps(r.start, r.end, startAt, endAt)) return "Has hourly bookings in that period";
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
