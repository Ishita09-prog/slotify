"use client";

import { CalendarRange, Clock, Sun } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DAILY_HOURS, dailyEnd, dailyLabel, isoToKey, keyToIso, PLAN_PRICING, quotePlan, type DailyWindow, type PlanQuote, type PlanType } from "@/lib/live/plans";
import { fmtDate } from "@/lib/live/time";
import type { LiveLot } from "@/lib/live/types";
import { cn, formatINR } from "@/lib/utils";

/** Duration chips + start date for a weekly / monthly plan. Prices come from PLAN_PRICING (lib/live/plans.ts). */
export function PlanPicker({
  lot, type, units, onUnits, startKey, onStart, minKey, maxKey, daily, onDaily,
}: {
  daily: DailyWindow | null;
  onDaily: (d: DailyWindow | null) => void;
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
  const d = daily ?? { start: "09:00", hours: 10 };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Coverage</p>
        <div className="grid grid-cols-2 gap-1 rounded-xl border p-1" role="radiogroup" aria-label="Plan coverage">
          {([[false, "Whole day", Sun, "24 h, any time"], [true, "Time-limited", Clock, "Fixed hours, cheaper"]] as const).map(([lim, t, Icon, sub]) => (
            <button key={t} role="radio" aria-checked={!!daily === lim} onClick={() => onDaily(lim ? d : null)} className={cn("rounded-lg py-1.5 text-sm font-semibold", !!daily === lim ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              <span className="flex items-center justify-center gap-1.5"><Icon className="size-4" /> {t}</span>
              <span className={cn("block text-[10px] font-medium", !!daily === lim ? "text-primary-foreground/80" : "text-muted-foreground")}>{sub}</span>
            </button>
          ))}
        </div>
        {daily && (
          <div className="space-y-2 rounded-xl border p-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 text-muted-foreground">From</span>
              <select aria-label="Daily start time" value={daily.start} onChange={(e) => onDaily({ ...daily, start: e.target.value })} className="flex-1 rounded-lg border bg-background px-2 py-1.5 text-sm font-semibold text-foreground">
                {Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`).map((t) => <option key={t} value={t} className="bg-background text-foreground">{t}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 text-muted-foreground">Hours/day</span>
              <div className="grid flex-1 grid-cols-6 gap-1">
                {DAILY_HOURS.map((h) => (
                  <button key={h} onClick={() => onDaily({ ...daily, hours: h })} className={cn("rounded-md border py-1 text-xs font-semibold tabular-nums", daily.hours === h ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>{h}</button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Your bay every day {daily.start}–{dailyEnd(daily)}. Outside these hours it&apos;s rented to other drivers, which is why it costs less.</p>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">How long?</p>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Plan duration">
          {cfg.options.map((n) => {
            let q: PlanQuote | null = null;
            try { q = quotePlan(lot, { type, units: n, startKey, daily }); } catch { /* bad date shows its own error */ }
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
      <Line l="Coverage" v={dailyLabel(q.daily)} />
      <Line l="Start" v={fmtDate(q.startAt)} />
      <Line l="Ends" v={`${fmtDate(q.endAt)}, 12:00 AM`} />
      <Line l={q.type === "weekly" ? "Weekly rate" : "Monthly rate"} v={q.daily ? <><s className="mr-1 text-muted-foreground">{formatINR(q.fullRate)}</s>{formatINR(q.rate)}/{PLAN_PRICING[q.type].unit}</> : `${formatINR(q.rate)}/${PLAN_PRICING[q.type].unit}`} />
      {q.discountPct > 0 && <Line l={`Discount ${q.discountPct}%`} v={`−${formatINR(q.discount)}`} />}
      <Line l={payLabel} v={formatINR(q.total)} strong />
    </>
  );
}
