import type { SlotType } from "../types";
import { cleanUsername, UserError, type Store } from "./store";
import { istDateKey, slotKey, windowRange, windowHours } from "./time";
import { hourlyBlockedByPlan, keyToIso, overlaps, planConflict, planRefund, quotePlan, type PlanQuote, type PlanSpec } from "./plans";
import {
  HOLD_MS, NO_SHOW_GRACE_MS, bikeRate, coverFor,
  type Account, type Bay, type LiveBooking, type LiveLot, type Occupant, type PayMethod, type PoliceNotice, type Role, type TimeWindow, type Txn, type Vehicle,
} from "./types";

/* ============================== accounts ============================== */

export async function registerAccount(
  store: Store,
  input: { username: string; password: string; role: Role; name: string; phone: string; business?: string; vehicles: Vehicle[] }
) {
  const username = cleanUsername(input.username);
  if (username.length < 3) throw new UserError("Username needs at least 3 letters or numbers.");
  if (input.password.length < 6) throw new UserError("Password must be at least 6 characters.");
  const uid = await store.auth.signUp(username, input.password);
  const acc: Account = {
    id: uid,
    username,
    role: input.role,
    name: input.name.trim(),
    phone: input.phone,
    createdAt: Date.now(),
    vehicles: input.vehicles,
    defaultVehicle: input.vehicles[0]?.number,
    business: input.business?.trim() || undefined,
    fastag:
      input.role === "driver" && input.vehicles[0]
        ? { tagId: newTagId(), bank: "Slotify Pay · NETC sandbox", balance: 0, vehicle: input.vehicles[0].number }
        : undefined,
  };
  await store.set("accounts", uid, acc);
  return acc;
}

function newTagId() {
  // NETC tag IDs are 24 hex chars (EPC); "34161FA82" prefix mimics an issuer code.
  let s = "34161FA82";
  for (let i = 0; i < 15; i++) s += "0123456789ABCDEF"[Math.floor(Math.random() * 16)];
  return s;
}

export async function saveAccount(store: Store, acc: Account) {
  await store.set("accounts", acc.id, acc);
}

export async function recharge(store: Store, uid: string, amount: number, method: PayMethod) {
  return store.tx(async (t) => {
    const acc = await t.get<Account>("accounts", uid);
    if (!acc?.fastag) throw new UserError("No FASTag linked to this account.");
    const balance = acc.fastag.balance + amount;
    t.set("accounts", uid, { ...acc, fastag: { ...acc.fastag, balance } });
    const txn: Txn = { id: rid("TX"), uid, kind: "credit", amount, desc: `FASTag recharge via ${method.toUpperCase()}`, at: Date.now(), balanceAfter: balance, method: "recharge" };
    t.set("txns", txn.id, txn);
    return balance;
  });
}

/* ================================ lots ================================ */

export const ROW_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export async function createLot(
  store: Store,
  owner: Account,
  lot: Omit<LiveLot, "id" | "ownerUid" | "ownerName" | "createdAt" | "rows">,
  layout: { rows: number; perRow: number; ev: number; accessible: number; bikes?: number }
) {
  const id = store.newId();
  const full: LiveLot = { ...lot, id, ownerUid: owner.id, ownerName: owner.business || owner.name, createdAt: Date.now(), rows: layout.rows };
  await store.set("lots", id, full);
  const bays: Bay[] = [];
  const total = layout.rows * layout.perRow;
  let n = 0;
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 1; c <= layout.perRow; c++) {
      n++;
      const type: SlotType = n <= layout.accessible ? "accessible" : n > total - layout.ev ? "ev" : "standard";
      bays.push(newBay(full, ROW_LETTERS[r], c, type));
    }
  }
  // two-wheeler rows (row letters after the car rows), up to 12 per row
  const nb = layout.bikes ?? 0;
  for (let i = 0; i < nb; i++) bays.push(newBay(full, ROW_LETTERS[layout.rows + Math.floor(i / 12)], (i % 12) + 1, "bike"));
  if (nb) await store.set("lots", id, { ...full, rows: layout.rows + Math.ceil(nb / 12) });
  await Promise.all(bays.map((b) => store.set("bays", b.id, b)));
  return full;
}

function newBay(lot: LiveLot, row: string, col: number, type: SlotType): Bay {
  return { id: `${lot.id}-${row}${col}`, lotId: lot.id, ownerUid: lot.ownerUid, label: `${row}${col}`, row, col, type, active: true, hold: null, open: null, slots: {}, updatedAt: Date.now() };
}

export async function addBays(store: Store, lot: LiveLot, existing: Bay[], row: string, count: number, type: SlotType) {
  const inRow = existing.filter((b) => b.row === row);
  const start = inRow.reduce((m, b) => Math.max(m, b.col), 0);
  const bays = Array.from({ length: count }, (_, i) => newBay(lot, row, start + i + 1, type));
  await Promise.all(bays.map((b) => store.set("bays", b.id, b)));
  const rows = new Set([...existing.map((b) => b.row), row]).size;
  if (rows !== lot.rows) await store.set("lots", lot.id, { ...lot, rows });
  return bays;
}

export async function setBayActive(store: Store, bayId: string, active: boolean) {
  return store.tx(async (t) => {
    const bay = await t.get<Bay>("bays", bayId);
    if (!bay) throw new UserError("Bay not found.");
    if (!active && (bay.open || Object.keys(bay.slots ?? {}).length || Object.values(bay.plans ?? {}).some((l) => l.endAt > Date.now()))) throw new UserError(`${bay.label} has a booking. Close it after the driver leaves.`);
    t.set("bays", bayId, { ...bay, active, updatedAt: Date.now() });
  });
}

export async function updateLot(store: Store, lot: LiveLot) {
  await store.set("lots", lot.id, lot);
}

/* ============================ bay state =============================== */

export interface BookingRequest {
  mode: "timed" | "open" | "plan";
  /** vehicle being parked: two-wheelers use bike bays only, cars never take bike bays */
  vehicle?: Vehicle["type"];
  dateKey?: string;
  window?: TimeWindow;
  /** mode "plan": weekly / monthly reservation */
  plan?: PlanSpec;
}

/** Why this bay can't take the request (null = free). Same rule the transaction enforces. */
export function conflict(bay: Bay, lot: LiveLot, req: BookingRequest, now: number): string | null {
  if (!bay.active) return "Under maintenance";
  if (req.vehicle === "bike" && bay.type !== "bike") return "Car bay";
  if (req.vehicle && req.vehicle !== "bike" && bay.type === "bike") return "Two-wheeler bay";
  const today = istDateKey(now);
  // weekly / monthly plans: checked against other plans, open stays and every timed slot
  if (req.mode === "plan") return req.plan ? planConflict(bay, lot, req.plan, now) : "Pick a plan";
  // hourly requests must also respect plans already on the bay
  const byPlan = hourlyBlockedByPlan(bay, req, now);
  if (byPlan) return byPlan;
  if (req.mode === "timed") {
    if (!req.dateKey || !req.window) return "Pick a time slot";
    if (bay.slots?.[slotKey(req.dateKey, req.window.id)]) return "Booked for this slot";
    if (bay.open && req.dateKey === today) return "Taken (no time limit)";
    return null;
  }
  if (bay.open) return "Booked";
  for (const [key] of Object.entries(bay.slots ?? {})) {
    const [d, wid] = key.split("_");
    const w = lot.windows.find((x) => x.id === wid);
    if (d === today && w && windowRange(d, w).end > now) return "Booked for a time slot today";
  }
  return null;
}

export const holdActive = (bay: Bay, now: number) => !!bay.hold && bay.hold.until > now;

/** `seed` = bay shape to create on first booking (public camera lots have no document until booked). */
export async function holdBay(store: Store, uid: string, bayId: string, seed?: Bay) {
  return store.tx(async (t) => {
    const bay = (await t.get<Bay>("bays", bayId)) ?? (seed ? { ...seed, open: null, hold: null, slots: {}, plans: {} } : null);
    if (!bay || !bay.active) throw new UserError("This bay is not available.");
    const now = Date.now();
    if (bay.hold && bay.hold.uid !== uid && bay.hold.until > now) throw new UserError("Someone else is booking this bay right now. Pick another.");
    const until = now + HOLD_MS;
    t.set("bays", bayId, { ...bay, hold: { uid, until }, updatedAt: now });
    return until;
  });
}

export async function releaseBay(store: Store, uid: string, bayId: string) {
  try {
    await store.tx(async (t) => {
      const bay = await t.get<Bay>("bays", bayId);
      if (bay?.hold?.uid === uid) t.set("bays", bayId, { ...bay, hold: null, updatedAt: Date.now() });
    });
  } catch {
    /* hold simply expires */
  }
}

/* ============================== booking =============================== */

export class LowBalance extends UserError {
  constructor(public balance: number, public needed: number) {
    super(`FASTag balance ₹${balance} is less than ₹${needed}.`);
  }
}

export async function book(
  store: Store,
  driver: Account,
  args: { lot: LiveLot; bayId: string; req: BookingRequest; vehicle: Vehicle; method: PayMethod; arriveInMin?: number; seed?: Bay }
): Promise<LiveBooking> {
  const { lot, bayId, req, vehicle, method } = args;
  if (req.mode === "open" && !lot.allowOpen) throw new UserError("This lot only takes time-slot bookings.");
  if (req.mode === "timed" && !lot.allowTimed) throw new UserError("This lot doesn't offer time slots.");
  // weekly / monthly: price is always recomputed here, never trusted from the client
  let quote: PlanQuote | null = null;
  if (req.mode === "plan") {
    if (!req.plan) throw new UserError("Pick a plan.");
    try {
      quote = quotePlan(lot, req.plan);
    } catch (e) {
      throw new UserError((e as Error).message);
    }
  }
  const COVER = coverFor(vehicle.type);
  const charge = quote ? quote.total : COVER;
  // one active no-time-limit booking per vehicle
  const mine = await store.query<LiveBooking>("bookings", ["driverUid", driver.id]);
  if (mine.some((b) => b.vehicle === vehicle.number && (b.status === "parked" || (b.status === "booked" && b.mode === "open")) && req.mode === "open"))
    throw new UserError(`${vehicle.number} already has an active booking.`);
  if (quote && mine.some((b) => b.mode === "plan" && b.status === "booked" && b.lotId === lot.id && b.vehicle === vehicle.number && overlaps(b.startAt, b.endAt ?? 0, quote!.startAt, quote!.endAt)))
    throw new UserError(`${vehicle.number} already has a plan at this location for those dates.`);

  return store.tx(async (t) => {
    const bay = (await t.get<Bay>("bays", bayId)) ?? (args.seed ? { ...args.seed, open: null, hold: null, slots: {}, plans: {} } : null);
    const acc = await t.get<Account>("accounts", driver.id);
    const now = Date.now();
    if (!bay || !acc) throw new UserError("Bay not found.");
    if (bay.hold && bay.hold.uid !== driver.id && bay.hold.until > now) throw new UserError("Someone else is booking this bay right now.");
    const why = conflict(bay, lot, req, now);
    if (why) throw new UserError(`Bay ${bay.label} was just taken (${why.toLowerCase()}). Pick another bay.`);
    if (method === "fastag") {
      if (!acc.fastag) throw new UserError("No FASTag linked.");
      if (acc.fastag.balance < charge) throw new LowBalance(acc.fastag.balance, charge);
    }
    const id = rid("SLT-");
    const range = req.mode === "timed" ? windowRange(req.dateKey!, req.window!) : null;
    const booking: LiveBooking = {
      id,
      lotId: lot.id,
      lotName: lot.name,
      lotArea: lot.area,
      bayId,
      bayLabel: bay.label,
      ownerUid: lot.ownerUid,
      driverUid: driver.id,
      driverName: acc.name,
      vehicle: vehicle.number,
      vehicleType: vehicle.type,
      mode: req.mode,
      slotKey: req.mode === "timed" ? slotKey(req.dateKey!, req.window!.id) : null,
      windowLabel: req.mode === "timed" ? `${req.window!.start}–${req.window!.end}` : null,
      startAt: quote ? quote.startAt : range ? range.start : now + (args.arriveInMin ?? 0) * 60_000,
      endAt: quote ? quote.endAt : range ? range.end : null,
      status: "booked",
      cover: charge,
      coverMethod: method,
      pricePerHour: bay.type === "bike" ? bikeRate(lot) : lot.pricePerHour + (bay.type === "ev" ? lot.evPerHour : 0),
      createdAt: now,
      ...(quote
        ? {
            bookingType: quote.type,
            duration: quote.units,
            amount: quote.total,
            planRate: quote.rate,
            planDiscountPct: quote.discountPct,
            startDate: keyToIso(quote.startKey),
            endDate: keyToIso(istDateKey(quote.endAt)),
          }
        : { bookingType: "hourly" as const }),
    };
    const occ: Occupant = { bookingId: id, uid: driver.id, vehicle: vehicle.number, status: "booked", at: now };
    // finished leases older than a day are dropped so the bay document doesn't grow forever
    const livePlans = Object.fromEntries(Object.entries(bay.plans ?? {}).filter(([, l]) => l.endAt > now - 24 * 3600_000));
    const nextBay: Bay = quote
      ? { ...bay, hold: null, plans: { ...livePlans, [id]: { ...occ, startAt: quote.startAt, endAt: quote.endAt } }, updatedAt: now }
      : req.mode === "timed"
        ? { ...bay, hold: null, slots: { ...(bay.slots ?? {}), [booking.slotKey!]: occ }, updatedAt: now }
        : { ...bay, hold: null, open: occ, updatedAt: now };
    t.set("bays", bayId, nextBay);
    t.set("bookings", id, booking);
    if (method === "fastag" && acc.fastag) {
      const balance = acc.fastag.balance - charge;
      t.set("accounts", acc.id, { ...acc, fastag: { ...acc.fastag, balance } });
      const txn: Txn = {
        id: rid("TX"), uid: acc.id, kind: "debit", amount: charge,
        desc: quote ? `${quote.type === "weekly" ? "Weekly" : "Monthly"} plan (${quote.durationLabel}) · ${lot.name} · ${bay.label}` : `Cover charge · ${lot.name} · ${bay.label}`,
        at: now, balanceAfter: balance, method: "fastag",
      };
      t.set("txns", txn.id, txn);
    }
    return booking;
  });
}

function clearOccupant(bay: Bay, b: LiveBooking): Bay {
  if (b.mode === "plan") {
    const plans = { ...(bay.plans ?? {}) };
    delete plans[b.id];
    return { ...bay, plans, updatedAt: Date.now() };
  }
  if (b.mode === "open") return { ...bay, open: bay.open?.bookingId === b.id ? null : bay.open, updatedAt: Date.now() };
  const slots = { ...(bay.slots ?? {}) };
  if (b.slotKey && slots[b.slotKey]?.bookingId === b.id) delete slots[b.slotKey];
  return { ...bay, slots, updatedAt: Date.now() };
}

export async function cancelBooking(store: Store, bookingId: string, status: "cancelled" | "noshow" = "cancelled") {
  return store.tx(async (t) => {
    const b = await t.get<LiveBooking>("bookings", bookingId);
    if (!b) throw new UserError("Booking not found.");
    const bay = await t.get<Bay>("bays", b.bayId);
    if (b.status !== "booked") throw new UserError("Only upcoming bookings can be cancelled.");
    // plans: unused time is refunded to the driver's FASTag wallet (reads must happen before writes)
    const acc = b.mode === "plan" ? await t.get<Account>("accounts", b.driverUid) : null;
    const now = Date.now();
    const refund = b.mode === "plan" && status === "cancelled" ? planRefund(b, now) : 0;
    if (bay) t.set("bays", bay.id, clearOccupant(bay, b));
    t.set("bookings", b.id, { ...b, status, exitAt: now, ...(b.mode === "plan" ? { refunded: refund } : {}) });
    if (refund > 0 && acc?.fastag) {
      const balance = acc.fastag.balance + refund;
      t.set("accounts", acc.id, { ...acc, fastag: { ...acc.fastag, balance } });
      const txn: Txn = { id: rid("TX"), uid: acc.id, kind: "credit", amount: refund, desc: `Plan cancelled · ${b.lotName} · ${b.bayLabel} (unused time refunded)`, at: now, balanceAfter: balance, method: "recharge" };
      t.set("txns", txn.id, txn);
    }
  });
}

/* ========================= FASTag gate (owner) ======================== */

export async function findAtGate(store: Store, lotId: string, plate: string) {
  const list = await store.query<LiveBooking>("bookings", ["vehicle", plate]);
  return list.filter((b) => b.lotId === lotId && (b.status === "booked" || b.status === "parked") && b.mode !== "plan").sort((a, b) => a.startAt - b.startAt);
}

export async function gateEntry(store: Store, bookingId: string) {
  return store.tx(async (t) => {
    const b = await t.get<LiveBooking>("bookings", bookingId);
    if (!b) throw new UserError("Booking not found.");
    const bay = await t.get<Bay>("bays", b.bayId);
    const now = Date.now();
    if (b.status !== "booked") throw new UserError(b.status === "parked" ? "This car is already inside." : "Booking is not active.");
    if (b.mode === "timed" && now < b.startAt - 30 * 60_000) throw new UserError(`Too early. Slot ${b.windowLabel} opens 30 min before start.`);
    if (b.endAt && now > b.endAt) throw new UserError("This time slot has ended.");
    if (bay) {
      const occ = b.mode === "open" ? bay.open : bay.slots?.[b.slotKey!];
      const parked = occ ? { ...occ, status: "parked" as const, at: now } : null;
      t.set("bays", bay.id, b.mode === "open" ? { ...bay, open: parked, updatedAt: now } : { ...bay, slots: { ...(bay.slots ?? {}), [b.slotKey!]: parked! }, updatedAt: now });
    }
    t.set("bookings", b.id, { ...b, status: "parked", parkedAt: now });
    return { ...b, status: "parked", parkedAt: now } as LiveBooking;
  });
}

/** Fee for time actually parked: per started hour, minimum one hour. */
export function exitQuote(b: LiveBooking, now = Date.now()) {
  const ms = now - (b.parkedAt ?? now);
  const hours = Math.max(1, Math.ceil(ms / 3600_000 - 0.001));
  const fee = hours * b.pricePerHour;
  return { ms, hours, fee, due: Math.max(0, fee - b.cover) };
}

export async function gateExit(store: Store, bookingId: string, method: PayMethod) {
  return store.tx(async (t) => {
    const b = await t.get<LiveBooking>("bookings", bookingId);
    if (!b) throw new UserError("Booking not found.");
    const bay = await t.get<Bay>("bays", b.bayId);
    const acc = await t.get<Account>("accounts", b.driverUid);
    if (b.status !== "parked") throw new UserError("This car hasn't entered yet.");
    const now = Date.now();
    const q = exitQuote(b, now);
    if (method === "fastag") {
      const bal = acc?.fastag?.balance ?? 0;
      if (!acc?.fastag || bal < q.due) throw new LowBalance(bal, q.due);
    }
    if (bay) t.set("bays", bay.id, clearOccupant(bay, b));
    const done: LiveBooking = { ...b, status: "completed", exitAt: now, fee: q.fee, paidAtExit: q.due, exitMethod: method };
    t.set("bookings", b.id, done);
    if (method === "fastag" && acc?.fastag && q.due > 0) {
      const balance = acc.fastag.balance - q.due;
      t.set("accounts", acc.id, { ...acc, fastag: { ...acc.fastag, balance } });
      const txn: Txn = { id: rid("TX"), uid: acc.id, kind: "debit", amount: q.due, desc: `Parking ${b.lotName} · ${b.bayLabel} · ${q.hours} h (₹${b.cover} cover adjusted)`, at: now, balanceAfter: balance, method: "fastag-gate" };
      t.set("txns", txn.id, txn);
    }
    return { booking: done, ...q };
  });
}

/** Release bays of drivers who didn't turn up within the grace period (cover charge is kept). */
export async function sweepNoShows(store: Store, bookings: LiveBooking[], now = Date.now()) {
  const late = bookings.filter((b) => b.status === "booked" && b.mode !== "plan" && now > b.startAt + NO_SHOW_GRACE_MS);
  for (const b of late) {
    try {
      await cancelBooking(store, b.id, "noshow");
    } catch {
      /* another device already did it */
    }
  }
  return late.length;
}

export const windowFee = (lot: LiveLot, w: TimeWindow) => windowHours(w) * lot.pricePerHour;

function rid(prefix: string) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = prefix;
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/* ======================= traffic police notices ======================= */

export async function findDriverByPlate(store: Store, plate: string) {
  const drivers = await store.query<Account>("accounts", ["role", "driver"]);
  return drivers.find((d) => d.vehicles?.some((v) => v.number === plate)) ?? null;
}

export async function issueNotice(store: Store, input: { plate: string; violation: string; location: string; fine: number; issuedBy: string }) {
  const driver = await findDriverByPlate(store, input.plate);
  const now = Date.now();
  const n: PoliceNotice = {
    id: rid("PN-"),
    plate: input.plate,
    kind: "notice",
    violation: input.violation,
    location: input.location,
    fine: input.fine,
    issuedBy: input.issuedBy,
    createdAt: now,
    dueAt: now + 10 * 60_000,
    status: "sent",
    driverUid: driver?.id ?? null,
    driverName: driver?.name ?? null,
    updatedAt: now,
  };
  await store.set("notices", n.id, n);
  return n;
}

export async function updateNotice(store: Store, n: PoliceNotice, patch: Partial<PoliceNotice>) {
  await store.set("notices", n.id, { ...n, ...patch, updatedAt: Date.now() });
}

export async function escalateToChallan(store: Store, n: PoliceNotice) {
  await updateNotice(store, n, { kind: "challan", status: "sent", dueAt: Date.now() + 7 * 24 * 3600_000 });
}

/** Driver pays an e-challan; FASTag debits the wallet atomically. */
export async function payChallan(store: Store, noticeId: string, uid: string, method: PayMethod) {
  return store.tx(async (t) => {
    const n = await t.get<PoliceNotice>("notices", noticeId);
    const acc = await t.get<Account>("accounts", uid);
    if (!n || !acc) throw new UserError("Challan not found.");
    if (n.status === "paid") throw new UserError("Already paid.");
    const now = Date.now();
    if (method === "fastag") {
      const bal = acc.fastag?.balance ?? 0;
      if (!acc.fastag || bal < n.fine) throw new LowBalance(bal, n.fine);
      const balance = bal - n.fine;
      t.set("accounts", acc.id, { ...acc, fastag: { ...acc.fastag, balance } });
      const txn: Txn = { id: rid("TX"), uid, kind: "debit", amount: n.fine, desc: `e-Challan ${n.id} · ${n.violation}`, at: now, balanceAfter: balance, method: "fastag" };
      t.set("txns", txn.id, txn);
    }
    t.set("notices", n.id, { ...n, status: "paid", paidMethod: method, updatedAt: now });
  });
}
