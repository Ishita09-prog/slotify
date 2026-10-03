"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Panel } from "@/components/command/ui";
import { ComplaintActions, ComplaintDetail, useComplaint } from "@/components/live/complaint-ui";
import { ACTION_LABEL } from "@/lib/live/complaints";
import { useCommand } from "@/lib/command/store";

/** Investigation view: transaction, entry/exit, evidence, history and the Command Centre's decisions. */
function View() {
  const id = useSearchParams().get("id") ?? "";
  const cmd = useCommand();
  const c = useComplaint(id);
  const back = <Link href="/command/disputes" className="mb-3 inline-flex items-center gap-1.5 text-sm text-[hsl(var(--cc-dim))] hover:text-slate-100"><ArrowLeft className="size-4" /> FASTag Dispute Resolution</Link>;
  if (!cmd.can("dispute.manage") || !cmd.user) return <>{back}<Panel title="Restricted"><p className="text-sm text-[hsl(var(--cc-dim))]">Only a Command Officer can open dispute cases.</p></Panel></>;
  if (c === undefined) return <>{back}<Panel><p className="text-sm text-[hsl(var(--cc-dim))]">Loading…</p></Panel></>;
  if (c === null || !c.auditLog.some((e) => e.to === "forwarded")) return <>{back}<Panel><p className="text-sm text-[hsl(var(--cc-dim))]">Case not found, or it hasn't reached the Command Centre yet.</p></Panel></>;
  const actor = { id: cmd.user.id, name: cmd.user.name, role: "command" as const };
  return (
    <div className="mx-auto max-w-4xl">
      {back}
      <div className="space-y-4">
        <ComplaintActions
          c={c}
          actor={actor}
          variant="cc"
          onDone={(a, next, note) => cmd.log({ action: `dispute.${a}`, entity: `complaint:${next.id}`, detail: `${ACTION_LABEL[a]} · ${next.vehicleNumber}${next.refund && a === "approve_refund" ? ` · ₹${next.refund.amount}` : ""}${note ? ` · ${note}` : ""}`, source: "FASTag Dispute Resolution" })}
        />
        <ComplaintDetail c={c} viewer="command" variant="cc" />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  );
}
