"use client";

import { CalendarClock, Infinity as InfinityIcon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { windowHours } from "@/lib/live/time";
import type { TimeWindow } from "@/lib/live/types";
import { cn, formatINR } from "@/lib/utils";

export const DEFAULT_WINDOWS: TimeWindow[] = [
  { id: "w1", start: "10:00", end: "13:00" },
  { id: "w2", start: "13:00", end: "16:00" },
  { id: "w3", start: "16:00", end: "19:00" },
  { id: "w4", start: "19:00", end: "22:00" },
];

export function ModesPicker({ allowTimed, allowOpen, onChange }: { allowTimed: boolean; allowOpen: boolean; onChange: (v: { allowTimed: boolean; allowOpen: boolean }) => void }) {
  const opts = [
    { key: "timed" as const, on: allowTimed, icon: CalendarClock, title: "With time slots", sub: "You set slots like 10–1, 1–4. Drivers book one slot." },
    { key: "open" as const, on: allowOpen, icon: InfinityIcon, title: "No time limit", sub: "Drivers park as long as they want, pay for time used." },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {opts.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            role="checkbox"
            aria-checked={o.on}
            onClick={() => {
              const next = { allowTimed, allowOpen, [o.key === "timed" ? "allowTimed" : "allowOpen"]: !o.on };
              if (next.allowTimed || next.allowOpen) onChange(next);
            }}
            className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors", o.on ? "border-primary bg-primary/10" : "hover:bg-secondary/50")}
          >
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", o.on ? "bg-primary text-white" : "bg-secondary")}><Icon className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="block text-xs text-muted-foreground">{o.sub}</span>
            </span>
            <span className={cn("mt-1 grid size-5 place-items-center rounded-md border-2 text-[10px] font-bold", o.on ? "border-primary bg-primary text-white" : "border-border")}>{o.on && "✓"}</span>
          </button>
        );
      })}
    </div>
  );
}

export function WindowsEditor({ windows, onChange, pricePerHour }: { windows: TimeWindow[]; onChange: (w: TimeWindow[]) => void; pricePerHour: number }) {
  const upd = (id: string, patch: Partial<TimeWindow>) => onChange(windows.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  return (
    <div className="space-y-2">
      {windows.map((w, i) => (
        <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-2">
          <span className="w-12 text-xs font-semibold text-muted-foreground">Slot {i + 1}</span>
          <input type="time" step={1800} value={w.start} onChange={(e) => upd(w.id, { start: e.target.value })} className="h-9 rounded-lg border bg-background px-2 text-sm tabular-nums" aria-label={`Slot ${i + 1} start`} />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="time" step={1800} value={w.end} onChange={(e) => upd(w.id, { end: e.target.value })} className="h-9 rounded-lg border bg-background px-2 text-sm tabular-nums" aria-label={`Slot ${i + 1} end`} />
          <span className="text-xs text-muted-foreground">{windowHours(w)} h · {formatINR(windowHours(w) * pricePerHour)}</span>
          <button type="button" onClick={() => onChange(windows.filter((x) => x.id !== w.id))} className="ml-auto grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary" aria-label="Remove slot">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const last = windows.at(-1)?.end ?? "09:00";
          const h = Math.min(23, Number(last.slice(0, 2)) + 3);
          onChange([...windows, { id: `w${Date.now().toString(36)}`, start: last, end: `${String(h).padStart(2, "0")}:00` }]);
        }}
      >
        <Plus /> Add time slot
      </Button>
    </div>
  );
}
