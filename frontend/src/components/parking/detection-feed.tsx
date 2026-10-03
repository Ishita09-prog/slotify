"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Cctv } from "lucide-react";
import type { DetectionEvent } from "@/lib/types";
import { Plate } from "@/components/brand/plate";
import { useNow } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";

const verb: Record<string, string> = {
  "available>occupied": "parked in",
  "reserved>occupied": "arrived at reserved",
  "occupied>available": "left",
  "available>reserved": "reserved",
  "reserved>available": "released",
  "maintenance>available": "reopened",
};

const dot: Record<string, string> = {
  occupied: "bg-status-occupied",
  available: "bg-status-available",
  reserved: "bg-status-reserved",
  maintenance: "bg-status-maintenance",
};

export function DetectionFeed({ events, limit = 8, emptyText }: { events: DetectionEvent[]; limit?: number; emptyText?: string }) {
  const now = useNow(5000);
  const list = events.slice(0, limit);
  if (!list.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText ?? "Waiting for the next camera detection…"}</p>;
  }
  return (
    <ul className="divide-y divide-border/60">
      <AnimatePresence initial={false}>
        {list.map((e) => (
          <motion.li
            key={e.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 py-2.5 text-sm"
          >
            <span className={cn("size-2 shrink-0 rounded-full", dot[e.to])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {e.to === "available" && e.from === "occupied" ? "Vehicle" : e.vehicleNumber ? <Plate value={e.vehicleNumber} className="mr-1 align-middle text-[0.7rem]" /> : "Vehicle"}{" "}
                <span className="text-muted-foreground">{verb[`${e.from}>${e.to}`] ?? `→ ${e.to} at`}</span>{" "}
                <span className="font-semibold">{e.slotId}</span>
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Cctv className="size-3" /> {e.camera} · {Math.round(e.confidence * 100)}% confidence · {timeAgo(e.at, now)}
              </p>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
