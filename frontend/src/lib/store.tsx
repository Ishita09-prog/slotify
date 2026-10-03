"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type {
  Booking,
  DetectionEvent,
  FastagTxn,
  LotSummary,
  LotWithStats,
  ParkingSession,
  Slot,
  SlotStatus,
  SlotType,
  Violation,
  ViolationStatus,
  Wallet,
} from "./types";
import {
  CAMERAS,
  ROW_LETTERS,
  STARTING_BALANCE,
  generateSlots,
  makeViolation,
  randomPlate,
  seedViolations,
} from "./mock-data";
import { etaMinutes, haversineKm, uid } from "./utils";
import { firebaseEnabled, subscribeToSlots } from "./firebase";
import type { CityConfig } from "./cities";
import { useCity } from "./city";
import { expectedOccupancyAt } from "./sim/demand";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

type ViolationSeed = Violation & { minutesAgo?: number };

interface State {
  slots: Record<string, Slot[]>;
  events: DetectionEvent[];
  wallet: Wallet;
  bookings: Booking[];
  session: ParkingSession | null;
  violations: ViolationSeed[];
  hydrated: boolean;
  liveSource: "simulator" | "firestore";
  /** extra demand pushed onto a lot by a scenario / relieved by an approved action (−0.6…+0.6) */
  pressure: Record<string, number>;
  /** lots whose camera node is down → timestamp it went down */
  offline: Record<string, number>;
  /** last camera heartbeat per lot */
  lastSeen: Record<string, number>;
  /** simulated weather feed (mm/h) */
  rainMm: number;
  /** occupancy snapshots every 10 s (ring buffer) for trend, anomaly and impact analysis */
  history: { t: number; occ: Record<string, number> }[];
}

type Action =
  | { type: "HYDRATE"; now: number; city: CityConfig; wallet?: Wallet; bookings?: Booking[]; session?: ParkingSession | null }
  | { type: "DETECT"; events: DetectionEvent[] }
  | { type: "REPLACE_SLOTS"; lotId: string; slots: Slot[] }
  | { type: "RESERVE"; booking: Booking }
  | { type: "CANCEL_BOOKING"; id: string }
  | { type: "ADD_SLOTS"; lotId: string; row: string; count: number; slotType: SlotType; now: number }
  | { type: "REMOVE_SLOTS"; lotId: string; ids: string[] }
  | { type: "SET_STATUS"; lotId: string; ids: string[]; status: SlotStatus; now: number }
  | { type: "WALLET"; txn: Omit<FastagTxn, "balanceAfter"> }
  | { type: "START_SESSION"; session: ParkingSession; vehicle: string }
  | { type: "END_SESSION" }
  | { type: "SET_WARP"; warp: number }
  | { type: "ADD_VIOLATION"; violation: Violation }
  | { type: "UPDATE_VIOLATION"; id: string; status: ViolationStatus }
  | { type: "SET_SOURCE"; source: State["liveSource"] }
  | { type: "PRESSURE"; lotIds: string[]; delta: number; absolute?: boolean }
  | { type: "CLEAR_PRESSURE" }
  | { type: "OFFLINE"; lotIds: string[]; down: boolean; now: number }
  | { type: "HEARTBEAT"; now: number }
  | { type: "RAIN"; mm: number }
  | { type: "SNAPSHOT"; now: number }
  | { type: "BULK_VIOLATIONS"; violations: Violation[] }
  | { type: "UPDATE_VIOLATIONS"; ids: string[]; status: ViolationStatus }
  | { type: "HOLD"; lotId: string; slotId: string; hold: boolean; now: number }
  | { type: "CAMERA_BAY"; lotId: string; slotId: string; occupied: boolean | null; confidence: number; now: number };

const defaultWallet = (city: CityConfig): Wallet => ({
  vehicleNumber: city.demoVehicle,
  tagId: city.id === "coimbatore" ? "34161FA820328EE8" : "34161FA82033C7D1",
  bank: city.walletBank,
  balance: STARTING_BALANCE,
  txns: [],
});

function initialState(city: CityConfig): State {
  const slots: Record<string, Slot[]> = {};
  city.lots.forEach((l) => (slots[l.id] = generateSlots(l, city.plateDistricts)));
  return {
    slots,
    events: [],
    wallet: defaultWallet(city),
    bookings: [],
    session: null,
    violations: seedViolations(city),
    hydrated: false,
    liveSource: "simulator",
    pressure: {},
    offline: {},
    lastSeen: {},
    rainMm: 0,
    history: [],
  };
}

const clampP = (v: number) => Math.max(-0.8, Math.min(0.8, v));

function patchSlots(list: Slot[], ids: string[], patch: (s: Slot) => Slot) {
  const set = new Set(ids);
  return list.map((s) => (set.has(s.id) ? patch(s) : s));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE": {
      const bookings = action.bookings ?? state.bookings;
      const session = action.session === undefined ? state.session : action.session;
      // Re-seed every lot at the occupancy the city would show right now (client clock, IST demand curves).
      const slots: Record<string, Slot[]> = {};
      action.city.lots.forEach((l) => {
        slots[l.id] = generateSlots(l, action.city.plateDistricts, expectedOccupancyAt(l, action.now));
      });
      const lastSeen: Record<string, number> = {};
      action.city.lots.forEach((l) => (lastSeen[l.id] = action.now));
      // Re-apply the user's own holds on top of the simulated lot state.
      bookings
        .filter((b) => b.status === "confirmed")
        .forEach((b) => {
          if (!slots[b.lotId]) return;
          slots[b.lotId] = patchSlots(slots[b.lotId], [b.slotId], (s) => ({
            ...s, status: "reserved", heldBy: "me", vehicleNumber: b.vehicleNumber,
          }));
        });
      if (session && slots[session.lotId]) {
        slots[session.lotId] = patchSlots(slots[session.lotId], [session.slotId], (s) => ({
          ...s, status: "occupied", heldBy: "me", vehicleNumber: (action.wallet ?? state.wallet).vehicleNumber,
        }));
      }
      return {
        ...state,
        slots,
        bookings,
        session,
        wallet: action.wallet ?? state.wallet,
        violations: state.violations.map((v) => ({ ...v, at: v.at || action.now - (v.minutesAgo ?? 0) * 60000 })),
        lastSeen,
        // Camera history for the last 40 min (what the simulated network reported before this page opened),
        // so trend and anomaly checks work from the first second.
        history: Array.from({ length: 40 }, (_, i) => {
          const t = action.now - (40 - i) * 60_000;
          const occ: Record<string, number> = {};
          action.city.lots.forEach((l) => (occ[l.id] = Math.round(expectedOccupancyAt(l, t) * 1000) / 1000));
          return { t, occ };
        }),
        hydrated: true,
      };
    }
    case "DETECT": {
      const slots = { ...state.slots };
      for (const e of action.events) {
        const list = slots[e.lotId];
        if (!list) continue;
        slots[e.lotId] = list.map((s) =>
          s.id === e.slotId
            ? {
                ...s,
                status: e.to,
                heldBy: undefined,
                vehicleNumber: e.to === "occupied" || e.to === "reserved" ? e.vehicleNumber : undefined,
                updatedAt: e.at,
              }
            : s
        );
      }
      return { ...state, slots, events: [...action.events, ...state.events].slice(0, 60) };
    }
    case "REPLACE_SLOTS":
      return { ...state, slots: { ...state.slots, [action.lotId]: action.slots } };
    case "RESERVE": {
      const b = action.booking;
      // Collision guard: a bay can only be booked if it is free or held by this checkout. Reducer runs atomically.
      const target = state.slots[b.lotId]?.find((x) => x.id === b.slotId);
      if (!target || !(target.status === "available" || (target.status === "reserved" && target.heldBy === "hold"))) return state;
      if (state.bookings.some((x) => x.lotId === b.lotId && x.slotId === b.slotId && x.status === "confirmed")) return state;
      return {
        ...state,
        bookings: [b, ...state.bookings],
        slots: {
          ...state.slots,
          [b.lotId]: patchSlots(state.slots[b.lotId] ?? [], [b.slotId], (s) => ({
            ...s, status: "reserved", heldBy: "me", vehicleNumber: b.vehicleNumber, updatedAt: b.createdAt,
          })),
        },
      };
    }
    case "CANCEL_BOOKING": {
      const b = state.bookings.find((x) => x.id === action.id);
      if (!b) return state;
      return {
        ...state,
        bookings: state.bookings.map((x) => (x.id === action.id ? { ...x, status: "cancelled" } : x)),
        slots: {
          ...state.slots,
          [b.lotId]: patchSlots(state.slots[b.lotId] ?? [], [b.slotId], (s) =>
            s.heldBy === "me" ? { ...s, status: "available", heldBy: undefined, vehicleNumber: undefined } : s
          ),
        },
      };
    }
    case "ADD_SLOTS": {
      const list = state.slots[action.lotId] ?? [];
      const inRow = list.filter((s) => s.row === action.row);
      const start = inRow.reduce((m, s) => Math.max(m, s.col), 0);
      const added: Slot[] = Array.from({ length: action.count }, (_, i) => ({
        id: `${action.row}${start + i + 1}`,
        row: action.row,
        col: start + i + 1,
        status: "available",
        type: action.slotType,
        updatedAt: action.now,
      }));
      const next = [...list, ...added].sort((a, b) => (a.row === b.row ? a.col - b.col : a.row.localeCompare(b.row)));
      return { ...state, slots: { ...state.slots, [action.lotId]: next } };
    }
    case "REMOVE_SLOTS": {
      const set = new Set(action.ids);
      return {
        ...state,
        slots: { ...state.slots, [action.lotId]: (state.slots[action.lotId] ?? []).filter((s) => !set.has(s.id)) },
      };
    }
    case "SET_STATUS":
      return {
        ...state,
        slots: {
          ...state.slots,
          [action.lotId]: patchSlots(state.slots[action.lotId] ?? [], action.ids, (s) => ({
            ...s,
            status: action.status,
            heldBy: undefined,
            vehicleNumber: action.status === "available" || action.status === "maintenance" ? undefined : s.vehicleNumber,
            updatedAt: action.now,
          })),
        },
      };
    case "WALLET": {
      const delta = action.txn.kind === "credit" ? action.txn.amount : -action.txn.amount;
      const balance = Math.round((state.wallet.balance + delta) * 100) / 100;
      return {
        ...state,
        wallet: { ...state.wallet, balance, txns: [{ ...action.txn, balanceAfter: balance }, ...state.wallet.txns] },
      };
    }
    case "START_SESSION": {
      const { session } = action;
      return {
        ...state,
        session,
        bookings: state.bookings.map((b) =>
          b.lotId === session.lotId && b.slotId === session.slotId && b.status === "confirmed" ? { ...b, status: "active" } : b
        ),
        slots: {
          ...state.slots,
          [session.lotId]: patchSlots(state.slots[session.lotId] ?? [], [session.slotId], (s) => ({
            ...s, status: "occupied", heldBy: "me", vehicleNumber: action.vehicle, updatedAt: session.entryAt,
          })),
        },
      };
    }
    case "END_SESSION": {
      const s0 = state.session;
      if (!s0) return state;
      return {
        ...state,
        session: null,
        bookings: state.bookings.map((b) =>
          b.lotId === s0.lotId && b.slotId === s0.slotId && b.status === "active" ? { ...b, status: "completed" } : b
        ),
        slots: {
          ...state.slots,
          [s0.lotId]: patchSlots(state.slots[s0.lotId] ?? [], [s0.slotId], (s) => ({
            ...s, status: "available", heldBy: undefined, vehicleNumber: undefined,
          })),
        },
      };
    }
    case "SET_WARP":
      return state.session ? { ...state, session: { ...state.session, warp: action.warp } } : state;
    case "ADD_VIOLATION":
      return { ...state, violations: [action.violation, ...state.violations].slice(0, 80) };
    case "UPDATE_VIOLATION":
      return {
        ...state,
        violations: state.violations.map((v) => (v.id === action.id ? { ...v, status: action.status } : v)),
      };
    case "SET_SOURCE":
      return { ...state, liveSource: action.source };
    case "PRESSURE": {
      const pressure = { ...state.pressure };
      for (const id of action.lotIds) pressure[id] = clampP(action.absolute ? action.delta : (pressure[id] ?? 0) + action.delta);
      return { ...state, pressure };
    }
    case "CLEAR_PRESSURE":
      return { ...state, pressure: {} };
    case "OFFLINE": {
      const offline = { ...state.offline };
      const lastSeen = { ...state.lastSeen };
      for (const id of action.lotIds) {
        if (action.down) offline[id] = action.now;
        else {
          delete offline[id];
          lastSeen[id] = action.now;
        }
      }
      return { ...state, offline, lastSeen };
    }
    case "HEARTBEAT": {
      const lastSeen = { ...state.lastSeen };
      for (const id of Object.keys(state.slots)) if (!state.offline[id]) lastSeen[id] = action.now;
      return { ...state, lastSeen };
    }
    case "RAIN":
      return { ...state, rainMm: action.mm };
    case "SNAPSHOT": {
      const occ: Record<string, number> = {};
      for (const [id, list] of Object.entries(state.slots)) occ[id] = Math.round(summarize(list).occupancy * 1000) / 1000;
      return { ...state, history: [...state.history, { t: action.now, occ }].slice(-400) };
    }
    case "BULK_VIOLATIONS":
      return { ...state, violations: [...action.violations, ...state.violations].slice(0, 120) };
    case "HOLD": {
      // Checkout lock: the bay is taken off the market while this driver pays (prevents double booking).
      const list = state.slots[action.lotId];
      if (!list) return state;
      return {
        ...state,
        slots: {
          ...state.slots,
          [action.lotId]: patchSlots(list, [action.slotId], (x) =>
            action.hold
              ? x.status === "available" ? { ...x, status: "reserved", heldBy: "hold", updatedAt: action.now } : x
              : x.heldBy === "hold" ? { ...x, status: "available", heldBy: undefined, updatedAt: action.now } : x
          ),
        },
      };
    }
    case "CAMERA_BAY": {
      // A bay watched by the live AI camera: the camera is the source of truth (simulator leaves it alone).
      const list = state.slots[action.lotId];
      const slot = list?.find((x) => x.id === action.slotId);
      if (!list || !slot) return state;
      if (action.occupied === null) {
        return { ...state, slots: { ...state.slots, [action.lotId]: patchSlots(list, [action.slotId], (x) => ({ ...x, heldBy: undefined })) } };
      }
      const to: SlotStatus = action.occupied ? "occupied" : "available";
      if (slot.status === to && slot.heldBy === "camera") return state;
      const ev: DetectionEvent = {
        id: uid("EV"), lotId: action.lotId, slotId: action.slotId, from: slot.status, to,
        camera: "CAM-LIVE", confidence: action.confidence, at: action.now,
      };
      return {
        ...state,
        slots: {
          ...state.slots,
          [action.lotId]: patchSlots(list, [action.slotId], (x) => ({
            ...x, status: to, heldBy: "camera", vehicleNumber: action.occupied ? x.vehicleNumber ?? "LIVE-CAM" : undefined, updatedAt: action.now,
          })),
        },
        events: [ev, ...state.events].slice(0, 60),
      };
    }
    case "UPDATE_VIOLATIONS": {
      const set = new Set(action.ids);
      return { ...state, violations: state.violations.map((v) => (set.has(v.id) ? { ...v, status: action.status } : v)) };
    }
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* AI detection simulator                                              */
/* ------------------------------------------------------------------ */

export function summarize(slots: Slot[]): LotSummary {
  let available = 0, occupied = 0, reserved = 0, maintenance = 0;
  for (const s of slots) {
    if (s.status === "available") available++;
    else if (s.status === "occupied") occupied++;
    else if (s.status === "reserved") reserved++;
    else maintenance++;
  }
  const usable = slots.length - maintenance;
  return {
    total: slots.length,
    available,
    occupied,
    reserved,
    maintenance,
    occupancy: usable > 0 ? (occupied + reserved) / usable : 0,
  };
}

/** Where a lot is heading right now: IST demand curve × weather + scenario / action pressure. */
export function liveTarget(lot: CityConfig["lots"][number], state: Pick<State, "pressure" | "rainMm">, now: number) {
  return Math.max(0.02, Math.min(0.995, expectedOccupancyAt(lot, now, state.rainMm) + (state.pressure[lot.id] ?? 0)));
}

/**
 * On-device stand-in for the edge camera network. Each tick, every online lot moves a few bays
 * towards its live target (bigger gap → more bays) plus a little random churn, and every change is
 * emitted as a detection event exactly like a camera would POST to /api/detections.
 */
function simulateDetections(state: State, city: CityConfig): DetectionEvent[] {
  const now = Date.now();
  const events: DetectionEvent[] = [];
  const emit = (lotId: string, slot: Slot, to: SlotStatus) =>
    events.push({
      id: uid("EV"),
      lotId,
      slotId: slot.id,
      from: slot.status,
      to,
      camera: CAMERAS[Math.floor(Math.random() * CAMERAS.length)],
      confidence: 0.9 + Math.random() * 0.095,
      vehicleNumber:
        to === "occupied" && slot.status === "reserved" && slot.vehicleNumber ? slot.vehicleNumber : randomPlate(Math.random, city.plateDistricts),
      at: now,
    });
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

  for (const lot of city.lots) {
    if (state.offline[lot.id]) continue;
    const slots = state.slots[lot.id];
    if (!slots?.length) continue;
    const free = slots.filter((s) => s.status === "available" && s.heldBy !== "camera");
    const reserved = slots.filter((s) => s.status === "reserved" && !s.heldBy);
    const occupied = slots.filter((s) => s.status === "occupied" && !s.heldBy);
    const sum = summarize(slots);
    const usable = sum.total - sum.maintenance;
    const gap = liveTarget(lot, state, now) - sum.occupancy;
    let moves = Math.min(Math.max(4, Math.ceil(usable / 12)), Math.round((Math.abs(gap) * usable) / 5));
    if (moves === 0 && Math.random() < 0.18) moves = 1; // natural churn
    const used = new Set<string>();
    for (let i = 0; i < moves; i++) {
      const fill = gap > 0.01 || (Math.abs(gap) <= 0.01 && Math.random() < 0.5);
      if (fill) {
        // arrivals: reserved cars turn up, or new cars take a free bay
        const r = reserved.filter((s) => !used.has(s.id));
        const f = free.filter((s) => !used.has(s.id));
        if (r.length && Math.random() < 0.35) {
          const s = pick(r); used.add(s.id); emit(lot.id, s, "occupied");
        } else if (f.length) {
          const s = pick(f); used.add(s.id); emit(lot.id, s, Math.random() < 0.82 ? "occupied" : "reserved");
        }
      } else {
        const o = [...occupied, ...reserved].filter((s) => !used.has(s.id));
        if (o.length) {
          const s = pick(o); used.add(s.id); emit(lot.id, s, "available");
        }
      }
    }
    // maintenance bays occasionally come back
    if (Math.random() < 0.01) {
      const m = slots.filter((s) => s.status === "maintenance");
      if (m.length) emit(lot.id, pick(m), "available");
    }
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

const storageKey = (city: CityConfig) => `slotify:v2:${city.id}`;

interface Ctx {
  state: State;
  actions: {
    reserve: (b: Booking) => void;
    cancelBooking: (id: string) => void;
    addSlots: (lotId: string, row: string, count: number, slotType: SlotType) => void;
    removeSlots: (lotId: string, ids: string[]) => void;
    setStatus: (lotId: string, ids: string[], status: SlotStatus) => void;
    walletTxn: (txn: Omit<FastagTxn, "balanceAfter" | "id" | "at">) => void;
    startSession: (lotId: string, lotName: string, slotId: string) => void;
    endSession: () => void;
    setWarp: (warp: number) => void;
    updateViolation: (id: string, status: ViolationStatus) => void;
    updateViolations: (ids: string[], status: ViolationStatus) => void;
    addViolations: (v: Violation[]) => void;
    pressure: (lotIds: string[], delta: number, absolute?: boolean) => void;
    clearPressure: () => void;
    setOffline: (lotIds: string[], down: boolean) => void;
    setRain: (mm: number) => void;
    cameraBay: (lotId: string, slotId: string, occupied: boolean | null, confidence?: number) => void;
    /** lock a bay for checkout; returns false if someone else got it first */
    holdBay: (lotId: string, slotId: string) => boolean;
    releaseBay: (lotId: string, slotId: string) => void;
  };
}

const SlotifyContext = createContext<Ctx | null>(null);

export function SlotifyProvider({ children }: { children: ReactNode }) {
  const { city } = useCity();
  return (
    <CityScopedProvider key={city.id} city={city}>
      {children}
    </CityScopedProvider>
  );
}

function CityScopedProvider({ children, city }: { children: ReactNode; city: CityConfig }) {
  const [state, dispatch] = useReducer(reducer, city, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Hydrate persisted wallet/bookings/session once on the client.
  useEffect(() => {
    let saved: Partial<Pick<State, "wallet" | "bookings" | "session">> = {};
    try {
      const raw = window.localStorage.getItem(storageKey(city));
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* storage unavailable: start fresh */
    }
    dispatch({ type: "HYDRATE", now: Date.now(), city, wallet: saved.wallet, bookings: saved.bookings, session: saved.session ?? null });
    // simulated-world drill state survives a refresh within the browser session
    try {
      const sim = JSON.parse(window.sessionStorage.getItem(`slotify:sim:${city.id}`) ?? "null") as null | { pressure: Record<string, number>; offline: string[]; rainMm: number };
      if (sim) {
        Object.entries(sim.pressure).forEach(([id, v]) => dispatch({ type: "PRESSURE", lotIds: [id], delta: v, absolute: true }));
        if (sim.offline.length) dispatch({ type: "OFFLINE", lotIds: sim.offline, down: true, now: Date.now() - 20_000 });
        if (sim.rainMm) dispatch({ type: "RAIN", mm: sim.rainMm });
      }
    } catch {
      /* ignore */
    }
  }, [city]);

  useEffect(() => {
    if (!state.hydrated) return;
    try {
      window.sessionStorage.setItem(`slotify:sim:${city.id}`, JSON.stringify({ pressure: state.pressure, offline: Object.keys(state.offline), rainMm: state.rainMm }));
    } catch {
      /* ignore */
    }
  }, [state.pressure, state.offline, state.rainMm, state.hydrated, city]);

  // Persist user-owned data.
  useEffect(() => {
    if (!state.hydrated) return;
    try {
      window.localStorage.setItem(
        storageKey(city),
        JSON.stringify({ wallet: state.wallet, bookings: state.bookings, session: state.session })
      );
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [state.wallet, state.bookings, state.session, state.hydrated, city]);

  // Live source: Firestore when configured, otherwise the on-device detector.
  useEffect(() => {
    if (!state.hydrated) return;
    if (firebaseEnabled) {
      dispatch({ type: "SET_SOURCE", source: "firestore" });
      const unsubs = city.lots.map((l) => subscribeToSlots(l.id, (slots) => dispatch({ type: "REPLACE_SLOTS", lotId: l.id, slots })));
      return () => unsubs.forEach((u) => u());
    }
    const t = window.setInterval(() => {
      const events = simulateDetections(stateRef.current, city);
      if (events.length) dispatch({ type: "DETECT", events });
      dispatch({ type: "HEARTBEAT", now: Date.now() });
    }, 3000);
    return () => window.clearInterval(t);
  }, [state.hydrated, city]);

  // Occupancy snapshots for trend / anomaly / impact analysis.
  useEffect(() => {
    if (!state.hydrated) return;
    dispatch({ type: "SNAPSHOT", now: Date.now() });
    const t = window.setInterval(() => dispatch({ type: "SNAPSHOT", now: Date.now() }), 10000);
    return () => window.clearInterval(t);
  }, [state.hydrated]);

  // ANPR camera feed for the police dashboard.
  useEffect(() => {
    if (!state.hydrated) return;
    let n = 0;
    const t = window.setInterval(() => {
      n++;
      const v = makeViolation(city, Math.random, 0, 900 + n);
      dispatch({ type: "ADD_VIOLATION", violation: { ...v, id: `VIO-${5000 + n}`, at: Date.now(), status: "detected" } });
    }, 45000);
    return () => window.clearInterval(t);
  }, [state.hydrated, city]);

  const actions = useMemo<Ctx["actions"]>(
    () => ({
      reserve: (booking) => dispatch({ type: "RESERVE", booking }),
      cancelBooking: (id) => dispatch({ type: "CANCEL_BOOKING", id }),
      addSlots: (lotId, row, count, slotType) => dispatch({ type: "ADD_SLOTS", lotId, row, count, slotType, now: Date.now() }),
      removeSlots: (lotId, ids) => dispatch({ type: "REMOVE_SLOTS", lotId, ids }),
      setStatus: (lotId, ids, status) => dispatch({ type: "SET_STATUS", lotId, ids, status, now: Date.now() }),
      walletTxn: (txn) => dispatch({ type: "WALLET", txn: { ...txn, id: uid("TX"), at: Date.now() } }),
      startSession: (lotId, lotName, slotId) =>
        dispatch({
          type: "START_SESSION",
          vehicle: stateRef.current.wallet.vehicleNumber,
          session: { lotId, lotName, slotId, entryAt: Date.now(), warp: 60 },
        }),
      endSession: () => dispatch({ type: "END_SESSION" }),
      setWarp: (warp) => dispatch({ type: "SET_WARP", warp }),
      updateViolation: (id, status) => dispatch({ type: "UPDATE_VIOLATION", id, status }),
      updateViolations: (ids, status) => dispatch({ type: "UPDATE_VIOLATIONS", ids, status }),
      addViolations: (violations) => dispatch({ type: "BULK_VIOLATIONS", violations }),
      pressure: (lotIds, delta, absolute) => dispatch({ type: "PRESSURE", lotIds, delta, absolute }),
      clearPressure: () => dispatch({ type: "CLEAR_PRESSURE" }),
      setOffline: (lotIds, down) => dispatch({ type: "OFFLINE", lotIds, down, now: Date.now() }),
      setRain: (mm) => dispatch({ type: "RAIN", mm }),
      holdBay: (lotId, slotId) => {
        const slot = stateRef.current.slots[lotId]?.find((x) => x.id === slotId);
        if (!slot || slot.status !== "available") return false;
        dispatch({ type: "HOLD", lotId, slotId, hold: true, now: Date.now() });
        return true;
      },
      releaseBay: (lotId, slotId) => dispatch({ type: "HOLD", lotId, slotId, hold: false, now: Date.now() }),
      cameraBay: (lotId, slotId, occupied, confidence = 0.9) => dispatch({ type: "CAMERA_BAY", lotId, slotId, occupied, confidence, now: Date.now() }),
    }),
    []
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <SlotifyContext.Provider value={value}>{children}</SlotifyContext.Provider>;
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export function useSlotify() {
  const ctx = useContext(SlotifyContext);
  if (!ctx) throw new Error("useSlotify must be used inside <SlotifyProvider>");
  return ctx;
}

/** Wall clock that is null during SSR, so relative times never mismatch on hydration. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useLots(origin?: { lat: number; lng: number } | null): LotWithStats[] {
  const { state } = useSlotify();
  const { city } = useCity();
  return useMemo(
    () =>
      city.lots.map((lot) => {
        const summary = summarize(state.slots[lot.id] ?? []);
        const distanceKm = origin ? haversineKm(origin, lot) : undefined;
        return {
          ...lot,
          ...summary,
          distanceKm,
          etaMin: distanceKm !== undefined ? etaMinutes(distanceKm, city.avgSpeedKmh) : undefined,
          stale: !!state.offline[lot.id],
        };
      }),
    [state.slots, state.offline, origin, city]
  );
}

export function useLot(lotId: string) {
  const { state } = useSlotify();
  const { city } = useCity();
  const lot = city.lots.find((l) => l.id === lotId) ?? null;
  const slots = state.slots[lotId] ?? [];
  const summary = useMemo(() => summarize(slots), [slots]);
  return { lot, slots, summary };
}

export function nextRowLetter(slots: Slot[]) {
  const used = new Set(slots.map((s) => s.row));
  return ROW_LETTERS.find((l) => !used.has(l)) ?? "Z";
}
