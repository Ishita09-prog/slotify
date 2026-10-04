"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ComplaintActions, ComplaintDetail, OwnerEvidencePanel, useComplaint } from "@/components/live/complaint-ui";
import { Card } from "@/components/ui/card";
import { complaintAction } from "@/lib/live/complaint-service";
import { useLive } from "@/lib/live/provider";

function View() {
  const id = useSearchParams().get("id") ?? "";
  const live = useLive();
  const c = useComplaint(id);
  const actor = { id: live.uid ?? "", name: live.account?.business || live.account?.name || "Operator", role: "owner" as const };
  const opened = useRef(false);

  // Opening a new complaint is itself recorded ("Owner Reviewed") and moves it to Under Owner Review.
  useEffect(() => {
    if (opened.current || !live.store || !c || c.ownerUid !== live.uid || c.status !== "submitted") return;
    opened.current = true;
    void complaintAction(live.store, c.id, actor, "owner_review").catch(() => {});
  }, [live.store, c, live.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/owner/complaints" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Fraud complaints</Link>
      {c === undefined ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : c === null || c.ownerUid !== live.uid ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Complaint not found.</Card>
      ) : (
        <>
          <PageHeader title="Review complaint" description="Check your gate records below. Forward it if the driver's claim looks credible." />
          <div className="space-y-4">
            <OwnerEvidencePanel c={c} actor={actor} />
            <ComplaintActions c={c} actor={actor} />
            <ComplaintDetail c={c} viewer="owner" />
          </div>
        </>
      )}
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
