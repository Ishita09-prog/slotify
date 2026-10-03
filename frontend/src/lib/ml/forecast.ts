import type { ParkingLot } from "../types";
import { expectedOccupancy, isFestivalSeason, isHoliday, istHour, istWeekday } from "../sim/demand";

/**
 * Browser-side inference for the trained occupancy forecaster (ml/train.py).
 * Three gradient-boosted tree ensembles: mean, 10th and 90th percentile.
 * Runs fully offline; the FastAPI forecast service evaluates the same JSON.
 */

type Node = [feature: number, threshold: number, left: number, right: number, value: number, count: number];
interface Ensemble {
  baseline: number;
  trees: Node[][];
}
export interface ModelCard {
  version: string;
  trainedAt: string;
  algorithm: string;
  target: string;
  features: { name: string; label: string }[];
  categories: string[];
  training: { data: string; lots: number; trainPairs: number; holdoutPairs: number; holdout: string };
  metrics: {
    mae_occupancy_pts: Record<"gbm" | "heuristic_v1" | "persistence", number>;
    mae_free_bays: Record<"gbm" | "heuristic_v1" | "persistence", number>;
    interval_80_coverage: number;
    mean_interval_width_pts: number;
    mae_on_holiday_rain_festival_pts: { share_of_holdout: number } & Record<"gbm" | "heuristic_v1" | "persistence", number>;
    by_horizon_mae_pts: Record<string, Record<"gbm" | "heuristic_v1" | "persistence", number>>;
    anomaly_detector: {
      rule: string;
      events_in_holdout: number;
      event_recall: number;
      median_detection_delay_min: number;
      false_alerts_per_lot_per_week: number;
    };
  };
  limitations: string[];
}
interface ModelFile {
  meta: ModelCard;
  featureNames: string[];
  models: { point: Ensemble; q10: Ensemble; q90: Ensemble };
  profiles: Record<string, { wk: number[]; we: number[] }>;
}

let cache: ModelFile | null = null;
let loading: Promise<ModelFile> | null = null;

/** Lazy-loads the ~0.5 MB model so pages that don't forecast never download it. */
export function loadModel(): Promise<ModelFile> {
  if (cache) return Promise.resolve(cache);
  loading ??= import("./model.json").then((m) => {
    cache = (m.default ?? m) as unknown as ModelFile;
    return cache;
  });
  return loading;
}
export const modelIfLoaded = () => cache;

/* Long-range model (4 h – 7 days ahead), trained by ml/train_long.py on the same features. */
let longCache: ModelFile | null = null;
let longLoading: Promise<ModelFile> | null = null;
export function loadLongModel(): Promise<ModelFile> {
  if (longCache) return Promise.resolve(longCache);
  longLoading ??= import("./model-long.json").then((m) => {
    longCache = (m.default ?? m) as unknown as ModelFile;
    return longCache;
  });
  return longLoading;
}
export const longModelIfLoaded = () => longCache;
export const loadAllModels = () => Promise.all([loadModel(), loadLongModel()]);

/** Forecast for any target time: short-range model (live-camera driven) up to 3 h, long-range model beyond. */
export function forecastAt(lot: ParkingLot, t0: number, occ0: number, target: number, rainMm = 0): (Forecast & { range: "short" | "long" }) | null {
  const h = Math.max(15, Math.round((target - t0) / 60_000));
  if (h <= 180) return cache ? { ...forecastWith(cache, lot, t0, occ0, h, rainMm), range: "short" } : null;
  return longCache ? { ...forecastWith(longCache, lot, t0, occ0, Math.min(h, 10080), rainMm), range: "long" } : null;
}

const CATS = ["mall", "commercial", "transit", "hospital", "office", "recreation", "religious"];

function profileFor(model: ModelFile, lot: ParkingLot) {
  const p = model.profiles[lot.id];
  if (p) return p;
  // New lot with no history yet: fall back to the category curve scaled by its declared base demand.
  const mk = (weekday: number) =>
    Array.from({ length: 24 }, (_, h) => expectedOccupancy(lot, h, { weekday, holiday: false, festival: false, rainMm: 0 }));
  return { wk: mk(2), we: mk(6) };
}

function profileAt(p: { wk: number[]; we: number[] }, hour: number, weekday: number) {
  const arr = weekday >= 5 ? p.we : p.wk;
  const h0 = Math.floor(hour) % 24;
  const f = hour - Math.floor(hour);
  return arr[h0] * (1 - f) + arr[(h0 + 1) % 24] * f;
}

export function featureVector(model: ModelFile, lot: ParkingLot, t0: number, occ0: number, horizonMin: number, rainMm: number) {
  const t1 = t0 + horizonMin * 60_000;
  const prof = profileFor(model, lot);
  const h0 = istHour(t0);
  const h1 = istHour(t1);
  const wd0 = istWeekday(t0);
  const wd1 = istWeekday(t1);
  const histNow = profileAt(prof, h0, wd0);
  return [
    horizonMin,
    h1,
    wd1,
    wd1 >= 5 ? 1 : 0,
    isHoliday(t1) ? 1 : 0,
    isFestivalSeason(t1) ? 1 : 0,
    rainMm,
    occ0,
    h0,
    lot.baseOccupancy,
    histNow,
    profileAt(prof, h1, wd1),
    occ0 - histNow,
    ...CATS.map((c) => (lot.category === c ? 1 : 0)),
  ];
}

function evalEnsemble(e: Ensemble, x: number[], contrib?: number[]) {
  let s = e.baseline;
  for (const t of e.trees) {
    let k = 0;
    if (contrib) s += t[0][4]; // root expectation; path deltas are added below
    while (t[k][0] !== -1) {
      const n = t[k];
      const next = x[n[0]] <= n[1] ? n[2] : n[3];
      if (contrib) {
        contrib[n[0]] += t[next][4] - n[4];
        s += t[next][4] - n[4];
      }
      k = next;
    }
    if (!contrib) s += t[k][4];
  }
  return s;
}

export interface Factor {
  label: string;
  /** the input's value in plain words, e.g. "no", "18:30", "12 mm/h" */
  value?: string;
  /** contribution in occupancy points (+ pushes occupancy up) */
  points: number;
}

export interface Forecast {
  occupancy: number;
  low: number;
  high: number;
  /** model's expectation before looking at this specific situation */
  baseline: number;
  factors: Factor[];
  confidence: number;
  modelVersion: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
function describe(name: string, v: number, lot: ParkingLot): string | undefined {
  switch (name) {
    case "horizon_min": return `${Math.round(v)} min`;
    case "target_hour": return hhmm(v);
    case "current_hour": return hhmm(v);
    case "target_dow": return DAYS[v] ?? String(v);
    case "is_weekend": case "is_holiday": case "festival_season": return v ? "yes" : "no";
    case "rain_mm": return v > 0 ? `${Math.round(v)} mm/h` : "none";
    case "current_occ": case "lot_base_occupancy": case "hist_now_occ": case "hist_target_occ": return `${Math.round(v * 100)}%`;
    case "current_deviation": return `${v >= 0 ? "+" : ""}${Math.round(v * 100)} pts`;
    default: return name.startsWith("cat_") && v ? lot.category : undefined;
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function forecastWith(model: ModelFile, lot: ParkingLot, t0: number, occ0: number, horizonMin: number, rainMm = 0): Forecast {
  const x = featureVector(model, lot, t0, occ0, horizonMin, rainMm);
  const contrib = new Array(x.length).fill(0);
  const point = evalEnsemble(model.models.point, x, contrib);
  const base = model.models.point.baseline + model.models.point.trees.reduce((a, t) => a + t[0][4], 0);
  let lo = evalEnsemble(model.models.q10, x);
  let hi = evalEnsemble(model.models.q90, x);
  if (lo > hi) [lo, hi] = [hi, lo];
  // group one-hot lot type + merge features into human labels
  const byLabel = new Map<string, number>();
  const valueOf = new Map<string, string>();
  model.meta.features.forEach((f, i) => {
    byLabel.set(f.label, (byLabel.get(f.label) ?? 0) + contrib[i]);
    const v = describe(f.name, x[i], lot);
    if (v) valueOf.set(f.label, v);
  });
  const factors = [...byLabel.entries()]
    .map(([label, v]) => ({ label, value: valueOf.get(label), points: Math.round(v * 1000) / 10 }))
    .filter((f) => Math.abs(f.points) >= 0.1)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const width = hi - lo;
  return {
    occupancy: clamp01(point),
    low: clamp01(Math.min(lo, point)),
    high: clamp01(Math.max(hi, point)),
    baseline: clamp01(base),
    factors,
    // 80% interval width → confidence: a ±3 pt band ≈ 0.94, a ±15 pt band ≈ 0.7
    confidence: Math.max(0.5, Math.min(0.99, 1 - width * 1.0)),
    modelVersion: model.meta.version,
  };
}

export async function forecast(lot: ParkingLot, t0: number, occ0: number, horizonMin: number, rainMm = 0) {
  return forecastWith(await loadModel(), lot, t0, occ0, horizonMin, rainMm);
}

/**
 * Anomaly check: compare the occupancy cameras see now with the 80% band the model predicted
 * from an earlier reading. Same rule that was evaluated on the hold-out set (see model card).
 */
export function anomalyCheck(
  model: ModelFile,
  lot: ParkingLot,
  earlier: { t: number; occ: number },
  now: { t: number; occ: number },
  rainMm = 0,
  margin = 0.05
) {
  const horizon = Math.max(15, Math.min(180, Math.round((now.t - earlier.t) / 60000)));
  const f = forecastWith(model, lot, earlier.t, earlier.occ, horizon, rainMm);
  const above = now.occ - (f.high + margin);
  const below = f.low - margin - now.occ;
  return {
    forecast: f,
    horizon,
    outOfBand: above > 0 || below > 0,
    direction: above > 0 ? ("spike" as const) : below > 0 ? ("drop" as const) : null,
    excess: Math.max(above, below, 0),
  };
}
