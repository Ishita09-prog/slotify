"use client";

import { useMemo, useState } from "react";
import { Download, Fingerprint, Link2, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { useCommand } from "@/lib/command/store";
import { CCButton, Kpi, Panel } from "@/components/command/ui";
import { cn } from "@/lib/utils";

const GROUPS = ["all", "auth", "incident", "ai", "simulation", "unit", "audit", "report", "system"] as const;

export default function AuditPage() {
  const cmd = useCommand();
  const [group, setGroup] = useState<(typeof GROUPS)[number]>("all");
  const [q, setQ] = useState("");
  const [result, setResult] = useState<null | { ok: boolean; brokenAt?: number; checked: number; at: number }>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...cmd.audit]
      .reverse()
      .filter((e) => (group === "all" ? true : group === "ai" ? e.action.startsWith("ai.") || e.action.startsWith("model.") : group === "system" ? e.action.startsWith("system.") || e.action.startsWith("device.") : group === "report" ? e.action.startsWith("report") : e.action.startsWith(group)))
      .filter((e) => !s || `${e.actor} ${e.action} ${e.entity} ${e.detail}`.toLowerCase().includes(s));
  }, [cmd.audit, group, q]);

  const head = cmd.audit[cmd.audit.length - 1];
  const humans = new Set(cmd.audit.filter((e) => e.role !== "system").map((e) => e.actorId)).size;

  const verify = async () => {
    setBusy(true);
    const r = await cmd.verify();
    setResult({ ...r, at: Date.now() });
    setBusy(false);
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), head: head?.hash, entries: cmd.audit }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `slotify-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    cmd.log({ action: "audit.export", entity: "ledger", detail: `${cmd.audit.length} entries exported as JSON`, source: "Audit console" });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Ledger entries" value={cmd.audit.length} icon={Link2} tone="info" sub="append-only, this session" />
        <Kpi label="Human actors" value={humans} sub="distinct signed-in officials" />
        <Kpi label="Decisions recorded" value={cmd.audit.filter((e) => /incident\.(approve|reject|close)/.test(e.action)).length} sub="approve / reject / close" />
        <Kpi
          label="Integrity"
          value={result ? (result.ok ? "INTACT" : `BROKEN #${result.brokenAt}`) : "—"}
          tone={result ? (result.ok ? "good" : "bad") : "default"}
          icon={result && !result.ok ? ShieldAlert : ShieldCheck}
          sub={result ? `${result.checked} entries re-hashed` : "run verification"}
        />
      </div>

      <Panel
        title="Hash chain"
        subtitle="hashₙ = SHA-256(seq | time | actor | role | action | entity | detail | source | hashₙ₋₁). Editing any entry breaks every hash after it."
        actions={
          <>
            <CCButton variant="primary" onClick={verify} disabled={busy || !cmd.can("audit.verify")}><Fingerprint className="size-3.5" /> Verify chain</CCButton>
            <CCButton onClick={exportJson} disabled={!cmd.can("audit.view")}><Download className="size-3.5" /> Export JSON</CCButton>
          </>
        }
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0 text-xs">
            <p className="cc-label">Chain head</p>
            <p className="cc-mono mt-1 break-all text-sky-300">{head?.hash ?? "—"}</p>
            <p className="mt-1 text-[hsl(var(--cc-dim))]">#{head?.seq} · {head?.action} · {head?.at}</p>
            {result && (
              <p className={cn("mt-2 rounded-md border px-2.5 py-1.5 font-semibold", result.ok ? "border-status-available/40 bg-status-available/5 text-status-available" : "border-status-occupied/50 bg-status-occupied/10 text-status-occupied")}>
                {result.ok ? `✓ All ${result.checked} entries verified — no entry has been altered, removed or reordered.` : `✗ Chain broken at entry #${result.brokenAt}: its contents no longer match its hash. Every later entry is now untrusted.`}
              </p>
            )}
          </div>
          <div className="rounded-md border border-dashed border-status-reserved/40 p-3 text-xs lg:w-72">
            <p className="font-semibold text-status-reserved">Tamper demo</p>
            <p className="mt-1 text-[hsl(var(--cc-dim))]">Simulates an insider editing one past entry directly in storage, then run Verify.</p>
            <div className="mt-2 flex gap-2">
              <CCButton variant="danger" disabled={!!cmd.tampered || !cmd.can("audit.verify") || cmd.audit.length < 4} onClick={() => { cmd.tamper(); setResult(null); }}>Edit an entry</CCButton>
              {cmd.tampered && <CCButton onClick={() => { cmd.undoTamper(); setResult(null); }}><Undo2 className="size-3.5" /> Undo</CCButton>}
            </div>
            {cmd.tampered && <p className="mt-1.5 text-status-occupied">Entry #{cmd.tampered.seq} was modified.</p>}
          </div>
        </div>
      </Panel>

      <Panel title="Activity log" subtitle="Newest first" bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-1 border-b border-[hsl(var(--cc-line))] p-2">
          {GROUPS.map((g) => (
            <button key={g} onClick={() => setGroup(g)} className={cn("rounded px-2 py-1 text-[11px] font-semibold capitalize", group === g ? "bg-sky-500/15 text-sky-300" : "text-[hsl(var(--cc-dim))] hover:bg-white/5")}>{g}</button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actor, incident, detail…"
            className="ml-auto w-full rounded-md border border-[hsl(var(--cc-line))] bg-transparent px-2.5 py-1 text-xs text-slate-100 placeholder:text-[hsl(var(--cc-dim))] focus:border-sky-500 focus:outline-none sm:w-64"
          />
        </div>
        <div className="max-h-[60dvh] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-[11px]">
            <thead className="cc-label sticky top-0 bg-[hsl(222_40%_8%)]">
              <tr className="border-b border-[hsl(var(--cc-line))]">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="py-2 font-semibold">Time (IST)</th>
                <th className="py-2 font-semibold">Actor</th>
                <th className="py-2 font-semibold">Action</th>
                <th className="py-2 font-semibold">Entity</th>
                <th className="py-2 font-semibold">Detail</th>
                <th className="py-2 pr-3 font-semibold">Hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.seq} className={cn("border-b border-[hsl(var(--cc-line))]/40 align-top", cmd.tampered?.seq === e.seq && "bg-status-occupied/10")}>
                  <td className="cc-mono px-3 py-1.5 text-[hsl(var(--cc-dim))]">{e.seq}</td>
                  <td className="cc-mono whitespace-nowrap py-1.5 text-slate-400">{e.at.slice(11, 19)}</td>
                  <td className="py-1.5 pr-2 text-slate-200">{e.actor}</td>
                  <td className="cc-mono py-1.5 pr-2 text-sky-300">{e.action}</td>
                  <td className="cc-mono py-1.5 pr-2 text-slate-400">{e.entity}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{e.detail} <span className="text-[hsl(var(--cc-dim))]">· {e.source}</span></td>
                  <td className="cc-mono py-1.5 pr-3 text-[hsl(var(--cc-dim))]" title={`prev ${e.prevHash}\nthis ${e.hash}`}>{e.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
