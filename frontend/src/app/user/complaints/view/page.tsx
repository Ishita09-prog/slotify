"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ComplaintDetail, ReplyForm, useComplaint } from "@/components/live/complaint-ui";
import { Card } from "@/components/ui/card";
import { useLive } from "@/lib/live/provider";

function View() {
  const id = useSearchParams().get("id") ?? "";
  const live = useLive();
  const c = useComplaint(id);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/user/complaints" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> My Complaints</Link>
      {c === undefined ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : c === null || c.userId !== live.uid ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Complaint not found.</Card>
      ) : (
        <>
          <PageHeader title="Complaint progress" description="Every step is recorded below and can't be changed afterwards." />
          <div className="space-y-4">
            <ReplyForm c={c} actor={{ id: live.uid!, name: live.account?.name ?? "Driver", role: "driver" }} />
            <ComplaintDetail c={c} viewer="driver" />
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
