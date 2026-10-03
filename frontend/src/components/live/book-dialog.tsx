"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { Check, CreditCard, Loader2, Lock, Navigation, QrCode, Smartphone, Timer, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLive, useTick } from "@/lib/live/provider";
import { book, holdBay, LowBalance, recharge, releaseBay, type BookingRequest } from "@/lib/live/service";
import { UserError } from "@/lib/live/store";
import { fmtDate, fmtDateTime, fmtTime, windowHours } from "@/lib/live/time";
import { quotePlan, type PlanQuote } from "@/lib/live/plans";
import { PlanBreakdown } from "@/components/live/plan-picker";
import { COVER, type Bay, type LiveBooking, type LiveLot, type PayMethod, type Vehicle } from "@/lib/live/types";
import { cn, formatINR, googleMapsDirectionsUrl } from "@/lib/utils";

type Step = "review" | "pay" | "busy" | "done";

function Row({ l, v, strong }: { l: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-1.5 text-sm", strong && "border-t pt-3 font-bold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{l}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}

export function BookDialog({
  open, onClose, lot, bay, req, vehicle, arriveInMin, seed,
}: {
  seed?: Bay;
  open: boolean;
  onClose: () => void;
  lot: LiveLot;
  bay: Bay;
  req: BookingRequest;
  vehicle: Vehicle;
  arriveInMin: number;
}) {
  const live = useLive();
  const now = useTick(1000);
  const [step, setStep] = useState<Step>("review");
  const [until, setUntil] = useState<number | null>(null);
  const [method, setMethod] = useState<PayMethod>("fastag");
  const [upi, setUpi] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [done, setDone] = useState<LiveBooking | null>(null);
  const [passQr, setPassQr] = useState<string | null>(null);
  const booked = useRef(false);
  const balance = live.account?.fastag?.balance ?? 0;
  // weekly / monthly: the whole plan is paid now. Hourly: unchanged ₹COVER.
  const quote = useMemo<PlanQuote | null>(() => {
    if (req.mode !== "plan" || !req.plan) return null;
    try { return quotePlan(lot, req.plan); } catch { return null; }
  }, [req, lot]);
  const charge = quote ? quote.total : COVER;
  const low = balance < charge;
  const est = req.mode === "timed" && req.window ? windowHours(req.window) * (lot.pricePerHour + (bay.type === "ev" ? lot.evPerHour : 0)) : null;

  // Lock the bay in the database while this driver pays — other phones see it amber instantly.
  useEffect(() => {
    if (!open || !live.store || !live.uid) return;
    booked.current = false;
    setStep("review");
    setDone(null);
    setMethod(low ? "upi" : "fastag");
    setUpi(`${live.account?.username ?? "driver"}@okaxis`);
    let cancelled = false;
    holdBay(live.store, live.uid, bay.id, seed)
      .then((u) => !cancelled && setUntil(u))
      .catch((e) => {
        toast.error(e instanceof UserError ? e.message : "Couldn't lock this bay");
        onClose();
      });
    const store = live.store, uid = live.uid;
    return () => {
      cancelled = true;
      if (!booked.current) void releaseBay(store, uid, bay.id);
    };
  }, [open, bay.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && until && now > until && step !== "done" && step !== "busy") {
      toast.warning(`Time's up. Bay ${bay.label} released for other drivers.`);
      onClose();
    }
  }, [now, until, open, step, bay.label, onClose]);

  useEffect(() => {
    if (method === "qr") QRCode.toDataURL(`upi://pay?pa=slotify.gcc@sbi&pn=Slotify&am=${charge}.00&cu=INR&tn=${bay.id}`, { margin: 1, width: 200 }).then(setQr);
  }, [method, bay.id, charge]);

  const pay = async () => {
    if (!live.store || !live.account) return;
    setStep("busy");
    try {
      await new Promise((r) => setTimeout(r, 700));
      const b = await book(live.store, live.account, { lot, bayId: bay.id, req, vehicle, method, arriveInMin, seed });
      booked.current = true;
      setDone(b);
      setPassQr(await QRCode.toDataURL(`SLOTIFY:${b.id}:${b.vehicle}`, { margin: 1, width: 180 }));
      setStep("done");
    } catch (e) {
      if (e instanceof LowBalance) {
        toast.warning("FASTag balance is low. Switched to UPI.");
        setMethod("upi");
        setStep("pay");
      } else {
        toast.error(e instanceof UserError ? e.message : (e as Error).message);
        onClose();
      }
    }
  };

  const topUp = async () => {
    if (!live.store || !live.uid) return;
    const amt = Math.max(500, Math.ceil((charge - balance) / 500) * 500);
    await recharge(live.store, live.uid, amt, "upi");
    toast.success(`${formatINR(amt)} added to FASTag via UPI`);
    setMethod("fastag");
  };

  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 180;
  const methods: { k: PayMethod; label: string; sub: string; icon: React.ElementType; disabled?: boolean }[] = [
    { k: "fastag", label: "FASTag", sub: low ? `Balance ${formatINR(balance)}, too low` : `Balance ${formatINR(balance)} · auto-debit`, icon: Wallet, disabled: low },
    { k: "upi", label: "UPI", sub: "GPay · PhonePe · Paytm", icon: Smartphone },
    { k: "qr", label: "Scan QR", sub: "Any UPI app", icon: QrCode },
    { k: "card", label: "Debit card", sub: "RuPay · Visa · Mastercard", icon: CreditCard },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && step !== "busy" && onClose()}>
      <DialogContent hideClose={step === "busy"}>
        {step !== "done" && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-status-reserved/40 bg-status-reserved/10 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 font-semibold"><Lock className="size-3.5" /> Bay {bay.label} is locked for you</span>
            <span className="flex items-center gap-1 font-display font-bold tabular-nums"><Timer className="size-3.5" /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
          </div>
        )}
        <AnimatePresence mode="wait">
          {step === "review" && (
            <motion.div key="r" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <DialogTitle>Confirm bay {bay.label}</DialogTitle>
              <DialogDescription className="mt-1">{lot.name} · {lot.area}</DialogDescription>
              <div className="mt-4 rounded-xl border bg-secondary/30 p-4">
                <Row l="Vehicle" v={<b className="font-display tracking-wider">{vehicle.number}</b>} />
                {quote ? (
                  <PlanBreakdown q={quote} payLabel="Pay now" />
                ) : (
                  <>
                    <Row l={req.mode === "timed" ? "Time slot" : "Arrive by"} v={req.mode === "timed" ? `${req.window?.start}–${req.window?.end}` : fmtTime(Date.now() + (arriveInMin + 15) * 60_000)} />
                    <Row l="Parking fee" v={est != null ? `${formatINR(est)} for the slot` : `${formatINR(lot.pricePerHour + (bay.type === "ev" ? lot.evPerHour : 0))}/h, pay for time used`} />
                    <Row l="Cover charge · pay now" v={formatINR(charge)} strong />
                  </>
                )}
              </div>
              <p className="mt-3 rounded-lg bg-primary/10 p-3 text-xs leading-relaxed">
                {quote ? (
                  <>Paid in full now. Bay {bay.label} is reserved for you on these dates and nobody else can book it. Cancel any time: <b>unused time is refunded</b> to your FASTag wallet.</>
                ) : (
                  <>The ₹{COVER} is <b>adjusted against your parking fee</b> at the exit gate. If you don&apos;t arrive within 15 minutes, the bay is released and the ₹{COVER} is not refunded.</>
                )}
              </p>
              <div className="mt-5 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onClose}>Change</Button>
                <Button className="flex-1" disabled={!until} onClick={() => setStep("pay")}>{until ? `Pay ${formatINR(charge)}` : <Loader2 className="animate-spin" />}</Button>
              </div>
            </motion.div>
          )}

          {step === "pay" && (
            <motion.div key="p" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <DialogTitle>Pay {formatINR(charge)}</DialogTitle>
              <DialogDescription className="mt-1">FASTag first. If the balance is low, UPI, then QR, then card.</DialogDescription>
              <div className="mt-4 space-y-2" role="radiogroup" aria-label="Payment method">
                {methods.map((m) => {
                  const Icon = m.icon;
                  const on = method === m.k;
                  return (
                    <button key={m.k} role="radio" aria-checked={on} disabled={m.disabled} onClick={() => setMethod(m.k)} className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50", on ? "border-primary bg-primary/10" : "hover:bg-secondary/50")}>
                      <span className={cn("grid size-9 place-items-center rounded-lg", on ? "bg-primary text-white" : "bg-secondary")}><Icon className="size-4" /></span>
                      <span className="flex-1"><span className="block text-sm font-semibold">{m.label}</span><span className="block text-xs text-muted-foreground">{m.sub}</span></span>
                      <span className={cn("size-4 rounded-full border-2", on ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--card))]" : "border-border")} />
                    </button>
                  );
                })}
              </div>
              {low && <button onClick={topUp} className="mt-2 text-xs font-semibold text-primary">+ Recharge FASTag {formatINR(Math.max(500, Math.ceil((charge - balance) / 500) * 500))} via UPI</button>}
              {method === "upi" && <Input aria-label="UPI ID" className="mt-3" value={upi} onChange={(e) => setUpi(e.target.value)} />}
              {method === "qr" && qr && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border p-3">
                  <img src={qr} alt="UPI QR" className="size-24 rounded-lg bg-white p-1" />
                  <p className="text-xs text-muted-foreground">Scan with any UPI app to pay {formatINR(charge)} (demo VPA).</p>
                </div>
              )}
              <div className="mt-5 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("review")}>Back</Button>
                <Button className="flex-1" onClick={pay} disabled={(method === "fastag" && low) || (method === "upi" && !upi.includes("@"))}>{method === "qr" ? "I've paid" : `Pay ${formatINR(charge)}`}</Button>
              </div>
            </motion.div>
          )}

          {step === "busy" && (
            <motion.div key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-10 text-center">
              <Loader2 className="size-10 animate-spin text-primary" />
              <DialogTitle className="mt-4">Confirming…</DialogTitle>
              <DialogDescription className="mt-1">Writing your booking to the database</DialogDescription>
            </motion.div>
          )}

          {step === "done" && done && (
            <motion.div key="d" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-status-available text-white"><Check className="size-7" /></span>
              <DialogTitle className="mt-3 text-xl">Bay {done.bayLabel} is yours</DialogTitle>
              <DialogDescription className="mt-1">It&apos;s now red on every other driver&apos;s screen.</DialogDescription>
              <div className="relative mt-4 flex items-center gap-4 rounded-xl border bg-secondary/30 p-4 text-left">
                {passQr && <img src={passQr} alt="Gate pass" className="size-24 shrink-0 rounded-lg bg-white p-1" />}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-mono text-xs text-muted-foreground">{done.id}</p>
                  <p className="font-display text-lg font-extrabold tracking-wider">{done.vehicle}</p>
                  <p className="text-xs text-muted-foreground">{done.mode === "plan" ? `${done.bookingType === "weekly" ? "Weekly" : "Monthly"} plan · ${fmtDate(done.startAt)} → ${fmtDate(done.endAt ?? done.startAt)}` : done.mode === "timed" ? `Slot ${done.windowLabel}` : `Arrive by ${fmtTime(done.startAt + 15 * 60_000)}`}{done.mode === "plan" ? "" : ` · ${fmtDateTime(done.startAt)}`}</p>
                  <p className="mt-1 text-xs">Paid {formatINR(done.cover)} via {done.coverMethod === "fastag" ? "FASTag" : done.coverMethod.toUpperCase()}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{done.mode === "plan" ? "Your bay is reserved for these dates. See it under My Active Bookings." : "At the gate the camera reads your plate. No need to show anything."}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button asChild><a href={googleMapsDirectionsUrl(lot)} target="_blank" rel="noopener noreferrer"><Navigation /> Navigate</a></Button>
                <Button asChild variant="outline"><Link href="/user/bookings">My bookings</Link></Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
