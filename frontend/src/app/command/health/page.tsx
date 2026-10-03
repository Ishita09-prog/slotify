"use client";

import { CameraOff, CheckCircle2, CircleAlert, Power, RotateCcw, ServerCrash } from "lucide-react";
import { useCityLive } from "@/lib/command/hooks";
import { useCommand } from "@/lib/command/store";
import { useSlotify } from "@/lib/store";
import { backendEnabled } from "@/lib/api";
import { firebaseEnabled } from "@/lib/firebase";
import { CCButton, Kpi, Panel } from "@/components/command/ui";
import { cn, timeAgo } from "@/lib/utils";

type Status = "ok" | "degraded" | "down" | "standby";

const DOT: Record<Status, string> = { ok: "bg-status-available", degraded: "bg-status-reserved", down: "bg-status-occupied", standby: "bg-slate-500" };

export default function HealthPage() {
  const live = useCityLive();
  const cmd = useCommand();
  const { state, actions } = useSlotify();
  const canChaos = cmd.can("health.chaos");
  const eventsMin = live.events.filter((e) => live.now - e.at < 60_000).length;
  const offline = Object.keys(state.offline);

  const services: { name: string; role: string; status: Status; detail: string }[] = [
    { name: "API gateway", role: "AuthN/Z, rate limits, routing", status: cmd.apiDown ? "down" : backendEnabled ? "ok" : "standby", detail: cmd.apiDown ? "Unreachable (drill) — clients in edge mode" : backendEnabled ? "FastAPI reachable" : "Browser running standalone (no API configured) — same code path as an outage" },
    { name: "Detection ingest", role: "Edge camera events → state", status: offline.length ? "degraded" : "ok", detail: `${eventsMin} events/min · ${live.lots.length - offline.length}/${live.lots.length} nodes` },
    { name: "Forecast service", role: "GBM inference + intervals", status: cmd.modelReady ? "ok" : "degraded", detail: cmd.modelReady ? "On-device copy loaded; server copy used when API is up" : "Loading" },
    { name: "Incident engine", role: "Detectors, correlation, escalation", status: cmd.engineRunAt && live.now - cmd.engineRunAt < 10_000 ? "ok" : "degraded", detail: cmd.engineRunAt ? `last run ${Math.round((live.now - cmd.engineRunAt) / 1000)} s ago` : "starting" },
    { name: "Notification service", role: "Field app, SMS, VMS, citizen app", status: cmd.apiDown ? "degraded" : "ok", detail: cmd.apiDown ? "Queued locally; replays on recovery" : `${cmd.notifications.length} messages this session` },
    { name: "Audit ledger", role: "Hash-chained, append-only", status: cmd.tampered ? "down" : "ok", detail: cmd.tampered ? "Integrity check would FAIL (tamper demo active)" : `${cmd.audit.length} entries` },
    { name: "Realtime sync", role: "Firestore fan-out to dashboards", status: firebaseEnabled ? "ok" : "standby", detail: firebaseEnabled ? "onSnapshot listeners live" : "Not configured — on-device simulator" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Camera nodes online" value={`${live.lots.length - offline.length}/${live.lots.length}`} tone={offline.length ? "warn" : "good"} icon={offline.length ? CameraOff : CheckCircle2} sub="heartbeat every 3 s · timeout 15 s" />
        <Kpi label="Events / min" value={eventsMin} tone="info" sub="bay state changes ingested" />
        <Kpi label="Data freshness" value={`${Math.max(0, ...live.lots.filter((l) => !state.offline[l.lot.id]).map((l) => Math.round((live.now - l.lastSeen) / 1000)))} s`} tone="good" sub="oldest live reading (online nodes)" />
        <Kpi label="Platform mode" value={cmd.apiDown ? "EDGE" : "NORMAL"} tone={cmd.apiDown ? "warn" : "good"} icon={cmd.apiDown ? ServerCrash : CheckCircle2} sub={cmd.apiDown ? "degraded but operational" : "all paths available"} />
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-7" title="Services" subtitle="Status derived from live signals in this session" bodyClassName="p-0">
          <ul className="divide-y divide-[hsl(var(--cc-line))]">
            {services.map((s) => (
              <li key={s.name} className="flex items-start gap-3 px-4 py-2.5">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[s.status], s.status === "ok" && "animate-pulse-dot")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-100">{s.name} <span className="font-normal text-[hsl(var(--cc-dim))]">· {s.role}</span></p>
                  <p className="text-xs text-slate-400">{s.detail}</p>
                </div>
                <span className={cn("text-[10px] font-bold uppercase tracking-wider", s.status === "ok" ? "text-status-available" : s.status === "down" ? "text-status-occupied" : s.status === "degraded" ? "text-status-reserved" : "text-slate-400")}>{s.status}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--cc-line))] p-3">
            <CCButton disabled={!canChaos} onClick={() => cmd.setApiDown(!cmd.apiDown)}>
              <ServerCrash className="size-3.5" /> {cmd.apiDown ? "Restore API" : "Simulate API outage"}
            </CCButton>
            <CCButton disabled={!canChaos} onClick={() => actions.setRain(state.rainMm ? 0 : 18)}>
              {state.rainMm ? "Clear weather" : "Inject heavy rain (18 mm/h)"}
            </CCButton>
            {!canChaos && <span className="self-center text-[11px] text-[hsl(var(--cc-dim))]">Fault injection requires the Command Officer role.</span>}
          </div>
        </Panel>

        <Panel className="xl:col-span-5" title="Failure modes" subtitle="What breaks, what the system does, what the user sees">
          <ul className="space-y-2 text-xs">
            {[
              ["Camera node down", "Heartbeat timeout → model estimate with range, labelled ESTIMATED; new bookings paused for that lot; vendor ticket", "Driver sees ‘~62% (estimate)’ instead of stale numbers"],
              ["Central API down", "Browser keeps edge data + on-device model; writes queued; reports still generate locally", "Amber ‘degraded mode’ banner; everything keeps working"],
              ["Model unavailable", "Fall back to lot’s historical profile; incidents still raised by rules", "Forecasts marked ‘profile only’"],
              ["Bad / spoofed sensor data", "Anomaly detector flags out-of-band readings; operator verifies on CCTV before field action", "Incident asks for verification first"],
              ["Approval not given", "Escalates after SLA (90 s demo) to Deputy Commissioner", "Escalation badge + SMS"],
              ["Audit tampering", "Hash chain breaks at the edited entry; head anchored to WORM storage", "‘Chain broken at #N’ on verification"],
            ].map(([a, b, c]) => (
              <li key={a} className="rounded-md border border-[hsl(var(--cc-line))] p-2.5">
                <p className="flex items-center gap-1.5 font-semibold text-slate-100"><CircleAlert className="size-3.5 text-status-reserved" /> {a}</p>
                <p className="mt-0.5 text-slate-300">{b}</p>
                <p className="mt-0.5 text-[hsl(var(--cc-dim))]">User sees: {c}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Edge camera nodes" subtitle="One node per lot (bay cameras + on-device YOLO). Toggle to inject a fault." bodyClassName="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="cc-label">
            <tr className="border-b border-[hsl(var(--cc-line))]">
              <th className="px-4 py-2 font-semibold">Node</th>
              <th className="py-2 font-semibold">Lot</th>
              <th className="py-2 font-semibold">Zone</th>
              <th className="py-2 font-semibold">Last heartbeat</th>
              <th className="py-2 font-semibold">Status</th>
              <th className="py-2 pr-4 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {live.lots.map((l) => {
              const down = !!state.offline[l.lot.id];
              return (
                <tr key={l.lot.id} className="border-b border-[hsl(var(--cc-line))]/50">
                  <td className="cc-mono px-4 py-1.5 text-sky-300">EDGE-{l.lot.id.toUpperCase()}</td>
                  <td className="py-1.5 text-slate-200">{l.lot.name}</td>
                  <td className="py-1.5 text-slate-400">{live.city.commandZones.find((z) => z.id === l.zoneId)?.name}</td>
                  <td className="cc-mono py-1.5 text-slate-400">{timeAgo(l.lastSeen, live.now)}</td>
                  <td className="py-1.5">
                    {down ? (
                      <span className={cn("font-semibold", l.stale ? "text-status-occupied" : "text-status-reserved")}>{l.stale ? "OFFLINE · estimating" : "missed heartbeat…"}</span>
                    ) : (
                      <span className="text-status-available">online</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right">
                    {down ? (
                      <CCButton disabled={!canChaos} onClick={() => cmd.restoreNode(l.lot.id)}><RotateCcw className="size-3" /> Restore</CCButton>
                    ) : (
                      <CCButton disabled={!canChaos} variant="ghost" onClick={() => { actions.setOffline([l.lot.id], true); cmd.log({ action: "simulation.node_down", entity: `lot:${l.lot.id}`, detail: "Edge node taken offline from health console (drill)", source: "Health console" }); }}>
                        <Power className="size-3" /> Take offline
                      </CCButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
