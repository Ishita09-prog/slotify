export type SlotStatus = "available" | "occupied" | "reserved" | "maintenance";
export type SlotType = "standard" | "ev" | "accessible" | "compact" | "bike";
export type LotCategory = "mall" | "commercial" | "transit" | "hospital" | "office" | "recreation" | "religious";

export interface Slot {
  id: string; // e.g. "B4"
  row: string; // "B"
  col: number; // 4
  status: SlotStatus;
  type: SlotType;
  vehicleNumber?: string;
  /** "me" when the current user holds the reservation */
  heldBy?: string;
  updatedAt: number;
}

export interface ParkingLot {
  id: string;
  name: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  category: LotCategory;
  layout: { rows: number; cols: number };
  pricePerHour: number;
  evSurchargePerHour: number;
  baseOccupancy: number;
  openHours: string;
  features: string[];
  ownerId: string;
  covered: boolean;
}

export interface LotSummary {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  occupancy: number; // 0..1, (occupied + reserved) / usable
}

export type LotWithStats = ParkingLot & LotSummary & { distanceKm?: number; etaMin?: number; stale?: boolean };

export type PaymentMethod = "fastag" | "upi" | "qr" | "card";

export interface Booking {
  id: string;
  lotId: string;
  lotName: string;
  slotId: string;
  vehicleNumber: string;
  startTime: number;
  durationHours: number;
  amount: number;
  paymentMethod: PaymentMethod;
  status: "confirmed" | "active" | "completed" | "cancelled";
  createdAt: number;
  /** "timed" = owner time window, "open" = no time limit */
  mode?: "timed" | "open";
  windowLabel?: string;
  /** non-refundable cover charge paid at booking, adjusted against the parking fee */
  coverCharge?: number;
}

export interface FastagTxn {
  id: string;
  kind: "debit" | "credit";
  amount: number;
  description: string;
  lotName?: string;
  durationMin?: number;
  at: number;
  balanceAfter: number;
}

export interface Wallet {
  vehicleNumber: string;
  tagId: string;
  bank: string;
  balance: number;
  txns: FastagTxn[];
}

export interface ParkingSession {
  lotId: string;
  lotName: string;
  slotId: string;
  entryAt: number;
  /** simulated minutes elapsed per real second (time warp for demos) */
  warp: number;
}

export interface DetectionEvent {
  id: string;
  lotId: string;
  slotId: string;
  from: SlotStatus;
  to: SlotStatus;
  camera: string;
  confidence: number;
  vehicleNumber?: string;
  at: number;
}

export type ViolationStatus = "detected" | "notice_sent" | "challan_issued" | "resolved";

export interface Violation {
  id: string;
  vehicleNumber: string;
  at: number;
  location: string;
  lat: number;
  lng: number;
  type: string;
  confidence: number;
  fine: number;
  status: ViolationStatus;
  camera: string;
}

export interface LegalParking {
  id: string;
  vehicleNumber: string;
  lat: number;
  lng: number;
  lotName: string;
}

export type DemandLevel = "high" | "medium" | "low";

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  demand: DemandLevel;
  occupancy: number;
  vehiclesPerHour: number;
  avgSearchMin: number;
  congestionIndex: number;
}

export interface Prediction {
  lotId: string;
  currentOccupancy: number;
  predictedOccupancy: number;
  predictedAvailable: number;
  totalSlots: number;
  confidence: number;
  arrivalAt: number;
  peakHours: { label: string; occupancy: number }[];
  bestTimeToArrive: string;
  trend: { hour: string; typical: number; actual: number | null; forecast: number | null; band?: [number, number] | null }[];
  source: "backend" | "local";
  /** 80% prediction interval (0..1) */
  low?: number;
  high?: number;
  /** free-bay range implied by the interval */
  rangeAvailable?: [number, number];
  /** why the model predicted this (occupancy points per factor) */
  factors?: { label: string; value?: string; points: number }[];
  modelVersion?: string;
  horizonMin?: number;
}

/* ---------------- Multi-city / command-centre geography ---------------- */

export type LocalityKind = "junction" | "market" | "transit" | "mall" | "it_corridor" | "beach" | "temple" | "hospital" | "residential" | "civic";

/** A monitored locality (hotspot) inside an operational zone. */
export interface Locality {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: LocalityKind;
  /** parking lots that sit in this locality */
  lotIds: string[];
  /** on-street ANPR cameras watching this hotspot */
  anprCameras: number;
  /** baseline peak-hour inflow (vehicles / h), simulated */
  vehiclesPerHour: number;
}

/** Operational command zone (e.g. "Velachery"), owned by one traffic division. */
export interface CommandZone {
  id: string;
  name: string;
  division: string;
  color: string;
  localities: Locality[];
}

export interface ViolationSpot {
  location: string;
  lat: number;
  lng: number;
  localityId?: string;
}
