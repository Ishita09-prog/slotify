"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CameraOff, CloudRain, FlaskConical, Laptop, RotateCcw, ServerCrash, Flame, Waves, X } from "lucide-react";
import { useCity } from "@/lib/city";
import { SCENARIOS } from "@/lib/command/scenarios";
import { useCommand } from "@/lib/command/store";
import { CCButton } from "./ui";
import { cn } from "@/lib/utils";

const ICONS = { flame: Flame, waves: Waves, laptop: Laptop, camera: CameraOff, rain: CloudRain, server: ServerCrash };

export function SimConsole({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { city } = useCity();
  const cmd = useCommand();
  const allowed = cmd.can("scenario.run");
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[1200] bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="cc-panel fixed inset-y-3 right-3 z-[1201] flex w-[min(400px,calc(100vw-24px))] flex-col"
            initial={{ x: 440 }}
            animate={{ x: 0 }}
            exit={{ x: 440 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            role="dialog"
            aria-label="Simulation console"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[hsl(var(--cc-line))] p-4">
              <div>
                <p className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-status-reserved">
                  <FlaskConical className="size-4" /> Drill console
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--cc-dim))]">
                  Changes only the <b className="text-slate-200">simulated world</b> (demand, cameras, weather, ANPR events). Detection, the
                  forecast model and recommendations run unmodified. Every drill is written to the audit trail.
                </p>
              </div>
              <button onClick={onClose} className="rounded p-1 text-[hsl(var(--cc-dim))] hover:bg-white/5" aria-label="Close">
                <X className="size-4" />
              </button>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {!allowed && (
                <p className="rounded-md border border-status-reserved/40 bg-status-reserved/10 p-3 text-xs text-status-reserved">
                  Your role can watch drills but only a Command Officer can start them.
                </p>
              )}
              {SCENARIOS[city.id].map((sc) => {
                const Icon = ICONS[sc.icon];
                const active = cmd.activeScenarios.includes(sc.id);
                return (
                  <button
                    key={sc.id}
                    disabled={!allowed || active}
                    onClick={() => (sc.apiDown ? cmd.setApiDown(true) : cmd.runScenario(sc.id))}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed",
                      active ? "border-status-reserved/60 bg-status-reserved/10" : "border-[hsl(var(--cc-line))] hover:border-sky-500/60 hover:bg-sky-500/5 disabled:opacity-50"
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      <Icon className={cn("size-4", active ? "text-status-reserved" : "text-sky-400")} />
                      {sc.title}
                      {active && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-status-reserved">Running</span>}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[hsl(var(--cc-dim))]">{sc.description}</span>
                  </button>
                );
              })}
            </div>
            <footer className="flex gap-2 border-t border-[hsl(var(--cc-line))] p-4">
              {cmd.apiDown && (
                <CCButton onClick={() => cmd.setApiDown(false)} disabled={!allowed}>
                  Restore API
                </CCButton>
              )}
              <CCButton
                variant="ghost"
                title="Clears incidents, ledger and drills for this browser tab, then reloads (keeps you signed in)"
                onClick={() => {
                  try {
                    Object.keys(window.sessionStorage).filter((k) => k.startsWith("slotify:cmd:") || k.startsWith("slotify:sim:")).forEach((k) => window.sessionStorage.removeItem(k));
                  } catch {
                    /* ignore */
                  }
                  window.location.reload();
                }}
              >
                New demo session
              </CCButton>
              <CCButton className="ml-auto" onClick={cmd.resetSimulation} disabled={!allowed}>
                <RotateCcw className="size-3.5" /> Reset all drills
              </CCButton>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
