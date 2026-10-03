"use client";

import { useEffect, useState } from "react";
import { FileVideo, Send } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/command/ui";
import { FootagePlayer } from "@/components/vision/footage-player";
import { useCommand } from "@/lib/command/store";
import { useLive } from "@/lib/live/provider";
import { fmtDateTime } from "@/lib/live/time";
import type { FootageRequest, LiveLot } from "@/lib/live/types";
import { cn } from "@/lib/utils";

const WINDOWS = ["Last 30 minutes", "Last 2 hours", "Today 08:00–12:00", "Today 12:00–18:00", "Today 18:00–23:00"];
const REASONS = ["Illegal parking complaint", "Vehicle damage / theft report", "Overflow incident review", "Lost vehicle search", "Audit / inspection"];

/** Command centre asks a private operator for recorded footage; the operator approves in their portal. */
export function OperatorFootage() {
  const live = useLive();
  const cmd = useCommand();
  const [lots, setLots] = useState<LiveLot[]>([]);
  const [reqs, setReqs] = useState<FootageRequest[]>([]);
  const [lotId, setLotId] = useState("");
  const [win, setWin] = useState(WINDOWS[0]);
  const [reason, setReason] = useState(REASONS[0]);
  const [view, setView] = useState<FootageRequest | null>(null);

  useEffect(() => {
    if (!live.store) return;
    const a = live.store.watch<LiveLot>("lots", null, setLots);
    const b = live.store.watch<FootageRequest>("footage", null, (l) => setReqs(l.sort((x, y) => y.createdAt - x.createdAt)));
    return () => {
      a();
      b();
    };
  }, [live.store]);
  useEffect(() => {
    if (!lotId && lots[0]) setLotId(lots[0].id);
  }, [lots, lotId]);

  const send = async () => {
    const lot = lots.find((l) => l.id === lotId);
    if (!live.store || !lot) return;
    const id = live.store.newId();
    const r: FootageRequest = {
      id, lotId: lot.id, lotName: lot.name, ownerUid: lot.ownerUid, ownerName: lot.ownerName,
      requestedBy: cmd.user?.name ?? "Command centre", requestedById: cmd.user?.id ?? "cmd", reason, window: win, status: "pending", createdAt: Date.now(),
    };
    await live.store.set("footage", id, r);
    cmd.log({ action: "footage.request", entity: `lot:${lot.id}`, detail: `Requested ${win} footage from ${lot.ownerName}: ${reason}` });
    toast.success(`Request sent to ${lot.ownerName}`);
  };

  return (
    <Panel title="Operator footage (private lots)" subtitle="Private operators keep their own CCTV. The command centre requests a clip; the operator approves; every step is audited.">
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2 text-xs">
          {lots.length === 0 ? (
            <p className="text-[hsl(var(--cc-dim))]">No private operator lots registered yet.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label="Lot" value={lotId} onChange={(e) => setLotId(e.target.value)} className="h-9 rounded border border-[hsl(var(--cc-line))] bg-transparent px-2 text-slate-100">
                {lots.map((l) => <option key={l.id} value={l.id} className="bg-slate-900">{l.name} · {l.ownerName}</option>)}
              </select>
              <select aria-label="Time window" value={win} onChange={(e) => setWin(e.target.value)} className="h-9 rounded border border-[hsl(var(--cc-line))] bg-transparent px-2 text-slate-100">
                {WINDOWS.map((w) => <option key={w} className="bg-slate-900">{w}</option>)}
              </select>
              <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded border border-[hsl(var(--cc-line))] bg-transparent px-2 text-slate-100">
                {REASONS.map((w) => <option key={w} className="bg-slate-900">{w}</option>)}
              </select>
            </div>
          )}
          <button onClick={send} disabled={!lotId} className="inline-flex items-center gap-1.5 rounded border border-sky-500/50 px-3 py-1.5 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"><Send className="size-3.5" /> Request footage</button>
          <ul className="mt-2 divide-y divide-[hsl(var(--cc-line))]">
            {reqs.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-slate-200">{r.lotName} · {r.window}<span className="block text-[10px] text-[hsl(var(--cc-dim))]">{r.reason} · {fmtDateTime(r.createdAt)}</span></span>
                {r.status === "approved" ? (
                  <button onClick={() => setView(r)} className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-300"><FileVideo className="size-3.5" /> View</button>
                ) : (
                  <span className={cn("shrink-0 rounded px-2 py-0.5 font-semibold", r.status === "pending" ? "bg-amber-500/15 text-amber-300" : "bg-white/5 text-[hsl(var(--cc-dim))]")}>{r.status === "pending" ? "awaiting operator" : "declined"}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          {view ? (
            <FootagePlayer title={`SHARED · ${view.lotName} · ${view.window}`} watermark={`Shared by ${view.ownerName} · request ${view.id.slice(0, 8)} · evidence copy`} className="aspect-square max-h-[420px]" />
          ) : (
            <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-[hsl(var(--cc-line))] text-xs text-[hsl(var(--cc-dim))]">Approved clips play here</div>
          )}
        </div>
      </div>
    </Panel>
  );
}
