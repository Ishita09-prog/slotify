import { forecastAt, forecastWith, modelIfLoaded, type Factor } from "../ml/forecast";
import { istDateKey, slotKey, windowRange } from "./time";
import { haversineKm } from "../utils";
import type { CityConfig } from "../cities";
import { asParkingLot, lotStats } from "./view";
import { bikeRate } from "./types";
import type { Bay, LiveLot } from "./types";

/* ------------------------------------------------------------------ */
/* Driver AI: (1) understand a plain-English request,                 */
/* (2) rank real lots using live bays + the trained occupancy model.  */
/* ------------------------------------------------------------------ */

export interface Place {
  name: string;
  lat: number;
  lng: number;
  keys: string[];
}

export function placesFor(city: CityConfig, lots: LiveLot[]): Place[] {
  const out: Place[] = [];
  const keysOf = (s: string) => {
    const n = s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const k = [n, n.replace(/ /g, "")];
    const first = n.split(" ")[0];
    if (first.length >= 4) k.push(first);
    return k;
  };
  for (const z of city.commandZones) {
    out.push({ name: z.name, lat: z.localities[0].lat, lng: z.localities[0].lng, keys: keysOf(z.name) });
    for (const l of z.localities) out.push({ name: l.name, lat: l.lat, lng: l.lng, keys: keysOf(l.name) });
  }
  for (const l of lots) {
    out.push({ name: l.name, lat: l.lat, lng: l.lng, keys: keysOf(l.name) });
    out.push({ name: l.area, lat: l.lat, lng: l.lng, keys: keysOf(l.area) });
  }
  // common spoken forms
  const alias: Record<string, string> = { tnagar: "T. Nagar", "t nagar": "T. Nagar", omr: "OMR", phoenix: "Phoenix MarketCity", vr: "VR Chennai" };
  for (const [k, v] of Object.entries(alias)) {
    const p = out.find((x) => x.name.toLowerCase().includes(v.toLowerCase()));
    if (p) out.push({ ...p, keys: [k] });
  }
  return out;
}

export interface Intent {
  place?: Place;
  /** minutes from now */
  inMin?: number;
  hours?: number;
  mode?: "timed" | "open";
  ev?: boolean;
  bike?: boolean;
  accessible?: boolean;
  cheap?: boolean;
  understood: string[];
}

export function parseIntent(text: string, places: Place[], now = Date.now()): Intent {
  const t = ` ${text.toLowerCase().replace(/[.,!?]/g, " ")} `;
  const it: Intent = { understood: [] };
  // place: longest key that appears
  let best: Place | undefined;
  let bestLen = 0;
  for (const p of places)
    for (const k of p.keys)
      if (k.length >= 3 && k.length > bestLen && (t.includes(` ${k} `) || t.includes(` ${k}`) || t.replace(/ /g, "").includes(k.replace(/ /g, "")) && k.length >= 6)) {
        best = p;
        bestLen = k.length;
      }
  if (best) {
    it.place = best;
    it.understood.push(`near ${best.name}`);
  }
  // time
  const tm = t.match(/(?:at|by|around|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/) ?? t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (tm) {
    let h = Number(tm[1]);
    const m = Number(tm[2] ?? 0);
    const ap = tm[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h <= 7) h += 12; // "at 6" means 6 pm for parking
    const istNow = new Date(now + 5.5 * 3600_000);
    const nowMin = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
    let diff = h * 60 + m - nowMin;
    if (diff < -30) diff += 1440;
    if (/tomorrow|tmrw|tmr/.test(t) && diff < 1440) diff += diff < 0 ? 1440 : 1440;
    it.inMin = Math.max(0, diff);
    it.understood.push(`${/tomorrow|tmrw|tmr/.test(t) ? "tomorrow " : ""}at ${String(h % 12 || 12)}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "pm" : "am"}`);
  } else if (/tomorrow|tmrw/.test(t)) {
    const ist = new Date(now + 5.5 * 3600_000);
    it.inMin = 1440 - (ist.getUTCHours() * 60 + ist.getUTCMinutes()) + 600;
    it.understood.push("tomorrow morning");
  } else if (/\b(now|right now|asap|immediately)\b/.test(t)) {
    it.inMin = 0;
    it.understood.push("right now");
  } else if (/\btonight|evening\b/.test(t)) {
    it.inMin = minutesUntil(18, now);
    it.understood.push("this evening");
  } else if (/\bmorning\b/.test(t)) {
    it.inMin = minutesUntil(9, now);
    it.understood.push("in the morning");
  }
  // duration / mode
  const dm = t.match(/(\d+(?:\.\d)?)\s*(h|hr|hrs|hour|hours)\b/);
  const mm = t.match(/(\d+)\s*(m|min|mins|minutes)\b/);
  if (dm) {
    it.hours = Number(dm[1]);
    it.understood.push(`for ${it.hours} h`);
  } else if (mm) {
    it.hours = Math.max(0.5, Number(mm[1]) / 60);
    it.understood.push(`for ${mm[1]} min`);
  }
  if (/no time limit|unlimited|all day|whole day|long|overnight|open ended|without time/.test(t)) {
    it.mode = "open";
    it.understood.push("no time limit");
  } else if (/time slot|slot|fixed time/.test(t)) {
    it.mode = "timed";
    it.understood.push("time slot");
  }
  if (/\bev\b|electric|charg/.test(t)) (it.ev = true), it.understood.push("EV charging");
  if (/bike|scooter|two.?wheeler|motorcycle/.test(t)) (it.bike = true), it.understood.push("two-wheeler");
  if (/wheelchair|accessible|disab/.test(t)) (it.accessible = true), it.understood.push("accessible bay");
  if (/cheap|budget|lowest|less price|low price/.test(t)) (it.cheap = true), it.understood.push("cheapest");
  return it;
}

function minutesUntil(h: number, now: number) {
  const ist = new Date(now + 5.5 * 3600_000);
  const d = h * 60 - (ist.getUTCHours() * 60 + ist.getUTCMinutes());
  return d >= 0 ? d : d + 1440;
}

export interface Ranked {
  lot: LiveLot;
  score: number;
  km: number | null;
  free: number;
  occNow: number;
  /** model forecast for arrival time */
  forecast?: { occupancy: number; low: number; high: number; at: number; confidence: number; freeMean: number; freeLow: number; freeHigh: number; chance: number; booked: number; range: "short" | "long" };
  reasons: string[];
  warn?: string;
}

export function rankLots(
  lots: LiveLot[],
  bays: Bay[],
  opts: { origin?: { lat: number; lng: number } | null; inMin?: number; mode: "timed" | "open"; ev?: boolean; accessible?: boolean; cheap?: boolean; bike?: boolean },
  now = Date.now()
): Ranked[] {
  const model = modelIfLoaded();
  const eligible = lots
    .filter((l) => (opts.mode === "open" ? l.allowOpen : l.allowTimed))
    .filter((l) => !opts.bike || bays.some((b) => b.lotId === l.id && b.type === "bike"));
  const price = (l: LiveLot) => (opts.bike ? bikeRate(l) : l.pricePerHour);
  const prices = eligible.map(price);
  const minP = Math.min(...prices, 9999);
  const out = eligible.map((lot) => {
    const st = lotStats(lot, bays, now, opts.bike ? { mode: "open", vehicle: "bike" } : null);
    const free = opts.ev ? st.evFree : opts.accessible ? st.accFree : st.free;
    const km = opts.origin ? haversineKm(opts.origin, lot) : null;
    const reasons: string[] = [];
    let forecast: Ranked["forecast"];
    const at = now + Math.max(15, opts.inMin ?? 15) * 60_000;
    const pr = predictAt(lot, bays, at, now, { ev: opts.ev, accessible: opts.accessible, bike: opts.bike });
    if (pr) forecast = { occupancy: pr.occupancy, low: pr.low, high: pr.high, at, confidence: pr.confidence, freeMean: pr.freeMean, freeLow: pr.freeLow, freeHigh: pr.freeHigh, chance: pr.chance, booked: pr.booked, range: pr.range };
    // lower score = better
    let score = 0;
    score += km != null ? km * 1.2 : 0;
    score += (price(lot) - minP) / (opts.cheap ? 8 : opts.origin ? 60 : 25);
    const future = (opts.inMin ?? 0) > 20;
    score += (forecast ? forecast.occupancy : st.occupancy) * 4;
    if (forecast) score += (1 - forecast.chance) * 30;
    if (!future) {
      if (free === 0) score += 50;
      else if (free <= 2) score += 3;
    }
    if (km != null) reasons.push(km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`);
    if (!future || !forecast) reasons.push(`${free} ${opts.ev ? "EV " : opts.accessible ? "accessible " : opts.bike ? "two-wheeler " : ""}bay${free === 1 ? "" : "s"} free now`);
    if (price(lot) === minP && eligible.length > 1) reasons.push(`cheapest at ₹${price(lot)}/h`);
    let warn: string | undefined;
    if (forecast) {
      reasons.push(`AI: ~${forecast.freeMean} free on arrival (${Math.round(forecast.chance * 100)}% chance of a spot)`);
      if (forecast.chance < 0.7) warn = "Likely full by then. Book now to guarantee a bay.";
    }
    if (free === 0 && !future) warn = opts.ev ? "No EV bay free" : "Full right now";
    return { lot, score, km, free, occNow: st.occupancy, forecast, reasons, warn };
  });
  return out.sort((a, b) => a.score - b.score);
}

/** Next few hours of the model's forecast for one lot (for "best time to go"). */
export function hourlyOutlook(lot: LiveLot, bays: Bay[], now = Date.now()) {
  const model = modelIfLoaded();
  const st = lotStats(lot, bays, now);
  if (!model || !st.usable) return [];
  return [30, 60, 90, 120, 180].map((h) => {
    const f = forecastWith(model, asParkingLot(lot, st.total), now, st.occupancy, h);
    return { inMin: h, at: now + h * 60_000, occupancy: f.occupancy, low: f.low, high: f.high, freeBays: Math.max(0, Math.round(st.usable * (1 - f.occupancy))) };
  });
}


/* ------------------------------------------------------------------ */
/* Availability at any future time                                     */
/* ------------------------------------------------------------------ */

function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Bookings already confirmed in the database that will be holding a bay at `at` (certain, not predicted). */
export function bookedAt(lot: LiveLot, bays: Bay[], at: number, now: number, bike = false) {
  let n = 0;
  const d = istDateKey(at);
  for (const b of bays) {
    if (b.lotId !== lot.id || !b.active || (b.type === "bike") !== bike) continue;
    let hit = false;
    for (const w of lot.windows) {
      const r = windowRange(d, w);
      if (at >= r.start && at < r.end && b.slots?.[slotKey(d, w.id)]) hit = true;
    }
    // no-time-limit bookings: assume a typical 2-hour stay from now
    if (!hit && b.open && b.open.uid !== "camera" && at - now < 2 * 3600_000) hit = true;
    if (hit) n++;
  }
  return n;
}

export interface Prediction {
  at: number;
  range: "short" | "long";
  occupancy: number;
  low: number;
  high: number;
  confidence: number;
  usable: number;
  booked: number;
  freeMean: number;
  freeLow: number;
  freeHigh: number;
  /** probability that at least one bay (of the requested kind) is free */
  chance: number;
  factors: Factor[];
}

export function predictAt(lot: LiveLot, bays: Bay[], at: number, now = Date.now(), need: { ev?: boolean; accessible?: boolean; bike?: boolean } = {}): Prediction | null {
  const st = lotStats(lot, bays, now, need.bike ? { mode: "open", vehicle: "bike" } : null);
  if (!st.usable) return null;
  const f = forecastAt(asParkingLot(lot, st.total), now, st.occupancy, at);
  if (!f) return null;
  const usable = st.usable;
  const booked = bookedAt(lot, bays, at, now, !!need.bike);
  // demand from the model, never below what is already confirmed
  const occ = (x: number) => Math.min(usable, Math.max(booked, x * usable));
  const mean = occ(f.occupancy), lo = occ(f.low), hi = occ(f.high);
  // share of bays of the requested kind
  const kindShare = need.ev ? st.ev / usable : need.accessible ? st.acc / usable : 1;
  const freeMean = Math.max(0, Math.round((usable - mean) * kindShare));
  const freeLow = Math.max(0, Math.round((usable - hi) * kindShare));
  const freeHigh = Math.max(0, Math.round((usable - lo) * kindShare));
  const sigma = Math.max(0.6, (hi - lo) / 2.563);
  const capacity = need.ev ? st.ev : need.accessible ? st.acc : usable;
  const kindMean = mean * kindShare;
  const chance = capacity <= 0 ? 0 : Math.max(0.01, Math.min(0.99, normCdf((capacity - 0.5 - kindMean) / (sigma * Math.max(0.35, kindShare)))));
  return { at, range: f.range, occupancy: mean / usable, low: lo / usable, high: hi / usable, confidence: f.confidence, usable, booked, freeMean, freeLow, freeHigh, chance, factors: f.factors };
}

/** Hour-by-hour availability for the next `hours` hours (for "best time to go"). */
export function dayOutlook(lot: LiveLot, bays: Bay[], now = Date.now(), hours = 24) {
  const start = Math.ceil(now / 3600_000) * 3600_000;
  const out: Prediction[] = [];
  for (let i = 0; i < hours; i++) {
    const p = predictAt(lot, bays, start + i * 3600_000, now);
    if (p) out.push(p);
  }
  return out;
}

/** Live check: forecasts made ~30 min ago from the camera history vs what cameras see now. */
export function liveAccuracy(lots: { lot: LiveLot; total: number; occNow: number }[], history: { t: number; occ: Record<string, number> }[], now = Date.now()) {
  const model = modelIfLoaded();
  if (!model || history.length < 5) return null;
  const past = history.reduce((best, h) => (Math.abs(now - 30 * 60_000 - h.t) < Math.abs(now - 30 * 60_000 - best.t) ? h : best), history[0]);
  const ago = Math.round((now - past.t) / 60_000);
  if (ago < 10) return null;
  let err = 0, n = 0, inBand = 0;
  for (const { lot, total, occNow } of lots) {
    const occ0 = past.occ[lot.id];
    if (occ0 == null || !total) continue;
    const f = forecastWith(model, asParkingLot(lot, total), past.t, occ0, Math.max(15, ago));
    err += Math.abs(f.occupancy - occNow) * total;
    if (occNow >= f.low - 0.02 && occNow <= f.high + 0.02) inBand++;
    n++;
  }
  return n ? { lots: n, minutesAgo: ago, maeBays: Math.round((err / n) * 10) / 10, inBandPct: Math.round((inBand / n) * 100) } : null;
}
