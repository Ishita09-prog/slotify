"""Occupancy forecaster shared in spirit with frontend/src/lib/predict.ts.

Each lot category has a daily demand curve made of Gaussian peaks. The gap between
what cameras see now and the typical curve decays exponentially (tau = 90 min), so a
lot that is unusually busy right now is forecast to stay busy for a while.
Swap `typical_occupancy` for a trained model (e.g. Prophet / LightGBM on historical
Firestore snapshots) without changing the API.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta

from app.models import ParkingLot, PeakHour, Prediction, TrendPoint

PROFILES = {
    "mall": (0.12, [(13.5, 2.2, 0.5), (19.5, 2.4, 0.82)], 1.18),
    "commercial": (0.18, [(11.5, 2.4, 0.62), (18.5, 2.0, 0.74)], 1.05),
    "transit": (0.30, [(8.5, 1.6, 0.62), (18.5, 1.9, 0.66)], 0.90),
    "hospital": (0.34, [(10.5, 3.0, 0.60), (17.5, 2.0, 0.30)], 0.85),
    "office": (0.08, [(10.0, 1.8, 0.82), (15.0, 3.0, 0.45)], 0.45),
    "recreation": (0.06, [(6.5, 1.2, 0.4), (18.5, 1.8, 0.85)], 1.35),
    "religious": (0.1, [(7.5, 1.5, 0.7), (18.5, 1.6, 0.8)], 1.2),
}
DECAY_MIN = 90


def _clamp(v: float, lo: float = 0.02, hi: float = 0.99) -> float:
    return max(lo, min(hi, v))


def typical_occupancy(category: str, hour: float, weekday: int) -> float:
    """weekday: Monday=0 … Sunday=6 (Python convention)."""
    base, peaks, weekend = PROFILES[category]
    v = base + sum(w * math.exp(-((hour - p) ** 2) / (2 * s ** 2)) for p, s, w in peaks)
    if weekday >= 5:
        v *= weekend
    return _clamp(v, 0.04, 0.98)


def hour_label(h: int) -> str:
    h %= 24
    return f"{12 if h % 12 == 0 else h % 12}{'am' if h < 12 else 'pm'}"


def predict(lot: ParkingLot, current_occupancy: float, total_slots: int, arrival_in_min: int, now: datetime | None = None) -> Prediction:
    now = now or datetime.now()
    wd = now.weekday()
    hour_now = now.hour + now.minute / 60
    deviation = current_occupancy - typical_occupancy(lot.category, hour_now, wd)
    arrival = now + timedelta(minutes=arrival_in_min)
    hour_arr = arrival.hour + arrival.minute / 60
    predicted = _clamp(typical_occupancy(lot.category, hour_arr, arrival.weekday()) + deviation * math.exp(-arrival_in_min / DECAY_MIN))

    trend: list[TrendPoint] = []
    for h in range(24):
        typical = typical_occupancy(lot.category, h, wd)
        actual = forecast = None
        if h <= int(hour_now):
            wobble = math.sin(h * 1.7 + len(lot.id)) * 0.03
            actual = round(_clamp(typical + deviation * math.exp(-(hour_now - h) / 3) + wobble) * 100)
        if h >= int(hour_now):
            forecast = round(_clamp(typical + deviation * math.exp(-max(0, h - hour_now) * 60 / DECAY_MIN)) * 100)
        trend.append(TrendPoint(hour=hour_label(h), typical=round(typical * 100), actual=actual, forecast=forecast))

    by_hour = [(h, typical_occupancy(lot.category, h, wd)) for h in range(24)]
    peaks = sorted(sorted(by_hour, key=lambda x: -x[1])[:3])
    upcoming = [x for x in by_hour if math.ceil(hour_now) <= x[0] <= math.ceil(hour_now) + 6]
    quiet = min(upcoming, key=lambda x: x[1]) if upcoming else None

    return Prediction(
        lot_id=lot.id,
        current_occupancy=round(current_occupancy, 4),
        predicted_occupancy=round(predicted, 4),
        predicted_available=max(0, round(total_slots * (1 - predicted))),
        total_slots=total_slots,
        confidence=round(max(0.55, 0.94 - arrival_in_min / 480), 3),
        arrival_at=int(arrival.timestamp() * 1000),
        peak_hours=[PeakHour(label=f"{hour_label(h)} – {hour_label(h + 1)}", occupancy=round(v * 100)) for h, v in peaks],
        best_time_to_arrive=f"{hour_label(quiet[0])} (≈{round(quiet[1] * 100)}% full)" if quiet else "Now",
        trend=trend,
    )


def owner_series(lot: ParkingLot, total_slots: int, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    wd = now.weekday()
    occupancy, revenue_today = [], 0.0
    for h in range(24):
        t = typical_occupancy(lot.category, h, wd)
        today = round(_clamp(t + math.sin(h * 2.1) * 0.04) * 100) if h <= now.hour else None
        occupancy.append({"hour": hour_label(h), "today": today, "yesterday": round(typical_occupancy(lot.category, h, (wd - 1) % 7) * 100)})
        revenue_today += ((today or 0) / 100) * total_slots * lot.price_per_hour * 0.62
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    revenue = []
    for i in range(7):
        d = (wd - 6 + i) % 7
        day_total = sum(typical_occupancy(lot.category, h, d) for h in range(24))
        value = revenue_today if i == 6 else day_total * total_slots * lot.price_per_hour * 0.62 * (0.94 + ((i * 37) % 11) / 100)
        revenue.append({"day": "Today" if i == 6 else days[d], "revenue": round(value)})
    peak = [{"hour": hour_label(h), "vehicles": round(typical_occupancy(lot.category, h, wd) * total_slots * 1.4)} for h in range(24)]
    return {"occupancy": occupancy, "revenue": revenue, "peak": peak, "revenue_today": round(revenue_today)}
