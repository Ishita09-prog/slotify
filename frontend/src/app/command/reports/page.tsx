"use client";

import { useState } from "react";
import { FileDown, FileText, Timer, TrendingDown, UserCheck } from "lucide-react";
import { useCityLive, useForecasts } from "@/lib/command/hooks";
import { useCommand } from "@/lib/command/store";
import { modelIfLoaded } from "@/lib/ml/forecast";
import { downloadSituationReport } from "@/lib/command/report";
import { CompareBars } from "@/components/command/charts";
import { CCButton, Kpi, Panel, SeverityBadge, StatusPill } from "@/components/command/ui";
import { istClock } from "@/lib/command/hooks";

export default function ReportsPage() {
  const live = useCityLive();
  const forecasts = useForecasts(60);
  const cmd = useCommand();
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resolved = cmd.incidents.filter((i) => i.status === "resolved" && i.resolved?.by !== "system");
  const mttr = resolved.length ? Math.round(resolved.reduce((a, i) => a + (i.resolved!.at - i.detectedAt), 0) / resolved.length / 1000) : null;
  const ttApprove = cmd.incidents.filter((i) => i.approved);
  const mtta = ttApprove.length ? Math.round(ttApprove.reduce((a, i) => a + (i.approved!.at - i.detectedAt), 0) / ttApprove.length / 1000) : null;
  const withImpact = cmd.incidents.filter((i) => i.occAtResolution !== undefined && i.counterfactual !== undefined && i.occAtDetection !== undefined && i.status === "resolved");
  const avoided = withImpact.length
    ? withImpact.reduce((a, i) => a + (i.counterfactual! - i.occAtResolution!), 0) / withImpact.length
    : null;

  const byType = new Map<string, number>();
  live.violations.forEach((v) => byType.set(v.type, (byType.get(v.type) ?? 0) + 1));

  const generate = async () => {
    setBusy(true);
    const ref = await downloadSituationReport({
      city: live.city,
      user: cmd.user,
      totals: live.totals,
      zones: live.zones.map((z) => ({
        name: z.zone.name,
        occupancy: z.occupancy,
        free: z.free,
        lots: z.lots.length,
        forecast60: forecasts ? z.lots.reduce((a, l) => a + (forecasts[l.lot.id]?.occupancy ?? 0) * l.usable, 0) / (z.usable || 1) : undefined,
      })),
      lots: live.lots.map((l) => {
        const f = forecasts?.[l.lot.id];
        return {
          name: l.lot.name,
          zone: live.city.commandZones.find((z) => z.id === l.zoneId)?.name ?? "",
          occupancy: live.occOf(l),
          free: l.stale ? 0 : l.s.available,
          forecast: f ? `${Math.round(f.occupancy * 100)}% (${Math.round(f.low * 100)}-${Math.round(f.high * 100)})` : undefined,
          feed: l.stale ? "OFFLINE (estimate)" : "live",
        };
      }),
      incidents: cmd.incidents,
      violations: { total: live.violations.length, actioned: live.violations.filter((v) => v.status !== "detected").length, byType: [...byType.entries()].sort((a, b) => b[1] - a[1]) },
      model: modelIfLoaded()?.meta ?? null,
      auditHead: cmd.audit[cmd.audit.length - 1],
      auditCount: cmd.audit.length,
    });
    cmd.noteGenerated("report.sitrep_pdf", `Situation report ${ref} generated`);
    setLast(ref);
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="cc-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="cc-label flex items-center gap-1.5"><FileText className="size-3.5 text-sky-400" /> Reporting engine</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-slate-50">Shift situation report · {live.city.name}</h1>
          <p className="mt-1 text-sm text-slate-300">Zones, lots, incidents and decisions, enforcement, model card and the audit chain head — signed-off PDF, generated in the browser (works in degraded mode).</p>
          {last && <p className="cc-mono mt-1 text-xs text-status-available">✓ {last}.pdf downloaded and logged to the audit trail</p>}
        </div>
        <CCButton variant="primary" className="shrink-0 px-4 py-2 text-sm" onClick={generate} disabled={busy || !cmd.can("report.generate")}>
          <FileDown className="size-4" /> {busy ? "Generating…" : "Generate PDF"}
        </CCButton>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Incidents this shift" value={cmd.incidents.length} sub={`${resolved.length} resolved by officers`} />
        <Kpi label="Mean time to approve" value={mtta !== null ? `${mtta}s` : "—"} icon={UserCheck} tone="info" sub="detection → human decision" />
        <Kpi label="Mean time to resolve" value={mttr !== null ? `${mttr}s` : "—"} icon={Timer} tone="info" sub="demo clock (1 min = 3 s)" />
        <Kpi label="Occupancy avoided" value={avoided !== null ? `${avoided > 0 ? "−" : "+"}${Math.abs(Math.round(avoided * 100))} pts` : "—"} icon={TrendingDown} tone={avoided !== null && avoided > 0 ? "good" : "default"} sub="vs. model forecast without action" />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Impact of approved actions" subtitle="At detection → forecast without action → at close (affected lots)">
          {withImpact.length ? (
            <CompareBars
              unit="%"
              height={Math.max(140, withImpact.length * 3 * 26)}
              data={withImpact.flatMap((i) => [
                { name: `${i.id.slice(-4)} detected`, value: Math.round(i.occAtDetection! * 100) },
                { name: `${i.id.slice(-4)} no action`, value: Math.round(i.counterfactual! * 100) },
                { name: `${i.id.slice(-4)} at close`, value: Math.round(i.occAtResolution! * 100), highlight: true },
              ])}
            />
          ) : (
            <p className="text-xs text-[hsl(var(--cc-dim))]">Close an approved saturation or anomaly incident to see its measured impact here.</p>
          )}
        </Panel>
        <Panel title="Incident register" subtitle="Everything raised this shift" bodyClassName="max-h-80 overflow-y-auto p-0">
          <table className="w-full text-left text-xs">
            <tbody>
              {cmd.incidents.map((i) => (
                <tr key={i.id} className="border-b border-[hsl(var(--cc-line))]/50">
                  <td className="cc-mono px-3 py-2 text-[hsl(var(--cc-dim))]">{istClock(i.detectedAt)}</td>
                  <td className="py-2"><SeverityBadge severity={i.severity} /></td>
                  <td className="py-2 text-slate-200">{i.title}</td>
                  <td className="py-2 text-slate-400">{i.approved?.by ?? "—"}</td>
                  <td className="py-2 pr-3"><StatusPill status={i.status} ready={i.readyToClose} /></td>
                </tr>
              ))}
              {!cmd.incidents.length && (
                <tr><td className="p-4 text-[hsl(var(--cc-dim))]">No incidents yet.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Enforcement summary" subtitle="ANPR detections by type (session)">
        <CompareBars unit="" height={Math.max(120, byType.size * 26)} data={[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({ name, value, highlight: i === 0 }))} />
      </Panel>
    </div>
  );
}
