"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Siren, X } from "lucide-react";
import { useLive, useTick } from "@/lib/live/provider";
import { updateNotice } from "@/lib/live/service";
import type { PoliceNotice } from "@/lib/live/types";
import { formatINR } from "@/lib/utils";

/** Watches police notices addressed to any of my vehicles; pops a full-width alert the moment one arrives. */
export function useMyNotices() {
  const live = useLive();
  const [notices, setNotices] = useState<PoliceNotice[]>([]);
  const plates = (live.account?.vehicles ?? []).map((v) => v.number).join(",");
  useEffect(() => {
    if (!live.store || !plates) return;
    const per: Record<string, PoliceNotice[]> = {};
    const offs = plates.split(",").map((p) =>
      live.store!.watch<PoliceNotice>("notices", ["plate", p], (l) => {
        per[p] = l;
        setNotices(Object.values(per).flat().sort((a, b) => b.createdAt - a.createdAt));
      })
    );
    return () => offs.forEach((o) => o());
  }, [live.store, plates]);
  return notices;
}

export function DriverAlerts() {
  const live = useLive();
  const notices = useMyNotices();
  const now = useTick(1000);
  const [shown, setShown] = useState<PoliceNotice | null>(null);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    const fresh = notices.find((n) => n.status === "sent" && !handled.current.has(n.id + n.kind));
    if (fresh && !shown) {
      handled.current.add(fresh.id + fresh.kind);
      setShown(fresh);
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* ignore */
      }
      if (live.store) void updateNotice(live.store, fresh, { status: "seen" });
    }
  }, [notices, shown, live.store]);

  const left = shown ? Math.max(0, shown.dueAt - now) : 0;
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed inset-x-3 top-3 z-[2000] mx-auto max-w-xl rounded-2xl border border-red-500/60 bg-red-950/95 p-4 text-white shadow-2xl backdrop-blur"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 animate-pulse place-items-center rounded-xl bg-red-600"><Siren className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-300">{shown.kind === "challan" ? "e-Challan issued" : "Traffic police notice"} · {shown.issuedBy}</p>
              <p className="mt-0.5 font-display text-lg font-bold">{shown.plate}: {shown.violation}</p>
              <p className="text-sm text-red-100/90">
                {shown.location}.{" "}
                {shown.kind === "notice"
                  ? <>Move your vehicle within <b>{Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}</b> to avoid a {formatINR(shown.fine)} fine.</>
                  : <>Fine {formatINR(shown.fine)}. Pay now with FASTag or UPI.</>}
              </p>
              <Link href="/user/notices" onClick={() => setShown(null)} className="mt-2 inline-block rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-red-700">
                {shown.kind === "notice" ? "I'm moving my car" : `Pay ${formatINR(shown.fine)}`}
              </Link>
            </div>
            <button onClick={() => setShown(null)} aria-label="Dismiss" className="rounded p-1 text-red-200 hover:bg-white/10"><X className="size-4" /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
