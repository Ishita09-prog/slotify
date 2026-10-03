"""Shared definitions for the Slotify occupancy forecaster.

The demand profiles are read from frontend/src/lib/sim/profiles.json so the history
generator, the live city simulator and the model all describe the same city.
"""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILES = json.loads((ROOT / "frontend/src/lib/sim/profiles.json").read_text())
CATS = ["mall", "commercial", "transit", "hospital", "office", "recreation", "religious"]
HOLIDAYS = set(PROFILES["holidays"])
SEASONS = PROFILES["festival_seasons"]

FEATURES = [
    "horizon_min", "target_hour", "target_dow", "is_weekend", "is_holiday", "festival_season",
    "rain_mm", "current_occ", "current_hour", "lot_base_occupancy", "hist_now_occ", "hist_target_occ", "current_deviation",
    *[f"cat_{c}" for c in CATS],
]
FEATURE_LABELS = {
    "horizon_min": "How far ahead",
    "target_hour": "Time of day",
    "target_dow": "Day of week",
    "is_weekend": "Weekend",
    "is_holiday": "Public holiday",
    "festival_season": "Festival shopping season",
    "rain_mm": "Rain forecast",
    "current_occ": "Occupancy right now",
    "current_hour": "Current hour",
    "lot_base_occupancy": "Lot's usual demand",
    "hist_now_occ": "Usual occupancy at this hour",
    "hist_target_occ": "Usual occupancy at arrival hour",
    "current_deviation": "Busier / quieter than usual now",
    **{f"cat_{c}": "Lot type" for c in CATS},
}


def load_lots() -> list[dict]:
    """Parse lot id / category / baseOccupancy / layout from the TypeScript city configs."""
    lots = []
    for f in ["chennai-south.ts", "coimbatore.ts"]:
        src = (ROOT / "frontend/src/lib/cities" / f).read_text()
        for m in re.finditer(r'id: "([^"]+)", name: "[^"]+",.*?category: "(\w+)", layout: \{ rows: (\d+), cols: (\d+) \}.*?baseOccupancy: ([\d.]+)', src, re.S):
            lots.append({"id": m[1], "city": f[:-3], "category": m[2], "bays": int(m[3]) * int(m[4]), "base": float(m[5])})
        # coimbatore file uses a multi-line layout
        for m in re.finditer(r'id: "([^"]+)",\s*name: "[^"]+",.*?category: "(\w+)", layout: \{ rows: (\d+), cols: (\d+) \},\s*pricePerHour: \d+, evSurchargePerHour: \d+, baseOccupancy: ([\d.]+)', src, re.S):
            if not any(l["id"] == m[1] for l in lots):
                lots.append({"id": m[1], "city": f[:-3], "category": m[2], "bays": int(m[3]) * int(m[4]), "base": float(m[5])})
    return lots


def relative_demand(cat: str, hour: float) -> float:
    p = PROFILES["categories"][cat]
    v = p["base"]
    for peak, width, w in p["peaks"]:
        for shift in (-24, 0, 24):
            v += w * math.exp(-((hour - peak - shift) ** 2) / (2 * width**2))
    return min(1.05, v)


def is_holiday(d: date) -> bool:
    return d.isoformat() in HOLIDAYS


def is_festival(d: date) -> bool:
    k = d.isoformat()
    return any(a <= k <= b for a, b in SEASONS)


def expected_occupancy(cat: str, base: float, hour: float, weekday: int, holiday: bool, festival: bool, rain_mm: float) -> float:
    p = PROFILES["categories"][cat]
    v = base * (0.25 + 0.85 * relative_demand(cat, hour))
    if weekday >= 5:
        v *= p["weekend"]
    if holiday:
        v *= p["holiday"]
    if festival:
        v *= p["festival"]
    if rain_mm > 2:
        v *= p["rain"]
    return min(0.92, max(0.03, v))


def profile_at(profile: dict, hour: float, weekday: int) -> float:
    """Historical mean occupancy for a lot, linearly interpolated between hourly buckets."""
    arr = profile["we" if weekday >= 5 else "wk"]
    h0 = int(hour) % 24
    f = hour - int(hour)
    return arr[h0] * (1 - f) + arr[(h0 + 1) % 24] * f


def feature_row(lot: dict, t0: datetime, occ0: float, horizon_min: int, t1: datetime, rain_mm_t1: float, profile: dict) -> list[float]:
    d1 = t1.date()
    return [
        horizon_min,
        t1.hour + t1.minute / 60,
        t1.weekday(),
        1.0 if t1.weekday() >= 5 else 0.0,
        1.0 if is_holiday(d1) else 0.0,
        1.0 if is_festival(d1) else 0.0,
        rain_mm_t1,
        occ0,
        t0.hour + t0.minute / 60,
        lot["base"],
        profile_at(profile, t0.hour + t0.minute / 60, t0.weekday()),
        profile_at(profile, t1.hour + t1.minute / 60, t1.weekday()),
        occ0 - profile_at(profile, t0.hour + t0.minute / 60, t0.weekday()),
        *[1.0 if lot["category"] == c else 0.0 for c in CATS],
    ]
