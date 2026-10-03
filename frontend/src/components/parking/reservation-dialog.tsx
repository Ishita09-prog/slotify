"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CreditCard, Loader2, Lock, Navigation, QrCode, Smartphone, Timer, Wallet } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import type { Booking, ParkingLot, PaymentMethod, Slot } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plate } from "@/components/brand/plate";
import { useSlotify } from "@/lib/store";
import { api } from "@/lib/api";
import { cn, formatDateTime, formatINR, googleMapsDirectionsUrl, uid } from "@/lib/utils";

type Step = "confirm" | "payment" | "processing" | "success";
const STEPS: { key: Step; label: string }[] = [
  { key: "confirm", label: "Review" },
  { key: "payment", label: "Pay" },
  { key: "success", label: "Pass" },
];
const HOLD_SECONDS = 300;

export interface Quote {
  hours: number;
  parking: number;
  evSurcharge: number;
  /** Non-refundable cover charge paid now, adjusted against the parking fee at exit. */
  coverCharge: number;
  /** Estimated parking fee (parking + EV), settled at exit via FASTag. */
  estimate: number;
  /** Due now = cover charge. */
  total: number;
  arrivalAt: number;
  mode: "timed" | "open";
  windowLabel?: string;
}

function Stepper({ step }: { step: Step }) {
  const idx = step === "processing" ? 1 : step === "success" ? STEPS.length : STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors",
              i < idx ? "bg-status-available text-white" : i === idx ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
            )}
            aria-current={i === idx ? "step" : undefined}
          >
            {i < idx ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("text-xs font-semibold", i === idx ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
          {i < STEPS.length - 1 && <span className={cn("h-px flex-1", i < idx ? "bg-status-available" : "bg-border")} />}
        </li>
      ))}
    </ol>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-1.5 text-sm", strong && "border-t pt-3 font-bold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = { fastag: "FASTag", upi: "UPI", qr: "UPI QR", card: "Debit card" };

export function ReservationDialog({
  open, onOpenChange, lot, slot, vehicle, quote, onReserved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lot: ParkingLot;
  slot: Slot;
  vehicle: string;
  quote: Quote;
  onReserved: () => void;
}) {
  const { state, actions } = useSlotify();
  const [step, setStep] = useState<Step>("confirm");
  const balance = state.wallet.balance;
  const fastagShort = balance < quote.total;
  const [method, setMethod] = useState<PaymentMethod>(fastagShort ? "upi" : "fastag");
  const [upiId, setUpiId] = useState("driver@okaxis");
  const [card, setCard] = useState("4111 1111 1111 1111");
  const [qr, setQr] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [left, setLeft] = useState(HOLD_SECONDS);
  const held = useRef(false);
  const done = useRef(false);
  const bookingId = useRef(uid("SLT-"));

  // 1) Lock the bay the moment checkout opens, so nobody else can book it (no double booking).
  useEffect(() => {
    if (!open) return;
    done.current = false;
    bookingId.current = uid("SLT-");
    setLeft(HOLD_SECONDS);
    setMethod(state.wallet.balance < quote.total ? "upi" : "fastag");
    const ok = actions.holdBay(lot.id, slot.id);
    held.current = ok;
    if (!ok) {
      toast.error(`Bay ${slot.id} was just taken by someone else. Pick another bay.`);
      onOpenChange(false);
      return;
    }
    return () => {
      if (held.current && !done.current) actions.releaseBay(lot.id, slot.id);
      held.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lot.id, slot.id]);

  // 2) Hold countdown — the bay is released automatically if checkout is abandoned.
  useEffect(() => {
    if (!open || step === "success") return;
    const t = window.setInterval(() => setLeft((l) => l - 1), 1000);
    return () => window.clearInterval(t);
  }, [open, step]);
  useEffect(() => {
    if (open && left <= 0 && step !== "success" && step !== "processing") {
      toast.warning(`Hold expired. Bay ${slot.id} released for other drivers.`);
      onOpenChange(false);
    }
  }, [left, open, step, slot.id, onOpenChange]);

  // 3) UPI QR (scan with any UPI app). Demo VPA; real deployment uses the operator's merchant VPA.
  useEffect(() => {
    if (method !== "qr") return;
    const url = `upi://pay?pa=slotify.gcc@sbi&pn=Slotify%20Parking&am=${quote.total.toFixed(2)}&cu=INR&tn=${bookingId.current}`;
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#0b1220", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [method, quote.total]);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setTimeout(() => { setStep("confirm"); setBooking(null); }, 250);
  };

  const pay = async () => {
    const liveSlot = state.slots[lot.id]?.find((s) => s.id === slot.id);
    if (!liveSlot || !(liveSlot.status === "available" || liveSlot.heldBy === "hold")) {
      toast.error(`Bay ${slot.id} is no longer available. Pick another bay.`);
      close(false);
      return;
    }
    setStep("processing");
    await new Promise((r) => setTimeout(r, method === "qr" ? 900 : 1400));
    const b: Booking = {
      id: bookingId.current,
      lotId: lot.id,
      lotName: lot.name,
      slotId: slot.id,
      vehicleNumber: vehicle,
      startTime: quote.arrivalAt,
      durationHours: quote.hours,
      amount: quote.total,
      paymentMethod: method,
      status: "confirmed",
      createdAt: Date.now(),
      mode: quote.mode,
      windowLabel: quote.windowLabel,
      coverCharge: quote.coverCharge,
    };
    done.current = true;
    actions.reserve(b);
    if (method === "fastag") {
      actions.walletTxn({ kind: "debit", amount: quote.total, description: `Cover charge · ${lot.name} · ${slot.id}`, lotName: lot.name });
    }
    void api.createBooking(b);
    setBooking(b);
    setStep("success");
    onReserved();
  };

  const methods: { key: PaymentMethod; label: string; sub: string; icon: React.ElementType; disabled?: boolean; tag?: string }[] = [
    { key: "fastag", label: "FASTag", sub: fastagShort ? `Balance ${formatINR(balance)} — too low, skipped` : `Auto-debit · balance ${formatINR(balance)}`, icon: Wallet, disabled: fastagShort, tag: "1st" },
    { key: "upi", label: "UPI ID", sub: "GPay, PhonePe, Paytm, BHIM", icon: Smartphone, tag: "2nd" },
    { key: "qr", label: "Scan UPI QR", sub: "Any UPI app — scan and pay", icon: QrCode, tag: "3rd" },
    { key: "card", label: "Debit card", sub: "RuPay, Visa, Mastercard", icon: CreditCard, tag: "4th" },
  ];
  const mm = String(Math.max(0, Math.floor(left / 60))).padStart(1, "0");
  const ss = String(Math.max(0, left % 60)).padStart(2, "0");
  const payDisabled = (method === "fastag" && fastagShort) || (method === "upi" && !upiId.includes("@")) || (method === "card" && card.replace(/\s/g, "").length < 12);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent hideClose={step === "processing"} onInteractOutside={(e) => step === "processing" && e.preventDefault()}>
        <Stepper step={step} />
        {step !== "success" && (
          <div className="-mt-2 mb-4 flex items-center justify-between rounded-lg border border-status-reserved/40 bg-status-reserved/10 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 font-semibold"><Lock className="size-3.5" /> Bay {slot.id} is locked for you</span>
            <span className="flex items-center gap-1 font-display font-bold tabular-nums"><Timer className="size-3.5" /> {mm}:{ss}</span>
          </div>
        )}
        <AnimatePresence mode="wait">
          {step === "confirm" && (
            <motion.div key="confirm" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
              <DialogTitle>Review your booking</DialogTitle>
              <DialogDescription className="mt-1">Nobody else can book this bay while the timer runs.</DialogDescription>
              <div className="mt-4 rounded-xl border bg-secondary/30 p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold">{lot.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{lot.address}</p>
                  </div>
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-status-selected font-display text-lg font-extrabold text-white">{slot.id}</span>
                </div>
                <div className="mt-3 border-t pt-2">
                  <Row label="Vehicle" value={<Plate value={vehicle} />} />
                  <Row label={quote.mode === "timed" ? "Time slot" : "Arrival"} value={quote.mode === "timed" ? quote.windowLabel : formatDateTime(quote.arrivalAt)} />
                  <Row label="Est. parking fee" value={`${formatINR(quote.estimate)} · ${quote.mode === "timed" ? `${quote.hours} h window` : `~${quote.hours} h, pay for time used`}`} />
                  <Row label="Cover charge (pay now)" value={formatINR(quote.coverCharge)} strong />
                </div>
              </div>
              <p className="mt-3 rounded-lg bg-primary/10 p-3 text-xs leading-relaxed">
                <b>How the ₹{quote.coverCharge} cover charge works:</b> it is adjusted against your parking fee when you park, so you pay
                {" "}{formatINR(Math.max(0, quote.estimate - quote.coverCharge))} at exit. If you don&apos;t turn up within 15 min of your time, the bay is
                released and the cover charge is not refunded.
              </p>
              <div className="mt-5 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => close(false)}>Change bay</Button>
                <Button className="flex-1" onClick={() => setStep("payment")}>Pay {formatINR(quote.total)}</Button>
              </div>
            </motion.div>
          )}

          {step === "payment" && (
            <motion.div key="payment" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
              <DialogTitle>Pay {formatINR(quote.total)} cover charge</DialogTitle>
              <DialogDescription className="mt-1">
                Order tried: FASTag → UPI → QR → Debit card.{fastagShort && " FASTag balance is low, so we moved you to UPI."} Simulated payment.
              </DialogDescription>
              <div className="mt-4 space-y-2" role="radiogroup" aria-label="Payment method">
                {methods.map((m) => {
                  const Icon = m.icon;
                  const checked = method === m.key;
                  return (
                    <button
                      key={m.key}
                      role="radio"
                      aria-checked={checked}
                      disabled={m.disabled}
                      onClick={() => setMethod(m.key)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
                        checked ? "border-primary bg-primary/10" : "hover:bg-secondary/50"
                      )}
                    >
                      <span className={cn("grid size-9 place-items-center rounded-lg", checked ? "bg-primary text-white" : "bg-secondary")}>
                        <Icon className="size-4" />
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{m.label} <span className="ml-1 rounded bg-secondary px-1 text-[10px] font-medium text-muted-foreground">{m.tag}</span></span>
                        <span className="block text-xs text-muted-foreground">{m.sub}</span>
                      </span>
                      <span className={cn("size-4 rounded-full border-2", checked ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--card))]" : "border-border")} />
                    </button>
                  );
                })}
              </div>
              {method === "upi" && (
                <div className="mt-3">
                  <label htmlFor="upi" className="text-xs font-medium text-muted-foreground">UPI ID</label>
                  <Input id="upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} className="mt-1" />
                </div>
              )}
              {method === "qr" && (
                <div className="mt-3 flex items-center gap-4 rounded-xl border p-3">
                  {qr ? <img src={qr} alt="UPI QR code" className="size-28 rounded-lg bg-white p-1" /> : <div className="size-28 animate-pulse rounded-lg bg-secondary" />}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Scan with any UPI app. Pays <b className="text-foreground">{formatINR(quote.total)}</b> to <span className="font-mono">slotify.gcc@sbi</span> (demo VPA), reference {bookingId.current}.
                  </p>
                </div>
              )}
              {method === "card" && (
                <div className="mt-3">
                  <label htmlFor="card" className="text-xs font-medium text-muted-foreground">Card number (demo)</label>
                  <Input id="card" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value.replace(/[^\d ]/g, "").slice(0, 19))} className="mt-1 font-mono" />
                </div>
              )}
              <div className="mt-5 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep("confirm")}>Back</Button>
                <Button className="flex-1" onClick={pay} disabled={payDisabled}>
                  {method === "qr" ? "I've paid" : `Pay ${formatINR(quote.total)}`}
                </Button>
              </div>
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-10 text-center">
              <Loader2 className="size-10 animate-spin text-primary" />
              <DialogTitle className="mt-4">Confirming payment…</DialogTitle>
              <DialogDescription className="mt-1">Bay {slot.id} stays locked for you.</DialogDescription>
            </motion.div>
          )}

          {step === "success" && booking && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
              <motion.svg viewBox="0 0 52 52" className="mx-auto size-16" initial="hidden" animate="visible">
                <motion.circle cx="26" cy="26" r="24" fill="hsl(var(--status-available))" variants={{ hidden: { scale: 0 }, visible: { scale: 1 } }} transition={{ type: "spring", stiffness: 300, damping: 18 }} />
                <motion.path d="M15 27l7 7 15-15" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" variants={{ hidden: { pathLength: 0 }, visible: { pathLength: 1 } }} transition={{ delay: 0.25, duration: 0.45 }} />
              </motion.svg>
              <DialogTitle className="mt-3 text-xl">You&apos;re booked</DialogTitle>
              <DialogDescription className="mt-1">Bay {booking.slotId} at {lot.name} is yours.</DialogDescription>

              <div className="relative mt-5 rounded-xl border bg-secondary/30 p-4 text-left">
                <span className="absolute -left-2 top-1/2 size-4 -translate-y-1/2 rounded-full bg-card" aria-hidden />
                <span className="absolute -right-2 top-1/2 size-4 -translate-y-1/2 rounded-full bg-card" aria-hidden />
                <Row label="Booking ID" value={<span className="font-display font-bold">{booking.id}</span>} />
                <Row label={booking.mode === "timed" ? "Time slot" : "Arrive by"} value={booking.mode === "timed" ? booking.windowLabel : formatDateTime(booking.startTime)} />
                <Row label="Cover charge paid" value={`${formatINR(booking.amount)} via ${METHOD_LABEL[booking.paymentMethod]}`} />
                <Row label="Balance at exit (est.)" value={formatINR(Math.max(0, quote.estimate - quote.coverCharge))} />
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                  The gate opens when the camera reads <Plate value={booking.vehicleNumber} className="mx-1 align-middle" /> and your FASTag is debited for the rest.
                </p>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Button asChild>
                  <a href={googleMapsDirectionsUrl(lot)} target="_blank" rel="noopener noreferrer"><Navigation /> Navigate</a>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/user/bookings">My bookings</Link>
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
