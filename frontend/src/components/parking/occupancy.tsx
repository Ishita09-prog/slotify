import { cn } from "@/lib/utils";

export function occupancyTone(o: number) {
  if (o >= 0.85) return { bar: "bg-status-occupied", text: "text-status-occupied", label: "Almost full" };
  if (o >= 0.6) return { bar: "bg-status-reserved", text: "text-[hsl(40_90%_35%)] dark:text-status-reserved", label: "Filling up" };
  return { bar: "bg-status-available", text: "text-status-available", label: "Plenty free" };
}

export function OccupancyBar({ value, className }: { value: number; className?: string }) {
  const tone = occupancyTone(value);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
        role="meter"
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Occupancy"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-700", tone.bar)} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className={cn("w-10 text-right text-xs font-bold tabular-nums", tone.text)}>{Math.round(value * 100)}%</span>
    </div>
  );
}
