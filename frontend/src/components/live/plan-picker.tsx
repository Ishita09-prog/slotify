"use client";

import { CalendarRange } from "lucide-react";
import { Input } from "@/components/ui/input";
import { isoToKey, keyToIso, PLAN_PRICING, quotePlan, type PlanQuote, type PlanType } from "@/lib/live/plans";
import { fmtDate } from "@/lib/live/time";
import type { LiveLot } from "@/lib/live/types";
import { cn, formatINR } from "@/lib/utils";

/** Duration chips + start date for a weekly / monthly plan. Prices come from PLAN_PRICING (lib/live/plans.ts). */
export function PlanPicker({
  lot, type, units, onUnits, startKey, onStart, minKey, maxKey,
}: {
  lot: LiveLot;
  type: PlanType;
  units: number;
  onUnits: (n: number) => void;
  startKey: string;
  onStart: (k: string) => void;
  minKey: string;
  maxKey: string;
}) {
  const cfg = PLAN_PRICING[type];
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">How long?</p>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Plan duration">
          {cfg.options.map((n) => {
            let q: PlanQuote | null = null;
            try { q = quotePlan(lot, { type, units: n, startKey }); } catch { /* bad date shows its own error */ }
            const on = units === n;
            return (
              <button key={n} role="radio" aria-checked={on} onClick={() => onUnits(n)} className={cn("rounded-xl border px-2 py-2 text-sm font-semibold tabular-nums transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary/60")}>
                {n} {cfg.unit}{n > 1 ? "s" : ""}
                <span className={cn("block text-[10px] font-medium", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {q ? `${formatINR(q.total)}${q.discountPct ? ` · ${q.discountPct}% off` : ""}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><CalendarRange className="size-4" /> Start date</p>
        <Input type="date" aria-label="Start date" value={keyToIso(startKey)} min={keyToIso(minKey)} max={keyToIso(maxKey)} onChange={(e) => e.target.value && onStart(isoToKey(e.target.value))} />
      </div>
    </div>
  );
}

function Line({ l, v, strong }: { l: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "mt-1 border-t pt-2 font-display text-base font-extrabold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{l}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}

/** Start, end, duration, rate, discount and final amount. The pass ends at 12:00 AM on the end date. */
export function PlanBreakdown({ q, payLabel = "Total" }: { q: PlanQuote; payLabel?: string }) {
  return (
    <>
      <Line l="Plan" v={`${q.type === "weekly" ? "Weekly" : "Monthly"} · ${q.durationLabel}`} />
      <Line l="Start" v={fmtDate(q.startAt)} />
      <Line l="Ends" v={`${fmtDate(q.endAt)}, 12:00 AM`} />
      <Line l={q.type === "weekly" ? "Weekly rate" : "Monthly rate"} v={`${formatINR(q.rate)}/${PLAN_PRICING[q.type].unit}`} />
      {q.discountPct > 0 && <Line l={`Discount ${q.discountPct}%`} v={`−${formatINR(q.discount)}`} />}
      <Line l={payLabel} v={formatINR(q.total)} strong />
    </>
  );
}
