"use client";

import { CalendarRange } from "lucide-react";
import { Card } from "@/components/ui/card";
import { bookingTypeOf, planStatus, type PlanStatus } from "@/lib/live/plans";
import { useLive, useTick } from "@/lib/live/provider";
import { fmtDate } from "@/lib/live/time";
import { cn, formatINR } from "@/lib/utils";

export const PLAN_LABEL: Record<PlanStatus, string> = { active: "Active", upcoming: "Upcoming", expired: "Expired", cancelled: "Cancelled" };

export const PLAN_TONE: Record<PlanStatus, string> = {
  active: "bg-status-available/15 text-status-available",
  upcoming: "bg-status-reserved/15 text-status-reserved",
  expired: "bg-secondary text-muted-foreground",
  cancelled: "bg-secondary text-muted-foreground",
};

/** Owner dashboard: weekly / monthly plans across all of this owner's locations. */
export function LongTermSection() {
  const live = useLive();
  const now = useTick(30_000);
  const plans = live.bookings.filter((b) => b.mode === "plan");
  const current = plans.filter((b) => ["active", "upcoming"].includes(planStatus(b, now)));
  const weekly = current.filter((b) => bookingTypeOf(b) === "weekly").length;
  const monthly = current.filter((b) => bookingTypeOf(b) === "monthly").length;
  const revenue = plans.reduce((a, b) => a + (b.amount ?? 0) - (b.refunded ?? 0), 0);
  const reservedNow = new Set(current.filter((b) => planStatus(b, now) === "active").map((b) => b.bayId)).size;
  const stats = [
    { label: "Weekly bookings", value: weekly },
    { label: "Monthly bookings", value: monthly },
    { label: "Long-term revenue", value: formatINR(revenue) },
    { label: "Reserved slots occupied now", value: reservedNow },
  ];
  return (
    <section className="mt-8" aria-label="Long-term reservations">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><CalendarRange className="size-5" /> Long-Term Reservations</h2>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>{["Bay", "Driver", "Plan", "Dates", "Status", "Paid"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {current.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No weekly or monthly reservations yet.</td></tr>}
            {current.map((b) => {
              const st = planStatus(b, now);
              return (
                <tr key={b.id}>
                  <td className="px-4 py-3">{b.lotName} · <b>{b.bayLabel}</b></td>
                  <td className="px-4 py-3"><p>{b.driverName}</p><p className="text-xs text-muted-foreground">{b.vehicle}</p></td>
                  <td className="px-4 py-3 capitalize">{bookingTypeOf(b)} · {b.duration}</td>
                  <td className="px-4 py-3 text-xs">{fmtDate(b.startAt)} → {fmtDate(b.endAt ?? b.startAt)}</td>
                  <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", PLAN_TONE[st])}>{PLAN_LABEL[st]}</span></td>
                  <td className="px-4 py-3 tabular-nums">{formatINR(b.amount ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
