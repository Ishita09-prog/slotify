"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_CITY, getCity, type CityConfig, type CityId } from "./cities";

const KEY = "slotify:city";

interface CityCtx {
  city: CityConfig;
  setCity: (id: CityId) => void;
}

const Ctx = createContext<CityCtx | null>(null);

/** Active deployment (city). Switching city re-mounts the live data layer for that city. */
export function CityProvider({ children }: { children: ReactNode }) {
  const [cityId, setCityId] = useState<CityId>(DEFAULT_CITY);

  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("city");
      const saved = fromUrl ?? window.localStorage.getItem(KEY);
      if (saved && saved !== cityId) setCityId(getCity(saved).id);
    } catch {
      /* storage blocked: stay on default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCity = useCallback((id: CityId) => {
    setCityId(id);
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  return <Ctx.Provider value={{ city: getCity(cityId), setCity }}>{children}</Ctx.Provider>;
}

export function useCity() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCity must be used inside <CityProvider>");
  return c;
}
