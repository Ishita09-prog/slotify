"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ScanLine, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { FootagePlayer } from "@/components/vision/footage-player";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLive } from "@/lib/live/provider";
import { fmtDateTime } from "@/lib/live/time";
import type { FootageRequest } from "@/lib/live/types";
import { cn } from "@/lib/utils";

export default function OwnerCameras() {
  const live = useLive();
  const mine = live.lots.filter((l) => l.ownerUid === live.uid);
  const [reqs, setReqs] = useState<FootageRequest[]>([]);
  useEffect(() => {
    if (!live.store || !live.uid) return;
    return live.store.watch<FootageRequest>("footage", ["ownerUid", live.uid], (l) => setReqs(l.sort((a, b) => b.createdAt - a.createdAt)));
  }, [live.store, live.uid]);

  const decide = async (r: FootageRequest, status: "approved" | "declined") => {
    if (!live.store) return;
    await live.store.set("footage", r.id, { ...r, status, decidedAt: Date.now(), note: status === "approved" ? "Shared from operator NVR" : "Declined by operator" });
    toast.success(status === "approved" ? "Footage shared with the command centre" : "Request declined");
  };
  const pending = reqs.filter((r) => r.status === "pending");

  return (
    <>
      <PageHeader title="Cameras" description="Your own CCTV. Footage stays with you; the command centre can only see it if you approve a request." />
      {pending.length > 0 && (
        <Card className="mb-4 border-status-reserved/50 p-4">
          <h2 className="flex items-center gap-2 font-display font-bold"><ShieldCheck className="size-4 text-status-reserved" /> Footage requests from the command centre</h2>
          <ul className="mt-3 space-y-2">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p><b>{r.requestedBy}</b> wants <b>{r.lotName}</b> footage · {r.window}</p>
                  <p className="text-xs text-muted-foreground">Reason: {r.reason} · {fmtDateTime(r.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(r, "approved")}><Check /> Share</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(r, "declined")}><X /> Decline</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {mine.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Add a parking location first.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {mine.map((lot) => (
            <Card key={lot.id} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display font-bold">{lot.name}</p>
                <Button asChild size="sm" variant="outline"><Link href={`/owner/gate?lot=${lot.id}`}><ScanLine /> Entry ANPR camera</Link></Button>
              </div>
              <FootagePlayer title={`BAY-CAM · ${lot.name}`} watermark={`${lot.ownerName} · recorded · demo clip`} />
            </Card>
          ))}
        </div>
      )}
      {reqs.some((r) => r.status !== "pending") && (
        <Card className="mt-4 p-4">
          <h2 className="font-display font-bold">Sharing history</h2>
          <ul className="mt-2 divide-y text-sm">
            {reqs.filter((r) => r.status !== "pending").map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>{r.lotName} · {r.window} · {r.requestedBy}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.status === "approved" ? "bg-status-available/15 text-status-available" : "bg-secondary text-muted-foreground")}>{r.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
