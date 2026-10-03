"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeIndianRupee, FileWarning, ScanLine, Search, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Plate } from "@/components/brand/plate";
import { StatCard } from "@/components/parking/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNow, useSlotify } from "@/lib/store";
import { useCommand } from "@/lib/command/store";
import Link from "next/link";
import { Radio } from "lucide-react";
import type { ViolationStatus } from "@/lib/types";
import { cn, formatClock, formatINR, normalizePlate, timeAgo } from "@/lib/utils";

const STATUS: Record<ViolationStatus, { label: string; variant: "occupied" | "reserved" | "default" | "available" }> = {
  detected: { label: "Detected", variant: "occupied" },
  notice_sent: { label: "Notice sent", variant: "reserved" },
  challan_issued: { label: "Challan issued", variant: "default" },
  resolved: { label: "Resolved", variant: "available" },
};

const NEXT: Partial<Record<ViolationStatus, { to: ViolationStatus; label: string }>> = {
  detected: { to: "notice_sent", label: "Send SMS notice" },
  notice_sent: { to: "challan_issued", label: "Issue e-challan" },
  challan_issued: { to: "resolved", label: "Mark paid" },
};

export default function ViolationsPage() {
  const { state, actions } = useSlotify();
  const now = useNow(10000);
  const [filter, setFilter] = useState<ViolationStatus | "all">("all");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const qq = normalizePlate(q);
    return state.violations.filter(
      (v) => (filter === "all" || v.status === filter) && (!q || v.vehicleNumber.includes(qq) || v.location.toLowerCase().includes(q.toLowerCase()))
    );
  }, [state.violations, filter, q]);

  const today = state.violations;
  const pending = today.filter((v) => v.status === "detected" || v.status === "notice_sent").length;
  const challans = today.filter((v) => v.status === "challan_issued" || v.status === "resolved");
  const fines = challans.reduce((a, v) => a + v.fine, 0);
  const avgConf = today.reduce((a, v) => a + v.confidence, 0) / Math.max(1, today.length);

  return (
    <>
      <PageHeader
        title="Illegal parking detection"
        description="ANPR cameras flag vehicles parked in no-parking zones, on footpaths, or blocking traffic. New detections appear at the top."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Detections today" value={today.length} icon={ScanLine} tone="occupied" sub={`${Math.round(avgConf * 100)}% average AI confidence`} />
        <StatCard label="Awaiting action" value={pending} icon={FileWarning} tone="reserved" />
        <StatCard label="Challans issued" value={challans.length} icon={ShieldCheck} tone="primary" />
        <StatCard label="Fines raised" value={formatINR(fines)} icon={BadgeIndianRupee} tone="accent" />
      </div>

      <CommandDispatches />

      <Card className="mt-4">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1 rounded-lg bg-secondary/60 p-1 text-xs font-semibold">
            {(["all", "detected", "notice_sent", "challan_issued", "resolved"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn("rounded-md px-2.5 py-1", filter === f ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {f === "all" ? "All" : STATUS[f].label}
              </button>
            ))}
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plate or street" className="pl-9" aria-label="Search violations" />
          </div>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Vehicle number</th>
                  <th className="px-4 py-3 font-semibold">Timestamp</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Violation</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {list.map((v) => {
                    const fresh = now !== null && now - v.at < 15000;
                    const next = NEXT[v.status];
                    return (
                      <motion.tr
                        key={v.id}
                        layout
                        initial={{ opacity: 0, backgroundColor: "hsl(0 80% 55% / 0.25)" }}
                        animate={{ opacity: 1, backgroundColor: "hsl(0 80% 55% / 0)" }}
                        transition={{ duration: 1.6 }}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Plate value={v.vehicleNumber} />
                            {fresh && <span className="rounded bg-status-occupied px-1.5 text-[10px] font-bold text-white">New</span>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <p className="tabular-nums">{formatClock(v.at)}</p>
                          <p className="text-xs text-muted-foreground">{timeAgo(v.at, now)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="min-w-40">{v.location}</p>
                          <p className="text-xs text-muted-foreground">{v.camera}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <p>{v.type}</p>
                          <p className="text-xs text-muted-foreground">{Math.round(v.confidence * 100)}% confidence · ₹{v.fine}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3"><Badge variant={STATUS[v.status].variant}>{STATUS[v.status].label}</Badge></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {next ? (
                            <Button size="sm" variant={v.status === "detected" ? "default" : "outline"} onClick={() => actions.updateViolation(v.id, next.to)}>
                              {next.label}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Closed</span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          {list.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">No violations match these filters.</p>}
        </CardContent>
      </Card>
    </>
  );
}


/** Alerts pushed to field units by the Command Centre (the "responsible authority receives the alert" step). */
function CommandDispatches() {
  const cmd = useCommand();
  const now = useNow(5000);
  const field = cmd.notifications.filter((n) => n.channel === "Field app push" || n.channel === "SMS").slice(0, 5);
  const pending = cmd.incidents.filter((i) => i.status === "awaiting_approval" && i.recommendations.some((r) => r.enforcement));
  if (!field.length && !pending.length) return null;
  return (
    <Card className="mt-4 border-primary/40">
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-display font-bold"><Radio className="size-4 animate-pulse text-primary" /> From the Command Centre</p>
          <Link href="/login/command" className="text-xs font-semibold text-primary hover:underline">
            {pending.length ? `${pending.length} enforcement decision${pending.length > 1 ? "s" : ""} awaiting approval →` : "Open Command Centre →"}
          </Link>
        </div>
        <ul className="mt-3 space-y-2">
          {field.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-lg border p-2.5 text-sm">
              <Badge variant={n.status === "acknowledged" ? "available" : "default"}>{n.status}</Badge>
              <div className="min-w-0">
                <p className="font-semibold">{n.to}</p>
                <p className="truncate text-xs text-muted-foreground">{n.message}</p>
              </div>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(n.at, now)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
