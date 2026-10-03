"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useCity } from "../city";
import { useSlotify } from "../store";
import { loadModel, modelIfLoaded } from "../ml/forecast";
import { haversineKm, uid } from "../utils";
import type { CityConfig } from "../cities";
import { makeViolation } from "../mock-data";
import { expectedOccupancyAt } from "../sim/demand";
import { seal, verifyChain, type AuditEntry, type AuditInput } from "./audit";
import { THRESHOLDS, seedIncidentSeq, detectAnomalies, detectClusters, detectOutages, detectSaturation, lotOcc, type WorldView } from "./engine";
import { ROLES, can, demoUsers, type DemoUser, type Permission } from "./rbac";
import { SCENARIOS } from "./scenarios";
import type { Incident, Notification, TimelineItem, UnitState } from "./types";

/** Demo clock for field units: one real-world minute of travel plays back in this many ms. */
export const DEMO_MINUTE_MS = 3000;

interface CommandState {
  user: DemoUser | null;
  audit: AuditEntry[];
  incidents: Incident[];
  notifications: Notification[];
  units: Record<string, UnitState>;
  vms: Record<string, { message: string; at: number; incidentId: string }>;
  pricing: Record<string, { surcharge: number; until: number }>;
  apiDown: boolean;
  activeScenarios: string[];
  engineRunAt: number | null;
  modelReady: boolean;
  tampered: { seq: number; original: AuditEntry } | null;
}

interface CommandCtx extends CommandState {
  can: (p: Permission) => boolean;
  login: (userId: string) => void;
  logout: () => void;
  log: (input: Omit<AuditInput, "actor" | "actorId" | "role" | "source"> & Partial<AuditInput>) => void;
  runScenario: (id: string) => void;
  resetSimulation: () => void;
  approve: (incidentId: string, recIds: string[], note?: string) => void;
  reject: (incidentId: string, reason: string) => void;
  close: (incidentId: string, note: string) => void;
  restoreNode: (lotId: string) => void;
  setApiDown: (down: boolean) => void;
  verify: () => Promise<{ ok: boolean; brokenAt?: number; checked: number }>;
  tamper: () => void;
  undoTamper: () => void;
  noteGenerated: (what: string, detail: string) => void;
}

const Ctx = createContext<CommandCtx | null>(null);
const SESSION_KEY = "slotify:session";

function unitHome(city: CityConfig, unitId: string) {
  const u = city.units.find((x) => x.id === unitId)!;
  const zone = city.commandZones.find((z) => z.id === u.zoneId)!;
  const idx = city.units.filter((x) => x.zoneId === u.zoneId).findIndex((x) => x.id === unitId);
  const c = zone.localities[Math.min(idx + 1, zone.localities.length - 1)];
  return { lat: c.lat + 0.004 * Math.cos(idx * 2), lng: c.lng + 0.004 * Math.sin(idx * 2) };
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const { city } = useCity();
  return (
    <CommandScoped key={city.id} city={city}>
      {children}
    </CommandScoped>
  );
}

function CommandScoped({ children, city }: { children: ReactNode; city: CityConfig }) {
  const { state: world, actions } = useSlotify();
  const [s, setS] = useState<CommandState>(() => ({
    user: null,
    audit: [],
    incidents: [],
    notifications: [],
    units: Object.fromEntries(city.units.map((u) => [u.id, { id: u.id, status: "available" as const, ...unitHome(city, u.id) }])),
    vms: {},
    pricing: {},
    apiDown: false,
    activeScenarios: [],
    engineRunAt: null,
    modelReady: false,
    tampered: null,
  }));
  const ref = useRef(s);
  ref.current = s;
  const worldRef = useRef(world);
  worldRef.current = world;

  /* ---------------- Audit ledger (sequential sealing) ---------------- */
  const chain = useRef<Promise<AuditEntry | undefined>>(Promise.resolve(undefined));
  const append = useCallback((input: AuditInput) => {
    chain.current = chain.current.then(async (prev) => {
      const e = await seal(prev, input);
      setS((x) => ({ ...x, audit: [...x.audit, e] }));
      return e;
    });
  }, []);

  const actor = useCallback(() => {
    const u = ref.current.user;
    return u
      ? { actor: `${u.name} (${ROLES[u.role].label})`, actorId: u.id, role: u.role, source: "Command UI" }
      : { actor: "anonymous", actorId: "-", role: "-", source: "UI" };
  }, []);

  const log: CommandCtx["log"] = useCallback(
    (input) => append({ ...actor(), ...input } as AuditInput),
    [append, actor]
  );
  const sysLog = useCallback(
    (action: string, entity: string, detail: string, source = "Incident engine") =>
      append({ actor: "system:incident-engine", actorId: "system", role: "system", action, entity, detail, source }),
    [append]
  );

  /* ---------------- Session persistence (a page refresh mid-demo keeps the story) ---------------- */
  const PKEY = `slotify:cmd:${city.id}`;
  const restored = useRef(false);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PKEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<CommandState>;
        if (saved.audit?.length) {
          restored.current = true;
          chain.current = Promise.resolve(saved.audit[saved.audit.length - 1]);
          seedIncidentSeq(saved.incidents?.length ?? 0);
          setS((x) => ({
            ...x,
            audit: saved.audit ?? [],
            incidents: saved.incidents ?? [],
            notifications: saved.notifications ?? [],
            units: saved.units ?? x.units,
            vms: saved.vms ?? {},
            pricing: saved.pricing ?? {},
            apiDown: saved.apiDown ?? false,
            activeScenarios: saved.activeScenarios ?? [],
          }));
        }
      }
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!s.audit.length || s.tampered) return;
    const t = window.setTimeout(() => {
      try {
        const { audit, incidents, notifications, units, vms, pricing, apiDown, activeScenarios } = s;
        window.sessionStorage.setItem(PKEY, JSON.stringify({ audit, incidents, notifications, units, vms, pricing, apiDown, activeScenarios }));
      } catch {
        /* quota / privacy mode */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [s, PKEY]);

  /* ---------------- Boot ---------------- */
  useEffect(() => {
    if (restored.current) {
      sysLog("system.resumed", `city:${city.id}`, "Command node resumed after page reload; session ledger restored", "Platform");
    } else
    sysLog("system.boot", `city:${city.id}`, `Command node online for ${city.name} (${city.authority}); ${city.lots.length} lots, ${city.units.length} field units`, "Platform");
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    if (saved) {
      const role = saved.split(":")[0];
      const u = demoUsers(city).find((x) => x.role === role);
      if (u) {
        setS((x) => ({ ...x, user: u }));
        append({ actor: `${u.name} (${ROLES[u.role].label})`, actorId: u.id, role: u.role, action: "auth.session_resumed", entity: `user:${u.id}`, detail: `Session resumed (${u.auth})`, source: "Auth service" });
      }
    }
    void loadModel().then((m) => {
      setS((x) => ({ ...x, modelReady: true }));
      sysLog("model.loaded", `model:${m.meta.version}`, `Forecast model ${m.meta.version} loaded (trained ${m.meta.trainedAt}, holdout MAE ${m.meta.metrics.mae_occupancy_pts.gbm} pts)`, "Forecast service");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- Helpers ---------------- */
  const patchIncident = useCallback((id: string, fn: (i: Incident) => Incident) => {
    setS((x) => ({ ...x, incidents: x.incidents.map((i) => (i.id === id ? fn(i) : i)) }));
  }, []);
  const addTimeline = (i: Incident, item: Omit<TimelineItem, "at"> & { at?: number }): Incident => ({
    ...i,
    timeline: [...i.timeline, { at: Date.now(), ...item }],
  });
  const notify = useCallback((n: Omit<Notification, "id" | "at" | "status">) => {
    const id = uid("N");
    setS((x) => ({ ...x, notifications: [{ ...n, id, at: Date.now(), status: "sent" as const }, ...x.notifications].slice(0, 80) }));
    window.setTimeout(() => {
      setS((x) => ({ ...x, notifications: x.notifications.map((m) => (m.id === id && m.status === "sent" ? { ...m, status: "delivered" } : m)) }));
    }, 1500);
    return id;
  }, []);

  /* ---------------- Incident engine ---------------- */
  const streak = useRef(new Map<string, number>());
  const cooldown = useRef(new Map<string, number>());
  useEffect(() => {
    if (!world.hydrated) return;
    const t = window.setInterval(() => {
      const model = modelIfLoaded();
      if (!model) return;
      const w0 = worldRef.current;
      const now = Date.now();
      const w: WorldView = { city, slots: w0.slots, violations: w0.violations, offline: w0.offline, lastSeen: w0.lastSeen, history: w0.history, rainMm: w0.rainMm, now };
      const open = ref.current.incidents.filter((i) => i.status !== "resolved" && i.status !== "rejected");
      const openKeys = new Set(open.map((i) => i.key));
      const busyLots = new Set(open.flatMap((i) => i.watchLotIds));
      const candidates = [...detectSaturation(model, w), ...detectAnomalies(model, w, busyLots), ...detectClusters(w), ...detectOutages(model, w)];
      const seen = new Set<string>();
      const created: Incident[] = [];
      for (const c of candidates) {
        seen.add(c.key);
        const n = (streak.current.get(c.key) ?? 0) + 1;
        streak.current.set(c.key, n);
        const needed = c.key.startsWith("out:") ? 1 : 2; // 2 consecutive checks, outages are already debounced by the heartbeat timeout
        if (n < needed || openKeys.has(c.key)) continue;
        if ((cooldown.current.get(c.key) ?? 0) > now) continue;
        const inc = { ...c.build(), key: c.key };
        created.push(inc);
      }
      for (const k of [...streak.current.keys()]) if (!seen.has(k)) streak.current.delete(k);

      // monitoring: ready-to-close checks, escalation, outage auto-resolve
      const updates = new Map<string, Incident>();
      for (const i of open) {
        let next = i;
        if (i.status === "awaiting_approval" && !i.escalated && now - i.detectedAt > THRESHOLDS.escalateAfterMs && (i.severity === "critical" || i.severity === "high")) {
          next = addTimeline({ ...next, escalated: true }, { label: "No decision within SLA (90 s demo) → escalated to Deputy Commissioner (Traffic)", actor: "Escalation policy", kind: "system" });
          notify({ to: "Deputy Commissioner (Traffic)", channel: "SMS", message: `${i.id} ${i.title} — awaiting approval`, incidentId: i.id });
          sysLog("incident.escalated", i.id, "Approval SLA breached; escalated to Deputy Commissioner (Traffic)");
        }
        if (i.status !== "awaiting_approval" && !i.readyToClose) {
          let ready = false;
          if (i.type === "saturation") ready = i.watchLotIds.every((id) => lotOcc(w, id) < THRESHOLDS.saturationClear + 0.02);
          if (i.type === "anomaly") ready = i.watchLotIds.every((id) => lotOcc(w, id) < (i.occAtDetection ?? 1) - 0.08);
          if (i.type === "illegal_cluster") {
            const ids = new Set(i.recommendations.flatMap((r) => r.params?.violationIds ?? []));
            ready = w0.violations.filter((v) => ids.has(v.id)).every((v) => v.status === "resolved" || v.status === "challan_issued");
          }
          if (i.type === "sensor_outage") ready = !w0.offline[i.lotId!];
          if (ready) {
            const occNow = i.watchLotIds.length ? i.watchLotIds.reduce((a, id) => a + lotOcc(w, id), 0) / i.watchLotIds.length : undefined;
            next = addTimeline({ ...next, readyToClose: true, occAtResolution: occNow }, {
              label: i.type === "sensor_outage" ? "Frames resumed — live data restored" : "Conditions back to normal — ready for officer to close",
              actor: "Incident engine",
              kind: "system",
            });
            sysLog("incident.condition_cleared", i.id, "Clearance condition met");
          }
        }
        if (next !== i) updates.set(i.id, next);
      }

      // Correlation: a zone saturation supersedes still-pending anomaly incidents in the same zone.
      for (const inc of created.filter((c) => c.type === "saturation")) {
        const superseded = open.filter((o) => o.type === "anomaly" && o.zoneId === inc.zoneId && o.status === "awaiting_approval");
        for (const o of superseded) {
          updates.set(o.id, addTimeline({ ...(updates.get(o.id) ?? o), status: "resolved", resolved: { by: "system", at: now, note: `Merged into ${inc.id}` } }, { label: `Superseded — merged into ${inc.id} (zone saturation)`, actor: "Correlation engine", kind: "system" }));
          inc.timeline.unshift({ at: now, label: `Merged earlier anomaly alert ${o.id}`, actor: "Correlation engine", kind: "system" });
          inc.watchLotIds = [...new Set([...inc.watchLotIds, ...o.watchLotIds])];
          sysLog("incident.merged", o.id, `Merged into ${inc.id}`, "Correlation engine");
        }
      }

      if (created.length || updates.size) {
        setS((x) => ({
          ...x,
          engineRunAt: now,
          incidents: [...created, ...x.incidents.map((i) => updates.get(i.id) ?? i)],
        }));
      } else {
        setS((x) => ({ ...x, engineRunAt: now }));
      }
      for (const inc of created) {
        sysLog("incident.detected", inc.id, `${inc.title} · risk ${inc.risk.score}/100 (${inc.severity}) · ${inc.source}`);
        if (inc.forecast) sysLog("ai.forecast", inc.id, `${inc.forecast.modelVersion}: ${Math.round(inc.forecast.occupancy * 100)}% in ${inc.forecast.horizonMin} min (80% ${Math.round(inc.forecast.low * 100)}–${Math.round(inc.forecast.high * 100)}%)`, "Forecast service");
        sysLog("ai.recommendation", inc.id, inc.recommendations.map((r) => `${r.kind}${r.suggested ? "*" : ""}`).join(", "), "Recommendation engine");
        if (inc.severity !== "low") toast.warning(inc.title, { description: `${inc.severity.toUpperCase()} · risk ${inc.risk.score}/100 — awaiting approval`, duration: 6000 });
      }
    }, 4000);
    return () => window.clearInterval(t);
  }, [world.hydrated, city, notify, sysLog]);

  /* ---------------- Unit movement (demo clock) ---------------- */
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      const st = ref.current;
      for (const inc of st.incidents) {
        if (!inc.unitId || !inc.unitDepartAt || !inc.unitEtaAt) continue;
        const u = st.units[inc.unitId];
        if (!u || u.incidentId !== inc.id) continue;
        if (u.status === "dispatched" && now - inc.unitDepartAt > 2500) {
          setS((x) => ({
            ...x,
            units: { ...x.units, [u.id]: { ...u, status: "en_route" } },
            notifications: x.notifications.map((n) => (n.incidentId === inc.id && n.channel === "Field app push" ? { ...n, status: "acknowledged" } : n)),
          }));
          patchIncident(inc.id, (i) => addTimeline(i, { label: `${city.units.find((x) => x.id === u.id)?.name} acknowledged · en route`, actor: u.id, kind: "unit" }));
          sysLog("unit.acknowledged", inc.id, `${u.id} acknowledged dispatch`, "Field app");
        }
        if ((u.status === "en_route" || u.status === "dispatched") && now >= inc.unitEtaAt) {
          setS((x) => ({ ...x, units: { ...x.units, [u.id]: { ...u, status: "on_scene", lat: inc.lat, lng: inc.lng } } }));
          patchIncident(inc.id, (i) => addTimeline({ ...i, status: i.status === "dispatched" ? "on_scene" : i.status }, { label: "Unit on scene", actor: u.id, kind: "unit" }));
          sysLog("unit.on_scene", inc.id, `${u.id} on scene`, "Field app (GPS)");
          // tow / patrol clear the cluster once on scene
          const towIds = inc.recommendations.filter((r) => inc.approved?.recIds.includes(r.id) && (r.kind === "tow" || r.kind === "patrol")).flatMap((r) => r.params?.violationIds ?? []);
          if (towIds.length) {
            window.setTimeout(() => {
              actions.updateViolations(towIds, "resolved");
              patchIncident(inc.id, (i) => addTimeline(i, { label: `${towIds.length} vehicles cleared / moved on`, actor: u.id, kind: "unit" }));
              sysLog("enforcement.cleared", inc.id, `${towIds.length} violations cleared on site`, "Field app");
            }, 4000);
          }
        }
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [actions, city, patchIncident, sysLog]);

  /* ---------------- Actions ---------------- */
  const login = useCallback(
    (userId: string) => {
      const u = demoUsers(city).find((x) => x.id === userId);
      if (!u) return;
      setS((x) => ({ ...x, user: u }));
      try {
        window.sessionStorage.setItem(SESSION_KEY, `${u.role}:${u.id}`);
      } catch {
        /* ignore */
      }
      append({ actor: `${u.name} (${ROLES[u.role].label})`, actorId: u.id, role: u.role, action: "auth.login", entity: `user:${u.id}`, detail: `Signed in via ${u.auth}; permissions: ${ROLES[u.role].permissions.length}`, source: "Auth service" });
    },
    [append, city]
  );
  const logout = useCallback(() => {
    log({ action: "auth.logout", entity: `user:${ref.current.user?.id ?? "-"}`, detail: "Signed out" });
    setS((x) => ({ ...x, user: null }));
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, [log]);

  const runScenario = useCallback(
    (id: string) => {
      const sc = SCENARIOS[city.id].find((x) => x.id === id);
      if (!sc) return;
      const now = Date.now();
      sc.pressure?.forEach((p) =>
        p.lotIds.forEach((id) => {
          const lot = city.lots.find((l) => l.id === id);
          if (lot) actions.pressure([id], Math.max(0.15, p.target - expectedOccupancyAt(lot, now, worldRef.current.rainMm)), true);
        })
      );
      sc.offlineLotIds && actions.setOffline(sc.offlineLotIds, true);
      sc.rainMm !== undefined && actions.setRain(sc.rainMm);
      if (sc.apiDown) setS((x) => ({ ...x, apiDown: true }));
      if (sc.violationBurst) {
        const loc = city.commandZones.flatMap((z) => z.localities).find((l) => l.id === sc.violationBurst!.localityId)!;
        const spots = city.violationSpots.filter((v) => haversineKm(v, loc) < 0.3);
        const cityLocal = { ...city, violationSpots: spots.length ? spots : [{ location: loc.name, lat: loc.lat, lng: loc.lng }] };
        const list = Array.from({ length: Math.max(THRESHOLDS.clusterCount, sc.violationBurst.count + 1) }, (_, i) => {
          const v = makeViolation(cityLocal, Math.random, 0, 7000 + i);
          const type = i % 2 === 0 ? "Double parking" : v.type;
          return { ...v, id: `VIO-${Date.now().toString(36).slice(-4).toUpperCase()}${i}`, type, fine: type === "Double parking" ? 1000 : v.fine, at: Date.now() - i * 40_000, status: "detected" as const };
        });
        actions.addViolations(list);
      }
      setS((x) => ({ ...x, activeScenarios: [...new Set([...x.activeScenarios, id])] }));
      log({ action: "simulation.scenario_started", entity: `scenario:${id}`, detail: `${sc.title} — changes the SIMULATED world only; detection runs unmodified`, source: "Simulation console" });
      toast.message(`Drill started: ${sc.title}`, { description: "Simulated input. Watch the system detect it." });
    },
    [actions, city, log]
  );

  const resetSimulation = useCallback(() => {
    actions.clearPressure();
    actions.setOffline(city.lots.map((l) => l.id), false);
    actions.setRain(0);
    setS((x) => ({ ...x, apiDown: false, activeScenarios: [], vms: {}, pricing: {} }));
    log({ action: "simulation.reset", entity: `city:${city.id}`, detail: "All drills cleared; world returns to its normal demand curve", source: "Simulation console" });
  }, [actions, city, log]);

  const approve = useCallback(
    (incidentId: string, recIds: string[], note?: string) => {
      const st = ref.current;
      const inc = st.incidents.find((i) => i.id === incidentId);
      const u = st.user;
      if (!inc || !u) return;
      const chosen = inc.recommendations.filter((r) => recIds.includes(r.id));
      const allowed = chosen.every((r) => (r.enforcement ? can(u.role, "incident.approve_enforcement") : can(u.role, "incident.approve")));
      if (!allowed) {
        toast.error("Not permitted", { description: `${ROLES[u.role].label} cannot approve one or more of these actions.` });
        log({ action: "incident.approve_denied", entity: incidentId, detail: `RBAC denied: ${chosen.map((r) => r.kind).join(", ")}` });
        return;
      }
      const now = Date.now();
      let unitId: string | undefined;
      let etaAt: number | undefined;
      const tl: TimelineItem[] = [{ at: now, label: `Approved by ${u.name}: ${chosen.map((r) => r.title).join(" · ")}${note ? ` — “${note}”` : ""}`, actor: u.name, kind: "human" }];

      for (const r of chosen) {
        switch (r.kind) {
          case "redirect": {
            // diverted demand: affected lots settle well below saturation, alternatives absorb some of it
            const target = inc.type === "anomaly" ? 0.62 : 0.8;
            (inc.watchLotIds.length ? inc.watchLotIds : [r.params!.lotId!]).forEach((id) => {
              const lot = city.lots.find((l) => l.id === id);
              if (lot) actions.pressure([id], Math.min(0, target - expectedOccupancyAt(lot, now, worldRef.current.rainMm)), true);
            });
            actions.pressure(r.params?.altLotIds ?? [], 0.06);
            notify({ to: "Slotify citizen app · drivers searching nearby", channel: "Citizen app", message: r.detail, incidentId });
            tl.push({ at: now, label: "Reroute pushed to citizen app + Google Maps deep links", actor: "Notification service", kind: "notify" });
            break;
          }
          case "vms": {
            const msg = r.params?.message ?? "";
            setS((x) => ({ ...x, vms: { ...x.vms, ...Object.fromEntries((r.params?.vmsIds ?? []).map((v) => [v, { message: msg, at: now, incidentId }])) } }));
            (r.params?.vmsIds ?? []).forEach((v) => notify({ to: v, channel: "VMS board", message: msg, incidentId }));
            tl.push({ at: now, label: `VMS updated: “${msg}”`, actor: "VMS controller", kind: "notify" });
            break;
          }
          case "warden":
          case "patrol":
          case "tow": {
            const uid2 = r.params?.unitId;
            if (!uid2 || unitId) break;
            const home = st.units[uid2];
            const km = haversineKm(home, inc);
            const etaMin = Math.max(3, Math.round(((km * 1.3) / 22) * 60));
            unitId = uid2;
            etaAt = now + 2500 + etaMin * DEMO_MINUTE_MS;
            setS((x) => ({ ...x, units: { ...x.units, [uid2]: { ...x.units[uid2], status: "dispatched", incidentId } } }));
            const unitName = city.units.find((x) => x.id === uid2)?.name ?? uid2;
            notify({ to: unitName, channel: "Field app push", message: `${inc.id}: ${r.title}. Location ${inc.lat.toFixed(4)}, ${inc.lng.toFixed(4)}`, incidentId });
            tl.push({ at: now, label: `${unitName} dispatched · ETA ${etaMin} min`, actor: "Dispatch", kind: "notify" });
            break;
          }
          case "challan": {
            const ids = r.params?.violationIds ?? [];
            actions.updateViolations(ids, "challan_issued");
            notify({ to: `${ids.length} registered owners`, channel: "SMS", message: "e-Challan issued with ANPR evidence (simulated)", incidentId });
            tl.push({ at: now, label: `${ids.length} e-challans signed and issued`, actor: u.name, kind: "human" });
            break;
          }
          case "pricing": {
            const lots = inc.watchLotIds.length ? inc.watchLotIds : [r.params!.lotId!];
            setS((x) => ({ ...x, pricing: { ...x.pricing, ...Object.fromEntries(lots.map((l) => [l, { surcharge: 10, until: now + 60 * 60_000 }])) } }));
            actions.pressure(lots, -0.05);
            notify({ to: "Citizen app", channel: "Citizen app", message: "Temporary +₹10/h demand pricing for 60 min", incidentId });
            tl.push({ at: now, label: "Demand pricing active for 60 min", actor: "Pricing service", kind: "system" });
            break;
          }
          case "maintenance": {
            const lotId = r.params!.lotId!;
            notify({ to: "Camera vendor NOC", channel: "Vendor ticket", message: `P1: edge node at ${lotId} offline`, incidentId });
            tl.push({ at: now, label: "P1 ticket raised with camera vendor", actor: "Maintenance desk", kind: "notify" });
            window.setTimeout(() => {
              actions.setOffline([lotId], false);
              patchIncident(incidentId, (i) => addTimeline(i, { label: "Vendor technician restored power to edge node", actor: "Camera vendor", kind: "unit" }));
              sysLog("device.restored", `lot:${lotId}`, "Edge node back online (vendor)", "Device registry");
            }, 22_000);
            break;
          }
          case "verify": {
            window.setTimeout(() => {
              patchIncident(incidentId, (i) => addTimeline(i, { label: "Operator confirmed a genuine crowd on CCTV (not a sensor fault)", actor: "Lot operator", kind: "human" }));
            }, 5000);
            break;
          }
          case "fallback":
            break;
        }
      }
      patchIncident(incidentId, (i) => ({
        ...i,
        status: unitId ? "dispatched" : "monitoring",
        approved: { by: u.name, role: ROLES[u.role].label, at: now, recIds, note },
        unitId,
        unitDepartAt: unitId ? now : undefined,
        unitEtaAt: etaAt,
        timeline: [...i.timeline, ...tl],
      }));
      log({ action: "incident.approve", entity: incidentId, detail: `Approved ${chosen.map((r) => r.kind).join(", ")}${note ? `; note: ${note}` : ""}` });
      toast.success("Actions approved and dispatched", { description: chosen.map((r) => r.title).join(" · ") });
    },
    [actions, city, log, notify, patchIncident, sysLog]
  );

  const reject = useCallback(
    (incidentId: string, reason: string) => {
      const u = ref.current.user;
      if (!u) return;
      const inc = ref.current.incidents.find((i) => i.id === incidentId);
      if (inc) cooldown.current.set(inc.key, Date.now() + 120_000);
      patchIncident(incidentId, (i) =>
        addTimeline({ ...i, status: "rejected", rejected: { by: u.name, at: Date.now(), reason } }, { label: `Rejected by ${u.name}: ${reason}`, actor: u.name, kind: "human" })
      );
      log({ action: "incident.reject", entity: incidentId, detail: `Recommendation rejected: ${reason}` });
    },
    [log, patchIncident]
  );

  const close = useCallback(
    (incidentId: string, note: string) => {
      const u = ref.current.user;
      const inc = ref.current.incidents.find((i) => i.id === incidentId);
      if (!u || !inc) return;
      cooldown.current.set(inc.key, Date.now() + 60_000);
      const w = worldRef.current;
      const occNow = inc.watchLotIds.length
        ? inc.watchLotIds.reduce((a, id) => {
            const list = w.slots[id] ?? [];
            const usable = list.filter((x) => x.status !== "maintenance").length;
            return a + list.filter((x) => x.status === "occupied" || x.status === "reserved").length / Math.max(1, usable);
          }, 0) / inc.watchLotIds.length
        : undefined;
      if (inc.unitId) setS((x) => ({ ...x, units: { ...x.units, [inc.unitId!]: { ...x.units[inc.unitId!], status: "available", incidentId: undefined, ...unitHome(city, inc.unitId!) } } }));
      // VMS boards go back to the default message
      setS((x) => ({ ...x, vms: Object.fromEntries(Object.entries(x.vms).filter(([, v]) => v.incidentId !== incidentId)) }));
      patchIncident(incidentId, (i) =>
        addTimeline({ ...i, status: "resolved", resolved: { by: u.name, at: Date.now(), note }, occAtResolution: occNow ?? i.occAtResolution }, { label: `Closed by ${u.name}: ${note}`, actor: u.name, kind: "human" })
      );
      log({ action: "incident.close", entity: incidentId, detail: `Closed: ${note}` });
    },
    [city, log, patchIncident]
  );

  const restoreNode = useCallback(
    (lotId: string) => {
      actions.setOffline([lotId], false);
      log({ action: "device.restore", entity: `lot:${lotId}`, detail: "Edge node marked restored from health console", source: "Health console" });
    },
    [actions, log]
  );

  const setApiDown = useCallback(
    (down: boolean) => {
      setS((x) => ({ ...x, apiDown: down, activeScenarios: down ? [...new Set([...x.activeScenarios, "api-outage"])] : x.activeScenarios.filter((a) => a !== "api-outage") }));
      log({ action: down ? "simulation.api_down" : "simulation.api_restored", entity: "service:api-gateway", detail: down ? "Central API marked unreachable (drill)" : "Central API restored", source: "Simulation console" });
    },
    [log]
  );

  const verify = useCallback(async () => {
    const r = await verifyChain(ref.current.audit);
    log({ action: "audit.verify", entity: "ledger", detail: r.ok ? `Chain intact: ${r.checked} entries verified` : `Chain BROKEN at entry #${r.brokenAt}`, source: "Audit console" });
    return r;
  }, [log]);

  const tamper = useCallback(() => {
    setS((x) => {
      if (x.tampered || x.audit.length < 4) return x;
      const target = x.audit.find((e) => e.action === "incident.approve") ?? x.audit[Math.floor(x.audit.length / 2)];
      return {
        ...x,
        tampered: { seq: target.seq, original: target },
        audit: x.audit.map((e) => (e.seq === target.seq ? { ...e, detail: e.detail.replace(/Approved|Command node online/, "EDITED") + " [edited by insider]" } : e)),
      };
    });
  }, []);
  const undoTamper = useCallback(() => {
    setS((x) => (x.tampered ? { ...x, audit: x.audit.map((e) => (e.seq === x.tampered!.seq ? x.tampered!.original : e)), tampered: null } : x));
  }, []);

  const noteGenerated = useCallback((what: string, detail: string) => log({ action: what, entity: "report", detail, source: "Reporting engine" }), [log]);

  const value = useMemo<CommandCtx>(
    () => ({
      ...s,
      can: (p) => can(s.user?.role, p),
      login, logout, log, runScenario, resetSimulation, approve, reject, close, restoreNode, setApiDown, verify, tamper, undoTamper, noteGenerated,
    }),
    [s, login, logout, log, runScenario, resetSimulation, approve, reject, close, restoreNode, setApiDown, verify, tamper, undoTamper, noteGenerated]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCommand() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCommand must be used inside <CommandProvider>");
  return c;
}
