"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BrainCircuit, CalendarClock, Gauge, ParkingSquare, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { PredictionChart } from "@/components/charts/charts";
import { StatCard } from "@/components/parking/stat-card";
import { occupancyTone } from "@/components/parking/occupancy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useCity } from "@/lib/city";
import { hourLabel } from "@/lib/predict";
import { useSlotify, useLot, useNow } from "@/lib/store";
import type { Prediction } from "@/lib/types";
import { cn, formatClock, pct } from "@/lib/utils";

export default function PredictPage() {
  const { city } = useCity();
  const LOTS = city.lots;
  const [lotId, setLotId] = useState(city.lots[0].id);
  const [arrivalIn, setArrivalIn] = useState(45);
  const { lot, summary } = useLot(lotId);
  const { state } = useSlotify();
  const now = useNow(60000);
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  // Re-predict when inputs change; occupancy is rounded so live ticks don't refetch constantly.
  const occKey = Math.round(summary.occupancy * 20);
  useEffect(() => {
    if (!lot || now === null) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const p = await api.prediction(lot, summary.occupancy, summary.total - summary.maintenance, arrivalIn, state.rainMm);
      if (!cancelled) setPrediction(p);
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot, arrivalIn, occKey, now === null, state.rainMm]);

  if (!lot) return null;
  const tone = prediction ? occupancyTone(prediction.predictedOccupancy) : null;
  const nowLabel = hourLabel(new Date(now ?? 0).getHours());
  const arrivalLabel = prediction ? hourLabel(new Date(prediction.arrivalAt).getHours()) : nowLabel;
  const delta = prediction ? prediction.predictedOccupancy - prediction.currentOccupancy : 0;

  return (
    <>
      <PageHeader
        title="Parking predictions"
        description="A gradient-boosted model trained on a year of (simulated) bay history combines what cameras see right now with time of day, holidays, festival season and the rain forecast — and tells you how sure it is."
        actions={
          prediction && (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
              <BrainCircuit className="size-3.5 text-primary" /> {prediction.source === "backend" ? "Forecast service" : "On-device model"}
              {prediction.modelVersion && <span className="font-mono text-[10px]">· {prediction.modelVersion}</span>}
            </span>
          )
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="lot">Where are you going?</Label>
            <Select id="lot" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              {LOTS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="arrival">Arriving in</Label>
              <span className="font-display text-sm font-bold">
                {arrivalIn === 0 ? "Now" : arrivalIn < 60 ? `${arrivalIn} min` : `${Math.floor(arrivalIn / 60)} h ${arrivalIn % 60 ? `${arrivalIn % 60} min` : ""}`}
                {now && <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">at {formatClock(now + arrivalIn * 60000)}</span>}
              </span>
            </div>
            <input
              id="arrival"
              type="range"
              min={0}
              max={240}
              step={15}
              value={arrivalIn}
              onChange={(e) => setArrivalIn(Number(e.target.value))}
              className="w-full accent-[hsl(var(--primary))]"
            />
          </div>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Current occupancy" value={pct(summary.occupancy)} icon={Gauge} tone="primary" sub={`${summary.available} bays free now`} />
        <StatCard
          label="Predicted at arrival"
          value={<span className={tone?.text}>{prediction ? pct(prediction.predictedOccupancy) : "…"}</span>}
          icon={TrendingUp}
          tone="accent"
          sub={
            prediction
              ? prediction.low !== undefined && prediction.horizonMin
                ? `80% range ${pct(prediction.low)}–${pct(prediction.high ?? 0)} · ${tone?.label}`
                : `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta * 100))} pts vs now · ${tone?.label}`
              : " "
          }
        />
        <StatCard
          label="Free bays at arrival"
          value={prediction ? `≈ ${prediction.predictedAvailable}` : "…"}
          icon={ParkingSquare}
          tone="available"
          sub={
            prediction
              ? prediction.rangeAvailable && prediction.horizonMin
                ? `likely ${prediction.rangeAvailable[0]}–${prediction.rangeAvailable[1]} of ${prediction.totalSlots}`
                : `of ${prediction.totalSlots} usable bays`
              : " "
          }
        />
        <StatCard label="Model confidence" value={prediction ? pct(prediction.confidence) : "…"} icon={Sparkles} sub="From the width of the 80% interval" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Occupancy trend</CardTitle>
            <CardDescription>Today versus a typical {new Date(now ?? 0).toLocaleDateString("en-IN", { weekday: "long" })}, with the AI forecast for the rest of the day.</CardDescription>
          </CardHeader>
          <CardContent>{prediction && <PredictionChart trend={prediction.trend} nowLabel={nowLabel} arrivalLabel={arrivalLabel} />}</CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Peak hours</CardTitle>
              <CardDescription>Busiest times at this lot today</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {prediction?.peakHours.map((p, i) => (
                <div key={p.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-semibold">{p.label}</span>
                    <span className="tabular-nums text-muted-foreground">{p.occupancy}% full</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className={cn("h-full rounded-full", p.occupancy > 85 ? "bg-status-occupied" : "bg-status-reserved")}
                      initial={{ width: 0 }}
                      animate={{ width: `${p.occupancy}%` }}
                      transition={{ delay: i * 0.08, duration: 0.6 }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          {prediction?.factors && prediction.factors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg">Why the model says {pct(prediction.predictedOccupancy)}</CardTitle>
                <CardDescription>Contribution of each input, in occupancy points (tree path attribution).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {prediction.factors.slice(0, 6).map((f) => {
                  const w = Math.min(100, Math.abs(f.points) * 2.2);
                  return (
                    <div key={f.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-medium">{f.label}{f.value ? <span className="opacity-60"> · {f.value}</span> : null}</span>
                      <span className={cn("tabular-nums font-semibold", f.points > 0 ? "text-status-occupied" : "text-status-available")}>
                        {f.points > 0 ? "+" : "−"}{Math.abs(f.points).toFixed(1)}
                      </span>
                      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div className={cn("h-full rounded-full", f.points > 0 ? "bg-status-occupied" : "bg-status-available")} style={{ width: `${w}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Model trained on simulated history — see the model card in the Command Centre.
                  {state.rainMm > 2 && " Rain forecast is active."}
                </p>
              </CardContent>
            </Card>
          )}
          <Card className="border-primary/40">
            <CardContent className="pt-5">
              <p className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-primary" /> Quietest time in the next 6 hours</p>
              <p className="mt-2 font-display text-2xl font-extrabold">{prediction?.bestTimeToArrive ?? "…"}</p>
              <Button asChild className="mt-4 w-full"><Link href={`/user/park?id=${lot.id}&mode=open`}>Reserve a bay now</Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
