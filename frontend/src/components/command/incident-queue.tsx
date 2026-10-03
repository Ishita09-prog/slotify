"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import type { Incident } from "@/lib/command/types";
import { timeAgo } from "@/lib/utils";
import { useNow } from "@/lib/store";
import { SEVERITY, SeverityBadge, StatusPill } from "./ui";
import { cn } from "@/lib/utils";

const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function sortIncidents(list: Incident[]) {
  return [...list].sort((a, b) => {
    const oa = a.status === "awaiting_approval" ? 0 : 1;
    const ob = b.status === "awaiting_approval" ? 0 : 1;
    return oa - ob || ORDER[a.severity] - ORDER[b.severity] || b.detectedAt - a.detectedAt;
  });
}

export function IncidentQueue({ incidents, limit, selectedId }: { incidents: Incident[]; limit?: number; selectedId?: string | null }) {
  const now = useNow(5000);
  const open = sortIncidents(incidents.filter((i) => i.status !== "resolved" && i.status !== "rejected"));
  const list = limit ? open.slice(0, limit) : open;
  if (!list.length)
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="size-6 text-status-available" />
        <p className="text-sm font-semibold text-slate-200">No open incidents</p>
        <p className="max-w-[16rem] text-xs text-[hsl(var(--cc-dim))]">The engine checks cameras, ANPR and forecasts every 4 s. Start a drill to see the full workflow.</p>
      </div>
    );
  return (
    <ul className="divide-y divide-[hsl(var(--cc-line))]">
      {list.map((i) => (
        <li key={i.id}>
          <Link
            href={`/command/incidents?id=${i.id}`}
            className={cn("group flex items-start gap-3 py-2.5 pl-1 pr-1 hover:bg-white/[0.03]", selectedId === i.id && "bg-sky-500/5")}
          >
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY[i.severity].dot, i.status === "awaiting_approval" && "animate-pulse-dot")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={i.severity} />
                <StatusPill status={i.status} ready={i.readyToClose} />
                {i.escalated && <span className="text-[10px] font-bold uppercase text-status-occupied">Escalated</span>}
              </div>
              <p className="mt-1 truncate text-[13px] font-semibold text-slate-100">{i.title}</p>
              <p className="cc-mono text-[10px] text-[hsl(var(--cc-dim))]">
                {i.id} · risk {i.risk.score} · {timeAgo(i.detectedAt, now)}
              </p>
            </div>
            <ChevronRight className="mt-2 size-4 shrink-0 text-[hsl(var(--cc-dim))] group-hover:text-slate-200" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
