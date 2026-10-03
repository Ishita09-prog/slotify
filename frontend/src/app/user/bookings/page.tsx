"use client";

import Link from "next/link";
import { CalendarX2, Navigation, Ticket } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLive, useTick } from "@/lib/live/provider";
import { useEffect } from "react";
import { cancelBooking, exitQuote, gateEntry, gateExit, LowBalance, sweepNoShows } from "@/lib/live/service";
import { PUBLIC_OWNER, useDriverLots } from "@/lib/live/public";
import type { PayMethod } from "@/lib/live/types";
import { fmtDateTime, fmtDur, fmtTime } from "@/lib/live/time";
import type { BookingStatus } from "@/lib/live/types";
import { cn, formatINR, googleMapsDirectionsUrl } from "@/lib/utils";

const LABEL: Record<BookingStatus, string> = { booked: "Upcoming", parked: "Parked now", completed: "Completed", cancelled: "Cancelled", noshow: "No-show" };
const TONE: Record<BookingStatus, string> = {
  booked: "bg-status-reserved/15 text-status-reserved",
  parked: "bg-status-occupied/15 text-status-occupied",
  completed: "bg-status-available/15 text-status-available",
  cancelled: "bg-secondary text-muted-foreground",
  noshow: "bg-secondary text-muted-foreground",
};

export default function MyBookings() {
  const live = useLive();
  const dl = useDriverLots();
  const now = useTick(1000);
  useEffect(() => {
    if (live.store && live.bookings.length) void sweepNoShows(live.store, live.bookings, now);
  }, [live.store, live.bookings, Math.floor(now / 30000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const gate = async (id: string, dir: "in" | "out", method: PayMethod = "fastag") => {
    if (!live.store) return;
    try {
      if (dir === "in") {
        const b = await gateEntry(live.store, id);
        toast.success(`Gate opened · ANPR read ${b.vehicle} → bay ${b.bayLabel}`);
      } else {
        const r = await gateExit(live.store, id, method);
        toast.success(`Gate opened · ${r.due > 0 ? `${method === "fastag" ? "FASTag" : method.toUpperCase()} charged ₹${r.due}` : "nothing more to pay"} (₹${r.booking.cover} cover adjusted)`);
      }
    } catch (e) {
      if (e instanceof LowBalance) {
        toast.warning(`FASTag balance ₹${e.balance} is too low for ₹${e.needed}. Paying by UPI instead.`);
        void gate(id, "out", "upi");
      } else toast.error((e as Error).message);
    }
  };
  const active = live.bookings.filter((b) => b.status === "booked" || b.status === "parked");
  const past = live.bookings.filter((b) => !(b.status === "booked" || b.status === "parked"));

  const cancel = async (id: string) => {
    if (!live.store) return;
    try {
      await cancelBooking(live.store, id);
      toast.success("Cancelled. The bay is free for others again. The ₹25 cover charge isn't refunded.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="My bookings" description="Your passes. The gate camera reads your plate, so there's nothing to show." />
      {live.bookings.length === 0 && (
        <Card className="p-10 text-center">
          <Ticket className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-2 font-semibold">No bookings yet</p>
          <Button asChild className="mt-3"><Link href="/user">Find parking</Link></Button>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {active.map((b) => {
          const q = b.status === "parked" ? exitQuote(b, now) : null;
          const lot = dl.lots.find((l) => l.id === b.lotId);
          const pub = b.ownerUid === PUBLIC_OWNER;
          return (
            <Card key={b.id} className="relative overflow-hidden p-5">
              <div className="absolute inset-y-0 left-0 w-1.5 bg-primary" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold">{b.lotName}</p>
                  <p className="text-xs text-muted-foreground">{b.lotArea} · {b.mode === "timed" ? `Slot ${b.windowLabel}` : "No time limit"}</p>
                </div>
                <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary font-display text-xl font-extrabold text-white">{b.bayLabel}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-md border-2 border-foreground/70 bg-white px-2 font-display font-extrabold tracking-wider text-slate-900">{b.vehicle}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[b.status])}>{LABEL[b.status]}</span>
              </div>
              {b.status === "booked" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {b.mode === "timed" ? `${fmtDateTime(b.startAt)} · arrive by ${fmtTime(b.startAt + 15 * 60_000)}` : `Arrive by ${fmtTime(b.startAt + 15 * 60_000)}`} · bay released after that
                </p>
              )}
              {q && <p className="mt-2 text-sm">Parked {fmtDur(q.ms)} · current fee {formatINR(q.fee)} · <b>{formatINR(q.due)} at exit</b> (₹{b.cover} adjusted)</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {lot && <Button asChild size="sm"><a href={googleMapsDirectionsUrl(lot)} target="_blank" rel="noopener noreferrer"><Navigation /> Navigate</a></Button>}
                {b.status === "booked" && <Button size="sm" variant="outline" onClick={() => cancel(b.id)}><CalendarX2 /> Cancel</Button>}
                {pub && b.status === "booked" && <Button size="sm" variant="secondary" onClick={() => gate(b.id, "in")}>Demo: drive in (ANPR)</Button>}
                {pub && b.status === "parked" && <Button size="sm" variant="secondary" onClick={() => gate(b.id, "out")}>Demo: drive out (FASTag)</Button>}
              </div>
            </Card>
          );
        })}
      </div>
      {past.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 font-display text-lg font-bold">History</h2>
          <Card className="divide-y">
            {past.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{b.lotName} · {b.bayLabel}</p>
                  <p className="text-xs text-muted-foreground">{b.vehicle} · {fmtDateTime(b.createdAt)}{b.fee ? ` · fee ${formatINR(b.fee)}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatINR(b.cover + (b.paidAtExit ?? 0))}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[b.status])}>{LABEL[b.status]}</span>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
