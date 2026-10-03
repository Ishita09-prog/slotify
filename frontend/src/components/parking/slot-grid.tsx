"use client";

import { Fragment, useMemo } from "react";
import { motion } from "framer-motion";
import { Accessibility, ArrowUp, Bike, ChevronsLeft, ChevronsRight, Zap } from "lucide-react";
import type { Slot } from "@/lib/types";
import { useNow } from "@/lib/store";
import { cn } from "@/lib/utils";

type Mode = "book" | "manage" | "monitor";

const statusClass: Record<Slot["status"], string> = {
  available: "bg-status-available/85 text-white",
  reserved: "bg-status-reserved text-slate-900",
  occupied: "bg-status-occupied/85 text-white",
  maintenance: "bay-hatch text-white/90",
};

const statusLabel: Record<Slot["status"], string> = {
  available: "available",
  reserved: "reserved",
  occupied: "occupied",
  maintenance: "under maintenance",
};

function Bay({
  slot, selected, disabled, flash, facing, onClick,
}: {
  slot: Slot;
  selected: boolean;
  disabled: boolean;
  flash: boolean;
  facing: "down" | "up";
  onClick?: () => void;
}) {
  const mine = slot.heldBy === "me";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Slot ${slot.id}, ${selected ? "selected" : statusLabel[slot.status]}${slot.type !== "standard" ? `, ${slot.type}` : ""}`}
      title={`${slot.id} · ${selected ? "Selected" : statusLabel[slot.status]}${slot.vehicleNumber ? ` · ${slot.vehicleNumber}` : ""}`}
      animate={{ scale: selected ? 1.07 : 1 }}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      transition={{ type: "spring", stiffness: 520, damping: 28 }}
      className={cn(
        "relative flex h-14 w-11 shrink-0 flex-col items-center justify-center gap-0.5 text-[11px] font-bold sm:h-16 sm:w-12",
        facing === "down" ? "rounded-b-md" : "rounded-t-md",
        selected ? "z-10 bg-status-selected text-white shadow-[0_0_0_2px_#fff,0_8px_24px_-6px_hsl(var(--status-selected))]" : statusClass[slot.status],
        !disabled && !selected && "hover:brightness-110",
        disabled && "cursor-not-allowed",
        flash && "animate-pulse"
      )}
    >
      {slot.type === "ev" && <Zap className="size-3" aria-hidden />}
      {slot.type === "accessible" && <Accessibility className="size-3" aria-hidden />}
      {slot.type === "bike" && <Bike className="size-3" aria-hidden />}
      <span className="font-display" style={{ fontVariationSettings: '"wdth" 85' }}>{slot.id}</span>
      {mine && <span className="absolute -top-2 rounded bg-foreground px-1 text-[9px] leading-3 text-background">You</span>}
    </motion.button>
  );
}

function Lane({ label }: { label: string }) {
  return (
    <div className="relative my-1 flex h-9 items-center" aria-hidden>
      <div className="lane-line h-[3px] w-full animate-lane-flow opacity-80" />
      <span className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[hsl(var(--asphalt))] px-2 text-[10px] font-semibold text-white/60">
        <ChevronsLeft className="size-3" /> {label} <ChevronsRight className="size-3" />
      </span>
    </div>
  );
}

export function SlotGrid({
  slots, mode, selectedIds = [], onSlotClick, className,
}: {
  slots: Slot[];
  mode: Mode;
  selectedIds?: string[];
  onSlotClick?: (slot: Slot) => void;
  className?: string;
}) {
  const now = useNow(1000);
  const rows = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      if (!map.has(s.row)) map.set(s.row, []);
      map.get(s.row)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([row, list]) => ({ row, list: list.sort((a, b) => a.col - b.col) }));
  }, [slots]);

  // Rows face each other in pairs across a driving lane: A|B, C|D, …
  const pairs: { row: string; list: Slot[] }[][] = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2));

  const selected = new Set(selectedIds);

  if (!slots.length) {
    return (
      <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        This lot has no slots yet. Add a row from Manage slots to start taking bookings.
      </div>
    );
  }

  return (
    <div className={cn("overflow-x-auto rounded-2xl bg-[hsl(var(--asphalt))] p-4 shadow-inner ring-1 ring-black/20", className)}>
      <div className="mx-auto w-max min-w-full">
        {pairs.map((pair, pi) => (
          <Fragment key={pair[0].row}>
            {pi > 0 && <div className="my-3 h-2 rounded-full bg-white/[0.06]" aria-hidden />}
            {pair.map(({ row, list }, ri) => (
              <Fragment key={row}>
                {ri === 1 && <Lane label="Lane" />}
                <div className="flex items-stretch justify-center gap-2">
                  <span className="flex w-5 items-center justify-center font-display text-sm font-bold text-white/50">{row}</span>
                  <div
                    className={cn(
                      "flex divide-x-2 divide-white/70 border-white/70",
                      ri === 0 ? "border-t-2" : "border-b-2"
                    )}
                  >
                    {list.map((slot) => {
                      const isSel = selected.has(slot.id);
                      const disabled =
                        mode === "monitor" ||
                        (mode === "book" && slot.status !== "available" && !isSel);
                      const flash = mode !== "book" && now !== null && slot.updatedAt > 0 && now - slot.updatedAt < 2500;
                      return (
                        <div key={slot.id} className="px-[3px] py-1">
                          <Bay
                            slot={slot}
                            selected={isSel}
                            disabled={disabled}
                            flash={flash}
                            facing={ri === 0 ? "down" : "up"}
                            onClick={disabled ? undefined : () => onSlotClick?.(slot)}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <span className="flex w-5 items-center justify-center font-display text-sm font-bold text-white/50">{row}</span>
                </div>
                {pair.length === 1 && <Lane label="Lane" />}
              </Fragment>
            ))}
          </Fragment>
        ))}
        <div className="mt-5 flex flex-col items-center gap-1 text-white/70">
          <ArrowUp className="size-4" aria-hidden />
          <div className="h-1.5 w-2/3 max-w-sm rounded-full bg-accent/80" />
          <span className="text-[11px] font-semibold">Entry gate · FASTag reader</span>
        </div>
      </div>
    </div>
  );
}

export function SlotLegend({ includeMaintenance = false, className }: { includeMaintenance?: boolean; className?: string }) {
  const items = [
    { label: "Available", cls: "bg-status-available" },
    { label: "Reserved", cls: "bg-status-reserved" },
    { label: "Occupied", cls: "bg-status-occupied" },
    { label: "Selected", cls: "bg-status-selected" },
    ...(includeMaintenance ? [{ label: "Maintenance", cls: "bay-hatch" }] : []),
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-muted-foreground", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn("size-3.5 rounded-[4px]", i.cls)} aria-hidden />
          {i.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5"><Zap className="size-3.5" aria-hidden /> EV</li>
      <li className="flex items-center gap-1.5"><Accessibility className="size-3.5" aria-hidden /> Accessible</li>
    </ul>
  );
}
