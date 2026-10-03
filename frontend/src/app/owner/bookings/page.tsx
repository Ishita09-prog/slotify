"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Card } from "@/components/ui/card";
import { useLive } from "@/lib/live/provider";
import { bookingTypeOf, dailyLabel, planStatus } from "@/lib/live/plans";
import { fmtDate, fmtDateTime } from "@/lib/live/time";
import type { BookingStatus } from "@/lib/live/types";
import { cn, formatINR } from "@/lib/utils";

const TONE: Record<BookingStatus, string> = {
  booked: "bg-status-reserved/15 text-status-reserved",
  parked: "bg-status-occupied/15 text-status-occupied",
  completed: "bg-status-available/15 text-status-available",
  cancelled: "bg-secondary text-muted-foreground",
  noshow: "bg-secondary text-muted-foreground",
};

export default function OwnerBookings() {
  const live = useLive();
  const [f, setF] = useState<"all" | "active" | "done">("active");
  // an expired weekly/monthly plan is finished even though its stored status stays "booked"
  const isLive = (b: (typeof live.bookings)[number]) => (b.status === "booked" || b.status === "parked") && !(b.mode === "plan" && planStatus(b, Date.now()) === "expired");
  const list = live.bookings.filter((b) => (f === "all" ? true : f === "active" ? isLive(b) : !isLive(b)));
  const earned = live.bookings.reduce((a, b) => a + b.cover - (b.refunded ?? 0) + (b.paidAtExit ?? 0), 0);
  return (
    <>
      <PageHeader title="Bookings" description={`All bookings at your locations · ${formatINR(earned)} collected (cover charges + exit fees).`} />
      <div className="mb-3 inline-flex rounded-xl border p-1 text-sm font-semibold">
        {(["active", "done", "all"] as const).map((k) => (
          <button key={k} onClick={() => setF(k)} className={cn("rounded-lg px-3 py-1.5 capitalize", f === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{k === "done" ? "Finished" : k}</button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>{["Booking", "Vehicle", "Bay", "Time", "Status", "Paid"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {list.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No bookings here yet.</td></tr>}
            {list.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3"><p className="font-mono text-xs">{b.id}</p><p className="text-xs text-muted-foreground">{b.driverName}</p></td>
                <td className="px-4 py-3 font-display font-bold tracking-wider">{b.vehicle}</td>
                <td className="px-4 py-3">{b.lotName} · <b>{b.bayLabel}</b></td>
                <td className="px-4 py-3 text-xs">{b.mode === "plan" ? `${bookingTypeOf(b) === "weekly" ? "Weekly" : "Monthly"} plan${b.planDaily ? ` · ${dailyLabel(b.planDaily)}` : " · 24 h"}` : b.mode === "timed" ? `Slot ${b.windowLabel}` : "No time limit"}<br /><span className="text-muted-foreground">{b.mode === "plan" ? `${fmtDate(b.startAt)} → ${fmtDate(b.endAt ?? b.startAt)}` : fmtDateTime(b.startAt)}</span></td>
                <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[b.status])}>{b.status === "noshow" ? "no-show" : b.mode === "plan" && b.status === "booked" ? planStatus(b, Date.now()) : b.status}</span></td>
                <td className="px-4 py-3 tabular-nums">{formatINR(b.cover - (b.refunded ?? 0) + (b.paidAtExit ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
