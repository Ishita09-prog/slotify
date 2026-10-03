"use client";

import { CheckCircle2, Siren, Smartphone, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { useMyNotices } from "@/components/live/driver-alerts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLive, useTick } from "@/lib/live/provider";
import { LowBalance, payChallan, updateNotice } from "@/lib/live/service";
import { fmtDateTime } from "@/lib/live/time";
import type { PayMethod, PoliceNotice } from "@/lib/live/types";
import { cn, formatINR } from "@/lib/utils";

export default function NoticesPage() {
  const live = useLive();
  const notices = useMyNotices();
  const now = useTick(1000);

  const moved = async (n: PoliceNotice) => {
    if (!live.store) return;
    await updateNotice(live.store, n, { status: "moved" });
    toast.success("Thanks! Police have been told your vehicle is moved.");
  };
  const pay = async (n: PoliceNotice, method: PayMethod) => {
    if (!live.store || !live.uid) return;
    try {
      await payChallan(live.store, n.id, live.uid, method);
      toast.success(`Fine ${formatINR(n.fine)} paid via ${method === "fastag" ? "FASTag" : "UPI"}`);
    } catch (e) {
      if (e instanceof LowBalance) toast.error(`FASTag balance ₹${e.balance} is too low. Pay by UPI or recharge.`);
      else toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notices" description="Traffic police alerts for your vehicles. Act on a notice in time and no fine is issued." />
      {notices.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 size-8 text-status-available" /> No notices. Drive safe!</Card>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => {
            const open = n.status === "sent" || n.status === "seen";
            const left = Math.max(0, n.dueAt - now);
            return (
              <Card key={n.id} className={cn("p-4", open && "border-red-500/50")}>
                <div className="flex items-start gap-3">
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", open ? "bg-red-600 text-white" : "bg-secondary")}><Siren className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{n.kind === "challan" ? "e-Challan" : "Notice"} · {n.issuedBy}</p>
                    <p className="font-display text-lg font-bold">{n.plate}: {n.violation}</p>
                    <p className="text-sm text-muted-foreground">{n.location} · {fmtDateTime(n.createdAt)} · fine {formatINR(n.fine)}</p>
                    {n.kind === "notice" && open && <p className="mt-1 text-sm font-semibold text-red-500">Move within {Math.floor(left / 60000)} min {Math.floor((left % 60000) / 1000)} s to avoid the fine</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {n.kind === "notice" && open && <Button size="sm" onClick={() => moved(n)}><CheckCircle2 /> I&apos;ve moved my car</Button>}
                      {n.kind === "challan" && n.status !== "paid" && (
                        <>
                          <Button size="sm" onClick={() => pay(n, "fastag")}><Wallet /> Pay {formatINR(n.fine)} with FASTag</Button>
                          <Button size="sm" variant="outline" onClick={() => pay(n, "upi")}><Smartphone /> UPI</Button>
                        </>
                      )}
                      {!open && n.kind === "notice" && n.status === "moved" && <span className="text-sm font-semibold text-status-available">Resolved: vehicle moved, no fine</span>}
                      {n.status === "paid" && <span className="text-sm font-semibold text-status-available">Paid via {n.paidMethod === "fastag" ? "FASTag" : "UPI"}</span>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
