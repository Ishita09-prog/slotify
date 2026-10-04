import type { Account, Txn } from "./types";

/* ------------------------------------------------------------------ */
/* FASTag ecosystem (NETC) simulation.                                  */
/* A real FASTag charge passes: RFID tag -> reader + ANPR at the gate ->*/
/* acquirer bank -> NPCI NETC switch (tag exception list) -> issuer bank */
/* -> SMS to driver -> settlement to the operator (T+1).                 */
/* Slotify plays the plaza/acquirer side. Banks and NPCI are simulated  */
/* here with deterministic IDs so every screen shows the same trace.    */
/* ------------------------------------------------------------------ */

export type TagStatus = "active" | "low_balance" | "blacklisted" | "hotlisted" | "closed";

/** What the reader "sees" at the gate. Real gates get this from the RFID antenna; the demo lets the operator pick. */
export type TagDrill = "genuine" | "cloned" | "blacklisted" | "hotlisted" | "low_balance";
export const DRILL_LABEL: Record<TagDrill, string> = {
  genuine: "Genuine tag",
  cloned: "Cloned plate (tag of another car)",
  blacklisted: "Blacklisted tag (KYC / issuer block)",
  hotlisted: "Hotlisted tag (reported stolen)",
  low_balance: "Low-balance tag",
};

export type CheckCode = "OK" | "LOW_BALANCE" | "BLACKLISTED" | "HOTLISTED" | "MISMATCH" | "NO_TAG";

/** Stored on gate transactions so the trace can be re-drawn later on any device. */
export interface NetcInfo {
  tagId: string;
  tagVehicle: string;
  plateRead: string;
  issuer: string;
  acquirer: string;
  plaza: string;
  rrn: string;
  tagStatus: TagStatus;
}

export interface TagCheck {
  code: CheckCode;
  ok: boolean;
  /** gate may let the car in/out, but FASTag can't be charged (use UPI / QR / card) */
  fallback: boolean;
  /** stop the car: security / fraud case */
  hold: boolean;
  title: string;
  detail: string;
  info: NetcInfo;
}

export const ACQUIRER = "Slotify Acquirer (demo bank)";
export const NETC = "NPCI · NETC switch";
export const LOW_BALANCE_FLOOR = 0;

/** Small stable hash so a transaction always gets the same reference numbers. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const digits = (seed: string, n: number) => String(hash(seed)).padStart(10, "7").slice(0, n);
export const rrnFor = (seed: string) => `${digits(seed + "rrn", 6)}${digits(seed + "r2", 6)}`;
export const plazaId = (lotId: string) => `PLZ-${digits(lotId, 6)}`;

const normal = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The checks NETC + the issuer would do for a tag read at a parking gate:
 * tag present -> exception list (blacklist / hotlist) -> tag-plate match against the vehicle registration -> balance.
 */
export function netcCheck(args: { acc: Account | null; plate: string; due: number; lotId: string; drill: TagDrill; seed: string }): TagCheck {
  const { acc, plate, due, lotId, drill, seed } = args;
  const tag = acc?.fastag;
  const base = (over: Partial<NetcInfo> = {}): NetcInfo => ({
    tagId: tag?.tagId ?? "—",
    tagVehicle: tag?.vehicle ?? "—",
    plateRead: plate,
    issuer: tag?.bank ?? "—",
    acquirer: ACQUIRER,
    plaza: plazaId(lotId),
    rrn: rrnFor(seed),
    tagStatus: (tag?.status as TagStatus) ?? "active",
    ...over,
  });
  if (!tag) return { code: "NO_TAG", ok: false, fallback: true, hold: false, title: "No FASTag read", detail: "No tag on this vehicle. Collect by UPI, QR or card.", info: base() };

  if (drill === "cloned") {
    // the antenna read a tag that belongs to a different vehicle than the plate the camera read
    const fake = `TN${digits(seed + "st", 2)}${String.fromCharCode(65 + (hash(seed) % 26))}${String.fromCharCode(65 + (hash(seed + "b") % 26))}${digits(seed + "n", 4)}`;
    return {
      code: "MISMATCH", ok: false, fallback: false, hold: true,
      title: "Tag–plate mismatch: possible cloned plate",
      detail: `Camera read ${plate}, but the FASTag is registered to ${fake}. Gate held and a fraud case opened for the owner of ${plate}.`,
      info: base({ tagId: `34161FA8${digits(seed + "tag", 8)}`, tagVehicle: fake, issuer: "Other issuer bank", tagStatus: "active" }),
    };
  }
  const status: TagStatus = drill === "blacklisted" ? "blacklisted" : drill === "hotlisted" ? "hotlisted" : drill === "low_balance" ? "low_balance" : ((tag.status as TagStatus) ?? "active");
  if (status === "hotlisted")
    return { code: "HOTLISTED", ok: false, fallback: false, hold: true, title: "Hotlisted tag: reported lost or stolen", detail: "NETC exception list says this tag was reported stolen. Gate held; security and the tag owner are alerted.", info: base({ tagStatus: status }) };
  if (status === "blacklisted" || status === "closed")
    return { code: "BLACKLISTED", ok: false, fallback: true, hold: false, title: "Blacklisted tag", detail: "The issuer has blocked this tag (KYC pending or closed). FASTag can't be charged: collect by UPI, QR or card.", info: base({ tagStatus: status }) };

  // tag must belong to the vehicle the camera read (or another vehicle on the same verified account)
  const own = [tag.vehicle, ...(acc?.vehicles ?? []).map((v) => v.number)].map(normal);
  if (!own.includes(normal(plate)))
    return { code: "MISMATCH", ok: false, fallback: false, hold: true, title: "Tag–plate mismatch", detail: `Camera read ${plate}, but this FASTag is registered to ${tag.vehicle}.`, info: base() };

  const balance = status === "low_balance" ? Math.min(tag.balance, Math.max(0, due - 1)) : tag.balance;
  if (due > 0 && balance < due)
    return { code: "LOW_BALANCE", ok: false, fallback: true, hold: false, title: "Low balance", detail: `Balance ${balance < 0 ? 0 : balance} is less than the ${due} due. Collect the fee by UPI, QR or card.`, info: base({ tagStatus: "low_balance" }) };

  return { code: "OK", ok: true, fallback: false, hold: false, title: "Tag valid", detail: "Tag active, matches the plate, balance sufficient.", info: base() };
}

/* ------------------------------ trace ------------------------------- */

export type Party = "driver" | "tag" | "gate" | "slotify" | "acquirer" | "netc" | "issuer" | "operator" | "upi" | "command";
export const PARTY_LABEL: Record<Party, string> = {
  driver: "Driver",
  tag: "FASTag (RFID)",
  gate: "Gate reader + ANPR",
  slotify: "Slotify",
  acquirer: "Acquirer bank",
  netc: "NPCI NETC",
  issuer: "Issuer bank",
  operator: "Parking operator",
  upi: "UPI",
  command: "Command Centre",
};

export interface TraceStep {
  party: Party;
  title: string;
  detail: string;
  /** ms after the first step */
  t: number;
  state: "done" | "pending" | "failed";
}

const DAY = 24 * 3600_000;
const IST = 5.5 * 3600_000;
/** Settlement to the operator: next day 11:00 IST (T+1). */
export const settlementAt = (at: number) => {
  const d = Math.floor((at + IST) / DAY) * DAY - IST;
  return d + DAY + 11 * 3600_000;
};

/** Every step a transaction went through, re-derived from what's stored on it. */
export function traceFor(txn: Txn & { netc?: NetcInfo | null }, tagBank: string, now = Date.now()): TraceStep[] {
  const rrn = txn.netc?.rrn ?? rrnFor(txn.id);
  const j = (k: string, lo: number, hi: number) => lo + (hash(txn.id + k) % (hi - lo));
  const issuer = txn.netc?.issuer ?? tagBank;
  const settle = settlementAt(txn.at);
  const settled = now >= settle;
  const sms: TraceStep = { party: "issuer", title: "SMS to driver", detail: `${txn.kind === "debit" ? "Debited" : "Credited"} ₹${txn.amount} · balance ₹${txn.balanceAfter}`, t: 0, state: "done" };

  if (txn.kind === "credit") {
    const refund = /refund/i.test(txn.desc);
    const steps: TraceStep[] = refund
      ? [
          { party: "command", title: "Refund approved", detail: txn.desc, t: 0, state: "done" },
          { party: "acquirer", title: "Credit adjustment raised", detail: `Against original RRN · ref ${rrn}`, t: j("a", 300, 900), state: "done" },
          { party: "netc", title: "Dispute settled on NETC", detail: "Chargeback in the driver's favour", t: j("b", 1200, 2400), state: "done" },
          { party: "issuer", title: "Tag wallet credited", detail: `${issuer} · +₹${txn.amount}`, t: j("c", 2600, 3600), state: "done" },
        ]
      : [
          { party: "driver", title: "Recharge started", detail: `UPI collect · ₹${txn.amount}`, t: 0, state: "done" },
          { party: "upi", title: "UPI payment authorised", detail: `UPI ref ${digits(txn.id + "u", 12)}`, t: j("u", 1500, 4000), state: "done" },
          { party: "issuer", title: "Tag wallet credited", detail: `${issuer} · +₹${txn.amount}`, t: j("i", 4200, 6000), state: "done" },
        ];
    sms.t = steps[steps.length - 1].t + j("s", 300, 1500);
    return [...steps, sms];
  }

  const gate = txn.method === "fastag-gate";
  const steps: TraceStep[] = gate
    ? [
        { party: "tag", title: "RFID tag read at exit lane", detail: `Tag ${txn.netc?.tagId ?? "—"} · registered to ${txn.netc?.tagVehicle ?? "—"}`, t: 0, state: "done" },
        { party: "gate", title: "ANPR plate read, matched to tag", detail: `Camera read ${txn.netc?.plateRead ?? "—"} · tag–plate match ✓`, t: j("g", 120, 380), state: "done" },
        { party: "slotify", title: "Fee computed from booking", detail: txn.desc, t: j("s", 400, 700), state: "done" },
        { party: "acquirer", title: "Debit request sent", detail: `${txn.netc?.acquirer ?? ACQUIRER} · plaza ${txn.netc?.plaza ?? "—"}`, t: j("a", 750, 1100), state: "done" },
        { party: "netc", title: "Exception list checked, routed to issuer", detail: `Tag status ${txn.netc?.tagStatus ?? "active"} · RRN ${rrn}`, t: j("n", 1150, 1500), state: "done" },
        { party: "issuer", title: "Tag wallet debited", detail: `${issuer} · −₹${txn.amount}`, t: j("i", 1550, 2100), state: "done" },
      ]
    : [
        { party: "slotify", title: "Booking payment requested", detail: txn.desc, t: 0, state: "done" },
        { party: "acquirer", title: "Debit request sent", detail: ACQUIRER, t: j("a", 250, 600), state: "done" },
        { party: "netc", title: "Routed to issuer", detail: `RRN ${rrn}`, t: j("n", 650, 1000), state: "done" },
        { party: "issuer", title: "Tag wallet debited", detail: `${issuer} · −₹${txn.amount}`, t: j("i", 1050, 1600), state: "done" },
      ];
  sms.t = steps[steps.length - 1].t + j("m", 400, 2500);
  const settlement: TraceStep = {
    party: "operator",
    title: settled ? "Settled to operator" : "Settlement to operator (T+1)",
    detail: `${settled ? "Paid" : "Due"} ${new Date(settle).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · via acquirer`,
    t: settle - txn.at,
    state: settled ? "done" : "pending",
  };
  return [...steps, sms, settlement];
}
