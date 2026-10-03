"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { dayOutlook, predictAt } from "@/lib/live/ai";
import { fmtTime } from "@/lib/live/time";
import type { Bay, LiveLot } from "@/lib/live/types";
import { cn } from "@/lib/utils";

const tone = (c: number) => (c >= 0.8 ? "bg-status-available" : c >= 0.5 ? "bg-status-reserved" : "bg-status-occupied");
const toneText = (c: number) => (c >= 0.8 ? "text-status-available" : c >= 0.5 ? "text-status-reserved" : "text-status-occupied");
/** Is IST time t inside "10:00 – 23:00"-style opening hours? (24×7 / unparsable → always open) */
function isOpen(hours: string, t: number) {
  const m = hours.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!m || /24/.test(hours.replace(m[0], ""))) return true;
  const d = new Date(t + 19800000);
  const x = d.getUTCHours() * 60 + d.getUTCMinutes();
  const a = Number(m[1]) * 60 + Number(m[2]);
  let b = Number(m[3]) * 60 + Number(m[4]);
  if (b === 0) b = 1440;
  return b > a ? x >= a && x < b : x >= a || x < b;
}
const dayLabel = (t: number, now: number) => (new Date(t + 19800000).getUTCDate() !== new Date(now + 19800000).getUTCDate() ? "tomorrow " : "");

/** "Will there be space when I get there?" — prediction for a chosen time + next-24-hour strip. */
export function AiAvailability({
  lot, bays, now, target, onPick, ready, need,
}: {
  lot: LiveLot;
  bays: Bay[];
  now: number;
  target: number;
  onPick: (t: number) => void;
  ready: boolean;
  need?: { ev?: boolean; accessible?: boolean; bike?: boolean };
}) {
  const minute = Math.floor(now / 60000);
  const pred = useMemo(() => (ready ? predictAt(lot, bays, Math.max(target, now + 15 * 60_000), now, need) : null), [ready, lot, bays, target, minute, need?.ev, need?.bike]); // eslint-disable-line react-hooks/exhaustive-deps
  const day = useMemo(() => (ready ? dayOutlook(lot, bays, now, 24, need) : []), [ready, lot, bays, Math.floor(now / 300000), need?.bike]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pred) return null;
  const maxFree = Math.max(1, ...day.map((d) => d.freeHigh));
  const open = day.map((d) => isOpen(lot.openHours, d.at));
  const openIdx = day.map((_, i) => i).filter((i) => open[i]);
  const pool = openIdx.length ? openIdx : day.map((_, i) => i);
  const bestIdx = pool.reduce((bi, i) => (day[i].freeMean > day[bi].freeMean ? i : bi), pool[0] ?? 0);
  const worstIdx = pool.reduce((wi, i) => (day[i].freeMean < day[wi].freeMean ? i : wi), pool[0] ?? 0);

  return (
    <Card className="mb-4 p-4 sm:p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"><Sparkles className="size-3.5" /> AI availability forecast</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-lg font-bold sm:text-xl">
            At {dayLabel(pred.at, now)}{fmtTime(pred.at)}: ~{pred.freeMean} of {pred.usable} bays free
            <span className="ml-1 text-sm font-medium text-muted-foreground">(likely {pred.freeLow}–{pred.freeHigh})</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pred.booked > 0 && <><b className="text-foreground">{pred.booked}</b> already booked for then · </>}
            Why: {pred.factors.slice(0, 3).map((f) => `${f.label.toLowerCase()}${f.value ? ` (${f.value})` : ""} ${f.points > 0 ? "↑" : "↓"}`).join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-display text-3xl font-extrabold tabular-nums", toneText(pred.chance))}>{Math.round(pred.chance * 100)}%</p>
          <p className="text-xs text-muted-foreground">chance of a spot</p>
        </div>
      </div>
      {pred.chance < 0.7 && <p className="mt-2 rounded-lg bg-status-reserved/10 px-3 py-2 text-xs font-medium text-status-reserved">Likely full around then. Book now to guarantee a bay, or come at {fmtTime(day[bestIdx]?.at ?? now)} instead.</p>}

      {day.length > 0 && (
        <>
          <div className="mt-4 flex h-24 items-end gap-[3px]" role="list" aria-label="Free bays forecast for the next 24 hours">
            {day.map((d, i) => {
              const sel = Math.abs(d.at - pred.at) < 30 * 60_000;
              return (
                <button
                  key={d.at}
                  role="listitem"
                  title={!open[i] ? `${fmtTime(d.at)} · closed` : `${fmtTime(d.at)} · ~${d.freeMean} free (${d.freeLow}–${d.freeHigh}) · ${Math.round(d.chance * 100)}% chance`}
                  onClick={() => onPick(d.at)}
                  className={cn("group relative flex h-full flex-1 flex-col justify-end rounded-t-md", sel && "bg-primary/10", !open[i] && "opacity-25")}
                >
                  <span className="absolute inset-x-0 rounded-t bg-foreground/10" style={{ bottom: `${(d.freeLow / maxFree) * 100}%`, height: `${((d.freeHigh - d.freeLow) / maxFree) * 100}%` }} />
                  <span className={cn("relative w-full rounded-t-md opacity-80 group-hover:opacity-100", tone(d.chance), sel && "opacity-100 ring-2 ring-primary")} style={{ height: `${Math.max(4, (d.freeMean / maxFree) * 100)}%` }} />
                  {i === bestIdx && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-bold text-status-available">best</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            {day.filter((_, i) => i % 4 === 0).map((d) => <span key={d.at}>{fmtTime(d.at)}</span>)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Free bays, next 24 h (tap a bar to check that time). Easiest at <b className="text-foreground">{fmtTime(day[bestIdx].at)}</b>, busiest at <b className="text-foreground">{fmtTime(day[worstIdx].at)}</b>.
            Grey = likely range; faded = closed ({lot.openHours}). {pred.range === "short" ? "Next 3 h start from live camera counts." : "Beyond 3 h: long-range model (weekly pattern, holidays, festivals, weather)."}
          </p>
        </>
      )}
    </Card>
  );
}
