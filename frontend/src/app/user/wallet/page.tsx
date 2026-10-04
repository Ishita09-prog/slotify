"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Radio, ShieldAlert, Wallet } from "lucide-react";
import { FastagTrace } from "@/components/live/fastag-trace";
import { GATEWAY_MS, PayGateway } from "@/components/fx/pay-gateway";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Txn } from "@/lib/live/types";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLive } from "@/lib/live/provider";
import { recharge, setTagStatus } from "@/lib/live/service";
import { fmtDateTime } from "@/lib/live/time";
import { cn, formatINR } from "@/lib/utils";

export default function WalletPage() {
  const live = useLive();
  const tag = live.account?.fastag;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Txn | null>(null);
  const hot = tag?.status === "hotlisted";
  const toggleHot = async () => {
    if (!live.store || !live.uid) return;
    setBusy(true);
    try {
      await setTagStatus(live.store, live.uid, hot ? "active" : "hotlisted");
      toast.success(hot ? "Tag reactivated on NETC" : "Tag hotlisted on NETC. Any gate that reads it will stop the car and alert security.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [paying, setPaying] = useState<number | null>(null);
  const add = async (amt: number) => {
    if (!live.store || !live.uid) return;
    setBusy(true);
    try {
      setPaying(amt);
      await new Promise((r) => setTimeout(r, GATEWAY_MS));
      setPaying(null);
      await recharge(live.store, live.uid, amt, "upi");
      toast.success(`${formatINR(amt)} added via UPI`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="FASTag" description="Pay the cover charge at booking and the balance at the exit gate automatically. No stopping, no cash." />
      {!tag ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No FASTag linked to this account.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 p-6 text-white shadow-xl">
              <div className="absolute -right-10 -top-10 size-40 rounded-full bg-primary/30 blur-2xl" />
              <div className="relative flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" /> FASTag</span>
                <Radio className="size-5 opacity-70" />
              </div>
              <p className="relative mt-6 text-xs text-white/60">Balance</p>
              <p className="relative font-display text-4xl font-extrabold tabular-nums">{formatINR(tag.balance)}</p>
              <div className="relative mt-6 flex items-end justify-between">
                <div>
                  <p className="rounded-md bg-white px-2 py-0.5 font-display text-sm font-extrabold tracking-wider text-slate-900">{tag.vehicle}</p>
                  <p className="mt-2 font-mono text-[10px] text-white/50">{tag.tagId}</p>
                </div>
                <p className="text-right text-[10px] text-white/50">{tag.bank}</p>
              </div>
            </div>
            <Card className="p-4">
              <p className="text-sm font-semibold">Recharge via UPI</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[200, 500, 1000].map((a) => <Button key={a} variant="outline" disabled={busy} onClick={() => add(a)}>+{formatINR(a)}</Button>)}
              </div>
              {tag.balance < 100 && <p className="mt-2 text-xs text-status-reserved">Low balance. If it can&apos;t cover the exit fee, the gate falls back to UPI or QR.</p>}
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Tag status on NETC</p>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", hot ? "bg-status-occupied/15 text-status-occupied" : "bg-status-available/15 text-status-available")}>{hot ? "Hotlisted" : "Active"}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{hot ? "Gates that read this tag hold the vehicle and alert security. Reactivate once you have the tag back." : "Lost the tag or the car was stolen? Hotlist it so no one can pay or park with it."}</p>
              <Button variant={hot ? "outline" : "destructive"} size="sm" className="mt-3" disabled={busy} onClick={toggleHot}><ShieldAlert /> {hot ? "Reactivate tag" : "Report tag lost / stolen"}</Button>
            </Card>
          </div>
          <Card className="p-4">
            <h2 className="font-display font-bold">Transactions</h2>
            <p className="text-xs text-muted-foreground">Tap one to trace it through the FASTag network: tag → gate → bank → NPCI → your issuer.</p>
            {live.txns.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No transactions yet. Recharge to get started.</p> : (
              <ul className="mt-2 divide-y">
                {live.txns.map((t) => (
                  <li key={t.id}><button onClick={() => setOpen(t)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-secondary/40">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", t.kind === "credit" ? "bg-status-available/15 text-status-available" : "bg-secondary")}>
                      {t.kind === "credit" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.desc}</p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(t.at)}</p>
                    </div>
                    <div className="text-right">
                      <p className={cn("font-semibold tabular-nums", t.kind === "credit" && "text-status-available")}>{t.kind === "credit" ? "+" : "−"}{formatINR(t.amount)}</p>
                      <p className="text-[11px] text-muted-foreground">bal {formatINR(t.balanceAfter)}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <Dialog open={paying != null}>
        <DialogContent hideClose>
          <DialogTitle className="sr-only">Processing recharge</DialogTitle>
          <DialogDescription className="sr-only">Authorising UPI payment</DialogDescription>
          {paying != null && <PayGateway amount={paying} method="upi" />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-xl">
          <DialogTitle>Transaction trace</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{open?.id} · {open ? fmtDateTime(open.at) : ""}</DialogDescription>
          {open && <FastagTrace txn={open} bank={tag?.bank} />}
          <p className="text-[11px] text-muted-foreground">Banks and NPCI are simulated (NETC sandbox). Reference numbers are stable for each transaction.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
