import { Accessibility, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function LiveLegend({ className, owner }: { className?: string; owner?: boolean }) {
  const items = [
    { c: "bg-status-available", l: "Free" },
    { c: "bg-status-occupied", l: owner ? "Booked / parked" : "Booked" },
    { c: "bg-status-reserved", l: owner ? "Driver paying now" : "Someone is booking" },
    ...(owner ? [] : [{ c: "bg-status-selected", l: "Your pick" }]),
    { c: "bay-hatch", l: "Closed" },
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <span key={i.l} className="inline-flex items-center gap-1.5"><span className={cn("size-3 rounded-sm", i.c)} />{i.l}</span>
      ))}
      <span className="inline-flex items-center gap-1"><Zap className="size-3" /> EV</span>
      <span className="inline-flex items-center gap-1"><Accessibility className="size-3" /> Accessible</span>
    </div>
  );
}
