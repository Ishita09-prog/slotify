import type { LegalParking, ParkingLot, Slot, SlotStatus, SlotType, Violation, Zone } from "./types";
import type { CityConfig } from "./cities";
import { seeded } from "./utils";

export const STARTING_BALANCE = 500;

export const ROW_LETTERS = "ABCDEFGHIJKLMNOP".split("");

const PLATE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

export function randomPlate(rand: () => number, districts: string[] = ["07", "09", "14"]) {
  const d = districts[Math.floor(rand() * districts.length)];
  const l = PLATE_LETTERS[Math.floor(rand() * PLATE_LETTERS.length)] + PLATE_LETTERS[Math.floor(rand() * PLATE_LETTERS.length)];
  const n = String(Math.floor(rand() * 9000) + 1000);
  return `TN${d}${l}${n}`;
}

function slotTypeFor(row: number, col: number, rows: number, cols: number): SlotType {
  if (row === 0 && col < 2) return "accessible";
  if (row === rows - 1 && col >= cols - 3) return "ev";
  if (col === cols - 1 && row < rows - 1) return "compact";
  return "standard";
}

/**
 * AI-detection seed state for a lot. Deterministic per lot id, and the number of used bays
 * matches `occupancy` exactly (bays are ranked by a seeded roll, so the pattern looks natural).
 */
export function generateSlots(lot: ParkingLot, districts?: string[], occupancy = lot.baseOccupancy): Slot[] {
  const rand = seeded(`slots:${lot.id}`);
  const total = lot.layout.rows * lot.layout.cols;
  const rolls = Array.from({ length: total }, () => rand());
  const order = rolls.map((r, i) => [r, i] as const).sort((x, y) => x[0] - y[0]).map(([, i]) => i);
  const maint = Math.round(total * 0.03);
  const used = Math.round((total - maint) * occupancy);
  const occupied = Math.round(used * 0.84);
  const statusOf = new Array<SlotStatus>(total).fill("available");
  order.forEach((idx, rank) => {
    statusOf[idx] = rank < maint ? "maintenance" : rank < maint + occupied ? "occupied" : rank < maint + used ? "reserved" : "available";
  });
  const out: Slot[] = [];
  for (let r = 0; r < lot.layout.rows; r++) {
    for (let c = 0; c < lot.layout.cols; c++) {
      const status = statusOf[r * lot.layout.cols + c];
      const row = ROW_LETTERS[r];
      out.push({
        id: `${row}${c + 1}`,
        row,
        col: c + 1,
        status,
        type: slotTypeFor(r, c, lot.layout.rows, lot.layout.cols),
        vehicleNumber: status === "occupied" || status === "reserved" ? randomPlate(rand, districts) : undefined,
        updatedAt: 0,
      });
    }
  }
  return out;
}

export const CAMERAS = ["CAM-N01", "CAM-N02", "CAM-E03", "CAM-S04", "CAM-W05", "CAM-GATE"];

/* ---------------- City police mock data ---------------- */


export const VIOLATION_TYPES: { type: string; fine: number }[] = [
  { type: "No-parking zone", fine: 500 },
  { type: "Double parking", fine: 1000 },
  { type: "Footpath parking", fine: 500 },
  { type: "Blocking driveway", fine: 750 },
  { type: "Bus stop obstruction", fine: 1000 },
  { type: "Overstay in paid bay", fine: 300 },
];

export function makeViolation(city: CityConfig, rand: () => number, minutesAgo: number, idx: number): Violation & { minutesAgo: number } {
  const spot = city.violationSpots[Math.floor(rand() * city.violationSpots.length)];
  const vt = VIOLATION_TYPES[Math.floor(rand() * VIOLATION_TYPES.length)];
  const statusRoll = rand();
  const status =
    minutesAgo < 12 ? "detected" : statusRoll < 0.35 ? "notice_sent" : statusRoll < 0.8 ? "challan_issued" : "resolved";
  return {
    id: `VIO-${(4820 + idx).toString()}`,
    vehicleNumber: randomPlate(rand, city.plateDistricts),
    at: 0,
    minutesAgo,
    location: spot.location,
    lat: spot.lat + (rand() - 0.5) * 0.0025,
    lng: spot.lng + (rand() - 0.5) * 0.0025,
    type: vt.type,
    fine: vt.fine,
    confidence: 0.86 + rand() * 0.13,
    status,
    camera: `ANPR-${String(Math.floor(rand() * 40) + 1).padStart(2, "0")}`,
  };
}

export function seedViolations(city: CityConfig, count = 26) {
  const rand = seeded(`violations:${city.id}`);
  const list: (Violation & { minutesAgo: number })[] = [];
  let t = 2;
  for (let i = 0; i < count; i++) {
    list.push(makeViolation(city, rand, t, count - i));
    t += Math.round(4 + rand() * 22);
  }
  return list;
}

export function seedLegalParking(city: CityConfig): LegalParking[] {
  const rand = seeded(`legal:${city.id}`);
  const out: LegalParking[] = [];
  city.lots.forEach((lot) => {
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      out.push({
        id: `LEG-${lot.id}-${i}`,
        vehicleNumber: randomPlate(rand, city.plateDistricts),
        lat: lot.lat + (rand() - 0.5) * 0.0018,
        lng: lot.lng + (rand() - 0.5) * 0.0018,
        lotName: lot.name,
      });
    }
  });
  return out;
}

const KIND_PRESSURE: Record<string, number> = {
  market: 0.9, junction: 0.82, transit: 0.78, mall: 0.74, it_corridor: 0.7, hospital: 0.8,
  beach: 0.6, temple: 0.62, civic: 0.5, residential: 0.45,
};

/** Congestion zones derived from the city's monitored localities (simulated baseline). */
export function cityZones(city: CityConfig): Zone[] {
  const lotById = new Map(city.lots.map((l) => [l.id, l]));
  return city.commandZones.flatMap((z) =>
    z.localities.map((loc) => {
      const rand = seeded(`zone:${loc.id}`);
      const lots = loc.lotIds.map((id) => lotById.get(id)).filter(Boolean) as ParkingLot[];
      const occ = Math.min(
        0.97,
        lots.length
          ? lots.reduce((a, l) => a + l.baseOccupancy, 0) / lots.length + rand() * 0.06
          : (KIND_PRESSURE[loc.kind] ?? 0.6) + (rand() - 0.5) * 0.12
      );
      const congestionIndex = Math.round(Math.min(99, occ * 68 + (loc.vehiclesPerHour / 2600) * 32));
      return {
        id: loc.id,
        name: loc.name,
        lat: loc.lat,
        lng: loc.lng,
        radius: Math.round(260 + loc.vehiclesPerHour / 7),
        demand: congestionIndex >= 75 ? "high" : congestionIndex >= 52 ? "medium" : "low",
        occupancy: Math.round(occ * 100) / 100,
        vehiclesPerHour: loc.vehiclesPerHour,
        avgSearchMin: Math.round(2 + occ ** 3 * 16),
        congestionIndex,
      } satisfies Zone;
    })
  );
}
