"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Hourglass, Search, Wallet } from "lucide-react";
import { Kpi, Panel } from "@/components/command/ui";
import { StatusBadge, useComplaints } from "@/components/live/complaint-ui";
import { isOpen } from "@/lib/live/complaints";
import { fmtDateTime } from "@/lib/live/time";
import { useCommand } from "@/lib/command/store";
import { cn, formatINR } from "@/lib/utils";

/** FASTag Dispute Resolution: complaints escalated by lot operators (or filed against public lots). */
export default function Disputes() {
  const cmd = useCommand();
  const all = useComplaints(null);
  const [f, setF] = useState<"active" | "all">("active");
  if (!cmd.can("dispute.manage"))
    return <Panel title="FASTag Dispute Resolution"><p className="text-sm text-[hsl(var(--cc-dim))]">Only a Command Officer can handle FASTag disputes. Your role: {cmd.user?.name}.</p></Panel>;

  // the Command Centre only ever sees complaints that reached it
  const reached = (all ?? []).filter((c) => c.auditLog.some((e) => e.to === "forwarded"));
  const rows = reached.filter((c) => f === "all" || isOpen(c.status));
  const refunded = reached.reduce((n, c) => n + (c.refund?.amount ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Awaiting acceptance" value={reached.filter((c) => c.status === "forwarded").length} icon={Hourglass} tone="warn" sub="forwarded, not yet picked up" />
        <Kpi label="In investigation" value={reached.filter((c) => c.status === "investigating").length} icon={Search} tone="info" />
        <Kpi label="Refunded" value={formatINR(refunded)} icon={Wallet} tone="good" sub="returned to victims' FASTag" />
        <Kpi label="Closed cases" value={reached.filter((c) => !isOpen(c.status)).length} icon={CheckCircle2} />
      </div>
      <Panel
        title="FASTag Dispute Resolution"
        subtitle="Complaints forwarded by parking operators, and complaints about public (GCC) lots"
        actions={
          <div className="flex rounded border border-[hsl(var(--cc-line))] p-0.5 text-xs">
            {([["active", "Open"], ["all", "All"]] as const).map(([k, t]) => (
              <button key={k} onClick={() => setF(k)} className={cn("rounded px-2.5 py-1", f === k ? "bg-sky-500/20 text-sky-200" : "text-[hsl(var(--cc-dim))]")}>{t}</button>
            ))}
          </div>
        }
        bodyClassName="p-0 overflow-x-auto"
      >
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-[hsl(var(--cc-line))] text-left text-[11px] uppercase tracking-wide text-[hsl(var(--cc-dim))]">
            <tr>{["Complaint ID", "Vehicle number", "Parking lot", "Owner comments", "Evidence", "Investigation status", ""].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--cc-line))]">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-[hsl(var(--cc-dim))]">{all === null ? "Loading…" : "No disputes here."}</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 font-mono text-xs font-bold text-slate-100">{c.complaintId}<span className="block font-sans text-[10px] font-normal text-[hsl(var(--cc-dim))]">{fmtDateTime(c.createdAt)}</span></td>
                <td className="px-4 py-2.5 font-display font-bold tracking-wider text-slate-100">{c.vehicleNumber}</td>
                <td className="px-4 py-2.5 text-slate-200">{c.parkingLocation}</td>
                <td className="max-w-56 truncate px-4 py-2.5 text-[hsl(var(--cc-dim))]" title={c.ownerRemarks}>{c.ownerRemarks || (c.ownerUid === "gcc-public" ? "Public lot: no operator" : "—")}</td>
                <td className="px-4 py-2.5 text-slate-200">{c.attachments.length} file{c.attachments.length === 1 ? "" : "s"}</td>
                <td className="px-4 py-2.5"><StatusBadge s={c.status} />{c.awaitingInfo && <span className="ml-1 text-[10px] font-semibold text-status-reserved">awaiting driver</span>}</td>
                <td className="px-4 py-2.5 text-right"><Link href={`/command/disputes/view?id=${c.id}`} className="rounded border border-[hsl(var(--cc-line))] px-2.5 py-1 text-xs text-sky-300 hover:bg-white/5">Open case</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
