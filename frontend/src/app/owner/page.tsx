"use client";

import Link from "next/link";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Infinity as InfinityIcon, MapPin, Plus, ScanLine, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OccupancyBar } from "@/components/parking/occupancy";
import { LongTermSection } from "@/components/owner/long-term-section";
import { useLive, useTick } from "@/lib/live/provider";
import { sweepNoShows } from "@/lib/live/service";
import { istDateKey } from "@/lib/live/time";
import { lotStats } from "@/lib/live/view";
import { formatINR } from "@/lib/utils";

export default function OwnerHome() {
  const live = useLive();
  const now = useTick(5000);
  const mine = live.lots.filter((l) => l.ownerUid === live.uid);
  const today = istDateKey(now);
  const todays = live.bookings.filter((b) => istDateKey(b.createdAt) === today);
  const revenue = todays.reduce((a, b) => a + (b.status === "cancelled" || b.status === "noshow" || b.status === "booked" || b.status === "parked" || b.status === "completed" ? b.cover - (b.refunded ?? 0) : 0) + (b.paidAtExit ?? 0), 0);
  const parkedNow = live.bookings.filter((b) => b.status === "parked").length;
  const upcoming = live.bookings.filter((b) => b.status === "booked" && b.mode !== "plan").length;

  // No-show protection: release bays 15 min after the booked time (cover charge is kept).
  useEffect(() => {
    if (live.store && live.bookings.length) void sweepNoShows(live.store, live.bookings, now);
  }, [live.store, live.bookings, now]);

  return (
    <>
      <PageHeader
        title={`Hi, ${live.account?.name.split(" ")[0] ?? ""}`}
        description="Your parking locations. Every change here is live for drivers instantly."
        actions={<Button asChild><Link href="/owner/new"><Plus /> Add parking location</Link></Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Locations", value: mine.length },
          { label: "Cars parked now", value: parkedNow },
          { label: "Upcoming bookings", value: upcoming },
          { label: "Collected today", value: formatINR(revenue) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      {mine.length === 0 ? (
        <Card className="grid place-items-center gap-3 p-12 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><MapPin className="size-7" /></span>
          <h2 className="text-xl font-bold">Add your first parking location</h2>
          <p className="max-w-md text-sm text-muted-foreground">Pick the spot on the map, say how many bays you have and whether drivers book time slots or park without a time limit. It goes live for drivers immediately.</p>
          <Button asChild size="lg"><Link href="/owner/new"><Plus /> Add parking location</Link></Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {mine.map((lot, i) => {
            const st = lotStats(lot, live.bays, now);
            return (
              <motion.div key={lot.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg font-bold">{lot.name}</h3>
                      <p className="truncate text-xs text-muted-foreground">{lot.area} · {lot.zone} · {formatINR(lot.pricePerHour)}/h</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {lot.allowTimed && <span title="Time slots" className="grid size-7 place-items-center rounded-lg bg-secondary"><CalendarClock className="size-3.5" /></span>}
                      {lot.allowOpen && <span title="No time limit" className="grid size-7 place-items-center rounded-lg bg-secondary"><InfinityIcon className="size-3.5" /></span>}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                    {[
                      { v: st.free, l: "free", c: "text-status-available" },
                      { v: st.booked + st.holding, l: "booked", c: "text-status-reserved" },
                      { v: st.parked, l: "parked", c: "text-status-occupied" },
                      { v: st.total, l: "total", c: "" },
                    ].map((x) => (
                      <div key={x.l} className="rounded-lg bg-secondary/50 py-2">
                        <p className={`font-display text-xl font-extrabold tabular-nums ${x.c}`}>{x.v}</p>
                        <p className="text-[10px] text-muted-foreground">{x.l}</p>
                      </div>
                    ))}
                  </div>
                  <OccupancyBar value={st.occupancy} className="mt-3" />
                  {st.bike > 0 && <p className="mt-2 text-xs text-muted-foreground">🛵 Two-wheeler: <b className="text-status-available">{st.bikeFree}</b> of {st.bike} free</p>}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button asChild variant="outline" size="sm"><Link href={`/owner/lot?id=${lot.id}`}><Settings2 /> Manage bays</Link></Button>
                    <Button asChild size="sm"><Link href={`/owner/gate?lot=${lot.id}`}><ScanLine /> FASTag gate</Link></Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
      <LongTermSection />
    </>
  );
}
