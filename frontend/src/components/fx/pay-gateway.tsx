"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import type { PayMethod } from "@/lib/live/types";
import { cn, formatINR } from "@/lib/utils";

/** Simulated payment gateway ("Slotify Pay · sandbox"): staged authorisation, then success. No real money moves. */
export const GATEWAY_MS = 2600;

const STAGES: Record<PayMethod, string[]> = {
  fastag: ["Securing connection", "Contacting your FASTag issuer bank via NPCI", "Debit authorised"],
  upi: ["Securing connection", "Collect request sent · approve in your UPI app", "UPI payment authorised"],
  qr: ["Securing connection", "Matching your QR payment", "Payment received"],
  card: ["Securing connection", "3-D Secure check with your card bank", "Card payment authorised"],
};

export function PayGateway({ amount, method }: { amount: number; method: PayMethod }) {
  const [i, setI] = useState(0);
  const stages = STAGES[method] ?? STAGES.fastag;
  useEffect(() => {
    const t1 = window.setTimeout(() => setI(1), 700);
    const t2 = window.setTimeout(() => setI(2), 1900);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"><ShieldCheck className="size-3.5 text-status-available" /> Slotify Pay · sandbox</p>
      <p className="mt-3 font-display text-4xl font-extrabold tabular-nums">{formatINR(amount)}</p>
      <div className="relative mt-5 grid size-16 place-items-center">
        <motion.span className="absolute inset-0 rounded-full border-2 border-primary/30" animate={{ scale: [1, 1.35], opacity: [0.8, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />
        {i < 2 ? <Loader2 className="size-9 animate-spin text-primary" /> : (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid size-14 place-items-center rounded-full bg-status-available text-white"><Check className="size-8" /></motion.span>
        )}
      </div>
      <ol className="mt-5 w-full max-w-xs space-y-2 text-left text-sm">
        {stages.map((s, k) => (
          <li key={s} className={cn("flex items-center gap-2 transition-opacity", k > i && "opacity-30")}>
            <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[10px]", k < i || (k === 2 && i === 2) ? "bg-status-available text-white" : k === i ? "bg-primary/20 text-primary" : "bg-secondary")}>
              {k < i || (k === 2 && i === 2) ? <Check className="size-3" /> : k + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] text-muted-foreground">Demo gateway. In production this step is the bank / NPCI authorisation.</p>
    </div>
  );
}
