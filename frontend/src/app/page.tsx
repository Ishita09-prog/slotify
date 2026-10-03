"use client";

import { useCity } from "@/lib/city";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Building2, CarFront, Radar, Siren } from "lucide-react";
import { CitySwitcher } from "@/components/layout/city-switcher";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SlotGrid, SlotLegend } from "@/components/parking/slot-grid";
import { useLot, useLots } from "@/lib/store";

const ROLES = [
  {
    href: "/login/driver",
    icon: CarFront,
    title: "I'm driving",
    body: "Find free bays near you, reserve one, and pay automatically with FASTag when you leave.",
  },
  {
    href: "/login/operator",
    icon: Building2,
    title: "I run a parking lot",
    body: "Watch every bay in real time, manage capacity, and track occupancy and revenue.",
  },
  {
    href: "/login/police",
    icon: Siren,
    title: "I manage city traffic",
    body: "Spot illegal parking from ANPR cameras and see which zones are running out of space.",
  },
  {
    href: "/login/command",
    icon: Radar,
    title: "I run the city command centre",
    body: "Live GIS of every zone, AI forecasts and incident workflow with human approval, audit trail and reports.",
  },
];

export default function Home() {
  const lots = useLots();
  const free = lots.reduce((a, l) => a + l.available, 0);
  const { city } = useCity();
  const { slots, summary } = useLot(city.lots[0].id);

  return (
    <div className="city-backdrop min-h-dvh">
      <header className="container flex h-16 items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <Link href="/user" className="hidden text-sm font-semibold text-muted-foreground hover:text-foreground sm:block">
            Open the driver app
          </Link>
          <CitySwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="container pb-20">
        <section className="grid grid-cols-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:py-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-status-available" />
              {free} bays free across {city.name} right now
            </p>
            <h1
              className="mt-5 text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl"
              style={{ fontVariationSettings: '"wdth" 88' }}
            >
              Know there’s a spot before you leave home.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              Slotify reads every parking bay in {city.name} through AI cameras, so drivers book a space instead of circling,
              lot owners fill more bays, traffic police see illegal parking as it happens — and the {city.authorityShort} command centre
              sees the whole city, forecasts trouble and acts before it builds.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/user"
                className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 font-semibold text-primary-foreground shadow-[0_10px_30px_-12px_hsl(var(--primary))] hover:bg-primary/90"
              >
                Find parking near me
              </Link>
              <Link href="/login/command" className="inline-flex h-12 items-center gap-2 rounded-lg border px-6 font-semibold hover:bg-secondary/60">
                <Radar className="size-4 text-primary" /> Open the Command Centre
              </Link>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24, rotateX: 12 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
            className="glass rounded-3xl p-4 sm:p-5"
            style={{ perspective: 1000 }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-sm font-bold">{city.lots[0].name}</p>
                <p className="text-xs text-muted-foreground">Updating live from 6 cameras</p>
              </div>
              <p className="text-right">
                <span className="font-display text-2xl font-extrabold text-status-available tabular-nums">{summary.available}</span>
                <span className="text-xs text-muted-foreground"> free</span>
              </p>
            </div>
            <SlotGrid slots={slots} mode="monitor" className="p-3" />
            <SlotLegend includeMaintenance className="mt-3" />
          </motion.div>
        </section>

        <section aria-labelledby="roles" className="mt-6">
          <h2 id="roles" className="text-xl font-bold">Choose your dashboard</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {ROLES.map((r) => {
              const Icon = r.icon;
              return (
                <Link key={r.href} href={r.href} className="glass group rounded-2xl p-5 transition-colors hover:border-primary/50">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <ArrowUpRight className="size-5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <h3 className="mt-4 text-lg font-bold">{r.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
                </Link>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="container border-t border-border/60 py-6 text-xs text-muted-foreground">
        Slotify · Smart City parking prototype · {city.name} pilot data is simulated for demonstration.
      </footer>
    </div>
  );
}
