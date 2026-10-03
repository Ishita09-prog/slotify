"use client";

import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { StatusBadge, useComplaints } from "@/components/live/complaint-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLive } from "@/lib/live/provider";
import { fmtDateTime } from "@/lib/live/time";

/** Driver: My Complaints. */
export default function MyComplaints() {
  const live = useLive();
  const list = useComplaints(live.uid ? ["userId", live.uid] : null);
  return (
    <>
      <PageHeader
        title="Fraud complaints"
        description="Charged for parking you never used? Tell us and we'll investigate. Your parking operator reviews first, then the Command Centre."
        actions={<Button asChild><Link href="/user/complaints/new"><ShieldAlert /> File a complaint</Link></Button>}
      />
      <h2 className="mb-2 font-display text-lg font-bold">My Complaints</h2>
      {list === null || list.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          <ShieldAlert className="mx-auto mb-2 size-8" />
          {list === null ? "Loading…" : "You haven't filed any complaints."}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>{["Complaint ID", "Date", "Vehicle number", "Status"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <Link href={`/user/complaints/view?id=${c.id}`} className="font-mono text-xs font-bold text-primary hover:underline">{c.complaintId}</Link>
                    {c.awaitingInfo && <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-status-reserved"><AlertTriangle className="size-3" /> Reply needed</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">{fmtDateTime(c.createdAt)}</td>
                  <td className="px-4 py-3 font-display font-bold tracking-wider">{c.vehicleNumber}</td>
                  <td className="px-4 py-3"><StatusBadge s={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
