/* Weekly / monthly plan tests. Run: cd frontend && npx tsx scripts/plans.test.ts
 * Exercises the REAL book / cancelBooking / conflict / sweepNoShows against an in-memory store
 * whose transactions are serialised (the same guarantee Firestore transactions give). */
import assert from "node:assert/strict";
import { book, cancelBooking, conflict, findAtGate, LowBalance, setBayActive, sweepNoShows, type BookingRequest } from "../src/lib/live/service";
import { bayState } from "../src/lib/live/view";
import { keyToIso, overlaps, planRange, planRefund, planStatus, PLAN_PRICING, quotePlan } from "../src/lib/live/plans";
import { at, istDateKey } from "../src/lib/live/time";
import type { Account, Bay, LiveBooking, LiveLot } from "../src/lib/live/types";
import type { Coll, Store } from "../src/lib/live/store";

const DAY = 24 * 3600_000;
const dk = (offsetDays: number) => istDateKey(Date.now() + offsetDays * DAY);

/* ---------------- in-memory store with serialised transactions ---------------- */
function memStore() {
  const data: Record<string, Record<string, any>> = {};
  const coll = (c: string) => (data[c] ??= {});
  let chain: Promise<unknown> = Promise.resolve();
  const store = {
    kind: "local",
    label: "mem",
    watch: () => () => {},
    watchDoc: () => () => {},
    async get(c: Coll, id: string) { return structuredClone(coll(c)[id] ?? null); },
    async query(c: Coll, f: [string, unknown] | null) { return Object.values(coll(c)).filter((d: any) => !f || d[f[0]] === f[1]).map((d) => structuredClone(d)); },
    async set(c: Coll, id: string, d: object) { coll(c)[id] = structuredClone({ ...d, id }); },
    newId: () => Math.random().toString(36).slice(2),
    tx<T>(fn: (t: any) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const writes: [string, string, object][] = [];
        const r = await fn({
          async get(c: string, id: string) {
            const p = [...writes].reverse().find((w) => w[0] === c && w[1] === id);
            return structuredClone(p ? p[2] : coll(c)[id] ?? null);
          },
          set(c: string, id: string, d: object) { writes.push([c, id, d]); },
        });
        for (const [c, id, d] of writes) coll(c)[id] = structuredClone({ ...d, id });
        return r;
      });
      chain = run.catch(() => {});
      return run;
    },
    auth: {} as any,
  } as unknown as Store;
  return { store, data };
}

/* --------------------------------- fixtures --------------------------------- */
const lot: LiveLot = {
  id: "L1", ownerUid: "owner1", ownerName: "Owner", name: "Test Lot", category: "mall" as any, area: "T. Nagar", zone: "Z", address: "x",
  lat: 0, lng: 0, pricePerHour: 40, evPerHour: 10, allowOpen: true, allowTimed: true,
  windows: [{ id: "w1", start: "10:00", end: "13:00" }, { id: "w2", start: "14:00", end: "18:00" }],
  openHours: "24h", features: [], createdAt: 0, rows: 1,
};
const mkBay = (label: string, extra: Partial<Bay> = {}): Bay => ({ id: `L1-${label}`, lotId: "L1", ownerUid: "owner1", label, row: "A", col: 1, type: "standard", active: true, hold: null, open: null, slots: {}, updatedAt: 0, ...extra });
const mkDriver = (n: number, balance = 100000): Account => ({
  id: `d${n}`, username: `d${n}`, role: "driver", name: `Driver ${n}`, phone: "0", createdAt: 0, vehicles: [{ number: `TN01AB000${n}`, type: "car" }],
  fastag: { tagId: "T", bank: "b", balance, vehicle: `TN01AB000${n}` },
});
async function setup(drivers = 3, balance = 100000) {
  const m = memStore();
  await m.store.set("bays", "L1-A1", mkBay("A1"));
  await m.store.set("bays", "L1-A2", mkBay("A2"));
  for (let i = 1; i <= drivers; i++) await m.store.set("accounts", `d${i}`, mkDriver(i, balance));
  return m;
}
const plan = (type: "weekly" | "monthly", units: number, startOffsetDays: number): BookingRequest => ({ mode: "plan", plan: { type, units, startKey: dk(startOffsetDays) } });
const go = (s: Store, d: number, req: BookingRequest, bay = "L1-A1") =>
  book(s, mkDriver(d), { lot, bayId: bay, req, vehicle: { number: `TN01AB000${d}`, type: "car" }, method: "fastag" });
const rejects = async (p: Promise<unknown>, re: RegExp, msg?: string) => assert.rejects(p, (e: Error) => { assert.match(e.message, re, msg); return true; }, msg);

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
};

(async () => {
  console.log("Pricing");
  await t("monthly 3 months = ₹4500 - 15% = ₹3825 (spec example)", () => {
    const q = quotePlan(lot, { type: "monthly", units: 3, startKey: dk(0) });
    assert.deepEqual([q.rate, q.gross, q.discountPct, q.discount, q.total], [1500, 4500, 15, 675, 3825]);
  });
  await t("weekly ladder from config", () => {
    for (const u of PLAN_PRICING.weekly.options) {
      const q = quotePlan(lot, { type: "weekly", units: u, startKey: dk(0) });
      assert.equal(q.total, 500 * u - Math.round((500 * u * PLAN_PRICING.weekly.discountPct[u]) / 100));
    }
  });
  await t("per-lot rate override wins over the global default", () => {
    assert.equal(quotePlan({ planRates: { weekly: 800 } }, { type: "weekly", units: 1, startKey: dk(0) }).rate, 800);
  });
  await t("rejects unsupported duration / past start / too far ahead / bad key", () => {
    assert.throws(() => quotePlan(lot, { type: "weekly", units: 5, startKey: dk(0) }));
    assert.throws(() => quotePlan(lot, { type: "monthly", units: 2, startKey: dk(0) }));
    assert.throws(() => quotePlan(lot, { type: "weekly", units: 1, startKey: dk(-1) }), /past/);
    assert.throws(() => quotePlan(lot, { type: "weekly", units: 1, startKey: dk(61) }), /ahead/);
    assert.throws(() => quotePlan(lot, { type: "weekly", units: 1, startKey: "abc" }));
  });

  console.log("Date math (end is exclusive, 00:00 IST)");
  await t("1 week from 10 Oct 2026 ends 17 Oct 2026 (spec example)", () => {
    const r = planRange({ type: "weekly", units: 1, startKey: "20261010" });
    assert.equal(istDateKey(r.endAt), "20261017");
  });
  await t("month-end rollover clamps: 31 Jan +1 month = 28 Feb; leap year = 29 Feb", () => {
    assert.equal(istDateKey(planRange({ type: "monthly", units: 1, startKey: "20260131" }).endAt), "20260228");
    assert.equal(istDateKey(planRange({ type: "monthly", units: 1, startKey: "20240131" }).endAt), "20240229");
  });
  await t("12 months crosses the year; 30 Nov +3 = 28 Feb", () => {
    assert.equal(istDateKey(planRange({ type: "monthly", units: 12, startKey: "20261115" }).endAt), "20271115");
    assert.equal(istDateKey(planRange({ type: "monthly", units: 3, startKey: "20261130" }).endAt), "20270228");
  });
  await t("IST boundary: plan start is 00:00 IST, not UTC", () => {
    assert.equal(at("20261010", "00:00"), Date.parse("2026-10-10T00:00:00+05:30"));
  });
  await t("half-open overlap: touching ranges don't clash, 1ms overlap does", () => {
    assert.equal(overlaps(1, 2, 2, 3), false);
    assert.equal(overlaps(1, 3, 2, 4), true);
  });

  console.log("Booking + conflict detection");
  await t("weekly booking stores all fields and locks the lease on the bay", async () => {
    const { store, data } = await setup();
    const b = await go(store, 1, plan("weekly", 2, 3));
    assert.equal(b.mode, "plan");
    assert.equal(b.bookingType, "weekly");
    assert.equal(b.duration, 2);
    assert.equal(b.amount, 950); // 1000 - 5%
    assert.equal(b.cover, 950); // existing revenue sums pick it up
    assert.equal(b.startDate, keyToIso(dk(3)));
    assert.equal(b.endDate, keyToIso(dk(17)));
    assert.ok(data.bays["L1-A1"].plans[b.id]);
    assert.equal(data.accounts.d1.fastag.balance, 100000 - 950);
    assert.equal(data.txns[Object.keys(data.txns)[0]].amount, 950);
  });
  await t("same dates, other user: rejected (spec example: booked 1-31 Oct blocks everyone)", async () => {
    const { store } = await setup();
    await go(store, 1, plan("monthly", 1, 2));
    await rejects(go(store, 2, plan("weekly", 1, 10)), /just taken/i, "inside month");
    await rejects(go(store, 2, plan("monthly", 1, 2)), /just taken/i, "identical");
  });
  await t("overlap by one day at either end is rejected", async () => {
    const { store } = await setup();
    await go(store, 1, plan("weekly", 1, 10)); // days 10..17 (exclusive)
    await rejects(go(store, 2, plan("weekly", 1, 4)), /just taken/i, "ends day 11 -> overlaps day 10");
    await rejects(go(store, 2, plan("weekly", 1, 16)), /just taken/i, "starts day 16 -> inside");
  });
  await t("back-to-back plans are allowed (end is exclusive)", async () => {
    const { store } = await setup();
    await go(store, 1, plan("weekly", 1, 10));
    await go(store, 2, plan("weekly", 1, 17));
    await go(store, 3, plan("weekly", 1, 3)); // days 3..10, touches the start
  });
  await t("a different bay is unaffected", async () => {
    const { store } = await setup();
    await go(store, 1, plan("monthly", 1, 2), "L1-A1");
    await go(store, 2, plan("monthly", 1, 2), "L1-A2");
  });
  await t("RACE: two drivers book the same bay+dates at once -> exactly one wins", async () => {
    const { store, data } = await setup();
    const res = await Promise.allSettled([go(store, 1, plan("monthly", 3, 5)), go(store, 2, plan("monthly", 3, 5)), go(store, 3, plan("weekly", 2, 20))]);
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(Object.keys(data.bays["L1-A1"].plans).length, 1);
    const loser = data.accounts.d1.fastag.balance === 100000 ? 1 : 2;
    assert.equal(data.accounts[`d${loser}`].fastag.balance, 100000, "loser was not charged");
  });
  await t("hourly timed slot inside a plan is blocked (hourly -> plan direction)", async () => {
    const { store } = await setup();
    await go(store, 1, plan("weekly", 1, 0)); // covers today + tomorrow
    await rejects(go(store, 2, { mode: "timed", dateKey: dk(1), window: lot.windows[0] }), /just taken/i, "timed tomorrow");
    await rejects(go(store, 2, { mode: "open" }), /just taken/i, "no-time-limit today");
  });
  await t("plan over existing hourly bookings is blocked (plan -> hourly direction)", async () => {
    const { store } = await setup();
    await go(store, 1, { mode: "timed", dateKey: dk(1), window: lot.windows[1] });
    await rejects(go(store, 2, plan("weekly", 1, 0)), /just taken.*hourly/i, "plan covering tomorrow's slot");
    await go(store, 2, plan("weekly", 1, 2)); // starts after the slot -> fine
  });
  await t("plan starting today is blocked by a no-time-limit stay; starting tomorrow is not", async () => {
    const { store } = await setup();
    await go(store, 1, { mode: "open" });
    await rejects(go(store, 2, plan("weekly", 1, 0)), /just taken/i);
    await go(store, 2, plan("weekly", 1, 1));
  });
  await t("hourly bookings outside the plan still work exactly as before", async () => {
    const { store, data } = await setup();
    await go(store, 1, plan("weekly", 1, 10));
    const h = await go(store, 2, { mode: "timed", dateKey: dk(1), window: lot.windows[0] });
    assert.equal(h.mode, "timed");
    assert.equal(h.bookingType, "hourly");
    assert.equal(h.cover, 25);
    assert.ok(data.bays["L1-A1"].slots[h.slotKey!]);
    const o = await go(store, 3, { mode: "open" }, "L1-A2");
    assert.equal(o.cover, 25);
  });
  await t("a timed slot whose window was later deleted still blocks its day", async () => {
    const { store, data } = await setup();
    data.bays["L1-A1"].slots = { [`${dk(3)}_gone`]: { bookingId: "x", uid: "z", vehicle: "V", status: "booked", at: 0 } };
    await rejects(go(store, 1, plan("weekly", 1, 2)), /just taken/i);
  });
  await t("maintenance bay can't be booked; bay with a live plan can't go to maintenance", async () => {
    const { store } = await setup();
    await go(store, 1, plan("weekly", 1, 3));
    await rejects(setBayActive(store, "L1-A1", false), /has a booking/i);
    await setBayActive(store, "L1-A2", false);
    await rejects(go(store, 2, plan("weekly", 1, 3), "L1-A2"), /(just taken|not available)/i);
  });
  await t("same vehicle can't hold two overlapping plans at one lot", async () => {
    const { store } = await setup();
    await go(store, 1, plan("weekly", 2, 3), "L1-A1");
    await rejects(go(store, 1, plan("weekly", 1, 5), "L1-A2"), /already has a plan/i);
  });
  await t("price is recomputed inside book() from the spec, never read from the request", async () => {
    const { store } = await setup();
    const req = { ...plan("monthly", 3, 3), amount: 1 } as any; // extra client field is ignored
    assert.equal((await go(store, 1, req)).amount, 3825);
  });

  console.log("Payment");
  await t("FASTag below the plan total -> LowBalance (UI falls back to UPI)", async () => {
    const { store, data } = await setup(2, 1000);
    await assert.rejects(go(store, 1, plan("monthly", 3, 3)), (e) => e instanceof LowBalance && e.needed === 3825);
    assert.equal(Object.keys(data.bays["L1-A1"].plans ?? {}).length, 0, "nothing was locked");
    assert.equal(data.accounts.d1.fastag.balance, 1000);
  });
  await t("UPI payment does not touch the wallet", async () => {
    const { store, data } = await setup(1, 10);
    const b = await book(store, mkDriver(1, 10), { lot, bayId: "L1-A1", req: plan("weekly", 1, 3), vehicle: { number: "TN01AB0001", type: "car" }, method: "upi" });
    assert.equal(b.coverMethod, "upi");
    assert.equal(data.accounts.d1.fastag.balance, 10, "wallet untouched when paying by UPI");
    assert.equal(Object.keys(data.txns ?? {}).length, 0, "no wallet transaction written");
  });

  console.log("Cancel / status / lifecycle");
  await t("cancel before start: full refund, lease freed, slot bookable again", async () => {
    const { store, data } = await setup();
    const b = await go(store, 1, plan("monthly", 1, 5));
    await cancelBooking(store, b.id);
    assert.equal(data.bookings[b.id].status, "cancelled");
    assert.equal(data.bookings[b.id].refunded, 1500);
    assert.equal(data.accounts.d1.fastag.balance, 100000);
    assert.deepEqual(data.bays["L1-A1"].plans, {});
    await go(store, 2, plan("monthly", 1, 5));
  });
  await t("cancel mid-plan refunds only unused time", () => {
    const b = { startAt: 0, endAt: 10 * DAY, amount: 1000 };
    assert.equal(planRefund(b, 4 * DAY), 600);
    assert.equal(planRefund(b, 11 * DAY), 0);
    assert.equal(planRefund(b, -DAY), 1000);
  });
  await t("status is derived: upcoming / active / expired / cancelled", () => {
    const b = { status: "booked" as const, startAt: 100, endAt: 200 };
    assert.equal(planStatus(b, 50), "upcoming");
    assert.equal(planStatus(b, 100), "active");
    assert.equal(planStatus(b, 199), "active");
    assert.equal(planStatus(b, 200), "expired");
    assert.equal(planStatus({ ...b, status: "cancelled" }, 150), "cancelled");
  });
  await t("no-show sweeper never cancels an active plan", async () => {
    const { store, data } = await setup();
    const b = await go(store, 1, plan("weekly", 1, 0)); // started at 00:00 today -> long past +15 min
    const all = (await store.query<LiveBooking>("bookings", null));
    assert.equal(await sweepNoShows(store, all), 0);
    assert.equal(data.bookings[b.id].status, "booked");
  });
  await t("plans stay out of the hourly gate flow (no accidental hourly charge)", async () => {
    const { store } = await setup();
    await go(store, 1, plan("weekly", 1, 0));
    assert.equal((await findAtGate(store, "L1", "TN01AB0001")).length, 0);
  });

  console.log("Slot colours (what drivers see)");
  await t("bay shows free today, booked for a covering plan, mine for the owner of the plan", async () => {
    const { store, data } = await setup();
    const lotWin = lot;
    const bay = () => data.bays["L1-A1"] as Bay;
    const now = Date.now();
    assert.equal(bayState(bay(), lotWin, "d2", now, null).state, "free");
    await go(store, 1, plan("monthly", 1, 10)); // starts in 10 days
    assert.equal(bayState(bay(), lotWin, "d2", now, null).state, "free", "future plan doesn't colour today");
    assert.equal(bayState(bay(), lotWin, "d2", now, plan("monthly", 1, 12)).state, "booked", "overlapping request");
    assert.equal(bayState(bay(), lotWin, "d1", now, plan("monthly", 1, 12)).state, "mine");
    assert.equal(bayState(bay(), lotWin, "d2", now, plan("weekly", 1, 60)).state, "free", "after the plan ends");
    await go(store, 3, plan("weekly", 1, 0), "L1-A2");
    assert.equal(bayState(data.bays["L1-A2"], lotWin, "d2", now, null).state, "booked", "active plan => occupied today");
  });

  console.log("Backwards compatibility");
  await t("documents written before plans existed (no bookingType, no plans field) still work", async () => {
    const { store, data } = await setup();
    delete data.bays["L1-A1"].plans;
    assert.equal(conflict(data.bays["L1-A1"], lot, { mode: "open" }, Date.now()), null);
    const b = await go(store, 1, { mode: "open" });
    assert.equal(b.bookingType, "hourly");
    await cancelBooking(store, b.id);
  });

  console.log(`\n${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);
})();
