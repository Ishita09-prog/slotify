"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BrainCircuit, Database, FlaskConical, Gauge, ShieldCheck, Target, TriangleAlert } from "lucide-react";
import { useCityLive } from "@/lib/command/hooks";
import { useCommand } from "@/lib/command/store";
import { forecastWith, modelIfLoaded, type ModelCard } from "@/lib/ml/forecast";
import { occAt } from "@/lib/command/engine";
import { anomalyCheck } from "@/lib/ml/forecast";
import { HorizonChart } from "@/components/command/charts";
import { Kpi, Panel, occTone } from "@/components/command/ui";
import { cn } from "@/lib/utils";

const DAY_TYPES = [
  { id: "today", label: "Today", date: null },
  { id: "weekday", label: "Normal weekday (Wed)", date: "2026-10-07" },
  { id: "sunday", label: "Sunday", date: "2026-10-04" },
  { id: "holiday", label: "Public holiday (Tue)", date: "2026-10-20" },
  { id: "festival", label: "Festival season (Wed)", date: "2026-10-28" },
] as const;

function istTimestamp(dateIso: string | null, hour: number) {
  const d = dateIso ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return Date.parse(`${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
}

export default function ForecastPage() {
  const live = useCityLive();
  const { modelReady } = useCommand();
  const [card, setCard] = useState<ModelCard | null>(null);
  useEffect(() => setCard(modelIfLoaded()?.meta ?? null), [modelReady]);

  // what-if
  const [lotId, setLotId] = useState(live.city.lots[0].id);
  const [occ, setOcc] = useState(0.6);
  const [hour, setHour] = useState(18);
  const [horizon, setHorizon] = useState(60);
  const [rain, setRain] = useState(0);
  const [day, setDay] = useState<(typeof DAY_TYPES)[number]["id"]>("weekday");
  const lot = live.city.lots.find((l) => l.id === lotId) ?? live.city.lots[0];
  const whatIf = useMemo(() => {
    const m = modelIfLoaded();
    if (!m) return null;
    const t0 = istTimestamp(DAY_TYPES.find((d) => d.id === day)!.date, hour);
    return forecastWith(m, lot, t0, occ, horizon, rain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot, occ, hour, horizon, rain, day, modelReady]);

  const table = useMemo(() => {
    const m = modelIfLoaded();
    if (!m) return [];
    const now = Date.now();
    const w = { city: live.city, slots: {}, violations: [], offline: {}, lastSeen: {}, history: live.history, rainMm: live.rainMm, now };
    return live.lots.map((l) => {
      const o = live.occOf(l);
      const f30 = forecastWith(m, l.lot, now, o, 30, live.rainMm);
      const f60 = forecastWith(m, l.lot, now, o, 60, live.rainMm);
      const f120 = forecastWith(m, l.lot, now, o, 120, live.rainMm);
      const ref = occAt(w as never, l.lot.id, now - 30 * 60_000);
      const an = ref && !l.stale ? anomalyCheck(m, l.lot, ref, { t: now, occ: o }, live.rainMm) : null;
      return { l, o, f30, f60, f120, an };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(live.now / 10000), modelReady]);

  if (!card) return <p className="p-6 text-sm text-[hsl(var(--cc-dim))]">Loading model card…</p>;
  const m = card.metrics;
  const horizonData = Object.entries(m.by_horizon_mae_pts).map(([h, v]) => ({ h: `${h}m`, ...v }));

  return (
    <div className="space-y-3">
      <div className="cc-panel p-4">
        <p className="cc-label flex items-center gap-1.5"><BrainCircuit className="size-3.5 text-violet-400" /> Model card</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold text-slate-50">Occupancy forecaster <span className="cc-mono text-base text-sky-300">{card.version}</span></h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-300">{card.algorithm}. Target: {card.target.toLowerCase()}. Trained {card.trainedAt}.</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded border border-status-reserved/40 bg-status-reserved/10 px-2 py-1 text-[11px] text-status-reserved">
          <TriangleAlert className="size-3.5" /> {card.training.data}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Hold-out error (MAE)" value={`${m.mae_occupancy_pts.gbm} pts`} tone="info" icon={Target} sub={`v1 heuristic ${m.mae_occupancy_pts.heuristic_v1} · same-as-now ${m.mae_occupancy_pts.persistence}`} />
        <Kpi label="Error in free bays" value={`±${m.mae_free_bays.gbm}`} icon={Gauge} sub={`per lot · v1 ±${m.mae_free_bays.heuristic_v1}`} />
        <Kpi label="Holidays / rain / festival" value={`${m.mae_on_holiday_rain_festival_pts.gbm} pts`} tone="good" icon={FlaskConical}
          sub={`${Math.round((1 - m.mae_on_holiday_rain_festival_pts.gbm / m.mae_on_holiday_rain_festival_pts.heuristic_v1) * 100)}% lower error than v1 (${m.mae_on_holiday_rain_festival_pts.heuristic_v1})`} />
        <Kpi label="80% interval coverage" value={`${Math.round(m.interval_80_coverage * 100)}%`} tone="good" icon={ShieldCheck} sub={`well calibrated · avg width ${m.mean_interval_width_pts} pts`} />
        <Kpi label="Anomaly detector" value={`${Math.round(m.anomaly_detector.event_recall * 100)}%`} icon={TriangleAlert} sub={`events caught · ${m.anomaly_detector.false_alerts_per_lot_per_week} false alerts/lot/wk`} />
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-5" title="Error by forecast horizon" subtitle={`Mean absolute error, occupancy points · hold-out = ${card.training.holdout}, ${card.training.holdoutPairs.toLocaleString("en-IN")} pairs`}>
          <HorizonChart data={horizonData} height={230} />
          <p className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--cc-dim))]">
            The v1 heuristic is given the simulator&apos;s <i>exact</i> demand curves — an optimistic baseline no real hand-tuned curve reaches. The model still beats it
            overall, and by a wide margin on holidays, rain and festival days, which are exactly the days that cause trouble.
          </p>
        </Panel>

        <Panel className="xl:col-span-7" title="How the AI is used" subtitle="Inputs → prediction → action. The model advises; officials decide.">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
            <div className="rounded-md border border-[hsl(var(--cc-line))] p-3 text-xs">
              <p className="cc-label mb-1.5 flex items-center gap-1"><Database className="size-3" /> Data in</p>
              <ul className="space-y-1 text-slate-300">
                <li>Bay occupancy now (edge cameras)</li>
                <li>Lot&apos;s historical profile by hour / day type</li>
                <li>Time, weekday, TN holiday & festival calendar</li>
                <li>Rain forecast (IMD feed in production)</li>
                <li>Lot type & usual demand</li>
              </ul>
            </div>
            <ArrowRight className="mx-auto hidden size-4 self-center text-[hsl(var(--cc-dim))] md:block" />
            <div className="rounded-md border border-violet-500/40 bg-violet-500/5 p-3 text-xs">
              <p className="cc-label mb-1.5 flex items-center gap-1"><BrainCircuit className="size-3" /> Model out</p>
              <ul className="space-y-1 text-slate-300">
                <li>Occupancy at arrival, 15–180 min ahead</li>
                <li>80% prediction interval → confidence</li>
                <li>Per-input contributions (why)</li>
                <li>Residual vs. 30-min-old forecast → anomaly flag</li>
              </ul>
            </div>
            <ArrowRight className="mx-auto hidden size-4 self-center text-[hsl(var(--cc-dim))] md:block" />
            <div className="rounded-md border border-status-available/40 bg-status-available/5 p-3 text-xs">
              <p className="cc-label mb-1.5 flex items-center gap-1"><ShieldCheck className="size-3" /> What follows</p>
              <ul className="space-y-1 text-slate-300">
                <li>Citizens: free bays at arrival, best time</li>
                <li>Command: risk score, saturation & anomaly incidents</li>
                <li>Recommended reroutes use the <i>upper</i> bound (never over-promise)</li>
                <li>Every action needs human approval</li>
              </ul>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-[11px] text-[hsl(var(--cc-dim))] sm:grid-cols-2">
            <p><b className="text-slate-300">Why ML here:</b> demand depends on interacting factors (hour × lot type × holiday × rain × how busy it already is). Fixed rules miss these; the hold-out numbers above show the gain.</p>
            <p><b className="text-slate-300">Why not deep learning:</b> tree ensembles are accurate on tabular data, run in the browser (works offline), and every prediction can be explained exactly.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-5" title="What-if simulator" subtitle="Change the situation, see the forecast and the reasons">
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="cc-label">Lot</span>
              <select value={lotId} onChange={(e) => setLotId(e.target.value)} className="w-full rounded-md border border-[hsl(var(--cc-line))] bg-[hsl(222_40%_8%)] px-2 py-1.5 text-slate-100">
                {live.city.lots.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.category})</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="cc-label">Day type</span>
              <select value={day} onChange={(e) => setDay(e.target.value as typeof day)} className="w-full rounded-md border border-[hsl(var(--cc-line))] bg-[hsl(222_40%_8%)] px-2 py-1.5 text-slate-100">
                {DAY_TYPES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="cc-label">Rain forecast: {rain} mm/h</span>
              <input type="range" min={0} max={25} value={rain} onChange={(e) => setRain(Number(e.target.value))} className="w-full accent-sky-500" />
            </label>
            <label className="space-y-1">
              <span className="cc-label">Time now: {String(Math.floor(hour)).padStart(2, "0")}:{hour % 1 ? "30" : "00"}</span>
              <input type="range" min={6} max={23} step={0.5} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="w-full accent-sky-500" />
            </label>
            <label className="space-y-1">
              <span className="cc-label">Occupancy now: {Math.round(occ * 100)}%</span>
              <input type="range" min={0.05} max={1} step={0.01} value={occ} onChange={(e) => setOcc(Number(e.target.value))} className="w-full accent-sky-500" />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="cc-label">Look ahead: {horizon} min</span>
              <input type="range" min={15} max={180} step={15} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="w-full accent-sky-500" />
            </label>
          </div>
          {whatIf && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr]">
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-center">
                <p className="cc-label">Forecast</p>
                <p className={cn("cc-mono mt-1 text-3xl font-bold", occTone(whatIf.occupancy))}>{Math.round(whatIf.occupancy * 100)}%</p>
                <p className="cc-mono text-[11px] text-slate-300">80%: {Math.round(whatIf.low * 100)}–{Math.round(whatIf.high * 100)}%</p>
                <p className="cc-mono mt-1 text-[11px] text-[hsl(var(--cc-dim))]">≈{Math.max(0, Math.round(lot.layout.rows * lot.layout.cols * (1 - whatIf.occupancy)))} free bays</p>
              </div>
              <ul className="space-y-1 text-xs">
                <li className="flex justify-between text-[hsl(var(--cc-dim))]"><span>Starting point (average lot)</span><span className="cc-mono">{Math.round(whatIf.baseline * 100)}%</span></li>
                {whatIf.factors.slice(0, 7).map((f) => (
                  <li key={f.label} className="flex justify-between gap-2">
                    <span className="text-slate-300">{f.label}{f.value ? <span className="opacity-60"> · {f.value}</span> : null}</span>
                    <span className={cn("cc-mono", f.points > 0 ? "text-status-occupied" : "text-status-available")}>{f.points > 0 ? "+" : ""}{f.points.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel className="xl:col-span-7" title="Live forecasts & anomaly watch" subtitle="Every lot, refreshed every 10 s · anomaly = outside the band forecast 30 min ago" bodyClassName="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="cc-label">
              <tr className="border-b border-[hsl(var(--cc-line))]">
                <th className="px-4 py-2 font-semibold">Lot</th>
                <th className="py-2 font-semibold">Now</th>
                <th className="py-2 font-semibold">+30 min</th>
                <th className="py-2 font-semibold">+60 min</th>
                <th className="py-2 font-semibold">+120 min</th>
                <th className="py-2 pr-4 font-semibold">Anomaly watch</th>
              </tr>
            </thead>
            <tbody>
              {table.map(({ l, o, f30, f60, f120, an }) => (
                <tr key={l.lot.id} className="border-b border-[hsl(var(--cc-line))]/50">
                  <td className="px-4 py-1.5 text-slate-200">{l.lot.name}</td>
                  <td className={cn("cc-mono py-1.5 font-semibold", occTone(o))}>{l.stale && "~"}{Math.round(o * 100)}%</td>
                  {[f30, f60, f120].map((f, i) => (
                    <td key={i} className="cc-mono py-1.5"><span className={occTone(f.occupancy)}>{Math.round(f.occupancy * 100)}</span><span className="text-[hsl(var(--cc-dim))]"> ({Math.round(f.low * 100)}–{Math.round(f.high * 100)})</span></td>
                  ))}
                  <td className="py-1.5 pr-4">
                    {l.stale ? <span className="text-slate-400">feed down</span> : an?.outOfBand ? (
                      <span className="font-semibold text-status-occupied">{an.direction === "spike" ? "▲ above band" : "▼ below band"}</span>
                    ) : (
                      <span className="text-status-available">in band</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Features" subtitle={`${card.features.length} model inputs`}>
          <div className="flex flex-wrap gap-1.5">
            {card.features.map((f) => (
              <span key={f.name} className="rounded border border-[hsl(var(--cc-line))] px-2 py-1 text-[11px]">
                <span className="cc-mono text-sky-300">{f.name}</span> <span className="text-[hsl(var(--cc-dim))]">· {f.label}</span>
              </span>
            ))}
          </div>
        </Panel>
        <Panel title="Limitations & governance" subtitle="What this model must not be trusted for">
          <ul className="list-disc space-y-1 pl-4 text-xs text-slate-300">
            {card.limitations.map((x) => <li key={x}>{x}</li>)}
            <li>Retraining: weekly on the detections archive; a new version ships only if hold-out MAE and interval coverage do not regress (versions are pinned in every audit entry).</li>
            <li>Model outputs never trigger enforcement or pricing directly — a named official approves every action.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
