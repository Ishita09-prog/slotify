"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCity } from "./city";
import type { ParkingLot } from "./types";

/* ------------------------------------------------------------------ */
/* Driver profile (phone login) + owner-defined booking schedules      */
/* ------------------------------------------------------------------ */

export type VehicleType = "car" | "suv" | "ev" | "bike";
export interface Vehicle {
  number: string;
  type: VehicleType;
  nickname?: string;
}
export interface DriverProfile {
  phone: string;
  name: string;
  vehicles: Vehicle[];
  defaultVehicle: string;
  createdAt: number;
}

/** "timed" = owner publishes time windows that drivers book; "open" = no time limit, pay for time used. */
export type BookingMode = "timed" | "open";
export interface TimeWindow {
  id: string;
  start: string; // "10:00"
  end: string; // "13:00"
}
export interface LotSchedule {
  mode: BookingMode;
  windows: TimeWindow[];
}

/** Non-refundable cover charge per vehicle per booking; adjusted against the parking fee when the driver turns up. */
export const COVER_CHARGE = 25;

export const VEHICLE_LABEL: Record<VehicleType, string> = { car: "Car", suv: "SUV", ev: "Electric car", bike: "Two-wheeler" };

export function defaultSchedule(lot: ParkingLot): LotSchedule {
  // Commercial operators (malls, IT parks) schedule windows; public lots are open-ended.
  if (lot.category === "mall" || lot.category === "office") {
    const w = lot.category === "mall" ? [["10:00", "13:00"], ["13:00", "16:00"], ["16:00", "19:00"], ["19:00", "22:00"]] : [["08:00", "12:00"], ["12:00", "16:00"], ["16:00", "20:00"]];
    return { mode: "timed", windows: w.map(([start, end], i) => ({ id: `w${i + 1}`, start, end })) };
  }
  return { mode: "open", windows: [] };
}

export const windowHours = (w: TimeWindow) => {
  const [a, b] = [w.start, w.end].map((t) => Number(t.split(":")[0]) + Number(t.split(":")[1]) / 60);
  return Math.max(0.5, (b > a ? b : b + 24) - a);
};

/** Today's start of window in epoch ms (IST), rolled to tomorrow if it has already ended. */
export function windowStart(w: TimeWindow, now = Date.now()) {
  const d = new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
  let t = Date.parse(`${d}T${w.start}:00+05:30`);
  const end = Date.parse(`${d}T${w.end}:00+05:30`);
  if (end <= now) t += 24 * 3600_000;
  return t;
}

interface Ctx {
  profile: DriverProfile | null;
  ready: boolean;
  saveProfile: (p: DriverProfile) => void;
  addVehicle: (v: Vehicle) => void;
  removeVehicle: (num: string) => void;
  setDefaultVehicle: (num: string) => void;
  logoutDriver: () => void;
  schedule: (lot: ParkingLot) => LotSchedule;
  setSchedule: (lotId: string, s: LotSchedule) => void;
}

const DriverCtx = createContext<Ctx | null>(null);
const PKEY = "slotify:driver-profile";

export function DriverProvider({ children }: { children: ReactNode }) {
  const { city } = useCity();
  const SKEY = `slotify:schedules:${city.id}`;
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [schedules, setSchedules] = useState<Record<string, LotSchedule>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const p = window.localStorage.getItem(PKEY);
      if (p) setProfile(JSON.parse(p));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(SKEY);
      setSchedules(s ? JSON.parse(s) : {});
    } catch {
      setSchedules({});
    }
  }, [SKEY]);

  const persistProfile = useCallback((p: DriverProfile | null) => {
    setProfile(p);
    try {
      if (p) window.localStorage.setItem(PKEY, JSON.stringify(p));
      else window.localStorage.removeItem(PKEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      profile,
      ready,
      saveProfile: persistProfile,
      addVehicle: (v) => {
        if (!profile) return;
        if (profile.vehicles.some((x) => x.number === v.number)) return;
        persistProfile({ ...profile, vehicles: [...profile.vehicles, v] });
      },
      removeVehicle: (num) => {
        if (!profile || profile.vehicles.length <= 1) return;
        const vehicles = profile.vehicles.filter((v) => v.number !== num);
        persistProfile({ ...profile, vehicles, defaultVehicle: profile.defaultVehicle === num ? vehicles[0].number : profile.defaultVehicle });
      },
      setDefaultVehicle: (num) => profile && persistProfile({ ...profile, defaultVehicle: num }),
      logoutDriver: () => persistProfile(null),
      schedule: (lot) => schedules[lot.id] ?? defaultSchedule(lot),
      setSchedule: (lotId, s) => {
        setSchedules((prev) => {
          const next = { ...prev, [lotId]: s };
          try {
            window.localStorage.setItem(SKEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      },
    }),
    [profile, ready, persistProfile, schedules, SKEY]
  );
  return <DriverCtx.Provider value={value}>{children}</DriverCtx.Provider>;
}

export function useDriver() {
  const c = useContext(DriverCtx);
  if (!c) throw new Error("useDriver must be used inside <DriverProvider>");
  return c;
}
