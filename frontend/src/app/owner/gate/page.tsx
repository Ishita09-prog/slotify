"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, CreditCard, Landmark, Loader2, QrCode, Radio, ScanLine, ShieldAlert, Smartphone, Wallet } from "lucide-react";
import { FastagTrace } from "@/components/live/fastag-trace";
import { GATEWAY_MS, PayGateway } from "@/components/fx/pay-gateway";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { autoFlagCloning } from "@/lib/live/complaint-service";
import { DRILL_LABEL, netcCheck, settlementAt, type TagCheck, type TagDrill } from "@/lib/live/netc";
import { toast } from "sonner";
import { GateCamera } from "@/components/vision/gate-camera";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useLive, useTick } from "@/lib/live/provider";
import { exitQuote, findAtGate, gateEntry, gateExit, LowBalance } from "@/lib/live/service";
import { fmtDur, fmtTime } from "@/lib/live/time";
import type { Account, LiveBooking, PayMethod, Txn } from "@/lib/live/types";
import { cn, formatINR, isValidPlate, normalizePlate } from "@/lib/utils";

type Result =
  | { kind: "none"; plate: string }
  | { kind: "found"; booking: LiveBooking; tag?: Account["fastag"] }
  | { kind: "entered"; booking: LiveBooking }
  | { kind: "low"; booking: LiveBooking; balance: number; due: number; reason?: string }
  | { kind: "blocked"; booking: LiveBooking; check: TagCheck; caseId?: string | null; stage: "entry" | "exit" }
  | { kind: "exited"; booking: LiveBooking; due: number; hours: number; method: PayMethod; txn: Txn | null; bank?: string };

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Soft barrier sound: a low motor hum sweeping up, then a gentle click. Web Audio, no files. */
function gateSound() {
  try {
    const A = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new A();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.9);
    f.type = "lowpass";
    f.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(f).connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 1.05);
    const c = ctx.createOscillator(), cg = ctx.createGain();
    c.type = "sine";
    c.frequency.value = 880;
    cg.gain.setValueAtTime(0.0001, t + 1.0);
    cg.gain.exponentialRampToValueAtTime(0.08, t + 1.02);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    c.connect(cg).connect(ctx.destination);
    c.start(t + 1.0);
    c.stop(t + 1.3);
    window.setTimeout(() => void ctx.close(), 1600);
  } catch {
    /* audio not available */
  }
}

function Gate() {
  const live = useLive();
  const now = useTick(1000);
  const params = useSearchParams();
  const mine = live.lots.filter((l) => l.ownerUid === live.uid);
  const [lotId, setLotId] = useState(params.get("lot") ?? "");
  useEffect(() => {
    if (!lotId && mine[0]) setLotId(mine[0].id);
  }, [lotId, mine]);
  const lot = mine.find((l) => l.id === lotId);
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [log, setLog] = useState<{ at: number; text: string; dir: "in" | "out" }[]>([]);
  const [drill, setDrill] = useState<TagDrill>("genuine");

  /** RFID read + NETC checks (exception list, tag–plate match, balance). Holds the car on mismatch / hotlist. */
  const checkTag = async (b: LiveBooking, due: number, stage: "entry" | "exit"): Promise<{ check: TagCheck; acc: Account | null } | null> => {
    if (!live.store || !lot) return null;
    const acc = await live.store.get<Account>("accounts", b.driverUid);
    const check = netcCheck({ acc, plate: b.vehicle, due, lotId: lot.id, drill, seed: `${b.id}-${stage}` });
    if (!check.hold) return { check, acc };
    let caseId: string | null = null;
    if (check.code === "MISMATCH") {
      try {
        const c = await autoFlagCloning(live.store, { victimUid: b.driverUid, victimName: b.driverName, plate: b.vehicle, lot, gateRef: `GATE-${check.info.rrn}`, detail: check.detail, tagId: check.info.tagId, tagVehicle: check.info.tagVehicle });
        caseId = c?.id ?? null;
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setRes({ kind: "blocked", booking: b, check, caseId, stage });
    setLog((l) => [{ at: Date.now(), text: `${b.vehicle} HELD · ${check.title}`, dir: stage === "entry" ? ("in" as const) : ("out" as const) }, ...l].slice(0, 8));
    toast.error(check.title);
    return null;
  };

  const arriving = live.bookings.filter((b) => b.lotId === lotId && b.status === "booked" && b.mode !== "plan").sort((a, b) => a.startAt - b.startAt);
  const inside = live.bookings.filter((b) => b.lotId === lotId && b.status === "parked");

  const [paying, setPaying] = useState<{ amount: number; method: PayMethod } | null>(null);
  const flashGate = () => {
    gateSound();
    setOpen(true);
    window.setTimeout(() => setOpen(false), 3500);
  };

  const scan = async (p = plate): Promise<LiveBooking | null> => {
    if (!live.store || !lot) return null;
    const v = normalizePlate(p);
    setPlate(v);
    setBusy(true);
    setQr(null);
    try {
      const list = await findAtGate(live.store, lot.id, v);
      const b = list.find((x) => x.status === "parked") ?? list[0];
      if (!b) {
        setRes({ kind: "none", plate: v });
        return null;
      }
      const acc = await live.store.get<Account>("accounts", b.driverUid);
      setRes({ kind: "found", booking: b, tag: acc?.fastag });
      return b;
    } finally {
      setBusy(false);
    }
  };

  const [auto, setAuto] = useState(true);
  const onAnpr = async (read: string, conf: number, raw?: string) => {
    // Whitelist matching (standard in ANPR gates): snap to the booked plate at this lot if within 2 edits.
    const expected = [...new Set(live.bookings.filter((x) => x.lotId === lotId && (x.status === "booked" || x.status === "parked")).map((x) => x.vehicle))];
    let text = read, best = 99;
    for (const v of expected) {
      const d = Math.min(editDistance(read, v), raw ? editDistance(raw, v) : 99);
      if (d < best) {
        best = d;
        if (d <= 2) text = v;
      }
    }
    setLog((l) => [{ at: Date.now(), text: `ANPR read ${raw ?? read} (${Math.round(conf * 100)}%)${text !== read ? ` → matched booking ${text}` : ""}`, dir: "in" as const }, ...l].slice(0, 8));
    const b = await scan(text);
    if (!b || !auto) return;
    if (b.status === "booked") await enter(b);
    else if (b.status === "parked") await exit(b, "fastag");
  };

  const enter = async (b: LiveBooking) => {
    if (!live.store) return;
    setBusy(true);
    try {
      const ok = await checkTag(b, 0, "entry");
      if (!ok) return;
      if (ok.check.fallback) toast.warning(`${ok.check.title}: entry allowed, collect the exit fee by UPI / QR / card.`);
      const nb = await gateEntry(live.store, b.id);
      setRes({ kind: "entered", booking: nb });
      flashGate();
      setLog((l) => [{ at: Date.now(), text: `${b.vehicle} entered → bay ${b.bayLabel}`, dir: "in" as const }, ...l].slice(0, 8));
      toast.success(`Gate open · ${b.vehicle} → bay ${b.bayLabel}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exit = async (b: LiveBooking, method: PayMethod) => {
    if (!live.store) return;
    setBusy(true);
    try {
      let netc = null;
      let bank: string | undefined;
      if (method === "fastag") {
        const due = exitQuote(b).due;
        const ok = await checkTag(b, due, "exit");
        if (!ok) return;
        if (ok.check.fallback) {
          setRes({ kind: "low", booking: b, balance: ok.acc?.fastag?.balance ?? 0, due, reason: ok.check.title });
          toast.warning(`${ok.check.title}. Collect by UPI, QR or card.`);
          return;
        }
        netc = ok.check.info;
        bank = ok.acc?.fastag?.bank;
      }
      if (method !== "fastag") {
        const due = exitQuote(b).due;
        if (due > 0) {
          setPaying({ amount: due, method });
          await new Promise((r) => setTimeout(r, GATEWAY_MS));
          setPaying(null);
        }
      }
      const r = await gateExit(live.store, b.id, method, netc);
      setRes({ kind: "exited", booking: r.booking, due: r.due, hours: r.hours, method, txn: r.txn, bank });
      flashGate();
      setLog((l) => [{ at: Date.now(), text: `${b.vehicle} left · ${formatINR(r.due)} via ${method === "fastag" ? "FASTag" : method.toUpperCase()}`, dir: "out" as const }, ...l].slice(0, 8));
      toast.success(`Paid ${formatINR(r.due)} · bay ${b.bayLabel} is free again for everyone`);
    } catch (e) {
      if (e instanceof LowBalance) {
        setRes({ kind: "low", booking: b, balance: e.balance, due: e.needed });
        toast.warning("FASTag balance too low. Collect by UPI, QR or card.");
      } else toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showQr = async (b: LiveBooking, due: number) => {
    setQr(await QRCode.toDataURL(`upi://pay?pa=${(lot?.ownerName ?? "slotify").toLowerCase().replace(/[^a-z]/g, "").slice(0, 12)}@sbi&pn=${encodeURIComponent(lot?.name ?? "Parking")}&am=${due.toFixed(2)}&cu=INR&tn=${b.id}`, { margin: 1, width: 200 }));
  };

  if (!mine.length) return <Card className="p-10 text-center text-sm text-muted-foreground">Add a parking location first.</Card>;

  return (
    <>
      <PageHeader
        title="FASTag gate"
        description="Camera reads the plate → we match the booking → the gate opens. At exit the FASTag is charged for the time parked, minus the cover charge already paid (₹25 car · ₹10 two-wheeler)."
        actions={<Select value={lotId} onChange={(e) => { setLotId(e.target.value); setRes(null); }} aria-label="Location" className="min-w-56">{mine.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            {/* Gate visual */}
            <div className="relative h-36 bg-[hsl(var(--asphalt))]">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-[repeating-linear-gradient(90deg,#facc15_0_24px,transparent_24px_48px)] opacity-40" />
              <div className="absolute bottom-6 left-8 h-16 w-5 rounded-t-md bg-slate-300" />
              <motion.div
                className="absolute bottom-[4.5rem] left-[2.6rem] h-3 w-[60%] origin-left rounded-full bg-[repeating-linear-gradient(90deg,#ef4444_0_28px,#fff_28px_56px)] shadow-lg"
                animate={{ rotate: open ? -78 : 0 }}
                transition={{ type: "spring", stiffness: 90, damping: 14 }}
              />
              <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white">
                <span className={cn("size-2 rounded-full", open ? "bg-status-available animate-pulse" : "bg-status-occupied")} /> {open ? "Gate open" : "Gate closed"}
              </div>
              <div className="absolute bottom-3 right-4 flex items-center gap-1.5 text-[11px] text-white/60"><Radio className="size-3.5" /> RFID reader · ANPR camera</div>
            </div>

            <div className="border-b p-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">ANPR camera · automatic plate reading</p>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Open gate & charge FASTag automatically</label>
              </div>
              <GateCamera onRead={onAnpr} disabled={busy} />
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-xs">
                <Radio className="size-3.5 text-primary" /> <span className="font-semibold">RFID reader simulation</span>
                <select aria-label="Simulated tag read" value={drill} onChange={(e) => setDrill(e.target.value as TagDrill)} className="rounded-md border bg-background px-2 py-1 text-xs text-foreground">
                  {(Object.keys(DRILL_LABEL) as TagDrill[]).map((d) => <option key={d} value={d}>{DRILL_LABEL[d]}</option>)}
                </select>
                <span className="text-muted-foreground">Every read is checked against NETC: exception list, tag–plate match, balance.</span>
              </div>
            </div>
            <form className="flex flex-col gap-3 p-5 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (isValidPlate(plate)) void scan(); }}>
              <div className="flex flex-1 items-center rounded-xl border-2 border-foreground/80 bg-white px-3 text-slate-900">
                <span className="mr-2 rounded bg-blue-700 px-1 text-[10px] font-bold text-white">IND</span>
                <input aria-label="Vehicle plate" placeholder="TN09AB1234" value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value).slice(0, 12))} className="h-12 w-full bg-transparent font-display text-2xl font-extrabold tracking-[0.15em] outline-none placeholder:text-slate-300" />
              </div>
              <Button type="submit" size="lg" className="h-14" disabled={!isValidPlate(plate) || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <ScanLine />} Read plate
              </Button>
            </form>
          </Card>

          <AnimatePresence mode="wait">
            {res && (
              <motion.div key={res.kind + ("booking" in res ? res.booking.id : "")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card className="p-5">
                  {res.kind === "none" && (
                    <p className="text-sm"><b>{res.plate}</b> has no booking at {lot?.name}. Gate stays closed. Ask the driver to book in the Slotify app. It takes 20 seconds.</p>
                  )}
                  {res.kind === "found" && res.booking.status === "booked" && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-status-available">Booking matched</p>
                      <h3 className="mt-1 font-display text-2xl font-extrabold">{res.booking.vehicle} → bay {res.booking.bayLabel}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{res.booking.driverName} · {res.booking.mode === "timed" ? `time slot ${res.booking.windowLabel}` : "no time limit"} · cover ₹{res.booking.cover} paid</p>
                      {res.tag && <p className="mt-2 font-mono text-xs text-muted-foreground">FASTag {res.tag.tagId} · balance {formatINR(res.tag.balance)}</p>}
                      <Button size="lg" className="mt-4 w-full sm:w-auto" disabled={busy} onClick={() => enter(res.booking)}><ArrowDownToLine /> Open gate · Entry</Button>
                    </div>
                  )}
                  {res.kind === "found" && res.booking.status === "parked" && (() => {
                    const q = exitQuote(res.booking, now);
                    return (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-status-occupied">Exit</p>
                        <h3 className="mt-1 font-display text-2xl font-extrabold">{res.booking.vehicle} · bay {res.booking.bayLabel}</h3>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                          <div className="rounded-lg bg-secondary/50 p-2"><p className="font-bold">{fmtDur(q.ms)}</p><p className="text-[11px] text-muted-foreground">parked</p></div>
                          <div className="rounded-lg bg-secondary/50 p-2"><p className="font-bold">{formatINR(q.fee)}</p><p className="text-[11px] text-muted-foreground">{q.hours} h × {formatINR(res.booking.pricePerHour)}</p></div>
                          <div className="rounded-lg bg-primary/10 p-2"><p className="font-bold">{formatINR(q.due)}</p><p className="text-[11px] text-muted-foreground">due (−₹{res.booking.cover} cover)</p></div>
                        </div>
                        {res.tag && <p className="mt-2 font-mono text-xs text-muted-foreground">FASTag {res.tag.tagId} · balance {formatINR(res.tag.balance)}</p>}
                        <Button size="lg" className="mt-4 w-full sm:w-auto" disabled={busy} onClick={() => exit(res.booking, "fastag")}><Wallet /> Charge FASTag · Open gate</Button>
                      </div>
                    );
                  })()}
                  {res.kind === "low" && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-status-reserved">{res.reason ?? "FASTag balance low"}</p>
                      <h3 className="mt-1 font-display text-xl font-extrabold">{res.reason && res.reason !== "Low balance" ? `Due ${formatINR(res.due)}` : `Balance ${formatINR(res.balance)} · due ${formatINR(res.due)}`}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Fallback: UPI → QR → card. The gate opens as soon as payment is confirmed.</p>
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <Button variant="outline" disabled={busy} onClick={() => exit(res.booking, "upi")}><Smartphone /> UPI request</Button>
                        <Button variant="outline" disabled={busy} onClick={() => showQr(res.booking, res.due)}><QrCode /> Show QR</Button>
                        <Button variant="outline" disabled={busy} onClick={() => exit(res.booking, "card")}><CreditCard /> Debit card</Button>
                      </div>
                      {qr && (
                        <div className="mt-4 flex items-center gap-4">
                          <img src={qr} alt="UPI QR" className="size-32 rounded-lg bg-white p-1" />
                          <div className="text-sm">
                            <p>Driver scans and pays <b>{formatINR(res.due)}</b>.</p>
                            <Button className="mt-2" size="sm" disabled={busy} onClick={() => exit(res.booking, "qr")}>Payment received · Open gate</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {res.kind === "entered" && (
                    <p className="text-sm"><b className="text-status-available">Gate opened.</b> {res.booking.vehicle} is parked in bay <b>{res.booking.bayLabel}</b>. It now shows as parked on every driver&apos;s screen.</p>
                  )}
                  {res.kind === "exited" && (
                    <div className="space-y-4">
                      <p className="text-sm"><b className="text-status-available">Paid {formatINR(res.due)} via {res.method === "fastag" ? "FASTag" : res.method.toUpperCase()}.</b> {res.hours} h parked; ₹{res.booking.cover} cover adjusted. Bay {res.booking.bayLabel} is free again for everyone.</p>
                      {res.txn && (
                        <div className="rounded-xl border p-3">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live FASTag trace · {res.txn.id}</p>
                          <FastagTrace txn={res.txn} bank={res.bank} play />
                        </div>
                      )}
                    </div>
                  )}
                  {res.kind === "blocked" && (
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 rounded-xl border border-status-occupied/60 bg-status-occupied/10 p-3">
                        <ShieldAlert className="mt-0.5 size-6 shrink-0 text-status-occupied" />
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-status-occupied">Gate held at {res.stage} · no charge made</p>
                          <h3 className="font-display text-xl font-extrabold">{res.check.title}</h3>
                          <p className="mt-1 text-sm">{res.check.detail}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                        {[["Camera read", res.check.info.plateRead], ["Tag registered to", res.check.info.tagVehicle], ["Tag ID", res.check.info.tagId], ["NETC status", res.check.info.tagStatus]].map(([l, v]) => (
                          <div key={l} className="rounded-lg bg-secondary/50 p-2"><p className="text-[11px] text-muted-foreground">{l}</p><p className={cn("break-all font-mono text-xs font-bold", l !== "Tag ID" && res.check.code === "MISMATCH" && "text-status-occupied")}>{v}</p></div>
                        ))}
                      </div>
                      {res.caseId ? (
                        <p className="text-sm">Fraud case <Link href={`/owner/complaints/view?id=${res.caseId}`} className="font-mono font-bold text-primary underline">{res.caseId}</Link> opened for the registered owner of {res.booking.vehicle}. Attach the CCTV still and forward it to the Command Centre.</p>
                      ) : res.check.code === "MISMATCH" ? (
                        <p className="text-sm text-muted-foreground">An open fraud case already exists for this plate at this lot.</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Security alerted. The tag owner gets a notification from their issuer bank.</p>
                      )}
                    </div>
                  )}
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="flex items-center gap-2 font-display font-bold"><ArrowDownToLine className="size-4 text-status-reserved" /> Expected arrivals</h2>
            {arriving.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">None.</p> : (
              <ul className="mt-2 space-y-1.5">
                {arriving.map((b) => (
                  <li key={b.id}>
                    <button onClick={() => scan(b.vehicle)} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-secondary/60">
                      <span><b className="font-display tracking-wider">{b.vehicle}</b><span className="block text-xs text-muted-foreground">bay {b.bayLabel} · {b.mode === "timed" ? b.windowLabel : `by ${fmtTime(b.startAt + 15 * 60_000)}`}</span></span>
                      <ScanLine className="size-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="flex items-center gap-2 font-display font-bold"><ArrowUpFromLine className="size-4 text-status-occupied" /> Inside now</h2>
            {inside.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No cars inside.</p> : (
              <ul className="mt-2 space-y-1.5">
                {inside.map((b) => (
                  <li key={b.id}>
                    <button onClick={() => scan(b.vehicle)} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-secondary/60">
                      <span><b className="font-display tracking-wider">{b.vehicle}</b><span className="block text-xs text-muted-foreground">bay {b.bayLabel} · {fmtDur(now - (b.parkedAt ?? now))}</span></span>
                      <ScanLine className="size-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {(() => {
            const day = new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
            const todays = live.bookings.filter((b) => b.ownerUid === live.uid && b.exitAt && new Date(b.exitAt + 5.5 * 3600_000).toISOString().slice(0, 10) === day);
            const tagGate = todays.filter((b) => b.exitMethod === "fastag").reduce((a, b) => a + (b.paidAtExit ?? 0), 0);
            const other = todays.filter((b) => b.exitMethod && b.exitMethod !== "fastag").reduce((a, b) => a + (b.paidAtExit ?? 0), 0);
            return (
              <Card className="p-4">
                <h2 className="flex items-center gap-2 font-display font-bold"><Landmark className="size-4 text-primary" /> Today&apos;s settlement</h2>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">FASTag exit fees</span><b>{formatINR(tagGate)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">UPI / QR / card</span><b>{formatINR(other)}</b></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Exits today</span><b>{todays.length}</b></div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">FASTag money reaches your bank via the acquirer on {new Date(settlementAt(now)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} (T+1, NETC cycle).</p>
              </Card>
            );
          })()}
          {log.length > 0 && (
            <Card className="p-4">
              <h2 className="font-display font-bold">Gate log</h2>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {log.map((l, i) => <li key={i}>{fmtTime(l.at)} · {l.text}</li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <Dialog open={!!paying}>
        <DialogContent hideClose>
          <DialogTitle className="sr-only">Processing payment</DialogTitle>
          <DialogDescription className="sr-only">Authorising the exit fee</DialogDescription>
          {paying && <PayGateway amount={paying.amount} method={paying.method} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}
