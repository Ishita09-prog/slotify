/* Fraud complaint tests. Run: cd frontend && npx tsx scripts/complaints.test.ts
 * Uses the REAL fileComplaint / complaintAction / applyAction against an in-memory store with serialised transactions. */
import assert from "node:assert/strict";
import { complaintAction, fileComplaint, findRelatedBookings } from "../src/lib/live/complaint-service";
import { allowedActions, applyAction, EVIDENCE_LIMITS, PUBLIC_OWNER_UID, validateAttachments, type Actor, type Attachment, type Complaint } from "../src/lib/live/complaints";
import type { Coll, Store } from "../src/lib/live/store";
import type { Account, LiveBooking, Txn } from "../src/lib/live/types";

function memStore() {
  const data: Record<string, Record<string, any>> = {};
  const coll = (c: string) => (data[c] ??= {});
  let chain: Promise<unknown> = Promise.resolve();
  const store = {
    kind: "local", label: "mem", watch: () => () => {}, watchDoc: () => () => {},
    async get(c: Coll, id: string) { return structuredClone(coll(c)[id] ?? null); },
    async query(c: Coll, f: [string, unknown] | null) { return Object.values(coll(c)).filter((d: any) => !f || d[f[0]] === f[1]).map((d) => structuredClone(d)); },
    async set(c: Coll, id: string, d: object) { coll(c)[id] = structuredClone({ ...d, id }); },
    newId: () => Math.random().toString(36).slice(2),
    tx<T>(fn: (t: any) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const writes: [string, string, object][] = [];
        const r = await fn({
          async get(c: string, id: string) { const p = [...writes].reverse().find((w) => w[0] === c && w[1] === id); return structuredClone(p ? p[2] : coll(c)[id] ?? null); },
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

const victim: Account = { id: "victim", username: "v", role: "driver", name: "Vera Victim", phone: "0", createdAt: 0, vehicles: [{ number: "TN09AB1234", type: "car" }], fastag: { tagId: "T", bank: "b", balance: 100, vehicle: "TN09AB1234" } };
const owner: Actor = { id: "owner1", name: "Olivia Owner", role: "owner" };
const otherOwner: Actor = { id: "owner2", name: "Other Owner", role: "owner" };
const cmd: Actor = { id: "CC-01", name: "Officer Rao", role: "command" };
const vera: Actor = { id: "victim", name: "Vera Victim", role: "driver" };
const privateLot = { id: "L1", name: "Olivia Plaza", area: "Adyar", ownerUid: "owner1" };
const publicLot = { id: "pub1", name: "T. Nagar MLCP", area: "T. Nagar", ownerUid: PUBLIC_OWNER_UID };
const img = (n = "a.jpg", len = 1000): Attachment => ({ name: n, mime: "image/jpeg", size: len, dataUrl: "data:image/jpeg;base64," + "A".repeat(len) });

async function setup() {
  const m = memStore();
  await m.store.set("accounts", "victim", victim);
  const debit: Txn = { id: "TX-FRAUD01", uid: "victim", kind: "debit", amount: 120, desc: "Parking Olivia Plaza · A3 · 3 h", at: Date.now() - 3600_000, balanceAfter: 80, method: "fastag-gate" };
  await m.store.set("txns", debit.id, debit);
  return m;
}
const file = (s: Store, over: Partial<Parameters<typeof fileComplaint>[2]> = {}) =>
  fileComplaint(s, victim, { lot: privateLot, transactionId: "TX-FRAUD01", vehicleNumber: "TN09AB1234", incidentAt: Date.now() - 3600_000, complaintType: "plate_cloning", description: "I was never at this lot; my plate was cloned.", attachments: [img()], ...over });
const rej = (p: Promise<unknown> | (() => unknown), re: RegExp, msg?: string) =>
  typeof p === "function" ? assert.throws(p, (e: Error) => { assert.match(e.message, re, msg); return true; }) : assert.rejects(p, (e: Error) => { assert.match(e.message, re, msg); return true; });

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; } };

(async () => {
  console.log("Filing");
  await t("files a complaint, snapshots the driver's own FASTag debit, starts as Submitted", async () => {
    const { store, data } = await setup();
    const c = await file(store);
    assert.equal(c.status, "submitted");
    assert.equal(c.ownerUid, "owner1");
    assert.equal(c.txnVerified, true);
    assert.equal(c.txnAmount, 120);
    assert.match(c.id, /^FC-/);
    assert.equal(c.complaintId, c.id);
    assert.deepEqual(c.auditLog.map((e) => e.action), ["Complaint Created"]);
    assert.ok(data.complaints[c.id]);
  });
  await t("unknown transaction ID is accepted but flagged unverified (Command Centre must verify)", async () => {
    const { store } = await setup();
    const c = await file(store, { transactionId: "TX-NOPE" });
    assert.equal(c.txnVerified, false);
    assert.equal(c.txnAmount, null);
  });
  await t("public (GCC-run) lot goes straight to the Command Centre, with the reason on the audit trail", async () => {
    const { store } = await setup();
    const c = await file(store, { lot: publicLot });
    assert.equal(c.status, "forwarded");
    assert.deepEqual(c.auditLog.map((e) => e.action), ["Complaint Created", "Forwarded To Command Centre"]);
    assert.match(c.auditLog[1].note!, /no private operator/i);
  });
  await t("validation: short description, future time, no type, someone else's vehicle", async () => {
    const { store } = await setup();
    await rej(file(store, { description: "short" }), /at least 10/);
    await rej(file(store, { incidentAt: Date.now() + 3600_000 }), /future/);
    await rej(file(store, { complaintType: "" as any }), /complaint type/i);
    await rej(file(store, { vehicleNumber: "KA01ZZ9999" }), /registered on your account/);
    await rej(file(store, { transactionId: "  " }), /transaction ID/i);
  });
  await t("duplicate complaint for the same transaction is blocked, unless the first was rejected", async () => {
    const { store } = await setup();
    const c = await file(store);
    await rej(file(store), /already filed/);
    await complaintAction(store, c.id, owner, "owner_reject", { note: "Not our lot" });
    await file(store); // allowed again
  });

  console.log("Permissions");
  await t("only the lot's own operator can act; other operators, drivers and command are refused", async () => {
    const { store } = await setup();
    const c = await file(store);
    await rej(complaintAction(store, c.id, otherOwner, "forward", {}), /isn't available/);
    await rej(complaintAction(store, c.id, vera, "forward", {}), /isn't available/);
    await rej(complaintAction(store, c.id, cmd, "accept", {}), /isn't available/);
    await rej(complaintAction(store, c.id, otherOwner, "owner_review", {}), /Only the lot operator/);
  });
  await t("command can't skip the owner: nothing to accept until it is forwarded", async () => {
    const { store } = await setup();
    const c = await file(store);
    assert.deepEqual(allowedActions(c, cmd), []);
    await rej(complaintAction(store, c.id, cmd, "approve_refund", { amount: 10 }), /isn't available/);
  });
  await t("owner can't take Command Centre actions after forwarding either", async () => {
    const { store } = await setup();
    const c = await file(store);
    await complaintAction(store, c.id, owner, "forward", {});
    assert.deepEqual(allowedActions((await store.get<Complaint>("complaints", c.id))!, owner), []);
    await rej(complaintAction(store, c.id, owner, "close", {}), /isn't available/);
  });
  await t("rejections need a note", async () => {
    const { store } = await setup();
    const c = await file(store);
    await rej(complaintAction(store, c.id, owner, "owner_reject", { note: " " }), /note/i);
  });

  console.log("Full escalation + audit trail");
  await t("Created -> Owner Reviewed -> Forwarded -> Investigation -> Refund -> Closed, wallet refunded once", async () => {
    const { store, data } = await setup();
    const c = await file(store);
    await complaintAction(store, c.id, owner, "owner_review");
    let cur = await complaintAction(store, c.id, owner, "forward", { note: "Our gate log shows no entry for this plate." });
    assert.equal(cur.status, "forwarded");
    assert.equal(cur.ownerRemarks, "Our gate log shows no entry for this plate.");
    cur = await complaintAction(store, c.id, cmd, "accept");
    assert.equal(cur.status, "investigating");
    cur = await complaintAction(store, c.id, cmd, "approve_refund", { amount: 120, note: "Plate cloned, confirmed" });
    assert.equal(data.accounts.victim.fastag.balance, 220);
    assert.equal(cur.status, "investigating", "refund alone does not close the case");
    cur = await complaintAction(store, c.id, cmd, "close", { note: "Refunded; police informed" });
    assert.equal(cur.status, "resolved");
    assert.equal(cur.resolution, "refunded");
    assert.deepEqual(cur.auditLog.map((e) => e.action), ["Complaint Created", "Owner Reviewed", "Forwarded To Command Centre", "Investigation Started", "Refund Approved", "Case Closed"]);
    const credits = Object.values<any>(data.txns).filter((x) => x.kind === "credit");
    assert.equal(credits.length, 1);
    assert.equal(credits[0].amount, 120);
  });
  await t("AUDIT IS APPEND-ONLY: every step keeps all earlier entries byte-for-byte and adds exactly one", async () => {
    const { store } = await setup();
    let prev = await file(store);
    const steps: [Actor, Parameters<typeof complaintAction>[3], any][] = [
      [owner, "owner_review", {}], [owner, "forward", { note: "fwd" }], [cmd, "accept", {}], [cmd, "approve_refund", { amount: 50 }], [cmd, "close", { note: "done" }],
    ];
    for (const [who, act, pl] of steps) {
      const next = await complaintAction(store, prev.id, who, act, pl);
      assert.equal(next.auditLog.length, prev.auditLog.length + 1, act);
      assert.deepEqual(next.auditLog.slice(0, prev.auditLog.length), prev.auditLog, `${act} changed history`);
      prev = next;
    }
  });
  await t("applyAction never mutates its input", async () => {
    const { store } = await setup();
    const c = await file(store);
    const frozen = structuredClone(c);
    applyAction(c, "forward", owner, { note: "x" }, Date.now());
    assert.deepEqual(c, frozen);
  });
  await t("opening an already-reviewed complaint is an idempotent no-op (no duplicate audit rows)", async () => {
    const { store } = await setup();
    const c = await file(store);
    const a = await complaintAction(store, c.id, owner, "owner_review");
    const b = await complaintAction(store, c.id, owner, "owner_review");
    assert.equal(a.auditLog.length, 2);
    assert.equal(b.auditLog.length, 2);
  });
  await t("closed and rejected cases are terminal", async () => {
    const { store } = await setup();
    const c = await file(store);
    const r = await complaintAction(store, c.id, owner, "owner_reject", { note: "No such entry" });
    assert.equal(r.status, "rejected");
    for (const [who, act] of [[owner, "forward"], [cmd, "accept"], [vera, "user_reply"]] as const) await rej(complaintAction(store, c.id, who, act, { note: "again" }), /closed|isn't available/);
    assert.deepEqual(allowedActions(r, owner), []);
    assert.deepEqual(allowedActions(r, cmd), []);
  });

  console.log("Refund safety");
  await t("RACE: two simultaneous 'Approve Refund' clicks credit the wallet exactly once", async () => {
    const { store, data } = await setup();
    const c = await file(store);
    await complaintAction(store, c.id, owner, "forward");
    await complaintAction(store, c.id, cmd, "accept");
    const res = await Promise.allSettled([complaintAction(store, c.id, cmd, "approve_refund", { amount: 120 }), complaintAction(store, c.id, cmd, "approve_refund", { amount: 120 })]);
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(data.accounts.victim.fastag.balance, 220);
  });
  await t("refund can't exceed the disputed charge, can't be zero, and a paid-out case can't then be 'rejected'", async () => {
    const { store } = await setup();
    const c = await file(store);
    await complaintAction(store, c.id, owner, "forward");
    await complaintAction(store, c.id, cmd, "accept");
    await rej(complaintAction(store, c.id, cmd, "approve_refund", { amount: 121 }), /can't exceed/);
    await rej(complaintAction(store, c.id, cmd, "approve_refund", { amount: 0 }), /refund amount|Enter/i);
    await complaintAction(store, c.id, cmd, "approve_refund", { amount: 120 });
    await rej(complaintAction(store, c.id, cmd, "command_reject", { note: "changed my mind" }), /isn't available/);
  });
  await t("refund without a verified charge needs an explicit amount from the Command Centre", async () => {
    const { store, data } = await setup();
    const c = await file(store, { transactionId: "TX-UNKNOWN" });
    await complaintAction(store, c.id, owner, "forward");
    await complaintAction(store, c.id, cmd, "accept");
    await rej(complaintAction(store, c.id, cmd, "approve_refund", {}), /Enter the refund amount/);
    await complaintAction(store, c.id, cmd, "approve_refund", { amount: 75 });
    assert.equal(data.accounts.victim.fastag.balance, 175);
  });
  await t("no-refund path: close without refund -> resolution 'no_refund'", async () => {
    const { store } = await setup();
    const c = await file(store);
    await complaintAction(store, c.id, owner, "forward");
    await complaintAction(store, c.id, cmd, "accept");
    assert.equal((await complaintAction(store, c.id, cmd, "close", { note: "Charge was valid" })).resolution, "no_refund");
  });

  console.log("More-information loops");
  await t("owner requests info -> driver replies with evidence -> loop clears -> owner can forward", async () => {
    const { store } = await setup();
    const c = await file(store);
    let cur = await complaintAction(store, c.id, owner, "owner_request_info", { note: "Send a photo of your RC book" });
    assert.equal(cur.status, "under_owner_review");
    assert.equal(cur.awaitingInfo?.by, "owner");
    assert.deepEqual(allowedActions(cur, vera), ["user_reply"]);
    await rej(complaintAction(store, c.id, vera, "user_reply", {}), /reply or attach/i);
    cur = await complaintAction(store, c.id, vera, "user_reply", { note: "Attached", attachments: [img("rc.jpg")] });
    assert.equal(cur.awaitingInfo, null);
    assert.equal(cur.attachments.length, 2);
    assert.deepEqual(allowedActions(cur, vera), []);
    await complaintAction(store, c.id, owner, "forward");
  });
  await t("command requests more evidence: close and refund are blocked until the driver replies", async () => {
    const { store } = await setup();
    const c = await file(store);
    await complaintAction(store, c.id, owner, "forward");
    await complaintAction(store, c.id, cmd, "accept");
    let cur = await complaintAction(store, c.id, cmd, "command_request_evidence", { note: "Need the FASTag statement" });
    assert.equal(cur.awaitingInfo?.by, "command");
    await rej(complaintAction(store, c.id, cmd, "close", { note: "x" }), /isn't available/);
    await rej(complaintAction(store, c.id, cmd, "approve_refund", { amount: 10 }), /isn't available/);
    await complaintAction(store, c.id, vera, "user_reply", { note: "Statement attached" });
    cur = await complaintAction(store, c.id, cmd, "close", { note: "ok" });
    assert.equal(cur.status, "resolved");
  });
  await t("another driver can't reply to someone else's complaint", async () => {
    const { store } = await setup();
    const c = await file(store);
    await complaintAction(store, c.id, owner, "owner_request_info", { note: "more please" });
    await rej(complaintAction(store, c.id, { id: "stranger", name: "S", role: "driver" }, "user_reply", { note: "hi" }), /isn't available/);
  });

  console.log("Evidence limits");
  await t("max files, types, PDF size and total size are enforced", () => {
    rej(() => validateAttachments([], Array.from({ length: EVIDENCE_LIMITS.maxFiles + 1 }, (_, i) => img(`${i}.jpg`))), /At most/);
    rej(() => validateAttachments([], [{ name: "x.exe", mime: "application/octet-stream", size: 5, dataUrl: "data:x" }]), /only images and PDFs/);
    rej(() => validateAttachments([], [{ name: "big.pdf", mime: "application/pdf", size: 500_000, dataUrl: "data:application/pdf;base64,AA" }]), /under 400 KB/);
    rej(() => validateAttachments([img("a", 400_000)], [img("b", 400_000)]), /too large in total/);
    assert.equal(validateAttachments([], [img(), { name: "ok.pdf", mime: "application/pdf", size: 1000, dataUrl: "data:application/pdf;base64,AA" }]).length, 2);
  });

  console.log("Investigation view data");
  await t("finds bookings on the same plate at that lot, flags ones made by a different account", async () => {
    const { store } = await setup();
    const mk = (id: string, driverUid: string, exitAt: number | null): Partial<LiveBooking> => ({ id, lotId: "L1", vehicle: "TN09AB1234", driverUid, startAt: Date.now() - 7200_000, parkedAt: Date.now() - 7000_000, exitAt, status: "completed", bayLabel: "A3", lotName: "x", driverName: driverUid });
    await store.set("bookings", "b-fraud", mk("b-fraud", "fraudster", Date.now() - 3600_000));
    await store.set("bookings", "b-old", mk("b-old", "victim", Date.now() - 30 * 24 * 3600_000));
    await store.set("bookings", "b-other-lot", { ...mk("b-other-lot", "victim", Date.now()), lotId: "ZZ" });
    const c = await file(store);
    const rel = await findRelatedBookings(store, c);
    assert.deepEqual(rel.map((r) => r.booking.id), ["b-fraud", "b-old"]);
    assert.equal(rel[0].otherAccount, true);
    assert.equal(rel[1].otherAccount, false);
    assert.ok(rel[0].minutesFromCharge! < 5);
  });
  await t("no related booking at all is reported as an empty list (itself a signal)", async () => {
    const { store } = await setup();
    assert.deepEqual(await findRelatedBookings(store, await file(store)), []);
  });

  console.log(`\n${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);
})();
