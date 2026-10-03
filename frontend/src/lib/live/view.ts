import type { ParkingLot, Slot } from "../types";
import { conflict, holdActive, type BookingRequest } from "./service";
import { currentWindow, istDateKey, slotKey } from "./time";
import { leaseAt, leaseClashing } from "./plans";
import type { Bay, LiveLot } from "./types";

export type BayState = "free" | "booked" | "parked" | "holding" | "mine" | "maintenance";

/** What a given user sees for a bay, for a given booking request (or "right now" when req is null). */
export function bayState(bay: Bay, lot: LiveLot, uid: string | null, now: number, req: BookingRequest | null): { state: BayState; reason?: string; vehicle?: string } {
  if (!bay.active) return { state: "maintenance", reason: "Under maintenance" };
  const occNow = (() => {
    if (bay.open) return bay.open;
    const w = currentWindow(lot.windows, now);
    return w ? bay.slots?.[slotKey(istDateKey(now), w.id)] : undefined;
  })();
  if (req?.vehicle && (req.vehicle === "bike") !== (bay.type === "bike")) return { state: "maintenance", reason: req.vehicle === "bike" ? "Car bay" : "Two-wheeler bay" };
  const planNow = leaseAt(bay, now);
  if (req) {
    // weekly / monthly request: my own overlapping plan shows as "mine", anyone else's as booked (via conflict below)
    const lease = req.mode === "plan" && req.plan ? leaseClashing(bay, req.plan) : undefined;
    if (lease?.uid === uid) return { state: "mine", vehicle: lease.vehicle };
    const occ = req.mode === "timed" && req.dateKey && req.window ? bay.slots?.[slotKey(req.dateKey, req.window.id)] ?? (req.dateKey === istDateKey(now) ? bay.open ?? undefined : undefined) : bay.open ?? undefined;
    if (occ?.uid === uid) return { state: "mine", vehicle: occ.vehicle };
    const why = conflict(bay, lot, req, now);
    if (why) return { state: occ?.status === "parked" ? "parked" : "booked", reason: why, vehicle: occ?.vehicle };
  } else if (occNow ?? planNow) {
    const o = (occNow ?? planNow)!;
    if (o.uid === uid) return { state: "mine", vehicle: o.vehicle };
    return { state: o.status === "parked" ? "parked" : "booked", vehicle: o.vehicle };
  }
  if (holdActive(bay, now) && bay.hold!.uid !== uid) return { state: "holding", reason: "Someone is booking this bay" };
  return { state: "free" };
}

/** Adapter to the shared <SlotGrid /> component. */
export function toSlot(bay: Bay, s: ReturnType<typeof bayState>, showVehicle = false): Slot {
  const status: Slot["status"] =
    s.state === "free" ? "available" : s.state === "maintenance" ? "maintenance" : s.state === "holding" ? "reserved" : "occupied";
  return {
    id: bay.label,
    row: bay.row,
    col: bay.col,
    status: s.state === "mine" ? "reserved" : status,
    type: bay.type,
    heldBy: s.state === "mine" ? "me" : undefined,
    vehicleNumber: showVehicle ? s.vehicle : undefined,
    updatedAt: bay.updatedAt,
  };
}

export function lotStats(lot: LiveLot, bays: Bay[], now: number, req: BookingRequest | null = null, uid: string | null = null) {
  const mine = bays.filter((b) => b.lotId === lot.id);
  let free = 0, booked = 0, parked = 0, holding = 0, maint = 0, ev = 0, evFree = 0, acc = 0, accFree = 0, bike = 0, bikeFree = 0;
  const forBike = req?.vehicle === "bike";
  for (const b of mine) {
    const s = bayState(b, lot, uid, now, req).state;
    if (b.type === "bike") {
      bike++;
      if (s === "free") bikeFree++;
    }
    if ((b.type === "bike") !== forBike) continue; // counts below are for the vehicle kind being parked (cars by default)
    if (s === "free") free++;
    else if (s === "parked") parked++;
    else if (s === "holding") holding++;
    else if (s === "maintenance") maint++;
    else booked++;
    if (b.type === "ev") {
      ev++;
      if (s === "free") evFree++;
    }
    if (b.type === "accessible") {
      acc++;
      if (s === "free") accFree++;
    }
  }
  const total = mine.filter((b) => (b.type === "bike") === forBike).length;
  const usable = total - maint;
  return { total, usable, free, booked, parked, holding, maint, ev, evFree, acc, accFree, bike, bikeFree, occupancy: usable ? (usable - free) / usable : 0 };
}

/** Shape the ML forecaster expects. New lots have no history, so the model falls back to the category demand curve. */
export function asParkingLot(lot: LiveLot, total: number): ParkingLot {
  return {
    id: lot.id,
    name: lot.name,
    area: lot.area,
    address: lot.address,
    lat: lot.lat,
    lng: lot.lng,
    category: lot.category,
    layout: { rows: lot.rows, cols: Math.max(1, Math.ceil(total / Math.max(1, lot.rows))) },
    pricePerHour: lot.pricePerHour,
    evSurchargePerHour: lot.evPerHour,
    baseOccupancy: 0.85,
    openHours: lot.openHours,
    features: lot.features,
    ownerId: lot.ownerUid,
    covered: lot.features.includes("Covered"),
  };
}
