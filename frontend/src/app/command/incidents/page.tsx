"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BellRing, BrainCircuit, Check, CheckCircle2, Clock, FileDown, Gavel, Lock, MapPin, Radio, Send, ShieldCheck, Truck, UserCheck, X,
} from "lucide-react";
import { useCommand, DEMO_MINUTE_MS } from "@/lib/command/store";
import { useTrend, istClock } from "@/lib/command/hooks";
import { useCity } from "@/lib/city";
import { ROLES } from "@/lib/command/rbac";
import type { Incident, IncidentStatus } from "@/lib/command/types";
import { CCButton, Panel, SeverityBadge, StatusPill } from "@/components/command/ui";
import { sortIncidents } from "@/components/command/incident-queue";
import { OccupancyForecastChart } from "@/components/command/charts";
import { cn, timeAgo } from "@/lib/utils";
import { useNow } from "@/lib/store";
import { downloadIncidentReport } from "@/lib/command/report";

type Filter = "open" | "awaiting" | "closed" | "all";

const STEPS: { key: string; label: string; icon: React.ElementType }[] = [
  { key: "detected", label: "Detected", icon: Radio },
  { key: "assessed", label: "AI assessed", icon: BrainCircuit },
  { key: "approved", label: "Human approval", icon: UserCheck },
  { key: "dispatched", label: "Dispatched", icon: Send },
  { key: "on_scene", label: "On scene / acting", icon: Truck },
  { key: "resolved", label: "Resolved", icon: CheckCircle2 },
];

function stepIndex(i: Incident) {
  if (i.status === "resolved") return 6;
  if (i.status === "rejected") return 2;
  if (i.status === "on_scene" || (i.status === "monitoring" && i.readyToClose)) return 5;
  if (i.status === "monitoring") return 4;
  if (i.status === "dispatched") return 4;
  return 2;
}

function IncidentsInner() {
  const cmd = useCommand();
  const params = useSearchParams();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("open");
  const selectedId = params.get("id");

  const filtered = useMemo(() => {
    const isOpen = (s: IncidentStatus) => s !== "resolved" && s !== "rejected";
    const l = cmd.incidents.filter((i) =>
      filter === "open" ? isOpen(i.status) : filter === "awaiting" ? i.status === "awaiting_approval" : filter === "closed" ? !isOpen(i.status) : true
    );
    return filter === "closed" ? [...l].sort((a, b) => b.detectedAt - a.detectedAt) : sortIncidents(l);
  }, [cmd.incidents, filter]);

  const selected = cmd.incidents.find((i) => i.id === selectedId) ?? filtered[0] ?? null;
  useEffect(() => {
    if (!selectedId && filtered[0]) router.replace(`/command/incidents?id=${filtered[0].id}`);
  }, [selectedId, filtered, router]);

  const now = useNow(5000);
  return (
    <div className="grid gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Panel title="Incidents" subtitle={`${cmd.incidents.length} this session · engine runs every 4 s`} bodyClassName="p-0">
        <div className="flex gap-1 border-b border-[hsl(var(--cc-line))] p-2">
          {(["open", "awaiting", "closed", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn("flex-1 rounded px-2 py-1 text-[11px] font-semibold capitalize", filter === f ? "bg-sky-500/15 text-sky-300" : "text-[hsl(var(--cc-dim))] hover:bg-white/5")}
            >
              {f}
            </button>
          ))}
        </div>
        <ul className="max-h-[calc(100dvh-14rem)] divide-y divide-[hsl(var(--cc-line))] overflow-y-auto">
          {filtered.map((i) => (
            <li key={i.id}>
              <Link href={`/command/incidents?id=${i.id}`} className={cn("block px-3 py-2.5 hover:bg-white/[0.03]", selected?.id === i.id && "bg-sky-500/10")}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityBadge severity={i.severity} />
                  <StatusPill status={i.status} ready={i.readyToClose} />
                </div>
                <p className="mt-1 text-[13px] font-semibold text-slate-100">{i.title}</p>
                <p className="cc-mono text-[10px] text-[hsl(var(--cc-dim))]">{i.id} · risk {i.risk.score} · {timeAgo(i.detectedAt, now)}</p>
              </Link>
            </li>
          ))}
          {!filtered.length && (
            <li className="p-6 text-center text-xs text-[hsl(var(--cc-dim))]">
              Nothing here. Open <b className="text-status-reserved">Drills</b> (top right) and start a scenario — the engine will detect it within a few seconds.
            </li>
          )}
        </ul>
      </Panel>

      {selected ? <IncidentDetail key={selected.id} inc={selected} /> : <Panel><p className="text-sm text-[hsl(var(--cc-dim))]">No incident selected.</p></Panel>}
    </div>
  );
}

function IncidentDetail({ inc }: { inc: Incident }) {
  const cmd = useCommand();
  const { city } = useCity();
  const now = useNow(1000) ?? Date.now();
  const zone = city.commandZones.find((z) => z.id === inc.zoneId);
  const locality = zone?.localities.find((l) => l.id === inc.localityId);
  const [picked, setPicked] = useState<string[]>(() =>
    inc.recommendations
      .filter((r) => r.suggested && (r.enforcement ? cmd.can("incident.approve_enforcement") : cmd.can("incident.approve")))
      .map((r) => r.id)
  );
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const role = cmd.user?.role;
  const canApprove = (enforcement: boolean) => (enforcement ? cmd.can("incident.approve_enforcement") : cmd.can("incident.approve"));
  const chosen = inc.recommendations.filter((r) => picked.includes(r.id));
  const blocked = chosen.filter((r) => !canApprove(r.enforcement));
  const trend = useTrend(inc.watchLotIds.length ? inc.watchLotIds : null);
  const notes = cmd.notifications.filter((n) => n.incidentId === inc.id);
  const unit = inc.unitId ? cmd.units[inc.unitId] : null;
  const unitMeta = inc.unitId ? city.units.find((u) => u.id === inc.unitId) : null;
  const step = stepIndex(inc);

  // impact chart markers + "without action" line
  const chartData = useMemo(() => {
    if (!inc.watchLotIds.length || inc.counterfactual === undefined || inc.occAtDetection === undefined) return trend.points;
    return trend.points.map((p) => {
      const t = p.t;
      if (t < inc.detectedAt || t > inc.detectedAt + 60 * 60_000) return p;
      const f = (t - inc.detectedAt) / (60 * 60_000);
      return { ...p, counterfactual: Math.round((inc.occAtDetection! + (inc.counterfactual! - inc.occAtDetection!) * Math.min(1, f * 12)) * 100) };
    });
  }, [trend.points, inc]);
  const nearestLabel = (t: number) => {
    let best = trend.points[0];
    for (const p of trend.points) if (Math.abs(p.t - t) < Math.abs((best?.t ?? 0) - t)) best = p;
    return best?.label;
  };
  const markers = [
    { label: nearestLabel(inc.detectedAt) ?? "", text: "Detected", color: "#ef4444" },
    ...(inc.approved ? [{ label: nearestLabel(inc.approved.at) ?? "", text: "Approved", color: "#22c55e" }] : []),
  ];

  const occNow = inc.watchLotIds.length ? trend.nowOcc : undefined;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="cc-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={inc.severity} />
              <StatusPill status={inc.status} ready={inc.readyToClose} />
              {inc.escalated && <span className="rounded bg-status-occupied/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-status-occupied">Escalated to DC (Traffic)</span>}
              <span className="cc-mono text-[11px] text-[hsl(var(--cc-dim))]">{inc.id}</span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-slate-50">{inc.title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-300">{inc.summary}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[hsl(var(--cc-dim))]">
              <span className="flex items-center gap-1"><MapPin className="size-3" /> {zone?.name}{locality ? ` › ${locality.name}` : ""} · {zone?.division}</span>
              <span className="flex items-center gap-1"><Clock className="size-3" /> detected {istClock(inc.detectedAt)} IST ({timeAgo(inc.detectedAt, now)})</span>
              <span>source: {inc.source}</span>
              <span>detection confidence {Math.round(inc.confidence * 100)}%</span>
            </p>
          </div>
          <CCButton onClick={() => { downloadIncidentReport(inc, city, cmd.user, cmd.notifications); cmd.noteGenerated("report.incident_pdf", `Incident report ${inc.id} generated`); }} disabled={!cmd.can("report.generate")}>
            <FileDown className="size-3.5" /> Incident report (PDF)
          </CCButton>
        </div>

        {/* stepper */}
        <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {STEPS.map((s, idx) => {
            const done = idx < step;
            const current = idx === step && inc.status !== "resolved";
            const Icon = s.icon;
            const rejected = inc.status === "rejected" && idx === 2;
            return (
              <li key={s.key} className={cn("rounded-md border px-2 py-2 text-[11px]", done ? "border-status-available/40 bg-status-available/5 text-status-available" : current ? "border-sky-500/60 bg-sky-500/10 text-sky-300" : "border-[hsl(var(--cc-line))] text-[hsl(var(--cc-dim))]", rejected && "border-status-occupied/50 bg-status-occupied/10 text-status-occupied")}>
                <span className="flex items-center gap-1.5 font-semibold">
                  {done ? <Check className="size-3.5" /> : <Icon className={cn("size-3.5", current && "animate-pulse-dot")} />}
                  {rejected ? "Rejected" : s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-3 2xl:grid-cols-2">
        {/* Risk + evidence */}
        <Panel title={`Risk score ${inc.risk.score}/100`} subtitle="Transparent weighted score — every point is accounted for">
          <div className="space-y-2">
            {inc.risk.factors.map((f) => (
              <div key={f.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-xs">
                <span className="text-slate-300">{f.label} <span className="text-[hsl(var(--cc-dim))]">· {f.value}</span></span>
                <span className="cc-mono font-semibold text-slate-100">+{f.points}</span>
                <div className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, f.points * 3)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[hsl(var(--cc-line))] pt-3">
            <p className="cc-label mb-2">Evidence</p>
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              {inc.evidence.map((e) => (
                <div key={e.label} className="flex justify-between gap-2 rounded bg-white/[0.02] px-2 py-1">
                  <dt className="truncate text-[hsl(var(--cc-dim))]">{e.label}</dt>
                  <dd className="cc-mono truncate text-slate-200">{e.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>

        {/* AI forecast & explanation */}
        <Panel title="AI assessment" subtitle={inc.forecast ? `${inc.forecast.modelVersion} · gradient-boosted trees · trained on simulated history` : "Rule-based detection (no model involved)"}>
          {inc.forecast ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-[hsl(var(--cc-line))] p-2">
                  <p className="cc-label">{inc.forecast.horizonMin ? `In ${inc.forecast.horizonMin} min` : "Estimate now"}</p>
                  <p className="cc-mono mt-1 text-xl font-bold text-slate-50">{Math.round(inc.forecast.occupancy * 100)}%</p>
                </div>
                <div className="rounded-md border border-[hsl(var(--cc-line))] p-2">
                  <p className="cc-label">80% interval</p>
                  <p className="cc-mono mt-1 text-xl font-bold text-slate-50">{Math.round(inc.forecast.low * 100)}–{Math.round(inc.forecast.high * 100)}%</p>
                </div>
                <div className="rounded-md border border-[hsl(var(--cc-line))] p-2">
                  <p className="cc-label">Forecast confidence</p>
                  <p className="cc-mono mt-1 text-xl font-bold text-slate-50">{Math.round((inc.forecast.confidence ?? inc.confidence) * 100)}%</p>
                </div>
              </div>
              <p className="cc-label mb-1.5 mt-4">Why — contribution of each input (occupancy points)</p>
              <ul className="space-y-1.5">
                {inc.forecast.factors.map((f) => (
                  <li key={f.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-xs">
                    <span className="text-slate-300">{f.label}{f.value ? <span className="opacity-60"> · {f.value}</span> : null}</span>
                    <span className={cn("cc-mono font-semibold", f.points > 0 ? "text-status-occupied" : "text-status-available")}>{f.points > 0 ? "+" : ""}{f.points.toFixed(1)}</span>
                    <div className="col-span-2 h-1 overflow-hidden rounded-full bg-slate-800">
                      <div className={cn("h-full rounded-full", f.points > 0 ? "bg-status-occupied" : "bg-status-available")} style={{ width: `${Math.min(100, Math.abs(f.points) * 2)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-[hsl(var(--cc-dim))]">
                The model recommends; it never acts. Every action below needs a named official&apos;s approval and is written to the audit trail.
              </p>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-slate-300">
              Raised by a deterministic rule ({inc.type === "illegal_cluster" ? "≥ 5 unprocessed ANPR detections within 350 m in 10 min" : "heartbeat timeout"}). Evidence on the left carries each camera&apos;s confidence.
            </p>
          )}
        </Panel>
      </div>

      {/* Decision */}
      <Panel
        title={inc.status === "awaiting_approval" ? "Recommended actions — decision required" : "Decision"}
        subtitle={inc.status === "awaiting_approval" ? `Signed in as ${cmd.user?.name} (${role ? ROLES[role].label : "-"}). Enforcement actions: police or command. Policy actions: command only.` : undefined}
      >
        {inc.status === "awaiting_approval" ? (
          <>
            <ul className="space-y-2">
              {inc.recommendations.map((r) => {
                const allowed = canApprove(r.enforcement);
                const on = picked.includes(r.id);
                return (
                  <li key={r.id}>
                    <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors", on ? "border-sky-500/50 bg-sky-500/5" : "border-[hsl(var(--cc-line))] hover:bg-white/[0.02]", !allowed && "cursor-not-allowed opacity-60")}>
                      <input
                        type="checkbox"
                        className="mt-1 accent-sky-500"
                        checked={on}
                        disabled={!allowed}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
                          {r.title}
                          <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", r.enforcement ? "bg-orange-500/15 text-orange-300" : "bg-violet-500/15 text-violet-300")}>
                            {r.enforcement ? "Enforcement" : "Policy / operations"}
                          </span>
                          {r.suggested && <span className="text-[10px] font-semibold text-sky-400">AI suggested</span>}
                          {!allowed && <span className="flex items-center gap-1 text-[10px] text-status-reserved"><Lock className="size-3" /> needs {r.enforcement ? "police / command" : "Command Officer"}</span>}
                        </span>
                        <span className="mt-1 block text-xs text-slate-300">{r.detail}</span>
                        <span className="mt-1 block text-[11px] text-[hsl(var(--cc-dim))]">Expected: {r.expected}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note for the record (optional)"
                className="flex-1 rounded-md border border-[hsl(var(--cc-line))] bg-transparent px-3 py-2 text-xs text-slate-100 placeholder:text-[hsl(var(--cc-dim))] focus:border-sky-500 focus:outline-none"
              />
              <CCButton variant="primary" disabled={!chosen.length || blocked.length > 0} onClick={() => cmd.approve(inc.id, picked, note || undefined)}>
                <ShieldCheck className="size-3.5" /> Approve & dispatch ({chosen.length})
              </CCButton>
              <CCButton variant="danger" onClick={() => setRejecting((v) => !v)}><X className="size-3.5" /> Reject</CCButton>
            </div>
            {rejecting && (
              <div className="mt-2 flex flex-wrap gap-2">
                {["False positive (verified on CCTV)", "Planned event — already managed", "Not proportionate"].map((r) => (
                  <CCButton key={r} onClick={() => cmd.reject(inc.id, r)}>{r}</CCButton>
                ))}
              </div>
            )}
          </>
        ) : inc.status === "rejected" ? (
          <p className="text-sm text-slate-300">Rejected by <b>{inc.rejected?.by}</b> — “{inc.rejected?.reason}”. The detector is muted for this location for 2 minutes. Rejections feed back into threshold tuning.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 text-xs">
              <p className="text-slate-300">
                Approved by <b className="text-slate-100">{inc.approved?.by}</b> ({inc.approved?.role}) at {inc.approved && istClock(inc.approved.at)} IST
                {inc.approved?.note && <> — “{inc.approved.note}”</>}
              </p>
              <ul className="space-y-1">
                {inc.recommendations.filter((r) => inc.approved?.recIds.includes(r.id)).map((r) => (
                  <li key={r.id} className="flex items-start gap-2 text-slate-200"><Check className="mt-0.5 size-3.5 shrink-0 text-status-available" /> {r.title}</li>
                ))}
              </ul>
              {unit && unitMeta && (
                <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5">
                  <p className="flex items-center gap-2 font-semibold text-sky-300"><Truck className="size-3.5" /> {unitMeta.name}</p>
                  <p className="mt-0.5 text-slate-300">
                    Status: <b>{unit.incidentId === inc.id ? unit.status.replace("_", " ") : "released"}</b>
                    {unit.incidentId === inc.id && inc.unitEtaAt && unit.status !== "on_scene" && (
                      <> · ETA {Math.max(0, Math.ceil((inc.unitEtaAt - now) / DEMO_MINUTE_MS))} min <span className="text-[hsl(var(--cc-dim))]">(demo clock: 1 min = 3 s)</span></>
                    )}
                  </p>
                </div>
              )}
            </div>
            <div>
              <p className="cc-label mb-1.5 flex items-center gap-1"><BellRing className="size-3" /> Notifications</p>
              <ul className="space-y-1 text-[11px]">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 rounded bg-white/[0.02] px-2 py-1">
                    <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", n.status === "acknowledged" ? "bg-status-available" : n.status === "delivered" ? "bg-sky-400" : "bg-slate-500")} />
                    <span className="min-w-0 flex-1">
                      <b className="text-slate-200">{n.channel}</b> → {n.to}
                      <span className="block truncate text-[hsl(var(--cc-dim))]">{n.message}</span>
                    </span>
                    <span className="shrink-0 uppercase text-[hsl(var(--cc-dim))]">{n.status}</span>
                  </li>
                ))}
                {!notes.length && <li className="text-[hsl(var(--cc-dim))]">No notifications for this incident.</li>}
              </ul>
            </div>
          </div>
        )}

        {inc.status !== "awaiting_approval" && inc.status !== "rejected" && inc.status !== "resolved" && (
          <div className={cn("mt-4 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center", inc.readyToClose ? "border-status-available/50 bg-status-available/5" : "border-[hsl(var(--cc-line))]")}>
            <p className="text-xs text-slate-300 sm:w-72">
              {inc.readyToClose ? <><b className="text-status-available">Conditions are back to normal.</b> Close with a note.</> : "Monitoring until the clearance condition is met (you can still close manually)."}
            </p>
            <input
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              placeholder="Closing note"
              className="flex-1 rounded-md border border-[hsl(var(--cc-line))] bg-transparent px-3 py-2 text-xs text-slate-100 placeholder:text-[hsl(var(--cc-dim))] focus:border-sky-500 focus:outline-none"
            />
            <CCButton variant={inc.readyToClose ? "primary" : "default"} disabled={!cmd.can("incident.resolve")} onClick={() => cmd.close(inc.id, closeNote || (inc.readyToClose ? "Resolved — conditions normal" : "Closed manually"))}>
              <Gavel className="size-3.5" /> Close incident
            </CCButton>
          </div>
        )}
        {inc.status === "resolved" && (
          <p className="mt-3 rounded-md border border-status-available/40 bg-status-available/5 p-3 text-xs text-slate-200">
            <CheckCircle2 className="mr-1 inline size-3.5 text-status-available" /> Closed by <b>{inc.resolved?.by}</b> at {inc.resolved && istClock(inc.resolved.at)} IST — “{inc.resolved?.note}”. Time to resolve: {inc.resolved && Math.round((inc.resolved.at - inc.detectedAt) / 1000)} s.
          </p>
        )}
      </Panel>

      <div className="grid gap-3 2xl:grid-cols-2">
        {inc.watchLotIds.length > 0 && (
          <Panel title="Impact" subtitle="Observed occupancy of the affected lots vs. what the model forecast at detection (no action)">
            <div className="mb-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-[hsl(var(--cc-line))] p-2">
                <p className="cc-label">At detection</p>
                <p className="cc-mono mt-1 text-lg font-bold text-status-occupied">{inc.occAtDetection !== undefined ? `${Math.round(inc.occAtDetection * 100)}%` : "—"}</p>
              </div>
              <div className="rounded-md border border-[hsl(var(--cc-line))] p-2">
                <p className="cc-label">Without action (60 min)</p>
                <p className="cc-mono mt-1 text-lg font-bold text-orange-400">{inc.counterfactual !== undefined ? `${Math.round(inc.counterfactual * 100)}%` : "—"}</p>
              </div>
              <div className="rounded-md border border-[hsl(var(--cc-line))] p-2">
                <p className="cc-label">{inc.status === "resolved" ? "At close" : "Now"}</p>
                <p className="cc-mono mt-1 text-lg font-bold text-status-available">
                  {inc.status === "resolved" && inc.occAtResolution !== undefined ? `${Math.round(inc.occAtResolution * 100)}%` : occNow !== undefined ? `${Math.round(occNow * 100)}%` : "—"}
                </p>
              </div>
            </div>
            <OccupancyForecastChart data={chartData} nowLabel={trend.nowLabel} markers={markers} height={220} />
          </Panel>
        )}
        <Panel title="Timeline" subtitle="Every step, who did it, when" bodyClassName="max-h-80 overflow-y-auto">
          <ol className="relative space-y-3 border-l border-[hsl(var(--cc-line))] pl-4">
            {inc.timeline.map((t, k) => (
              <li key={k} className="relative text-xs">
                <span className={cn("absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-[hsl(222_40%_8%)]",
                  t.kind === "ai" ? "bg-violet-400" : t.kind === "human" ? "bg-status-available" : t.kind === "unit" ? "bg-sky-400" : t.kind === "notify" ? "bg-amber-400" : "bg-slate-400")} />
                <p className="text-slate-200">{t.label}</p>
                <p className="cc-mono text-[10px] text-[hsl(var(--cc-dim))]">{istClock(t.at)} · {t.actor}</p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

export default function IncidentsPage() {
  return (
    <Suspense>
      <IncidentsInner />
    </Suspense>
  );
}
