"use client";

import { AlertOctagon, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import type { IncidentStatus, Severity } from "@/lib/command/types";
import { cn } from "@/lib/utils";

export function Panel({
  title, subtitle, actions, children, className, bodyClassName,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("cc-panel flex min-w-0 flex-col", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-[hsl(var(--cc-line))] px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="truncate font-display text-[13px] font-bold uppercase tracking-[0.08em] text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--cc-dim))]">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kpi({
  label, value, sub, tone = "default", icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad" | "info";
  icon?: React.ElementType;
}) {
  const toneCls = {
    default: "text-slate-100",
    good: "text-status-available",
    warn: "text-status-reserved",
    bad: "text-status-occupied",
    info: "text-sky-400",
  }[tone];
  return (
    <div className="cc-panel px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="cc-label">{label}</p>
        {Icon && <Icon className={cn("size-3.5", toneCls)} aria-hidden />}
      </div>
      <p className={cn("cc-mono mt-1.5 text-2xl font-bold leading-none tabular-nums", toneCls)}>{value}</p>
      {sub && <p className="mt-1.5 truncate text-[11px] text-[hsl(var(--cc-dim))]">{sub}</p>}
    </div>
  );
}

export const SEVERITY: Record<Severity, { label: string; cls: string; dot: string; icon: React.ElementType }> = {
  critical: { label: "Critical", cls: "bg-status-occupied/15 text-status-occupied ring-status-occupied/40", dot: "bg-status-occupied", icon: AlertOctagon },
  high: { label: "High", cls: "bg-orange-500/15 text-orange-400 ring-orange-500/40", dot: "bg-orange-400", icon: ShieldAlert },
  medium: { label: "Medium", cls: "bg-status-reserved/15 text-status-reserved ring-status-reserved/40", dot: "bg-status-reserved", icon: AlertTriangle },
  low: { label: "Low", cls: "bg-sky-500/15 text-sky-400 ring-sky-500/40", dot: "bg-sky-400", icon: Info },
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEVERITY[severity];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1", s.cls, className)}>
      <Icon className="size-3" aria-hidden /> {s.label}
    </span>
  );
}

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  awaiting_approval: "Awaiting approval",
  dispatched: "Dispatched",
  on_scene: "Unit on scene",
  monitoring: "Monitoring",
  resolved: "Resolved",
  rejected: "Rejected",
};

export function StatusPill({ status, ready }: { status: IncidentStatus; ready?: boolean }) {
  const cls =
    status === "awaiting_approval"
      ? "border-status-reserved/50 text-status-reserved"
      : status === "resolved"
        ? "border-status-available/50 text-status-available"
        : status === "rejected"
          ? "border-slate-500/50 text-slate-400"
          : "border-sky-500/50 text-sky-400";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cls)}>
      {status === "awaiting_approval" && <span className="size-1.5 animate-pulse-dot rounded-full bg-status-reserved" />}
      {ready && status !== "resolved" ? "Ready to close" : STATUS_LABEL[status]}
    </span>
  );
}

export function SimTag({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded border border-status-reserved/40 bg-status-reserved/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-status-reserved", className)}
      title="All occupancy, camera, traffic and enforcement data in this prototype is simulated."
    >
      Simulated data
    </span>
  );
}

export function OccBar({ value, className }: { value: number; className?: string }) {
  const color = value >= 0.95 ? "bg-status-occupied" : value >= 0.8 ? "bg-status-reserved" : "bg-status-available";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-800", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700", color)} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function occTone(v: number) {
  return v >= 0.95 ? "text-status-occupied" : v >= 0.8 ? "text-status-reserved" : "text-status-available";
}

export const CCButton = ({ className, variant = "default", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) => (
  <button
    {...props}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
      variant === "primary" && "bg-sky-500 text-slate-950 hover:bg-sky-400",
      variant === "danger" && "border border-status-occupied/50 text-status-occupied hover:bg-status-occupied/10",
      variant === "ghost" && "text-[hsl(var(--cc-dim))] hover:bg-white/5 hover:text-slate-100",
      variant === "default" && "border border-[hsl(var(--cc-line))] bg-white/[0.03] text-slate-200 hover:bg-white/[0.07]",
      className
    )}
  />
);
