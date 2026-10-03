"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, BrainCircuit, Cctv, FileText, FlaskConical, LayoutDashboard, LogOut, Network, Scale, ScrollText, ServerCrash, ShieldCheck, Siren,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { CitySwitcher } from "@/components/layout/city-switcher";
import { useCity } from "@/lib/city";
import { ROLES } from "@/lib/command/rbac";
import { useCommand } from "@/lib/command/store";
import { useSlotify } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SimConsole } from "./sim-console";
import { SimTag } from "./ui";
import { LiveCameraLauncher } from "@/components/vision/live-camera";

const NAV = [
  { href: "/command", label: "Situation", icon: LayoutDashboard },
  { href: "/command/incidents", label: "Incidents", icon: Siren },
  { href: "/command/cameras", label: "Live cameras", icon: Cctv },
  { href: "/command/forecast", label: "AI & forecasts", icon: BrainCircuit },
  { href: "/command/health", label: "System health", icon: Activity },
  { href: "/command/audit", label: "Audit trail", icon: ScrollText },
  { href: "/command/disputes", label: "FASTag disputes", icon: Scale },
  { href: "/command/reports", label: "Reports", icon: FileText },
  { href: "/command/architecture", label: "Architecture", icon: Network },
];

function IstClock() {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => {
    const f = () =>
      setT(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    f();
    const i = window.setInterval(f, 1000);
    return () => window.clearInterval(i);
  }, []);
  return (
    <span className="cc-mono text-sm font-semibold tabular-nums text-slate-100">
      {t ?? "--:--:--"} <span className="text-[10px] text-[hsl(var(--cc-dim))]">IST</span>
    </span>
  );
}

function Pill({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
      ok ? "border-status-available/30 text-status-available" : warn ? "border-status-reserved/40 text-status-reserved" : "border-status-occupied/40 text-status-occupied"
    )}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-status-available" : warn ? "bg-status-reserved" : "bg-status-occupied", ok && "animate-pulse-dot")} />
      {label}
    </span>
  );
}

export function CommandShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { city } = useCity();
  const cmd = useCommand();
  const { state } = useSlotify();
  const [simOpen, setSimOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  // Route guard (client-side for the prototype; production enforces the same rules at the API gateway).
  useEffect(() => {
    const t = window.setTimeout(() => setChecked(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (checked && !cmd.can("command.view")) router.replace("/login/command");
  }, [checked, cmd, pathname, router]);

  const open = cmd.incidents.filter((i) => i.status !== "resolved" && i.status !== "rejected");
  const awaiting = open.filter((i) => i.status === "awaiting_approval").length;
  const offline = Object.keys(state.offline).length;

  if (!cmd.can("command.view")) {
    return (
      <div className="cc-root dark grid min-h-dvh place-items-center text-slate-300">
        <p className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-sky-400" /> Checking your access…</p>
      </div>
    );
  }

  return (
    <div className="cc-root dark min-h-dvh text-slate-200">
      {/* Top bar */}
      <header className="sticky top-0 z-[1100] border-b border-[hsl(var(--cc-line))] bg-[hsl(222_47%_5%/0.92)] backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Logo className="shrink-0 text-slate-100" />
          <div className="hidden min-w-0 border-l border-[hsl(var(--cc-line))] pl-3 md:block">
            <p className="truncate font-display text-[13px] font-bold uppercase tracking-[0.12em] text-slate-100">Parking Command Centre</p>
            <p className="truncate text-[11px] text-[hsl(var(--cc-dim))]">{city.authority} · {city.police}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1.5 xl:flex">
              <Pill ok={!cmd.apiDown} warn label={cmd.apiDown ? "API degraded · edge mode" : "API online"} />
              <Pill ok={offline === 0} warn label={offline ? `${offline} camera node down` : "Cameras online"} />
              <Pill ok={cmd.modelReady} warn label={cmd.modelReady ? "Model ready" : "Loading model"} />
            </div>
            <SimTag className="hidden sm:inline-flex" />
            <CitySwitcher compact className="border-[hsl(var(--cc-line))] bg-transparent" />
            <div className="hidden sm:block"><IstClock /></div>
            <LiveCameraLauncher dark />
            <button
              onClick={() => setSimOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-status-reserved/40 px-2.5 py-1.5 text-xs font-semibold text-status-reserved hover:bg-status-reserved/10"
            >
              <FlaskConical className="size-3.5" /> <span className="hidden sm:inline">Drills</span>
              {cmd.activeScenarios.length > 0 && <span className="rounded bg-status-reserved px-1 text-[10px] text-slate-950">{cmd.activeScenarios.length}</span>}
            </button>
          </div>
        </div>
        {cmd.apiDown && (
          <div className="flex items-center gap-2 border-t border-status-reserved/30 bg-status-reserved/10 px-4 py-1.5 text-xs text-status-reserved">
            <ServerCrash className="size-3.5 shrink-0" />
            <span><b>Degraded mode:</b> central API unreachable. Running on edge camera data and the on-device model; writes are queued and replayed on recovery. No data lost.</span>
          </div>
        )}
      </header>

      <div className="flex">
        {/* Rail */}
        <nav className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-14 shrink-0 flex-col gap-1 border-r border-[hsl(var(--cc-line))] p-2 md:flex xl:w-52" aria-label="Command Centre">
          {NAV.map((n) => {
            const active = n.href === "/command" ? pathname === n.href : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                title={n.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30" : "text-[hsl(var(--cc-dim))] hover:bg-white/5 hover:text-slate-100"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden xl:inline">{n.label}</span>
                {n.href === "/command/incidents" && awaiting > 0 && (
                  <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-status-occupied px-1 text-[9px] font-bold text-white xl:static xl:ml-auto">
                    {awaiting}
                  </span>
                )}
              </Link>
            );
          })}
          <div className="mt-auto hidden rounded-md border border-[hsl(var(--cc-line))] p-2.5 xl:block">
            <p className="truncate text-xs font-semibold text-slate-100">{cmd.user?.name}</p>
            <p className="truncate text-[10px] text-[hsl(var(--cc-dim))]">{cmd.user && ROLES[cmd.user.role].label}</p>
            <p className="cc-mono mt-1 truncate text-[10px] text-[hsl(var(--cc-dim))]">{cmd.user?.id}</p>
            <div className="mt-2 flex gap-1">
              <Link href="/user" className="flex-1 rounded border border-[hsl(var(--cc-line))] py-1 text-center text-[10px] text-[hsl(var(--cc-dim))] hover:text-slate-100">Citizen app</Link>
              <button onClick={() => { cmd.logout(); router.push("/login"); }} className="rounded border border-[hsl(var(--cc-line))] px-2 text-[hsl(var(--cc-dim))] hover:text-slate-100" aria-label="Sign out">
                <LogOut className="size-3" />
              </button>
            </div>
          </div>
        </nav>

        <main className="min-w-0 flex-1 p-3 pb-20 sm:p-4">{children}</main>
      </div>

      {/* Mobile nav */}
      <nav className="fixed inset-x-0 bottom-0 z-[1100] grid grid-cols-9 border-t border-[hsl(var(--cc-line))] bg-[hsl(222_47%_5%/0.96)] md:hidden" aria-label="Command Centre mobile">
        {NAV.map((n) => {
          const active = n.href === "/command" ? pathname === n.href : pathname.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[9px]", active ? "text-sky-300" : "text-[hsl(var(--cc-dim))]")}>
              <Icon className="size-4" />
              {n.label.split(" ")[0]}
            </Link>
          );
        })}
      </nav>

      <SimConsole open={simOpen} onClose={() => setSimOpen(false)} />
    </div>
  );
}
