import { UserError, type Store } from "./store";
import {
  applyAction, ComplaintError, newComplaint,
  type Actor, type ActionPayload, type Attachment, type Complaint, type ComplaintAction, type ComplaintType,
} from "./complaints";
import type { Account, LiveBooking, Txn } from "./types";

/* Database + wallet side of the fraud-complaint workflow. All rules live in complaints.ts. */

function rid(prefix: string) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = prefix;
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

const wrap = <T,>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw e instanceof ComplaintError ? new UserError(e.message) : e;
  }
};

export interface FileInput {
  lot: { id: string; name: string; area?: string; ownerUid: string };
  transactionId: string;
  vehicleNumber: string;
  incidentAt: number;
  complaintType: ComplaintType;
  description: string;
  attachments: Attachment[];
}

/** Driver files a complaint. The transaction is looked up in the driver's own FASTag history. */
export async function fileComplaint(store: Store, driver: Account, input: FileInput): Promise<Complaint> {
  if (!driver.vehicles?.some((v) => v.number === input.vehicleNumber)) throw new UserError("You can only file a complaint for a vehicle registered on your account.");
  const wanted = input.transactionId.trim().toUpperCase();
  const mine = await store.query<Complaint>("complaints", ["userId", driver.id]);
  if (mine.some((c) => c.transactionId.toUpperCase() === wanted && c.status !== "rejected"))
    throw new UserError("You've already filed a complaint for this transaction. Open it under My Complaints.");
  const txns = await store.query<Txn>("txns", ["uid", driver.id]);
  const t = txns.find((x) => x.id.toUpperCase() === wanted && x.kind === "debit");
  const c = wrap(() =>
    newComplaint(
      {
        id: rid("FC-"),
        driver: { id: driver.id, name: driver.name, role: "driver" },
        ownerUid: input.lot.ownerUid,
        lotId: input.lot.id,
        transactionId: input.transactionId,
        vehicleNumber: input.vehicleNumber,
        parkingLocation: input.lot.area ? `${input.lot.name} · ${input.lot.area}` : input.lot.name,
        incidentAt: input.incidentAt,
        complaintType: input.complaintType,
        description: input.description,
        attachments: input.attachments,
        txn: t ? { amount: t.amount, at: t.at, desc: t.desc } : null,
      },
      Date.now()
    )
  );
  await store.set("complaints", c.id, c);
  return c;
}

/**
 * Every state change goes through here, inside one transaction. Approving a refund also credits the
 * driver's FASTag wallet in the SAME transaction, so a refund can never be paid twice.
 */
export async function complaintAction(store: Store, id: string, actor: Actor, action: ComplaintAction, payload: ActionPayload = {}) {
  return store.tx(async (t) => {
    const c = await t.get<Complaint>("complaints", id);
    if (!c) throw new UserError("Complaint not found.");
    const acc = action === "approve_refund" ? await t.get<Account>("accounts", c.userId) : null;
    const next = wrap(() => applyAction(c, action, actor, payload, Date.now()));
    if (next === c) return c; // idempotent no-op (e.g. owner opens an already-reviewed complaint)
    if (action === "approve_refund") {
      if (!acc?.fastag) throw new UserError("The driver has no FASTag wallet to refund into.");
      const amount = next.refund!.amount;
      const balance = acc.fastag.balance + amount;
      t.set("accounts", acc.id, { ...acc, fastag: { ...acc.fastag, balance } });
      const txn: Txn = { id: rid("TX"), uid: acc.id, kind: "credit", amount, desc: `Refund · fraud complaint ${c.id} · disputed charge ${c.transactionId}`, at: next.updatedAt, balanceAfter: balance, method: "recharge" };
      t.set("txns", txn.id, txn);
    }
    t.set("complaints", c.id, next);
    return next;
  });
}

export interface RelatedBooking {
  booking: LiveBooking;
  /** booked by a different Slotify account than the complainant: strong sign of plate misuse */
  otherAccount: boolean;
  minutesFromCharge: number | null;
}

/** Entry / exit evidence for the Investigation view: bookings on the same plate at the same lot, nearest to the charge first. */
export async function findRelatedBookings(store: Store, c: Complaint): Promise<RelatedBooking[]> {
  const list = await store.query<LiveBooking>("bookings", ["vehicle", c.vehicleNumber]);
  const ref = c.txnAt ?? c.incidentAt;
  return list
    .filter((b) => b.lotId === c.lotId)
    .map((b) => {
      const at = b.exitAt ?? b.parkedAt ?? b.startAt;
      return { booking: b, otherAccount: b.driverUid !== c.userId, minutesFromCharge: at ? Math.round(Math.abs(at - ref) / 60000) : null };
    })
    .sort((x, y) => (x.minutesFromCharge ?? 1e9) - (y.minutesFromCharge ?? 1e9))
    .slice(0, 5);
}

/**
 * Gate detected a tag–plate mismatch (or a hotlisted tag): open a "Number Plate Cloning" case on behalf of the
 * registered owner of the plate, routed to the lot operator like any complaint. Re-uses an open case for the same plate & lot.
 */
export async function autoFlagCloning(
  store: Store,
  a: { victimUid: string; victimName: string; plate: string; lot: { id: string; name: string; area?: string; ownerUid: string }; gateRef: string; detail: string; tagId: string; tagVehicle: string }
): Promise<Complaint | null> {
  const mine = await store.query<Complaint>("complaints", ["userId", a.victimUid]);
  const open = mine.find((c) => c.vehicleNumber === a.plate && c.lotId === a.lot.id && c.complaintType === "plate_cloning" && c.status !== "resolved" && c.status !== "rejected");
  if (open) return null;
  const now = Date.now();
  const c = wrap(() =>
    newComplaint(
      {
        id: rid("FC-"),
        driver: { id: a.victimUid, name: a.victimName, role: "driver" },
        ownerUid: a.lot.ownerUid,
        lotId: a.lot.id,
        transactionId: a.gateRef,
        vehicleNumber: a.plate,
        parkingLocation: a.lot.area ? `${a.lot.name} · ${a.lot.area}` : a.lot.name,
        incidentAt: now,
        complaintType: "plate_cloning",
        description: `Auto-flagged by the Slotify gate: ${a.detail} Tag read: ${a.tagId} (registered to ${a.tagVehicle}). No charge was made.`,
        attachments: [],
        txn: null,
      },
      now
    )
  );
  c.auditLog[0] = { at: now, actorId: "system", actorName: "Slotify gate (ANPR + RFID)", actorRole: "system", action: "Auto-flagged: tag–plate mismatch", note: a.detail, from: null, to: c.status };
  await store.set("complaints", c.id, c);
  return c;
}
