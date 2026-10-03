"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Plus, ScanLine, Wrench } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { SlotGrid } from "@/components/parking/slot-grid";
import { ModesPicker, WindowsEditor } from "@/components/owner/windows-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LiveLegend } from "@/components/live/legend";
import { useLive, useTick } from "@/lib/live/provider";
import { addBays, ROW_LETTERS, setBayActive, updateLot, type BookingRequest } from "@/lib/live/service";
import { bookableDays, fmtDate, fmtTime, windowRange } from "@/lib/live/time";
import { planStatus } from "@/lib/live/plans";
import { bayState, lotStats, toSlot } from "@/lib/live/view";
import type { LiveLot } from "@/lib/live/types";
import type { SlotType } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";

function LotManage() {
  const id = useSearchParams().get("id") ?? "";
  const live = useLive();
  const now = useTick(1000);
  const lot = live.lots.find((l) => l.id === id);
  const bays = useMemo(() => live.bays.filter((b) => b.lotId === id), [live.bays, id]);
  const [view, setView] = useState<string>("now"); // "now" | `${dateKey}|${windowId}`
  const [sel, setSel] = useState<string | null>(null);
  const [row, setRow] = useState("A");
  const [count, setCount] = useState(4);
  const [type, setType] = useState<SlotType>("standard");
  const [draft, setDraft] = useState<LiveLot | null>(null);
  useEffect(() => {
    if (lot && (!draft || draft.id !== lot.id)) setDraft(lot);
  }, [lot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lot || !draft) {
    return <Card className="p-10 text-center text-sm text-muted-foreground">{live.lots.length ? "Location not found." : "Loading…"}</Card>;
  }

  const req: BookingRequest | null = (() => {
    if (view === "now") return null;
    const [dateKey, wid] = view.split("|");
    const window = lot.windows.find((w) => w.id === wid);
    return window ? { mode: "timed", dateKey, window } : null;
  })();
  const slots = bays.map((b) => toSlot(b, bayState(b, lot, null, now, req), true));
  const st = lotStats(lot, bays, now, req);
  const selected = bays.find((b) => b.label === sel);
  const selState = selected ? bayState(selected, lot, null, now, req) : null;
  const rows = [...new Set(bays.map((b) => b.row))].sort();
  const nextRow = ROW_LETTERS[rows.length] ?? "Z";
  const lotBookings = live.bookings.filter((b) => b.lotId === lot.id && (b.status === "booked" || b.status === "parked") && !(b.mode === "plan" && planStatus(b, Date.now()) === "expired"));
  const dirty = JSON.stringify(draft) !== JSON.stringify(lot);

  const add = async () => {
    if (!live.store) return;
    try {
      const made = await addBays(live.store, lot, bays, row, count, type);
      toast.success(`Added ${made.length} bay${made.length > 1 ? "s" : ""} to row ${row}: ${made.map((b) => b.label).join(", ")}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const toggle = async () => {
    if (!live.store || !selected) return;
    try {
      await setBayActive(live.store, selected.id, !selected.active);
      toast.success(`${selected.label} ${selected.active ? "closed for maintenance" : "reopened"}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const save = async () => {
    if (!live.store) return;
    await updateLot(live.store, draft);
    toast.success("Published. Drivers see the new settings now.");
  };

  return (
    <>
      <Link href="/owner" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> My locations</Link>
      <PageHeader
        title={lot.name}
        description={`${lot.area} · ${lot.zone} · ${st.total} bays · ${formatINR(lot.pricePerHour)}/h`}
        actions={<Button asChild><Link href={`/owner/gate?lot=${lot.id}`}><ScanLine /> Open FASTag gate</Link></Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <span><b className="text-status-available">{st.free}</b> free</span>
              <span><b className="text-status-reserved">{st.booked + st.holding}</b> booked</span>
              <span><b className="text-status-occupied">{st.parked}</b> parked</span>
              <span className="text-muted-foreground">{st.maint} closed</span>
            </div>
            <Select aria-label="View" value={view} onChange={(e) => setView(e.target.value)} className="w-auto min-w-48">
              <option value="now">Right now</option>
              {lot.allowTimed &&
                bookableDays(now).map((d) => (
                  <optgroup key={d.key} label={d.label}>
                    {lot.windows.filter((w) => windowRange(d.key, w).end > now).map((w) => (
                      <option key={w.id} value={`${d.key}|${w.id}`}>{d.label} · {w.start}–{w.end}</option>
                    ))}
                  </optgroup>
                ))}
            </Select>
          </div>
          <SlotGrid slots={slots} mode="manage" selectedIds={sel ? [sel] : []} onSlotClick={(s) => setSel((c) => (c === s.id ? null : s.id))} />
          <LiveLegend className="mt-4" owner />
        </Card>

        <div className="space-y-4">
          {selected && selState && (
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Bay</p>
              <p className="font-display text-2xl font-extrabold">{selected.label} <span className="text-sm font-medium capitalize text-muted-foreground">{selected.type}</span></p>
              <p className="mt-1 text-sm">
                {selState.state === "free" && "Free"}
                {selState.state === "maintenance" && "Closed for maintenance"}
                {selState.state === "holding" && "A driver is paying for this bay right now"}
                {(selState.state === "booked" || selState.state === "mine") && <>Booked · <b>{selState.vehicle}</b></>}
                {selState.state === "parked" && <>Parked · <b>{selState.vehicle}</b></>}
              </p>
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={toggle}>
                {selected.active ? <><Wrench /> Close for maintenance</> : <><CheckCircle2 /> Reopen bay</>}
              </Button>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="font-display font-bold">Add more bays</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Row</Label>
                <Select value={row} onChange={(e) => setRow(e.target.value)}>
                  {rows.map((r) => <option key={r} value={r}>{r}</option>)}
                  <option value={nextRow}>{nextRow} (new)</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">How many</Label>
                <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={type} onChange={(e) => setType(e.target.value as SlotType)}>
                  <option value="standard">Standard</option>
                  <option value="ev">EV</option>
                  <option value="accessible">Accessible</option>
                </Select>
              </div>
            </div>
            <Button className="mt-3 w-full" onClick={add}><Plus /> Add {count} bay{count > 1 ? "s" : ""}</Button>
          </Card>

          <Card className="p-4">
            <h2 className="font-display font-bold">Booking rules</h2>
            <div className="mt-3"><ModesPicker allowTimed={draft.allowTimed} allowOpen={draft.allowOpen} onChange={(m) => setDraft({ ...draft, ...m, windows: m.allowTimed && !draft.windows.length ? [{ id: "w1", start: "10:00", end: "13:00" }] : draft.windows })} /></div>
            {draft.allowTimed && <div className="mt-3"><WindowsEditor windows={draft.windows} onChange={(w) => setDraft({ ...draft, windows: w })} pricePerHour={draft.pricePerHour} /></div>}
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Label className="shrink-0">Price / hour</Label>
              <input aria-label="Price per hour" inputMode="numeric" className="h-9 w-20 rounded-lg border bg-background px-2 text-sm tabular-nums" value={draft.pricePerHour} onChange={(e) => setDraft({ ...draft, pricePerHour: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </div>
            <Button className="mt-3 w-full" disabled={!dirty || (draft.allowTimed && !draft.windows.length) || draft.pricePerHour <= 0} onClick={save}>Publish changes</Button>
          </Card>

          <Card className="p-4">
            <h2 className="font-display font-bold">Active bookings</h2>
            {lotBookings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No active bookings yet.</p>
            ) : (
              <ul className="mt-2 divide-y">
                {lotBookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span><b className="font-display">{b.bayLabel}</b> · {b.vehicle}<span className="block text-xs text-muted-foreground">{b.driverName} · {b.mode === "plan" ? `${b.bookingType} plan until ${fmtDate(b.endAt ?? b.startAt)}` : b.mode === "timed" ? b.windowLabel : `no time limit, arriving ${fmtTime(b.startAt)}`}</span></span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", b.status === "parked" ? "bg-status-occupied/15 text-status-occupied" : "bg-status-reserved/15 text-status-reserved")}>{b.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LotManage />
    </Suspense>
  );
}
