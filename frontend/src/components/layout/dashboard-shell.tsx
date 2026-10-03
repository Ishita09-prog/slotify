"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLive } from "@/lib/live/provider";
import { AnimatePresence, motion } from "framer-motion";
import { UserRound, Cctv, ScanLine, LogOut, Loader2, Database,
  Activity, BarChart3, BrainCircuit, Building2, CarFront, LayoutGrid, Map as MapIcon,
  Menu, Radar, ShieldAlert, Siren, Ticket, Wallet, Wrench, X,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useSlotify } from "@/lib/store";
import { useCity } from "@/lib/city";
import { CitySwitcher } from "@/components/layout/city-switcher";
import { LiveCameraLauncher } from "@/components/vision/live-camera";
import { cn } from "@/lib/utils";

export type Role = "user" | "owner" | "police";

const NAV: Record<Role, { title: string; subtitle: string; items: { href: string; label: string; icon: React.ElementType }[] }> = {
  user: {
    title: "Driver",
    subtitle: "Find and book parking",
    items: [
      { href: "/user", label: "Find parking", icon: MapIcon },
      { href: "/user/predict", label: "AI forecast", icon: BrainCircuit },
      { href: "/user/bookings", label: "My bookings", icon: Ticket },
      { href: "/user/wallet", label: "FASTag", icon: Wallet },
      { href: "/user/profile", label: "Profile", icon: UserRound },
    ],
  },
  owner: {
    title: "Parking owner",
    subtitle: "Your parking locations",
    items: [
      { href: "/owner", label: "My locations", icon: Building2 },
      { href: "/owner/gate", label: "FASTag gate", icon: ScanLine },
      { href: "/owner/cameras", label: "Cameras", icon: Cctv },
      { href: "/owner/bookings", label: "Bookings", icon: Ticket },
    ],
  },
  police: {
    title: "City police",
    subtitle: "{police}",
    items: [
      { href: "/police", label: "Violations", icon: ShieldAlert },
      { href: "/police/map", label: "Map view", icon: MapIcon },
      { href: "/police/congestion", label: "Congestion", icon: LayoutGrid },
    ],
  },
};

const ROLE_LINKS: { role: Role; href: string; label: string; icon: React.ElementType }[] = [
  { role: "user", href: "/user", label: "Driver", icon: CarFront },
  { role: "owner", href: "/owner", label: "Owner", icon: Building2 },
  { role: "police", href: "/police", label: "Police", icon: Siren },
];

function subtitleFor(raw: string, city: ReturnType<typeof useCity>["city"]) {
  return raw.replace("{owner}", city.demoOwnerName).replace("{police}", city.police);
}

function LiveBadge() {
  const { state } = useSlotify();
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-xs font-medium text-muted-foreground">
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-available opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-status-available" />
      </span>
      {state.liveSource === "firestore" ? "Live · Firestore" : "Live · AI cameras"}
    </span>
  );
}

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const nav = NAV[role];
  return (
    <nav className="flex flex-col gap-1" aria-label={`${nav.title} navigation`}>
      {nav.items.map((item) => {
        const active = item.href === `/${role}` ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={`nav-${role}`}
                className="absolute inset-0 rounded-lg bg-primary/12 ring-1 ring-primary/30"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <Icon className={cn("relative size-4", active && "text-primary")} />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function RoleSwitch({ role }: { role: Role }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/60 p-1" role="tablist" aria-label="Switch dashboard">
      {ROLE_LINKS.map((r) => {
        const Icon = r.icon;
        return (
          <Link
            key={r.role}
            href={r.href}
            role="tab"
            aria-selected={r.role === role}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[11px] font-semibold transition-colors",
              r.role === role ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}

function AccountCard({ onNavigate }: { onNavigate?: () => void }) {
  const live = useLive();
  const router = useRouter();
  const a = live.account;
  if (!a) return null;
  return (
    <div className="mt-auto rounded-xl border border-border/70 bg-secondary/30 p-3 text-xs">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-bold text-white">
          {a.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{a.business || a.name}</p>
          <p className="truncate text-muted-foreground">@{a.username} · {a.role === "owner" ? "Parking operator" : "Driver"}</p>
        </div>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-status-available"><Database className="size-3" /> {live.store?.label}</p>
      <button
        onClick={async () => { onNavigate?.(); await live.signOut(); router.replace("/login"); }}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <LogOut className="size-3.5" /> Sign out
      </button>
    </div>
  );
}

function useGuard(role: Role) {
  const live = useLive();
  const router = useRouter();
  const need = role === "user" ? "driver" : role === "owner" ? "owner" : null;
  const ok = !need || live.account?.role === need;
  useEffect(() => {
    if (!need || !live.authReady) return;
    if (!live.uid) router.replace(need === "driver" ? "/login/driver" : "/login/operator");
    else if (live.account && live.account.role !== need) router.replace("/login");
  }, [need, live.authReady, live.uid, live.account, router]);
  return ok;
}

function BottomTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = NAV[role].items;
  return (
    <nav className="glass fixed inset-x-3 bottom-3 z-30 grid rounded-2xl p-1 lg:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))`, paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }} aria-label="Tabs">
      {items.map((it) => {
        const active = it.href === `/${role}` ? pathname === it.href || pathname === `${it.href}/` : pathname.startsWith(it.href);
        const Icon = it.icon;
        return (
          <Link key={it.href} href={it.href} className={cn("flex flex-col items-center gap-0.5 rounded-xl py-2 text-[10px] font-semibold transition-colors", active ? "bg-primary/15 text-primary" : "text-muted-foreground")}>
            <Icon className="size-5" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const allowed = useGuard(role);
  const live = useLive();
  const nav = NAV[role];
  const { city } = useCity();
  const bays = city.lots.reduce((a, l) => a + l.layout.rows * l.layout.cols, 0);
  const cams = city.commandZones.reduce((a, z) => a + z.localities.reduce((b, l) => b + l.anprCameras, 0), 0);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo />
      <div>
        <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">{subtitleFor(nav.subtitle, city)}</p>
        <NavList role={role} onNavigate={onNavigate} />
      </div>
      {role === "police" ? (
        <div className="mt-auto rounded-xl border border-border/70 bg-secondary/30 p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{city.name} pilot · {city.authorityShort}</p>
          <p className="mt-1 leading-relaxed">{city.lots.length} lots · {bays} smart bays · {cams} ANPR cameras.</p>
          <p className="mt-1.5 text-[10px] uppercase tracking-wider text-status-reserved">Simulation · drill data</p>
          <Link href="/command" onClick={onNavigate} className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-semibold text-primary hover:bg-primary/20">
            <Radar className="size-4" /> Command Centre
          </Link>
        </div>
      ) : (
        <AccountCard onNavigate={onNavigate} />
      )}
    </div>
  );

  return (
    <div className="city-backdrop min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="glass fixed inset-y-3 left-3 z-30 hidden w-64 rounded-2xl lg:block">{sidebar()}</aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-card lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute right-3 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
              {sidebar(() => setOpen(false))}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-[17.5rem]">
        <header className="sticky top-0 z-20 px-3 pt-3 lg:pr-3">
          <div className="glass flex h-14 items-center gap-2 rounded-2xl px-2.5 sm:px-4">
            <button
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>
            <div className="lg:hidden">
              <Logo />
            </div>
            <p className="hidden font-display text-sm font-semibold text-muted-foreground lg:block">{nav.title} dashboard</p>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              {role === "police" ? (
                <>
                  <CitySwitcher />
                  <div className="hidden sm:block"><LiveBadge /></div>
                </>
              ) : (
                <span className="hidden items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
                  <span className="size-2 animate-pulse rounded-full bg-status-available" /> {live.store?.kind === "firebase" ? "Live · synced across devices" : "Live · this browser"}
                </span>
              )}
              {role !== "user" && <LiveCameraLauncher />}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-3 pb-28 pt-5 sm:px-5 lg:pb-16">
          {allowed ? children : (
            <div className="grid place-items-center py-24 text-sm text-muted-foreground"><Loader2 className="mb-2 size-6 animate-spin text-primary" />Checking your sign-in…</div>
          )}
        </main>
        {role !== "police" && allowed && <BottomTabs role={role} />}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
