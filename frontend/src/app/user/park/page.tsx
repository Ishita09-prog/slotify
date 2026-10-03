"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Infinity as InfinityIcon, Navigation, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { SlotGrid } from "@/components/parking/slot-grid";
import { LiveLegend } from "@/components/live/legend";
import { BookDialog } from "@/components/live/book-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { loadAllModels } from "@/lib/ml/forecast";
import { AiAvailability } from "@/components/live/ai-availability";
import { useLive, useTick } from "@/lib/live/provider";
import { isPublic, useDriverLots } from "@/lib/live/public";
import type { BookingRequest } from "@/lib/live/service";
import { bookableDays, fmtTime, windowHours, windowRange } from "@/lib/live/time";
import { bayState, lotStats, toSlot } from "@/lib/live/view";
import { COVER, VEHICLE_LABEL } from "@/lib/live/types";
import { cn, formatINR, googleMapsDirectionsUrl } from "@/lib/utils";

const ARRIVALS = [0, 10, 20, 30];

function Park() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const live = useLive();
  const dl = useDriverLots();
  const now = useTick(1000);
  const lot = dl.lots.find((l) => l.id === id);
  const bays = useMemo(() => dl.bays.filter((b) => b.lotId === id), [dl.bays, id]);
  const [mode, setMode] = useState<"timed" | "open">((params.get("mode") as "timed" | "open") ?? "open");
  const [day, setDay] = useState<string | null>(null);
  const [winId, setWinId] = useState<string | null>(null);
  const [arrive, setArrive] = useState(10);
  const [vehicleNo, setVehicleNo] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  useEffect(() => void loadAllModels().then(() => setModelReady(true)), []);
  const [target, setTarget] = useState<number>(() => Date.now() + Math.max(15, Number(params.get("in") ?? 0)) * 60_000);
  useEffect(() => {
    if (!vehicleNo && live.account?.defaultVehicle) setVehicleNo(live.account.defaultVehicle);
  }, [live.account, vehicleNo]);
  useEffect(() => {
    if (lot && mode === "open" && !lot.allowOpen) setMode("timed");
    if (lot && mode === "timed" && !lot.allowTimed) setMode("open");
  }, [lot, mode]);

  const days = bookableDays(now);
  const dayKey = day ?? days[0].key;
  const win = lot?.windows.find((w) => w.id === winId) ?? null;
  const req: BookingRequest | null = mode === "open" ? { mode: "open" } : win ? { mode: "timed", dateKey: dayKey, window: win } : null;
  const evNeed = useMemo(() => ({ ev: params.get("ev") === "1" }), [params]);
  useEffect(() => {
    if (win) setTarget(windowRange(dayKey, win).start);
  }, [win?.id, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selBay = bays.find((b) => b.label === sel);
  // If someone else takes my selected bay, tell me.
  useEffect(() => {
    if (!lot || !selBay || open || !req) return;
    const s = bayState(selBay, lot, live.uid, now, req).state;
    if (s !== "free") {
      toast.warning(`Bay ${selBay.label} was just taken by another driver.`);
      setSel(null);
    }
  }, [selBay, lot, req, open, live.uid, now]);

  if (!lot) return <Card className="p-10 text-center text-sm text-muted-foreground">{dl.lots.length ? "This location is no longer listed." : "Loading…"}</Card>;

  const vehicles = live.account?.vehicles ?? [];
  const vehicle = vehicles.find((v) => v.number === vehicleNo) ?? vehicles[0];
  const slots = bays.map((b) => {
    const st = req ? bayState(b, lot, live.uid, now, req) : bayState(b, lot, live.uid, now, null);
    const s = toSlot(b, st);
    // timed mode without a slot chosen: grid is view-only
    return !req && s.status === "available" ? { ...s, status: "available" as const } : s;
  });
  const st = lotStats(lot, bays, now, req, live.uid);
  const pickable = Boolean(req && vehicle);

  return (
    <>
      <Link href="/user" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All parking</Link>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">{lot.name}</h1>
          <p className="text-sm text-muted-foreground"><span className={cn("mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", isPublic(lot) ? "bg-status-available/15 text-status-available" : "bg-primary/15 text-primary")}>{isPublic(lot) ? "Public · GCC · AI cameras" : "Commercial"}</span>{lot.address} · {lot.openHours}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-display text-2xl font-extrabold text-status-available tabular-nums">{st.free}</p>
            <p className="text-xs text-muted-foreground">free{req?.mode === "timed" ? " in this slot" : " now"}</p>
          </div>
          <Button asChild variant="outline" size="sm"><a href={googleMapsDirectionsUrl(lot)} target="_blank" rel="noopener noreferrer"><Navigation /> Navigate</a></Button>
        </div>
      </div>

      <AiAvailability lot={lot} bays={dl.bays} now={now} target={target} onPick={setTarget} ready={modelReady} need={evNeed} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="order-2 p-4 sm:p-5 xl:order-1">
          <div className="mb-3">
            <h2 className="font-display text-lg font-bold">Pick your bay</h2>
            <p className="text-xs text-muted-foreground">{req ? "Green bays are free for your choice. Bays update live." : "Choose a time slot first."}</p>
          </div>
          <SlotGrid slots={slots} mode={pickable ? "book" : "monitor"} selectedIds={sel ? [sel] : []} onSlotClick={(s) => setSel((c) => (c === s.id ? null : s.id))} />
          <LiveLegend className="mt-4" />
        </Card>

        <div className="order-1 space-y-4 xl:order-2 xl:sticky xl:top-24 xl:self-start">
          <Card className="space-y-4 p-4">
            {lot.allowOpen && lot.allowTimed && (
              <div className="grid grid-cols-2 gap-1 rounded-xl border p-1" role="radiogroup" aria-label="Booking type">
                {([["timed", "Time slot", CalendarClock], ["open", "No time limit", InfinityIcon]] as const).map(([k, t, Icon]) => (
                  <button key={k} role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setSel(null); }} className={cn("flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold", mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                    <Icon className="size-4" /> {t}
                  </button>
                ))}
              </div>
            )}

            {mode === "timed" ? (
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  {days.map((d) => (
                    <button key={d.key} onClick={() => { setDay(d.key); setWinId(null); setSel(null); }} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", dayKey === d.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>{d.label}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Time slot">
                  {lot.windows.map((w) => {
                    const ended = windowRange(dayKey, w).end <= now;
                    const free = ended ? 0 : lotStats(lot, bays, now, { mode: "timed", dateKey: dayKey, window: w }, live.uid).free;
                    return (
                      <button key={w.id} role="radio" aria-checked={winId === w.id} disabled={ended} onClick={() => { setWinId(w.id); setSel(null); }} className={cn("rounded-xl border px-2 py-2 text-sm font-semibold tabular-nums transition-colors disabled:opacity-40", winId === w.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary/60")}>
                        {w.start} – {w.end}
                        <span className={cn("block text-[10px] font-medium", winId === w.id ? "text-primary-foreground/80" : "text-muted-foreground")}>{ended ? "Ended" : `${free} free · ${formatINR(windowHours(w) * lot.pricePerHour)}`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">When will you arrive?</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {ARRIVALS.map((m) => (
                    <button key={m} onClick={() => setArrive(m)} className={cn("rounded-lg border py-2 text-xs font-semibold", arrive === m ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>{m === 0 ? "Now" : `${m} min`}</button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Bay held until {fmtTime(now + (arrive + 15) * 60_000)}. Pay {formatINR(lot.pricePerHour)}/h for the time you stay.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between"><p className="text-sm font-semibold">Vehicle</p><Link href="/user/profile" className="text-xs font-semibold text-primary">+ Add</Link></div>
              {vehicles.length > 1 ? (
                <Select aria-label="Vehicle" value={vehicle?.number} onChange={(e) => setVehicleNo(e.target.value)}>
                  {vehicles.map((v) => <option key={v.number} value={v.number}>{v.number} · {VEHICLE_LABEL[v.type]}</option>)}
                </Select>
              ) : vehicle ? (
                <p className="rounded-lg border px-3 py-2 font-display font-bold tracking-wider">{vehicle.number} <span className="text-xs font-medium text-muted-foreground">· {VEHICLE_LABEL[vehicle.type]}</span></p>
              ) : <p className="text-sm text-muted-foreground">Add a vehicle in your profile.</p>}
              {vehicle?.type === "ev" && <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Zap className="size-3" /> Pick a bay with the ⚡ icon to charge.</p>}
            </div>

            <div className="rounded-xl bg-secondary/40 p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Bay</span><b>{sel ?? "—"}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Parking fee</span><span>{mode === "timed" && win ? formatINR(windowHours(win) * lot.pricePerHour) : `${formatINR(lot.pricePerHour)}/h`}</span></div>
              <div className="mt-1 flex justify-between border-t pt-2 font-display text-base font-extrabold"><span>Pay now</span><span>{formatINR(COVER)}</span></div>
              <p className="text-[11px] text-muted-foreground">Cover charge, adjusted at exit. Non-refundable if you don&apos;t show up.</p>
            </div>
            <Button size="lg" className="w-full" disabled={!sel || !req || !vehicle} onClick={() => setOpen(true)}>
              {!req ? "Choose a time slot" : !sel ? "Tap a green bay" : `Book bay ${sel} · ${formatINR(COVER)}`}
            </Button>
          </Card>
        </div>
      </div>

      {selBay && req && vehicle && open && (
        <BookDialog open={open} onClose={() => { setOpen(false); setSel(null); }} lot={lot} bay={selBay} req={req} vehicle={vehicle} arriveInMin={arrive} seed={isPublic(lot) ? selBay : undefined} />
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Park />
    </Suspense>
  );
}
