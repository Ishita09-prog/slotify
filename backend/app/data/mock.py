"""City seed data, loaded from cities.json (exported from frontend/src/lib/cities — one source of truth).

Regenerate after editing a city:  cd frontend && npx tsx scripts/export-cities.ts
"""
from __future__ import annotations

import json
import random
import time
from pathlib import Path

from app.models import Layout, LegalParking, ParkingLot, Slot, SlotStatus, Violation, Zone

_DATA = json.loads((Path(__file__).parent / "cities.json").read_text())
CITIES: dict[str, dict] = {c["id"]: c for c in _DATA["cities"]}
DEFAULT_CITY = "chennai-south"

DEMO_OWNER_ID = CITIES["coimbatore"]["demoOwnerId"]
DEMO_VEHICLE = CITIES["coimbatore"]["demoVehicle"]
CITY_CENTER = (CITIES["coimbatore"]["center"]["lat"], CITIES["coimbatore"]["center"]["lng"])
ROW_LETTERS = "ABCDEFGHIJKLMNOP"
CAMERAS = ["CAM-N01", "CAM-N02", "CAM-E03", "CAM-S04", "CAM-W05", "CAM-GATE"]


def _lot(raw: dict, city: str) -> ParkingLot:
    return ParkingLot(
        id=raw["id"], name=raw["name"], area=raw["area"], address=raw["address"], lat=raw["lat"], lng=raw["lng"],
        category=raw["category"], layout=Layout(**raw["layout"]), price_per_hour=raw["pricePerHour"],
        ev_surcharge_per_hour=raw["evSurchargePerHour"], base_occupancy=raw["baseOccupancy"], open_hours=raw["openHours"],
        features=raw["features"], owner_id=raw["ownerId"], covered=raw["covered"], city=city,
    )


LOTS: list[ParkingLot] = [_lot(l, cid) for cid, c in CITIES.items() for l in c["lots"]]
LOT_CITY: dict[str, str] = {l.id: l.city for l in LOTS}


def city_of(lot_id: str) -> dict:
    return CITIES[LOT_CITY.get(lot_id, DEFAULT_CITY)]


PLATE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"


def random_plate(rng: random.Random, districts: list[str] | None = None) -> str:
    d = rng.choice(districts or CITIES[DEFAULT_CITY]["plateDistricts"])
    return f"TN{d}{rng.choice(PLATE_LETTERS)}{rng.choice(PLATE_LETTERS)}{rng.randint(1000, 9999)}"


def _slot_type(r: int, c: int, rows: int, cols: int) -> str:
    if r == 0 and c < 2:
        return "accessible"
    if r == rows - 1 and c >= cols - 3:
        return "ev"
    if c == cols - 1 and r < rows - 1:
        return "compact"
    return "standard"


def generate_slots(lot: ParkingLot) -> list[Slot]:
    """Initial AI-detection state for a lot, deterministic per lot id."""
    rng = random.Random(f"slots:{lot.id}")
    now = int(time.time() * 1000)
    slots: list[Slot] = []
    for r in range(lot.layout.rows):
        for c in range(lot.layout.cols):
            roll = rng.random()
            if roll < 0.03:
                status = SlotStatus.maintenance
            elif roll < 0.03 + lot.base_occupancy * 0.82:
                status = SlotStatus.occupied
            elif roll < 0.03 + lot.base_occupancy:
                status = SlotStatus.reserved
            else:
                status = SlotStatus.available
            row = ROW_LETTERS[r]
            slots.append(Slot(
                id=f"{row}{c + 1}", row=row, col=c + 1, status=status,
                type=_slot_type(r, c, lot.layout.rows, lot.layout.cols),
                vehicle_number=random_plate(rng, city_of(lot.id)["plateDistricts"]) if status in (SlotStatus.occupied, SlotStatus.reserved) else None,
                updated_at=now,
            ))
    return slots


VIOLATION_TYPES = [
    ("No-parking zone", 500), ("Double parking", 1000), ("Footpath parking", 500),
    ("Blocking driveway", 750), ("Bus stop obstruction", 1000), ("Overstay in paid bay", 300),
]


def make_violation(rng: random.Random, minutes_ago: int, idx: int, city_id: str = DEFAULT_CITY) -> Violation:
    city = CITIES[city_id]
    spot = rng.choice(city["violationSpots"])
    vtype, fine = rng.choice(VIOLATION_TYPES)
    roll = rng.random()
    status = "detected" if minutes_ago < 12 else "notice_sent" if roll < 0.35 else "challan_issued" if roll < 0.8 else "resolved"
    return Violation(
        id=f"VIO-{city['authorityShort']}-{4820 + idx}", vehicle_number=random_plate(rng, city["plateDistricts"]),
        at=int(time.time() * 1000) - minutes_ago * 60_000, location=spot["location"],
        lat=spot["lat"] + (rng.random() - 0.5) * 0.0025, lng=spot["lng"] + (rng.random() - 0.5) * 0.0025,
        type=vtype, fine=fine, confidence=round(0.86 + rng.random() * 0.13, 3), status=status,
        camera=f"ANPR-{rng.randint(1, 40):02d}", city=city_id,
    )


def seed_violations(count: int = 26) -> list[Violation]:
    out: list[Violation] = []
    for cid in CITIES:
        rng = random.Random(f"violations:{cid}")
        t = 2
        for i in range(count):
            out.append(make_violation(rng, t, count - i, cid))
            t += round(4 + rng.random() * 22)
    return out


def seed_legal_parking(city_id: str | None = None) -> list[LegalParking]:
    rng = random.Random(f"legal:{city_id}")
    out: list[LegalParking] = []
    for lot in LOTS:
        if city_id and lot.city != city_id:
            continue
        for i in range(3 + rng.randint(0, 2)):
            out.append(LegalParking(
                id=f"LEG-{lot.id}-{i}", vehicle_number=random_plate(rng, city_of(lot.id)["plateDistricts"]),
                lat=lot.lat + (rng.random() - 0.5) * 0.0018, lng=lot.lng + (rng.random() - 0.5) * 0.0018, lot_name=lot.name,
            ))
    return out


_KIND_PRESSURE = {"market": 0.9, "junction": 0.82, "transit": 0.78, "mall": 0.74, "it_corridor": 0.7, "hospital": 0.8,
                  "beach": 0.6, "temple": 0.62, "civic": 0.5, "residential": 0.45}


def city_zones(city_id: str = DEFAULT_CITY) -> list[Zone]:
    """Congestion zones derived from the city's monitored localities (mirrors cityZones() in the frontend)."""
    city = CITIES[city_id]
    lots = {l.id: l for l in LOTS}
    out: list[Zone] = []
    for z in city["commandZones"]:
        for loc in z["localities"]:
            rng = random.Random(f"zone:{loc['id']}")
            ls = [lots[i] for i in loc["lotIds"] if i in lots]
            if ls:
                occ = sum(l.base_occupancy for l in ls) / len(ls) + rng.random() * 0.06
            else:
                occ = _KIND_PRESSURE.get(loc["kind"], 0.6) + (rng.random() - 0.5) * 0.12
            occ = min(0.97, occ)
            ci = round(min(99, occ * 68 + loc["vehiclesPerHour"] / 2600 * 32))
            out.append(Zone(
                id=loc["id"], name=loc["name"], lat=loc["lat"], lng=loc["lng"], radius=round(260 + loc["vehiclesPerHour"] / 7),
                demand="high" if ci >= 75 else "medium" if ci >= 52 else "low", occupancy=round(occ, 2),
                vehicles_per_hour=loc["vehiclesPerHour"], avg_search_min=round(2 + occ**3 * 16), congestion_index=ci,
            ))
    return out


ZONES: list[Zone] = city_zones("coimbatore")
