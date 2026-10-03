"use client";

import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { PoliceMap } from "@/components/map";
import { Plate } from "@/components/brand/plate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { seedLegalParking } from "@/lib/mock-data";
import { useCity } from "@/lib/city";
import { useNow, useSlotify } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";

export default function PoliceMapPage() {
  const { state } = useSlotify();
  const now = useNow(10000);
  const { city } = useCity();
  const legal = useMemo(() => seedLegalParking(city), [city]);
  const [showLegal, setShowLegal] = useState(true);
  const [showIllegal, setShowIllegal] = useState(true);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null);
  const open = state.violations.filter((v) => v.status !== "resolved");

  const Toggle = ({ on, set, color, label, count }: { on: boolean; set: (v: boolean) => void; color: string; label: string; count: number }) => (
    <button
      onClick={() => set(!on)}
      aria-pressed={on}
      className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-opacity", !on && "opacity-50")}
    >
      <span className={cn("size-3 rounded-full ring-2 ring-white/80", color)} /> {label} <span className="tabular-nums text-muted-foreground">{count}</span>
    </button>
  );

  return (
    <>
      <PageHeader
        title="Map view"
        description="Green markers are vehicles parked legally in Slotify lots. Red markers are open illegal-parking cases."
        actions={
          <>
            <Toggle on={showLegal} set={setShowLegal} color="bg-status-available" label="Legal parking" count={legal.length} />
            <Toggle on={showIllegal} set={setShowIllegal} color="bg-status-occupied" label="Illegal parking" count={open.length} />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="glass h-[420px] overflow-hidden rounded-2xl p-1.5 lg:h-[calc(100dvh-11rem)]">
          <PoliceMap violations={state.violations} legal={legal} showLegal={showLegal} showIllegal={showIllegal} flyTo={flyTo} />
        </div>
        <Card className="xl:max-h-[calc(100dvh-11rem)] xl:overflow-y-auto">
          <CardHeader><CardTitle className="font-display text-lg">Open cases</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60">
              {open.slice(0, 25).map((v) => (
                <li key={v.id}>
                  <button onClick={() => setFlyTo({ lat: v.lat, lng: v.lng })} className="flex w-full items-start gap-3 py-3 text-left hover:opacity-80">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-status-occupied" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <Plate value={v.vehicleNumber} />
                        <span className="text-xs text-muted-foreground">{timeAgo(v.at, now)}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm">{v.type}</span>
                      <span className="block truncate text-xs text-muted-foreground">{v.location}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
