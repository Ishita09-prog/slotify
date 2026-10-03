import type { CityConfig } from "../cities";
import type { Locality, ParkingLot, Slot, Violation } from "../types";
import { summarize } from "../store";
import { anomalyCheck, forecastWith, type modelIfLoaded } from "../ml/forecast";
import { etaMinutes, haversineKm } from "../utils";
import type { Incident, Recommendation, RiskFactor, Severity } from "./types";

type Model = NonNullable<ReturnType<typeof modelIfLoaded>>;

export interface WorldView {
  city: CityConfig;
  slots: Record<string, Slot[]>;
  violations: Violation[];
  offline: Record<string, number>;
  lastSeen: Record<string, number>;
  history: { t: number; occ: Record<string, number> }[];
  rainMm: number;
  now: number;
}

export const THRESHOLDS = {
  saturation: 0.95,
  saturationClear: 0.88,
  staleMs: 15_000,
  clusterCount: 5,
  clusterRadiusKm: 0.35,
  clusterWindowMs: 10 * 60_000,
  anomalyMargin: 0.05,
  escalateAfterMs: 90_000,
};

const sevFor = (score: number): Severity => (score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "medium" : "low");

export function zoneOf(city: CityConfig, lotId: string) {
  for (const z of city.commandZones) for (const l of z.localities) if (l.lotIds.includes(lotId)) return { zone: z, locality: l };
  return null;
}

export function nearestLocality(city: CityConfig, p: { lat: number; lng: number }) {
  let best: { zone: CityConfig["commandZones"][number]; locality: Locality; km: number } | null = null;
  for (const z of city.commandZones)
    for (const l of z.localities) {
      const km = haversineKm(p, l);
      if (!best || km < best.km) best = { zone: z, locality: l, km };
    }
  return best;
}

export function lotOcc(w: WorldView, lotId: string) {
  return summarize(w.slots[lotId] ?? []).occupancy;
}

/** Occupancy recorded closest to `t` (from the camera history ring buffer). */
export function occAt(w: WorldView, lotId: string, t: number) {
  let best = w.history[0];
  for (const h of w.history) if (Math.abs(h.t - t) < Math.abs((best?.t ?? 0) - t)) best = h;
  return best ? { t: best.t, occ: best.occ[lotId] ?? lotOcc(w, lotId) } : null;
}

/** Ranked alternative lots for drivers who can't get into `from` lots. */
export function alternatives(model: Model, w: WorldView, from: ParkingLot[], exclude: Set<string>, max = 2) {
  const c = { lat: from.reduce((a, l) => a + l.lat, 0) / from.length, lng: from.reduce((a, l) => a + l.lng, 0) / from.length };
  return w.city.lots
    .filter((l) => !exclude.has(l.id) && !w.offline[l.id])
    // skip lots that are filling fast right now (likely hit by the same surge)
    .filter((l) => {
      const before = occAt(w, l.id, w.now - 120_000);
      return !before || lotOcc(w, l.id) - before.occ < 0.04;
    })
    .map((l) => {
      const km = haversineKm(c, l);
      const eta = etaMinutes(km, w.city.avgSpeedKmh);
      const s = summarize(w.slots[l.id] ?? []);
      const usable = s.total - s.maintenance;
      const f = forecastWith(model, l, w.now, s.occupancy, Math.max(15, eta), w.rainMm);
      const freeAtArrival = Math.max(0, Math.round(usable * (1 - f.high))); // conservative: use the upper occupancy bound
      return { lot: l, km, eta, freeAtArrival, freeNow: s.available, score: freeAtArrival / (1 + km) };
    })
    .filter((a) => a.km <= 4.5 && a.freeAtArrival >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

let seq = 0;
/** continue numbering after a page reload restored earlier incidents */
export function seedIncidentSeq(n: number) {
  seq = Math.max(seq, n);
}
export function incidentId(now: number) {
  seq += 1;
  const d = new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  return `INC-${d}-${String(seq).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

export interface Candidate {
  key: string; // dedupe key, e.g. "sat:z-tnagar"
  build: () => Omit<Incident, "key">;
}

/** Zone-level saturation: lots at ≥95% that the model says will stay full. */
export function detectSaturation(model: Model, w: WorldView): Candidate[] {
  const out: Candidate[] = [];
  for (const zone of w.city.commandZones) {
    const lots = zone.localities.flatMap((loc) => loc.lotIds).map((id) => w.city.lots.find((l) => l.id === id)!).filter(Boolean);
    const full = lots.filter((l) => !w.offline[l.id] && lotOcc(w, l.id) >= THRESHOLDS.saturation);
    if (!full.length) continue;
    out.push({
      key: `sat:${zone.id}`,
      build: () => {
        const main = full.sort((a, b) => lotOcc(w, b.id) - lotOcc(w, a.id))[0];
        const loc = zoneOf(w.city, main.id)!.locality;
        const occ = lotOcc(w, main.id);
        const f = forecastWith(model, main, w.now, occ, 60, w.rainMm);
        const nearbyViol = w.violations.filter(
          (v) => v.status === "detected" && w.now - v.at < 20 * 60_000 && full.some((l) => haversineKm(l, v) < 0.6)
        ).length;
        const totalFree = full.reduce((a, l) => a + summarize(w.slots[l.id]).available, 0);
        const factors: RiskFactor[] = [
          { label: "Occupancy", value: `${Math.round(occ * 100)}%`, points: Math.round(Math.min(30, ((occ - 0.9) / 0.1) * 30)) },
          { label: "Forecast 60 min (upper bound)", value: `${Math.round(f.high * 100)}% · central ${Math.round(f.occupancy * 100)}%`, points: Math.round(Math.max(0, Math.min(20, ((f.high - 0.75) / 0.2) * 20))) },
          { label: "Peak inflow", value: `${loc.vehiclesPerHour.toLocaleString("en-IN")} veh/h`, points: Math.round((loc.vehiclesPerHour / 2600) * 20) },
          { label: "Illegal parking nearby", value: `${nearbyViol} in 20 min`, points: Math.min(15, nearbyViol * 4) },
          { label: "Lots affected", value: `${full.length} of ${lots.length}`, points: Math.min(15, full.length * 5) },
        ];
        const score = Math.min(100, factors.reduce((a, x) => a + x.points, 0));
        const alts = alternatives(model, w, full, new Set(full.map((l) => l.id)));
        const vms = w.city.vmsBoards.filter((b) => b.zoneId === zone.id);
        const warden = w.city.units.find((u) => u.zoneId === zone.id && u.kind === "warden") ?? w.city.units.find((u) => u.zoneId === zone.id);
        const recs: Recommendation[] = [];
        if (alts.length)
          recs.push({
            id: "r-redirect", kind: "redirect", suggested: true, enforcement: false,
            title: `Reroute drivers to ${alts.map((a) => a.lot.name.replace(/ Parking$/, "")).join(" and ")}`,
            detail: alts.map((a) => `${a.lot.name}: ≈${a.freeAtArrival} bays free on arrival (${a.km.toFixed(1)} km, ~${a.eta} min)`).join(" · "),
            expected: "Inflow into the full lots drops within 10–15 min as app users and VMS readers are diverted.",
            params: { lotId: main.id, altLotIds: alts.map((a) => a.lot.id) },
          });
        if (vms.length)
          recs.push({
            id: "r-vms", kind: "vms", suggested: true, enforcement: false,
            title: `Update ${vms.length} VMS board${vms.length > 1 ? "s" : ""} in ${zone.name}`,
            detail: vms.map((b) => b.name).join(", "),
            expected: "Drivers approaching the zone see where space is before they start circling.",
            params: {
              vmsIds: vms.map((b) => b.id),
              message: `${loc.name.toUpperCase()} PARKING FULL${alts[0] ? ` · USE ${alts[0].lot.name.toUpperCase().replace(/ PARKING$/, "")} (${alts[0].freeAtArrival} FREE)` : ""}`,
            },
          });
        if (warden)
          recs.push({
            id: "r-warden", kind: "warden", suggested: true, enforcement: true,
            title: `Deploy ${warden.name} to prevent double parking`,
            detail: `Full lots push drivers onto carriageways; ${nearbyViol} illegal-parking detections nearby in the last 20 min.`,
            expected: "Keeps the carriageway clear while demand is redirected.",
            params: { unitId: warden.id },
          });
        recs.push({
          id: "r-pricing", kind: "pricing", suggested: false, enforcement: false,
          title: `Temporary +₹10/h demand pricing at ${full.length} full lot${full.length > 1 ? "s" : ""} (60 min)`,
          detail: "Policy lever — needs Command Officer approval; citizens are notified in-app before it applies.",
          expected: "Shifts discretionary short trips to nearby lots; revenue earmarked for the zone.",
          params: { lotId: main.id },
        });
        return {
          id: incidentId(w.now),
          type: "saturation",
          severity: sevFor(score),
          status: "awaiting_approval",
          title: `${zone.name}: parking saturated`,
          summary: `${full.length} lot${full.length > 1 ? "s" : ""} at ≥${Math.round(THRESHOLDS.saturation * 100)}% (${full.map((l) => l.name).join(", ")}). Model expects ${Math.round(f.occupancy * 100)}% at ${main.name} in 60 min. Only ${totalFree} free bay${totalFree === 1 ? "" : "s"} left.`,
          zoneId: zone.id,
          localityId: loc.id,
          lotId: main.id,
          lat: main.lat,
          lng: main.lng,
          detectedAt: w.now,
          source: "Bay cameras (edge YOLO) + forecast model",
          evidence: [
            ...full.map((l) => ({ label: l.name, value: `${Math.round(lotOcc(w, l.id) * 100)}% · ${summarize(w.slots[l.id]).available} free` })),
            { label: "Camera confidence (avg)", value: "94–99%" },
          ],
          risk: { score, factors },
          confidence: 0.96,
          forecast: { horizonMin: 60, occupancy: f.occupancy, low: f.low, high: f.high, confidence: f.confidence, factors: f.factors.slice(0, 5), modelVersion: f.modelVersion },
          recommendations: recs,
          timeline: [
            { at: w.now, label: `Cameras report ${full.length} lot(s) ≥ ${Math.round(THRESHOLDS.saturation * 100)}% for 2 consecutive checks`, actor: "Incident engine", kind: "system" },
            { at: w.now, label: `Forecast: ${Math.round(f.occupancy * 100)}% in 60 min (80% range ${Math.round(f.low * 100)}–${Math.round(f.high * 100)}%)`, actor: f.modelVersion, kind: "ai" },
            { at: w.now, label: `${recs.length} actions recommended · awaiting human approval`, actor: "Recommendation engine", kind: "ai" },
          ],
          watchLotIds: full.map((l) => l.id),
          occAtDetection: full.reduce((a, l) => a + lotOcc(w, l.id), 0) / full.length,
          counterfactual: f.occupancy,
        };
      },
    });
  }
  return out;
}

/** Demand the model did not expect (outside the 80% band of a 30-min-ahead forecast). */
export function detectAnomalies(model: Model, w: WorldView, busyLots: Set<string>): Candidate[] {
  // 1. per-lot residual check
  const hits: { lot: ParkingLot; occ: number; a: ReturnType<typeof anomalyCheck> }[] = [];
  for (const lot of w.city.lots) {
    if (w.offline[lot.id] || busyLots.has(lot.id)) continue;
    const occ = lotOcc(w, lot.id);
    if (occ >= THRESHOLDS.saturation) continue; // saturation detector owns this
    const ref = occAt(w, lot.id, w.now - 30 * 60_000);
    if (!ref || w.now - ref.t < 20 * 60_000) continue;
    const a = anomalyCheck(model, lot, ref, { t: w.now, occ }, w.rainMm, THRESHOLDS.anomalyMargin);
    const bays = summarize(w.slots[lot.id] ?? []).total;
    // ignore tiny absolute deviations on small lots (a few cars is noise, not an event)
    if (a.outOfBand && a.direction === "spike" && a.excess * bays >= 3) hits.push({ lot, occ, a });
  }
  // 2. correlate per zone → one incident per zone
  const out: Candidate[] = [];
  for (const zone of w.city.commandZones) {
    const zh = hits.filter((h) => zoneOf(w.city, h.lot.id)?.zone.id === zone.id).sort((x, y) => y.a.excess - x.a.excess);
    if (!zh.length) continue;
    // advisory-only below a minimum size: shown in the anomaly watch, not raised as an incident
    if (zh.length === 1 && zh[0].a.excess < 0.06 && zh[0].occ < 0.7) continue;
    out.push({
      key: `anom:${zone.id}`,
      build: () => {
        const { lot, occ, a } = zh[0];
        const where = zoneOf(w.city, lot.id)!;
        const lots = zh.map((h) => h.lot);
        const alts = alternatives(model, w, lots, new Set(lots.map((l) => l.id)));
        const fNext = forecastWith(model, lot, w.now, occ, 60, w.rainMm);
        const factors: RiskFactor[] = [
          { label: "Above expected band", value: `+${Math.round(a.excess * 100 + THRESHOLDS.anomalyMargin * 100)} pts (worst lot)`, points: Math.round(Math.min(35, a.excess * 200)) },
          { label: "Occupancy", value: `${Math.round(occ * 100)}%`, points: Math.round(occ * 25) },
          { label: "Lots affected", value: `${zh.length}`, points: Math.min(15, zh.length * 5) },
          { label: "Locality inflow", value: `${where.locality.vehiclesPerHour} veh/h`, points: Math.round((where.locality.vehiclesPerHour / 2600) * 10) },
          { label: "Calendar explains it?", value: "No — beyond holiday / festival / rain effects", points: 10 },
        ];
        const score = Math.min(100, factors.reduce((s2, x) => s2 + x.points, 0));
        const warden = w.city.units.find((u) => u.zoneId === where.zone.id && u.kind !== "tow");
        const names = lots.map((l) => l.name);
        const recs: Recommendation[] = [
          {
            id: "r-verify", kind: "verify", suggested: true, enforcement: false,
            title: "Operator verifies on CCTV",
            detail: `Lot operator confirms the crowd at ${names.join(", ")} from live camera tiles.`,
            expected: "Rules out a sensor fault before field action.",
          },
          ...(alts.length
            ? [{
                id: "r-redirect", kind: "redirect" as const, suggested: true, enforcement: false,
                title: `Advise drivers to use ${alts[0].lot.name}`,
                detail: alts.map((x) => `${x.lot.name}: ≈${x.freeAtArrival} free on arrival (${x.km.toFixed(1)} km)`).join(" · "),
                expected: "Spreads the surge before the lots fill.",
                params: { lotId: lot.id, altLotIds: alts.map((x) => x.lot.id) },
              }]
            : []),
          ...(warden
            ? [{
                id: "r-warden", kind: "warden" as const, suggested: true, enforcement: true,
                title: `Pre-position ${warden.name}`,
                detail: "Crowds without a calendar reason often bring kerbside parking and blocked junctions.",
                expected: "Faster response if spill-over starts.",
                params: { unitId: warden.id },
              }]
            : []),
        ];
        return {
          id: incidentId(w.now),
          type: "anomaly",
          severity: sevFor(score),
          status: "awaiting_approval",
          title: zh.length > 1 ? `${zone.name}: unusual demand at ${zh.length} lots` : `Unusual demand at ${lot.name}`,
          summary: `Cameras see ${Math.round(occ * 100)}% at ${lot.name}; 30 min ago the model expected ${Math.round(a.forecast.low * 100)}–${Math.round(a.forecast.high * 100)}% for now.${zh.length > 1 ? ` Also out of band: ${names.slice(1).join(", ")}.` : ""} Next hour: ${Math.round(fNext.occupancy * 100)}%.`,
          zoneId: where.zone.id,
          localityId: where.locality.id,
          lotId: lot.id,
          lat: lot.lat,
          lng: lot.lng,
          detectedAt: w.now,
          source: "Anomaly detector (forecast residual) on bay cameras",
          evidence: [
            ...zh.map((h) => ({ label: h.lot.name, value: `${Math.round(h.occ * 100)}% vs ${Math.round(h.a.forecast.low * 100)}–${Math.round(h.a.forecast.high * 100)}% expected` })),
            { label: "Rule", value: "2 consecutive checks > 5 pts above the 80% band" },
          ],
          risk: { score, factors },
          confidence: Math.round(Math.min(0.95, 0.6 + a.excess * 2) * 100) / 100,
          forecast: { horizonMin: 60, occupancy: fNext.occupancy, low: fNext.low, high: fNext.high, confidence: fNext.confidence, factors: fNext.factors.slice(0, 5), modelVersion: fNext.modelVersion },
          recommendations: recs,
          timeline: [
            { at: w.now, label: `${zh.length} lot(s) above the forecast band for 2 consecutive checks (worst: ${lot.name}, ${Math.round(occ * 100)}% vs ${Math.round(a.forecast.low * 100)}–${Math.round(a.forecast.high * 100)}%)`, actor: "Anomaly detector", kind: "ai" },
            { at: w.now, label: "Correlated per zone · awaiting human review", actor: "Incident engine", kind: "system" },
          ],
          watchLotIds: lots.map((l) => l.id),
          occAtDetection: zh.reduce((s2, h) => s2 + h.occ, 0) / zh.length,
          counterfactual: fNext.occupancy,
        };
      },
    });
  }
  return out;
}

/** ≥5 unprocessed illegal-parking detections within 350 m in 10 min. */
export function detectClusters(w: WorldView): Candidate[] {
  const recent = w.violations.filter((v) => v.status === "detected" && w.now - v.at < THRESHOLDS.clusterWindowMs);
  const out: Candidate[] = [];
  for (const zone of w.city.commandZones)
    for (const loc of zone.localities) {
      const near = recent.filter((v) => haversineKm(v, loc) <= THRESHOLDS.clusterRadiusKm);
      if (near.length < THRESHOLDS.clusterCount) continue;
      out.push({
        key: `clu:${loc.id}`,
        build: () => {
          const tow = w.city.units.find((u) => u.zoneId === zone.id && u.kind === "tow") ?? w.city.units.find((u) => u.kind === "tow");
          const patrol = w.city.units.find((u) => u.zoneId === zone.id && u.kind === "patrol");
          const blocking = near.filter((v) => /Double|Bus stop|driveway/i.test(v.type)).length;
          const factors: RiskFactor[] = [
            { label: "Violations", value: `${near.length} in 10 min`, points: Math.min(35, near.length * 6) },
            { label: "Blocking traffic", value: `${blocking} double / bus-stop / driveway`, points: Math.min(25, blocking * 8) },
            { label: "Locality inflow", value: `${loc.vehiclesPerHour} veh/h`, points: Math.round((loc.vehiclesPerHour / 2600) * 20) },
            { label: "ANPR confidence (avg)", value: `${Math.round((near.reduce((a, v) => a + v.confidence, 0) / near.length) * 100)}%`, points: 5 },
          ];
          const score = Math.min(100, factors.reduce((a, x) => a + x.points, 0));
          const recs: Recommendation[] = [
            ...(tow
              ? [{
                  id: "r-tow", kind: "tow" as const, suggested: blocking > 0, enforcement: true,
                  title: `Dispatch ${tow.name}`,
                  detail: `Clear ${blocking || "obstructing"} vehicles blocking the carriageway at ${loc.name}.`,
                  expected: "Lane capacity restored; repeat offenders deterred.",
                  params: { unitId: tow.id, violationIds: near.map((v) => v.id) },
                }]
              : []),
            {
              id: "r-challan", kind: "challan", suggested: true, enforcement: true,
              title: `Issue ${near.length} e-challans (ANPR evidence attached)`,
              detail: "Each challan carries plate image, timestamp, location and model confidence; officer signs digitally.",
              expected: "Owners notified via Parivahan-style e-challan SMS (simulated).",
              params: { violationIds: near.map((v) => v.id) },
            },
            ...(patrol
              ? [{
                  id: "r-patrol", kind: "patrol" as const, suggested: !tow, enforcement: true,
                  title: `Send ${patrol.name}`,
                  detail: "Visible presence for 30 min.",
                  expected: "New violations drop while officers are on site.",
                  params: { unitId: patrol.id },
                }]
              : []),
          ];
          return {
            id: incidentId(w.now),
            type: "illegal_cluster",
            severity: sevFor(score),
            status: "awaiting_approval",
            title: `Illegal parking cluster · ${loc.name}`,
            summary: `${near.length} vehicles detected parked illegally within ${Math.round(THRESHOLDS.clusterRadiusKm * 1000)} m in 10 minutes (${blocking} obstructing traffic).`,
            zoneId: zone.id,
            localityId: loc.id,
            lat: loc.lat,
            lng: loc.lng,
            detectedAt: w.now,
            source: "ANPR cameras",
            evidence: near.slice(0, 6).map((v) => ({ label: v.vehicleNumber, value: `${v.type} · ${Math.round(v.confidence * 100)}% · ${v.camera}` })),
            risk: { score, factors },
            confidence: Math.round((near.reduce((a, v) => a + v.confidence, 0) / near.length) * 100) / 100,
            recommendations: recs,
            timeline: [
              { at: w.now, label: `${near.length} ANPR detections clustered within ${Math.round(THRESHOLDS.clusterRadiusKm * 1000)} m`, actor: "Incident engine", kind: "system" },
              { at: w.now, label: "Enforcement actions recommended · awaiting approval", actor: "Recommendation engine", kind: "ai" },
            ],
            watchLotIds: [],
          };
        },
      });
    }
  return out;
}

/** Camera node stopped heartbeating. */
export function detectOutages(model: Model, w: WorldView): Candidate[] {
  return w.city.lots
    .filter((l) => w.offline[l.id] && w.now - (w.lastSeen[l.id] ?? w.now) > THRESHOLDS.staleMs)
    .map((lot) => ({
      key: `out:${lot.id}`,
      build: (): Omit<Incident, "key"> => {
        const where = zoneOf(w.city, lot.id)!;
        const last = w.lastSeen[lot.id] ?? w.now;
        const lastOcc = lotOcc(w, lot.id);
        const est = forecastWith(model, lot, last, lastOcc, Math.max(15, Math.round((w.now - last) / 60000)), w.rainMm);
        const warden = w.city.units.find((u) => u.zoneId === where.zone.id && u.kind === "warden");
        return {
          id: incidentId(w.now),
          type: "sensor_outage",
          severity: "medium",
          status: "awaiting_approval",
          title: `Camera feed lost · ${lot.name}`,
          summary: `No heartbeat from the edge node for ${Math.round((w.now - last) / 1000)} s. Availability is now shown as a model estimate (${Math.round(est.occupancy * 100)}%, range ${Math.round(est.low * 100)}–${Math.round(est.high * 100)}%) and labelled ESTIMATED to drivers.`,
          zoneId: where.zone.id,
          localityId: where.locality.id,
          lotId: lot.id,
          lat: lot.lat,
          lng: lot.lng,
          detectedAt: w.now,
          source: "Device heartbeat monitor",
          evidence: [
            { label: "Last frame", value: new Date(last).toLocaleTimeString("en-IN") },
            { label: "Last observed occupancy", value: `${Math.round(lastOcc * 100)}%` },
            { label: "Fallback", value: "Model estimate shown with range; new bookings paused" },
          ],
          risk: {
            score: 40,
            factors: [
              { label: "Bays without live data", value: `${lot.layout.rows * lot.layout.cols}`, points: 20 },
              { label: "Bookings affected", value: "Paused to protect citizens", points: 10 },
              { label: "Duration", value: `${Math.round((w.now - last) / 1000)} s`, points: 10 },
            ],
          },
          confidence: 0.99,
          forecast: { horizonMin: 0, occupancy: est.occupancy, low: est.low, high: est.high, factors: est.factors.slice(0, 4), modelVersion: est.modelVersion },
          recommendations: [
            {
              id: "r-fallback", kind: "fallback", suggested: true, enforcement: false,
              title: "Keep model-estimated availability live (auto-applied)",
              detail: "Applied automatically by the system and logged; approval confirms it.",
              expected: "Drivers keep seeing a clearly-labelled estimate instead of stale numbers.",
              params: { lotId: lot.id },
            },
            {
              id: "r-maint", kind: "maintenance", suggested: true, enforcement: false,
              title: "Raise P1 ticket with camera vendor",
              detail: "SLA: 4 h on-site. Ticket includes node ID, last heartbeat and power telemetry.",
              expected: "Node restored; incident auto-closes when frames resume.",
              params: { lotId: lot.id },
            },
            ...(warden
              ? [{
                  id: "r-warden", kind: "warden" as const, suggested: false, enforcement: true,
                  title: `Manual bay count by ${warden.name}`,
                  detail: "Ground-truth the estimate if the outage lasts beyond 30 min.",
                  expected: "Estimate corrected with a manual count.",
                  params: { unitId: warden.id },
                }]
              : []),
          ],
          timeline: [
            { at: last, label: "Last frame received", actor: "Edge node", kind: "system" },
            { at: w.now, label: "Heartbeat timeout → availability switched to model estimate (auto)", actor: "Incident engine", kind: "system" },
          ],
          watchLotIds: [lot.id],
        };
      },
    }));
}
