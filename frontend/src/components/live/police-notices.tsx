"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCity } from "@/lib/city";
import { useLive, useTick } from "@/lib/live/provider";
import { escalateToChallan, issueNotice } from "@/lib/live/service";
import { fmtTime } from "@/lib/live/time";
import type { Account, PoliceNotice } from "@/lib/live/types";
import { cn, formatINR, isValidPlate, normalizePlate } from "@/lib/utils";

const VIOLATIONS: [string, number][] = [
  ["No-parking zone", 500],
  ["Double parking", 1000],
  ["Blocking driveway", 750],
  ["Bus stop obstruction", 1000],
  ["Parked on footpath", 500],
  ["Overstay in paid bay", 300],
];

const STATUS: Record<PoliceNotice["status"], { label: string; cls: string }> = {
  sent: { label: "Delivered", cls: "bg-status-reserved/15 text-status-reserved" },
  seen: { label: "Seen by driver", cls: "bg-primary/15 text-primary" },
  moved: { label: "Vehicle moved", cls: "bg-status-available/15 text-status-available" },
  paid: { label: "Fine paid", cls: "bg-status-available/15 text-status-available" },
};

/** Police: send a notice to any plate. If the plate belongs to a Slotify driver, it pops up in their app live. */
export function PoliceNotices() {
  const live = useLive();
  const { city } = useCity();
  const now = useTick(5000);
  const [drivers, setDrivers] = useState<Account[]>([]);
  const [notices, setNotices] = useState<PoliceNotice[]>([]);
  const [plate, setPlate] = useState("");
  const [vio, setVio] = useState(0);
  const places = useMemo(() => city.commandZones.flatMap((z) => z.localities.map((l) => `${l.name}, ${z.name}`)), [city]);
  const [place, setPlace] = useState(places[0] ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!live.store) return;
    const a = live.store.watch<Account>("accounts", ["role", "driver"], setDrivers);
    const b = live.store.watch<PoliceNotice>("notices", null, (l) => setNotices(l.sort((x, y) => y.createdAt - x.createdAt)));
    return () => {
      a();
      b();
    };
  }, [live.store]);

  const known = drivers.flatMap((d) => (d.vehicles ?? []).map((v) => ({ plate: v.number, name: d.name })));
  const match = known.find((k) => k.plate === plate);

  const send = async () => {
    if (!live.store) return;
    setBusy(true);
    try {
      const [violation, fine] = VIOLATIONS[vio];
      const n = await issueNotice(live.store, { plate, violation, location: place, fine, issuedBy: city.police });
      toast.success(n.driverName ? `Notice delivered to ${n.driverName}'s Slotify app` : `SMS queued to registered owner (VAHAN lookup)`);
      setPlate("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><BellRing className="size-5 text-primary" /> Live notices to drivers</h2>
        <p className="text-xs text-muted-foreground">Slotify drivers get it in the app instantly · others by SMS to the registered owner (VAHAN)</p>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-[1.2fr_1fr_1.3fr_auto]">
        <div>
          <Input list="slotify-plates" placeholder="Vehicle number, e.g. TN09AB1234" value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value).slice(0, 12))} className="font-display font-bold tracking-wider" aria-label="Vehicle number" />
          <datalist id="slotify-plates">{known.map((k) => <option key={k.plate} value={k.plate}>{k.name}</option>)}</datalist>
          <p className={cn("mt-1 text-[11px]", match ? "text-status-available" : "text-muted-foreground")}>
            {match ? `✓ Slotify driver: ${match.name}, will get an in-app alert` : plate ? "Not on Slotify, SMS to registered owner" : `${known.length} Slotify vehicles registered`}
          </p>
        </div>
        <Select aria-label="Violation" value={vio} onChange={(e) => setVio(Number(e.target.value))}>
          {VIOLATIONS.map(([v, f], i) => <option key={v} value={i}>{v} · ₹{f}</option>)}
        </Select>
        <Select aria-label="Location" value={place} onChange={(e) => setPlace(e.target.value)}>
          {places.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Button onClick={send} disabled={!isValidPlate(plate) || busy}><Send /> Send notice</Button>
      </div>

      {notices.length > 0 && (
        <ul className="mt-4 divide-y">
          {notices.slice(0, 8).map((n) => {
            const left = n.dueAt - now;
            return (
              <li key={n.id} className="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="mr-2 rounded border-2 border-foreground/70 bg-white px-1.5 font-display text-xs font-extrabold tracking-wider text-slate-900">{n.plate}</span>
                    {n.kind === "challan" ? "e-Challan" : "Notice"} · {n.violation}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {n.location} · {fmtTime(n.createdAt)} · {formatINR(n.fine)} ·{" "}
                    {n.driverName ? <span className="inline-flex items-center gap-1"><Smartphone className="inline size-3" /> {n.driverName} (Slotify app)</span> : "SMS to registered owner"}
                    {n.kind === "notice" && n.status !== "moved" && left > 0 && ` · ${Math.ceil(left / 60000)} min to move`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[n.status].cls)}>{n.kind === "challan" && n.status !== "paid" ? "Challan issued" : STATUS[n.status].label}</span>
                  {n.kind === "notice" && n.status !== "moved" && n.status !== "paid" && live.store && (
                    <Button size="sm" variant="outline" onClick={() => escalateToChallan(live.store!, n).then(() => toast.success("e-Challan issued"))}>Issue e-challan</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
