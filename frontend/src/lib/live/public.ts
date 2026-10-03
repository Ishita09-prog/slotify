"use client";

import { useMemo } from "react";
import { useCity } from "../city";
import { useSlotify } from "../store";
import type { CityConfig } from "../cities";
import type { ParkingLot, Slot } from "../types";
import { useLive } from "./provider";
import type { Bay, LiveLot } from "./types";

/* ------------------------------------------------------------------ */
/* Public (GCC-run) parking: the 21 city lots with their live camera   */
/* feed (simulated sensors), merged with real bookings from the shared */
/* database so a bay booked on one phone is red on every phone.        */
/* ------------------------------------------------------------------ */

export const PUBLIC_OWNER = "gcc-public";
export const isPublic = (lot: Pick<LiveLot, "ownerUid">) => lot.ownerUid === PUBLIC_OWNER;
export const publicBayId = (lotId: string, label: string) => `pub-${lotId}-${label}`;

export function publicLot(city: CityConfig, lot: ParkingLot): LiveLot {
  const zone = city.commandZones.find((z) => z.localities.some((l) => l.lotIds.includes(lot.id)));
  return {
    id: lot.id,
    ownerUid: PUBLIC_OWNER,
    ownerName: city.demoOwnerName,
    name: lot.name,
    category: lot.category,
    area: lot.area,
    zone: zone?.name ?? lot.area,
    address: lot.address,
    lat: lot.lat,
    lng: lot.lng,
    pricePerHour: lot.pricePerHour,
    evPerHour: lot.evSurchargePerHour,
    allowOpen: true,
    allowTimed: false,
    windows: [],
    openHours: lot.openHours,
    features: lot.features,
    createdAt: 0,
    rows: lot.layout.rows,
  };
}

/** A simulated camera bay as a database-shaped Bay; a real booking document (if any) wins. */
function mergeBay(lot: LiveLot, s: Slot, real: Bay | undefined, bikeRow?: string): Bay {
  const sim: Bay = {
    id: publicBayId(lot.id, s.id),
    lotId: lot.id,
    ownerUid: PUBLIC_OWNER,
    label: s.id,
    row: s.row,
    col: s.col,
    type: s.row === bikeRow ? "bike" : s.type,
    active: s.status !== "maintenance",
    hold: null,
    open:
      s.status === "occupied" || (s.status === "reserved" && s.heldBy !== "me")
        ? { bookingId: "camera", uid: "camera", vehicle: s.vehicleNumber ?? "", status: s.status === "occupied" ? "parked" : "booked", at: s.updatedAt }
        : null,
    slots: {},
    updatedAt: s.updatedAt,
  };
  if (!real) return sim;
  const hasReal = !!real.open || (!!real.hold && real.hold.until > Date.now());
  const merged = hasReal ? { ...sim, hold: real.hold ?? null, open: real.open ?? null } : sim;
  // weekly / monthly leases live only in the database; the camera simulation never has them
  return real.plans && Object.keys(real.plans).length ? { ...merged, plans: real.plans } : merged;
}

export function useDriverLots() {
  const { city } = useCity();
  const { state } = useSlotify();
  const live = useLive();
  return useMemo(() => {
    const pubLots = city.lots.map((l) => publicLot(city, l));
    const realById = new Map(live.bays.map((b) => [b.id, b]));
    // Public lots: the last row is marked out for two-wheelers.
    const pubBays = pubLots.flatMap((lot) => {
      const list = state.slots[lot.id] ?? [];
      const bikeRow = list.reduce((m, s) => (s.row > m ? s.row : m), "");
      return list.map((s) => mergeBay(lot, s, realById.get(publicBayId(lot.id, s.id)), bikeRow));
    });
    const ownerLots = live.lots;
    const ownerBays = live.bays.filter((b) => b.ownerUid !== PUBLIC_OWNER);
    return { lots: [...pubLots, ...ownerLots], bays: [...pubBays, ...ownerBays], pubLots, ownerLots };
  }, [city, state.slots, live.lots, live.bays]);
}
