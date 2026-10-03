"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CalendarClock, Infinity as InfinityIcon, LocateFixed, MapPin, Search, Sparkles, TriangleAlert, Zap } from "lucide-react";
import { LotsMap } from "@/components/map";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCity } from "@/lib/city";
import { loadAllModels } from "@/lib/ml/forecast";
import { useSlotify } from "@/lib/store";
import { liveAccuracy, parseIntent, placesFor, predictAt, rankLots, type Ranked } from "@/lib/live/ai";
import { useLive, useTick } from "@/lib/live/provider";
import { isPublic, useDriverLots } from "@/lib/live/public";
import { fmtTime } from "@/lib/live/time";
import { lotStats } from "@/lib/live/view";
import type { LotWithStats } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";

const EXAMPLES = ["EV parking near Phoenix at 6 pm for 2 hours", "Cheap parking in T. Nagar now", "Park near Adyar with no time limit"];

export default function DriverHome() {
  const live = useLive();
  const dl = useDriverLots();
  const { city } = useCity();
  const now = useTick(5000);
  const [mode, setMode] = useState<"timed" | "open">("open");
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [whenMin, setWhenMin] = useState(0);
  const { state: sim } = useSlotify();

  useEffect(() => {
    loadAllModels().then(() => setModelReady(true)).catch(() => {});
  }, []);

  const places = useMemo(() => placesFor(city, dl.lots), [city, dl.lots]);
  const intent = useMemo(() => (asked ? parseIntent(asked, places, now) : null), [asked, places]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (intent?.mode) setMode(intent.mode);
    if (intent?.inMin != null) setWhenMin(intent.inMin);
  }, [intent]);
  const future = whenMin > 20;
  const at = now + Math.max(15, whenMin) * 60_000;

  const origin = intent?.place ?? me ?? null;
  const ranked: Ranked[] = useMemo(
    () => rankLots(dl.lots, dl.bays, { origin, inMin: whenMin, mode, ev: intent?.ev, accessible: intent?.accessible, cheap: intent?.cheap }, now),
    [dl.lots, dl.bays, origin, intent, mode, now, modelReady, whenMin] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const hidden = dl.lots.length - ranked.length;
  const best = ranked.find((r) => (future ? (r.forecast?.chance ?? 0) > 0.3 : r.free > 0));
  const bestPred = useMemo(() => (best && modelReady ? predictAt(best.lot, dl.bays, at, now, { ev: intent?.ev, accessible: intent?.accessible }) : null), [best?.lot.id, at, modelReady, dl.bays]); // eslint-disable-line react-hooks/exhaustive-deps
  const accuracy = useMemo(() => {
    if (!modelReady) return null;
    const pub = dl.pubLots.map((lot) => {
      const st = lotStats(lot, dl.bays, now);
      return { lot, total: st.usable, occNow: st.occupancy };
    });
    return liveAccuracy(pub, sim.history, now);
  }, [modelReady, Math.floor(now / 30000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const whenLabel = (m: number) => {
    const t = now + m * 60_000;
    const day = new Date(t + 5.5 * 3600_000).getUTCDate() !== new Date(now + 5.5 * 3600_000).getUTCDate() ? "tomorrow " : "";
    return `${day}${fmtTime(t)}`;
  };
  const istMin = (() => { const d = new Date(now + 5.5 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
  const tonight = (h: number) => { const d = h * 60 - istMin; return d > 0 ? d : d + 1440; };
  const tomorrow = (h: number) => 1440 - istMin + h * 60;
  const WHEN = [
    { label: "Now", m: 0 },
    { label: "In 1 h", m: 60 },
    { label: "In 3 h", m: 180 },
    { label: "Tonight 10 PM", m: tonight(22) },
    { label: "Tomorrow 10 AM", m: tomorrow(10) },
    { label: "Tomorrow 6 PM", m: tomorrow(18) },
  ];

  const mapLots: LotWithStats[] = ranked.map((r) => {
    const st = lotStats(r.lot, dl.bays, now);
    return {
      id: r.lot.id, name: r.lot.name, area: r.lot.area, address: r.lot.address, lat: r.lot.lat, lng: r.lot.lng, category: r.lot.category,
      layout: { rows: r.lot.rows, cols: 1 }, pricePerHour: r.lot.pricePerHour, evSurchargePerHour: r.lot.evPerHour, baseOccupancy: 0.8,
      openHours: r.lot.openHours, features: r.lot.features, ownerId: r.lot.ownerUid, covered: false,
      total: st.total, available: st.free, occupied: st.parked, reserved: st.booked, maintenance: st.maint, occupancy: st.occupancy,
    };
  });

  const href = (id: string) => `/user/park?id=${id}&mode=${mode}${intent?.ev ? "&ev=1" : ""}${whenMin > 20 ? `&in=${whenMin}` : ""}`;
  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => setMe({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setMe(city.center),
      { timeout: 5000 }
    );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Where are you parking{live.account ? `, ${live.account.name.split(" ")[0]}` : ""}?</h1>
        <p className="mt-1 text-sm text-muted-foreground">Public GCC parking (live AI cameras) and commercial lots from parking owners. Public = no time limit · Commercial = time slots.</p>
      </div>

      {/* AI search */}
      <Card className="p-3 sm:p-4">
        <form onSubmit={(e) => { e.preventDefault(); setAsked(q); }} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
            <input
              aria-label="Ask Slotify"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask: EV parking near Phoenix at 6 pm for 2 hours"
              className="h-12 w-full rounded-xl border bg-background/60 pl-9 pr-3 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </div>
          <Button type="submit" size="lg" className="h-12 px-4"><Search /><span className="hidden sm:inline">Find</span></Button>
          <Button type="button" variant="outline" size="lg" className="h-12 px-3" onClick={locate} aria-label="Use my location"><LocateFixed /></Button>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {intent && intent.understood.length > 0 ? (
            <>
              <span className="text-muted-foreground">AI understood:</span>
              {intent.understood.map((u) => <span key={u} className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{u}</span>)}
              <button className="text-muted-foreground underline" onClick={() => { setAsked(""); setQ(""); }}>clear</button>
            </>
          ) : (
            EXAMPLES.map((e) => <button key={e} onClick={() => { setQ(e); setAsked(e); }} className="rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground">{e}</button>)
          )}
        </div>
      </Card>

      {/* When */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-muted-foreground">When?</span>
        {WHEN.map((w) => (
          <button key={w.label} onClick={() => setWhenMin(w.m)} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors", Math.abs(whenMin - w.m) < 2 ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{w.label}</button>
        ))}
        <input
          type="datetime-local"
          aria-label="Pick a date and time"
          className="h-8 rounded-full border bg-background/60 px-3 text-xs"
          onChange={(e) => { const t = Date.parse(e.target.value); if (!Number.isNaN(t)) setWhenMin(Math.max(0, Math.round((t - Date.now()) / 60_000))); }}
        />
        {future && <span className="text-xs text-primary">AI is predicting availability for <b>{whenLabel(whenMin)}</b></span>}
      </div>

      {/* Mode */}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Booking type">
        {([
          ["timed", "With time slot", "Book the owner's slot, e.g. 4–7 pm", CalendarClock],
          ["open", "No time limit", "Park as long as you like, pay for time used", InfinityIcon],
        ] as const).map(([k, t, s, Icon]) => (
          <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors sm:p-4", mode === k ? "border-primary bg-primary/10" : "glass hover:bg-secondary/40")}>
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", mode === k ? "bg-primary text-white" : "bg-secondary")}><Icon className="size-5" /></span>
            <span className="min-w-0"><span className="block font-semibold">{t}</span><span className="hidden text-xs text-muted-foreground sm:block">{s}</span></span>
          </button>
        ))}
      </div>

      {dl.lots.length === 0 ? (
        <Card className="p-10 text-center">
          <MapPin className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-2 font-semibold">No parking locations yet</p>
          <p className="text-sm text-muted-foreground">They appear here the moment a parking owner adds one.</p>
        </Card>
      ) : (
        <>
          {/* AI pick */}
          <AnimatePresence mode="wait">
            {best && (
              <motion.div key={best.lot.id + mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="relative overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent p-5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"><Sparkles className="size-3.5" /> Best spot for you</p>
                  <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-2xl font-extrabold">{best.lot.name}</h2>
                      <p className="text-sm text-muted-foreground">{isPublic(best.lot) ? "Public · GCC" : `Commercial · ${best.lot.ownerName}`} · {best.lot.area} · {formatINR(best.lot.pricePerHour)}/h</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {best.reasons.map((r) => <span key={r} className="rounded-full bg-background/60 px-2.5 py-1 text-xs font-medium">{r}</span>)}
                      </div>
                      {bestPred && (
                        <div className="mt-3 rounded-xl bg-background/50 p-3 text-sm">
                          <p>
                            <b>{future ? `At ${whenLabel(whenMin)}` : "In 15 min"}: ~{bestPred.freeMean} of {bestPred.usable} bays free</b>{" "}
                            <span className="text-muted-foreground">(likely {bestPred.freeLow}–{bestPred.freeHigh})</span> ·{" "}
                            <b className={bestPred.chance >= 0.8 ? "text-status-available" : bestPred.chance >= 0.5 ? "text-status-reserved" : "text-status-occupied"}>{Math.round(bestPred.chance * 100)}% chance of a spot</b>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Why: {bestPred.factors.slice(0, 3).map((f) => `${f.label.toLowerCase()}${f.value ? ` (${f.value})` : ""} ${f.points > 0 ? "↑ busier" : "↓ quieter"}`).join(" · ")}
                            {bestPred.booked > 0 && ` · ${bestPred.booked} bays already booked for that time`}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">{bestPred.range === "short" ? "Short-range model · starts from live camera counts" : "Long-range model · weekly pattern, holidays, festivals, weather"} · 80% range</p>
                        </div>
                      )}
                    </div>
                    <Button asChild size="lg" className="shrink-0"><Link href={href(best.lot.id)}>Book a bay <ArrowRight /></Link></Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {accuracy && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3 shrink-0 text-primary" /> <span>AI live check: forecasts made {accuracy.minutesAgo} min ago were off by <b className="text-foreground">{accuracy.maeBays} bays</b> on average across {accuracy.lots} public lots ({accuracy.inBandPct}% inside the predicted range).</span>
            </p>
          )}
          {mode === "timed" && (
            <p className="text-xs text-muted-foreground">Time slots are offered by commercial parking owners. Public GCC parking has no time limit; switch to &quot;No time limit&quot; to see it.</p>
          )}
          {hidden > 0 && mode === "open" && (
            <p className="text-xs text-muted-foreground">Public parking + owners who allow no time limit ({hidden} commercial location{hidden > 1 ? "s" : ""} offer time slots only).</p>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="space-y-2">
              {ranked.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">No location offers this yet. Try the other booking type.</Card>}
              {ranked.map((r, i) => (
                <Link key={r.lot.id} href={href(r.lot.id)} onMouseEnter={() => setActive(r.lot.id)} className={cn("glass flex items-center gap-3 rounded-2xl p-3 transition hover:-translate-y-0.5", active === r.lot.id && "ring-1 ring-primary/50")}>
                  <span className={cn("grid size-12 shrink-0 place-items-center rounded-xl font-display text-lg font-extrabold", (future ? (r.forecast?.chance ?? 0) < 0.5 : r.free === 0) ? "bg-status-occupied/15 text-status-occupied" : future && (r.forecast?.chance ?? 0) < 0.8 ? "bg-status-reserved/15 text-status-reserved" : "bg-status-available/15 text-status-available")}>{future && r.forecast ? `~${r.forecast.freeMean}` : r.free}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{i === 0 && r.free > 0 && <Sparkles className="mr-1 inline size-3.5 text-primary" />}{r.lot.name} <span className={cn("ml-1 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold", isPublic(r.lot) ? "bg-status-available/15 text-status-available" : "bg-primary/15 text-primary")}>{isPublic(r.lot) ? "Public" : "Commercial"}</span></p>
                    <p className="truncate text-xs text-muted-foreground">{r.lot.area} · {formatINR(r.lot.pricePerHour)}/h{r.km != null ? ` · ${r.km.toFixed(1)} km` : ""}{r.forecast ? (future ? ` · ${Math.round(r.forecast.chance * 100)}% chance at ${whenLabel(whenMin)}` : ` · AI ${Math.round(r.forecast.occupancy * 100)}% full soon`) : ""}</p>
                    {r.warn && <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-status-reserved"><TriangleAlert className="size-3" /> {r.warn}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {r.lot.features.includes("EV charging") && <Zap className="size-3.5 text-muted-foreground" />}
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
            <div className="h-[340px] overflow-hidden rounded-2xl border lg:sticky lg:top-24 lg:h-[calc(100dvh-8rem)]">
              <LotsMap lots={mapLots} origin={origin ?? city.center} activeId={active} onSelect={setActive} hrefFor={href} flyTo={origin} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
