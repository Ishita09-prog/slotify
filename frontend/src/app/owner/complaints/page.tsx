"use client";

import Link from "next/link";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { StatusBadge, useComplaints } from "@/components/live/complaint-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { complaintAction } from "@/lib/live/complaint-service";
import { allowedActions, isOpen, type Complaint } from "@/lib/live/complaints";
import { useLive } from "@/lib/live/provider";
import { fmtDateTime } from "@/lib/live/time";
import { cn } from "@/lib/utils";

/** Operator: fraud complaints raised against charges at this operator's lots. */
export default function OwnerComplaints() {
  const live = useLive();
  const list = useComplaints(live.uid ? ["ownerUid", live.uid] : null);
  const [f, setF] = useState<"open" | "all">("open");
  const shown = (list ?? []).filter((c) => f === "all" || isOpen(c.status));
  const actor = { id: live.uid ?? "", name: live.account?.business || live.account?.name || "Operator", role: "owner" as const };

  const forward = async (c: Complaint) => {
    if (!live.store) return;
    try {
      await complaintAction(live.store, c.id, actor, "forward", {});
      toast.success(`${c.complaintId} forwarded to the Command Centre`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Fraud complaints" description="Drivers who say a FASTag charge at your lot wasn't theirs. Review each one, then forward it to the Command Centre or reject it with a reason." />
      <div className="mb-3 inline-flex rounded-xl border p-1 text-sm font-semibold">
        {([["open", "Needs action"], ["all", "All"]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setF(k)} className={cn("rounded-lg px-3 py-1.5", f === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{t}</button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>{["Complaint ID", "Vehicle number", "Transaction ID", "Parking location", "Submitted", "Status", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {shown.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground"><ShieldAlert className="mx-auto mb-2 size-7" />{list === null ? "Loading…" : "No fraud complaints here."}</td></tr>
            )}
            {shown.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-mono text-xs font-bold">{c.complaintId}{c.awaitingInfo && <span className="block font-sans text-[11px] font-semibold text-status-reserved">Waiting for driver</span>}{c.footageRequest?.status === "pending" && <span className="block font-sans text-[11px] font-semibold text-status-occupied">Command Centre wants CCTV recording</span>}</td>
                <td className="px-4 py-3 font-display font-bold tracking-wider">{c.vehicleNumber}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.transactionId}</td>
                <td className="px-4 py-3">{c.parkingLocation}</td>
                <td className="px-4 py-3 text-xs">{fmtDateTime(c.createdAt)}</td>
                <td className="px-4 py-3"><StatusBadge s={c.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button asChild size="sm" variant="outline"><Link href={`/owner/complaints/view?id=${c.id}`}>View Complaint</Link></Button>
                    {allowedActions(c, actor).includes("forward") && <Button size="sm" onClick={() => void forward(c)}>Forward To Command Centre</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
