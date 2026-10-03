"use client";

import { useEffect, useMemo, useState } from "react";
import { useCity } from "@/lib/city";

const KEY = "slotify:owner-lot";

/** Lots the demo owner account operates in the active city. */
export function useOwnedLots() {
  const { city } = useCity();
  return useMemo(() => city.lots.filter((l) => l.ownerId === city.demoOwnerId), [city]);
}

/** The lot the owner is looking at, remembered across owner pages. */
export function useOwnerLot() {
  const owned = useOwnedLots();
  const [lotId, setLotIdState] = useState(owned[0].id);
  useEffect(() => {
    if (!owned.some((l) => l.id === lotId)) setLotIdState(owned[0].id);
    try {
      const saved = window.sessionStorage.getItem(KEY);
      if (saved && owned.some((l) => l.id === saved)) setLotIdState(saved);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned]);
  const setLotId = (id: string) => {
    setLotIdState(id);
    try {
      window.sessionStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  };
  const valid = owned.some((l) => l.id === lotId) ? lotId : owned[0].id;
  return [valid, setLotId] as const;
}
