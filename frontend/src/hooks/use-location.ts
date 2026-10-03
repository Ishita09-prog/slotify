"use client";

import { useEffect, useState } from "react";
import { useCity } from "@/lib/city";
import { haversineKm } from "@/lib/utils";

export type LocationState = {
  coords: { lat: number; lng: number };
  status: "locating" | "live" | "fallback";
  label: string;
};

/**
 * Uses the browser location when the person is within 40 km of the active city;
 * otherwise centres on the city so distances and ETAs stay meaningful.
 */
export function useUserLocation(): LocationState {
  const { city } = useCity();
  const [state, setState] = useState<LocationState>({
    coords: { lat: city.center.lat, lng: city.center.lng },
    status: "locating",
    label: "Locating you…",
  });

  useEffect(() => {
    const c = { lat: city.center.lat, lng: city.center.lng };
    const fallback = (reason: string) => setState({ coords: c, status: "fallback", label: reason });
    if (!("geolocation" in navigator)) return fallback(`Showing ${city.name} centre`);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (haversineKm(here, c) > 40) return fallback(`You're outside ${city.name} — showing city centre`);
        setState({ coords: here, status: "live", label: "Using your location" });
      },
      () => fallback(`Location off — showing ${city.name} centre`),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 }
    );
  }, [city]);

  return state;
}
