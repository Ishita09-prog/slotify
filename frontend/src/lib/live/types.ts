import type { LotCategory, SlotType } from "../types";

/* ------------------------------------------------------------------ */
/* Real (non-simulated) data model shared by every device.             */
/* Firestore collections: accounts, lots, bays, bookings, txns.        */
/* ------------------------------------------------------------------ */

export type Role = "driver" | "owner";
export type VehicleType = "car" | "suv" | "ev" | "bike";

export interface Vehicle {
  number: string;
  type: VehicleType;
}

export interface Fastag {
  tagId: string;
  bank: string;
  balance: number;
  vehicle: string;
  /** NETC tag status; absent = active. The driver can hotlist a lost/stolen tag from the app. */
  status?: "active" | "low_balance" | "blacklisted" | "hotlisted" | "closed";
}

export interface Account {
  id: string; // = auth uid
  username: string;
  role: Role;
  name: string;
  phone: string;
  createdAt: number;
  vehicles: Vehicle[];
  defaultVehicle?: string;
  fastag?: Fastag;
  /** owner: business name shown to drivers */
  business?: string;
}

export interface TimeWindow {
  id: string;
  start: string; // "10:00"
  end: string; // "13:00"
}

export interface LiveLot {
  id: string;
  ownerUid: string;
  ownerName: string;
  name: string;
  category: LotCategory;
  area: string;
  zone: string;
  address: string;
  lat: number;
  lng: number;
  pricePerHour: number;
  evPerHour: number;
  /** two-wheeler hourly rate (defaults to a third of the car rate) */
  bikePerHour?: number;
  /** drivers may park without a time limit (pay for time used) */
  allowOpen: boolean;
  /** drivers book one of the owner's time slots */
  allowTimed: boolean;
  windows: TimeWindow[];
  openHours: string;
  features: string[];
  createdAt: number;
  rows: number;
  /** optional per-lot override of the weekly/monthly base rate (defaults live in plans.ts) */
  planRates?: { weekly?: number; monthly?: number };
}

/** A booking pinned on a bay (the bay document is the lock — every booking goes through a transaction on it). */
export interface Occupant {
  bookingId: string;
  uid: string;
  vehicle: string;
  status: "booked" | "parked";
  at: number;
}

export interface Bay {
  id: string;
  lotId: string;
  ownerUid: string;
  label: string; // "A3"
  row: string;
  col: number;
  type: SlotType;
  active: boolean;
  /** checkout in progress — nobody else can book until `until` */
  hold?: { uid: string; until: number } | null;
  /** no-time-limit booking */
  open?: Occupant | null;
  /** timed bookings keyed by `${yyyymmdd}_${windowId}` */
  slots?: Record<string, Occupant>;
  /** weekly / monthly leases keyed by booking id. Ranges are [startAt, endAt). */
  plans?: Record<string, PlanLease>;
  updatedAt: number;
}

/** A weekly/monthly reservation pinned on a bay. endAt is exclusive (00:00 IST). */
export interface PlanLease extends Occupant {
  startAt: number;
  endAt: number;
  /** time-limited pass: bay is held only for these hours each day; null/absent = whole day */
  daily?: { start: string; hours: number } | null;
}

export type PayMethod = "fastag" | "upi" | "qr" | "card";
export type BookingStatus = "booked" | "parked" | "completed" | "cancelled" | "noshow";

export interface LiveBooking {
  id: string;
  lotId: string;
  lotName: string;
  lotArea: string;
  bayId: string;
  bayLabel: string;
  ownerUid: string;
  driverUid: string;
  driverName: string;
  vehicle: string;
  vehicleType: VehicleType;
  /** "plan" = weekly/monthly. Documents written before plans existed have no bookingType and are hourly. */
  mode: "timed" | "open" | "plan";
  bookingType?: "hourly" | "weekly" | "monthly";
  /** plan: number of weeks / months */
  duration?: number | null;
  /** plan: total charged (also stored in `cover` so existing revenue sums include it) */
  amount?: number | null;
  planRate?: number | null;
  planDiscountPct?: number | null;
  /** plan: time-limited pass window ("HH:00" + hours); null = whole day */
  planDaily?: { start: string; hours: number } | null;
  /** plan: IST dates, yyyy-mm-dd (endDate is the exclusive end) */
  startDate?: string | null;
  endDate?: string | null;
  /** plan: money returned on cancellation */
  refunded?: number | null;
  /** timed: slot key + label */
  slotKey?: string | null;
  windowLabel?: string | null;
  /** timed: window start/end; open: expected arrival / null */
  startAt: number;
  endAt: number | null;
  status: BookingStatus;
  cover: number;
  coverMethod: PayMethod;
  pricePerHour: number;
  createdAt: number;
  parkedAt?: number | null;
  exitAt?: number | null;
  fee?: number | null;
  paidAtExit?: number | null;
  exitMethod?: PayMethod | null;
}

export interface Txn {
  id: string;
  uid: string;
  kind: "credit" | "debit";
  amount: number;
  desc: string;
  at: number;
  balanceAfter: number;
  method: PayMethod | "fastag-gate" | "recharge";
  /** gate charges: tag read, plate read, issuer/acquirer and NETC reference (see netc.ts) */
  netc?: import("./netc").NetcInfo | null;
}

export const COVER = 25;
export const COVER_BIKE = 10;
export const coverFor = (t?: VehicleType) => (t === "bike" ? COVER_BIKE : COVER);
/** Two-wheeler hourly rate: owner-set, else a third of the car rate (min ₹5). */
export const bikeRate = (lot: { pricePerHour: number; bikePerHour?: number }) => lot.bikePerHour ?? Math.max(5, Math.round(lot.pricePerHour / 3 / 5) * 5);
export const HOLD_MS = 3 * 60_000;
export const NO_SHOW_GRACE_MS = 15 * 60_000;
export const VEHICLE_LABEL: Record<VehicleType, string> = { car: "Car", suv: "SUV", ev: "Electric car", bike: "Two-wheeler" };

/** Command centre → operator request for recorded camera footage (operator approves; every step is audited). */
export interface FootageRequest {
  id: string;
  lotId: string;
  lotName: string;
  ownerUid: string;
  ownerName: string;
  requestedBy: string;
  requestedById: string;
  reason: string;
  window: string; // "Today 18:00–18:30"
  status: "pending" | "approved" | "declined";
  createdAt: number;
  decidedAt?: number | null;
  note?: string | null;
}

/** Traffic-police notice / e-challan addressed to a vehicle (delivered in-app when the plate belongs to a Slotify driver). */
export interface PoliceNotice {
  id: string;
  plate: string;
  kind: "notice" | "challan";
  violation: string;
  location: string;
  fine: number;
  issuedBy: string;
  createdAt: number;
  dueAt: number;
  status: "sent" | "seen" | "moved" | "paid";
  driverUid?: string | null;
  driverName?: string | null;
  updatedAt: number;
  paidMethod?: PayMethod | null;
}
