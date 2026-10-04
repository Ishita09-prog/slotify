"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Car, CheckCircle2, Clock, Landmark, Network, Radio, ScanLine, ShieldCheck, Smartphone, Store, XCircle } from "lucide-react";
import { PARTY_LABEL, traceFor, type NetcInfo, type Party, type TraceStep } from "@/lib/live/netc";
import type { Txn } from "@/lib/live/types";
import { cn } from "@/lib/utils";

const ICON: Record<Party, typeof Car> = {
  driver: Car,
  tag: Radio,
  gate: ScanLine,
  slotify: Store,
  acquirer: Landmark,
  netc: Network,
  issuer: Building2,
  operator: Store,
  upi: Smartphone,
  command: ShieldCheck,
};

/** The chain of parties behind every FASTag parking charge. Highlights the ones a given trace touched. */
export function EcosystemStrip({ active }: { active?: Party[] }) {
  const chain: Party[] = ["tag", "gate", "slotify", "acquirer", "netc", "issuer", "operator"];
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] font-semibold">
      {chain.map((p, i) => {
        const Icon = ICON[p];
        const on = !active || active.includes(p);
        return (
          <span key={p} className="flex items-center gap-1">
            <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5", on ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground opacity-50")}>
              <Icon className="size-3" /> {PARTY_LABEL[p]}
            </span>
            {i < chain.length - 1 && <span className="text-muted-foreground">→</span>}
          </span>
        );
      })}
    </div>
  );
}

const fmtT = (ms: number) => (ms >= 3600_000 ? "next day" : ms >= 1000 ? `+${(ms / 1000).toFixed(1)} s` : `+${ms} ms`);

/** Timeline of one transaction through the FASTag ecosystem. `play` reveals the steps one by one (used right after a gate charge). */
export function FastagTrace({ txn, bank, play = false, steps: given }: { txn?: Txn & { netc?: NetcInfo | null }; bank?: string; play?: boolean; steps?: TraceStep[] }) {
  const steps = given ?? (txn ? traceFor(txn, bank ?? "Issuer bank") : []);
  const [shown, setShown] = useState(play ? 0 : steps.length);
  useEffect(() => {
    if (!play) return;
    setShown(0);
    const i = window.setInterval(() => setShown((n) => (n >= steps.length ? (window.clearInterval(i), n) : n + 1)), 420);
    return () => window.clearInterval(i);
  }, [play, steps.length, txn?.id]);
  return (
    <div className="space-y-3">
      <EcosystemStrip active={steps.map((s) => s.party)} />
      <ol className="relative ml-3 space-y-3 border-l pl-5">
        {steps.slice(0, shown).map((s, i) => {
          const Icon = ICON[s.party];
          return (
            <motion.li key={i} initial={play ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }} className="relative">
              <span className={cn("absolute -left-[31px] top-0 grid size-5 place-items-center rounded-full ring-4 ring-card", s.state === "failed" ? "bg-status-occupied text-white" : s.state === "pending" ? "bg-status-reserved text-white" : "bg-status-available text-white")}>
                {s.state === "failed" ? <XCircle className="size-3" /> : s.state === "pending" ? <Clock className="size-3" /> : <CheckCircle2 className="size-3" />}
              </span>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{s.title}</p>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtT(s.t)}</span>
              </div>
              <p className="flex items-center gap-1 text-[11px] font-medium text-primary"><Icon className="size-3" /> {PARTY_LABEL[s.party]}</p>
              <p className="break-words text-xs text-muted-foreground">{s.detail}</p>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
