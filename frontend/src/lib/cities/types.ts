import type { CommandZone, ParkingLot, ViolationSpot, Zone } from "../types";

export type CityId = "chennai-south" | "coimbatore";

/**
 * Everything that differs between deployments lives in one CityConfig.
 * Adding a new city = adding one file; no component code changes.
 */
export interface CityConfig {
  id: CityId;
  name: string; // "South Chennai"
  shortName: string; // "Chennai"
  state: string;
  center: { lat: number; lng: number };
  zoom: number;
  /** Urban local body that runs the platform */
  authority: string;
  authorityShort: string;
  /** Traffic police unit that receives enforcement alerts */
  police: string;
  /** The owner account the demo "Parking owner" dashboard logs in as */
  demoOwnerId: string;
  demoOwnerName: string;
  demoVehicle: string;
  walletBank: string;
  plateDistricts: string[];
  /** Average driving speed used for ETAs (km/h) */
  avgSpeedKmh: number;
  lots: ParkingLot[];
  commandZones: CommandZone[];
  violationSpots: ViolationSpot[];
  /** Traffic units that can be assigned to incidents */
  units: { id: string; name: string; zoneId: string; kind: "patrol" | "tow" | "warden" }[];
  /** Variable message signs (VMS) the command centre can update */
  vmsBoards: { id: string; name: string; lat: number; lng: number; zoneId: string }[];
}

export type { Zone };
