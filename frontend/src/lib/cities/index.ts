import { CHENNAI_SOUTH } from "./chennai-south";
import { COIMBATORE } from "./coimbatore";
import type { CityConfig, CityId } from "./types";

export type { CityConfig, CityId } from "./types";

export const CITIES: Record<CityId, CityConfig> = {
  "chennai-south": CHENNAI_SOUTH,
  coimbatore: COIMBATORE,
};

export const CITY_LIST: CityConfig[] = [CHENNAI_SOUTH, COIMBATORE];
export const DEFAULT_CITY: CityId = "chennai-south";

export const getCity = (id: string | null | undefined): CityConfig =>
  (id && id in CITIES ? CITIES[id as CityId] : CITIES[DEFAULT_CITY]);

/** Which command zone + locality a lot belongs to. */
export function lotLocation(city: CityConfig, lotId: string) {
  for (const z of city.commandZones) for (const l of z.localities) if (l.lotIds.includes(lotId)) return { zone: z, locality: l };
  return null;
}
