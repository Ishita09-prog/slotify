"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Radio, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLive } from "@/lib/live/provider";
import { recharge } from "@/lib/live/service";
import { fmtDateTime } from "@/lib/live/time";
import { cn, formatINR } from "@/lib/utils";

export default function WalletPage() {
  const live = useLive();
  const tag = live.account?.fastag;
  const [busy, setBusy] = useState(false);

  const add = async (amt: number) => {
    if (!live.store || !live.uid) return;
    setBusy(true);
    try {
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
          </div>
          <Card className="p-4">
            <h2 className="font-display font-bold">Transactions</h2>
            {live.txns.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No transactions yet. Recharge to get started.</p> : (
              <ul className="mt-2 divide-y">
                {live.txns.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-3">
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
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
