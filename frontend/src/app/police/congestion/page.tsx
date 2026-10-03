"use client";

import { useEffect, useMemo, useState } from "react";
import { Car, Clock, Flame, Gauge } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ZonesMap } from "@/components/map";
import { CongestionHourlyChart, ZoneOccupancyChart } from "@/components/charts/charts";
import { StatCard } from "@/components/parking/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cityZones } from "@/lib/mock-data";
import { useCity } from "@/lib/city";
import { hourLabel, typicalOccupancy } from "@/lib/predict";
import type { DemandLevel, Zone } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVELS: { key: DemandLevel; title: string; note: string; ring: string; dot: string }[] = [
  { key: "high", title: "High demand", note: "Over 80% full — divert drivers and enforce strictly", ring: "border-status-occupied/50", dot: "bg-status-occupied" },
  { key: "medium", title: "Medium demand", note: "60–80% full — watch during peaks", ring: "border-status-reserved/50", dot: "bg-status-reserved" },
  { key: "low", title: "Low demand", note: "Under 60% full — suggest these to drivers", ring: "border-status-available/50", dot: "bg-status-available" },
];

export default function CongestionPage() {
  const { city } = useCity();
  const [zones, setZones] = useState<Zone[]>(() => cityZones(city));
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => { setZones(cityZones(city)); void api.zones(city).then(setZones); }, [city]);

  const hourly = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) => {
        const c = (typicalOccupancy("commercial", h, 3) + typicalOccupancy("transit", h, 3)) / 2;
        return { hour: hourLabel(h), index: Math.round(c * 100), searching: Math.round(Math.max(0, c - 0.45) * 60) };
      }),
    []
  );

  const avgSearch = zones.reduce((a, z) => a + z.avgSearchMin, 0) / zones.length;
  const vph = zones.reduce((a, z) => a + z.vehiclesPerHour, 0);
  const worst = [...zones].sort((a, b) => b.congestionIndex - a.congestionIndex)[0];

  return (
    <>
      <PageHeader title="Traffic congestion analytics" description="Parking demand by zone, from lot sensors and ANPR vehicle counts. Circling for parking causes up to a third of downtown traffic." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Most congested" value={<span className="block text-xl leading-tight sm:text-2xl">{worst.name}</span>} icon={Flame} tone="occupied" sub={`Congestion index ${worst.congestionIndex}/100`} />
        <StatCard label="High-demand zones" value={zones.filter((z) => z.demand === "high").length} icon={Gauge} tone="reserved" sub={`of ${zones.length} monitored`} />
        <StatCard label="Avg. time to find parking" value={`${avgSearch.toFixed(1)} min`} icon={Clock} tone="primary" />
        <StatCard label="Vehicles per hour" value={vph.toLocaleString("en-IN")} icon={Car} tone="accent" sub="Across all zones" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {LEVELS.map((lvl) => {
          const list = zones.filter((z) => z.demand === lvl.key);
          return (
            <Card key={lvl.key} className={cn("border-t-4", lvl.ring)}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-lg">
                  <span className={cn("size-2.5 rounded-full", lvl.dot)} /> {lvl.title}
                  <span className="ml-auto text-sm font-normal text-muted-foreground">{list.length} zones</span>
                </CardTitle>
                <CardDescription>{lvl.note}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {list.map((z) => (
                  <button
                    key={z.id}
                    onMouseEnter={() => setActiveId(z.id)}
                    onMouseLeave={() => setActiveId(null)}
                    onFocus={() => setActiveId(z.id)}
                    onBlur={() => setActiveId(null)}
                    className="flex w-full items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-left text-sm hover:bg-secondary/70"
                  >
                    <span>
                      <span className="block font-semibold">{z.name}</span>
                      <span className="text-xs text-muted-foreground">{z.vehiclesPerHour.toLocaleString("en-IN")} veh/h · {z.avgSearchMin} min search</span>
                    </span>
                    <span className="font-display text-lg font-extrabold tabular-nums">{Math.round(z.occupancy * 100)}%</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="glass h-[420px] overflow-hidden rounded-2xl p-1.5">
          <ZonesMap zones={zones} activeId={activeId} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Parking occupancy by zone</CardTitle>
          </CardHeader>
          <CardContent><ZoneOccupancyChart zones={zones} /></CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Congestion through the day</CardTitle>
            <CardDescription>City-wide congestion index and the share of cars circling for parking, typical weekday</CardDescription>
          </CardHeader>
          <CardContent><CongestionHourlyChart data={hourly} /></CardContent>
        </Card>
      </div>
    </>
  );
}
