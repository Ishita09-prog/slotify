"""Forecast service: evaluates the trained tree ensembles (ml/train.py) in pure Python.

The same model.json runs in the browser (frontend/src/lib/ml/forecast.ts); tests/test_ml.py
checks both give identical predictions on shared reference cases.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from app.models import Factor, ParkingLot, PeakHour, Prediction, TrendPoint

ML_DIR = Path(__file__).resolve().parent.parent / "ml"
IST = timezone(timedelta(hours=5, minutes=30))
CATS = ["mall", "commercial", "transit", "hospital", "office", "recreation", "religious"]


@lru_cache
def model() -> dict:
    return json.loads((ML_DIR / "model.json").read_text())


@lru_cache
def profiles() -> dict:
    return json.loads((ML_DIR / "profiles.json").read_text())


def card() -> dict:
    return model()["meta"]


# ---------------------------------------------------------------- calendar / demand curves (mirror of sim/demand.ts)
NATURAL_MAX = 0.92


def _is_holiday(d: datetime) -> bool:
    return d.date().isoformat() in set(profiles()["holidays"])


def _is_festival(d: datetime) -> bool:
    k = d.date().isoformat()
    return any(a <= k <= b for a, b in profiles()["festival_seasons"])


def relative_demand(cat: str, hour: float) -> float:
    p = profiles()["categories"][cat]
    v = p["base"]
    for peak, width, w in p["peaks"]:
        for shift in (-24, 0, 24):
            v += w * math.exp(-((hour - peak - shift) ** 2) / (2 * width**2))
    return min(1.05, v)


def expected_occupancy(lot: ParkingLot, t: datetime, rain_mm: float = 0) -> float:
    p = profiles()["categories"][lot.category]
    h = t.hour + t.minute / 60
    v = lot.base_occupancy * (0.25 + 0.85 * relative_demand(lot.category, h))
    if t.weekday() >= 5:
        v *= p["weekend"]
    if _is_holiday(t):
        v *= p["holiday"]
    if _is_festival(t):
        v *= p["festival"]
    if rain_mm > 2:
        v *= p["rain"]
    return min(NATURAL_MAX, max(0.03, v))


# ---------------------------------------------------------------- features & inference
def _profile(lot: ParkingLot) -> dict:
    p = model()["profiles"].get(lot.id)
    if p:
        return p
    base = datetime(2026, 10, 7, tzinfo=IST)  # a plain Wednesday / Sunday for new lots
    return {
        "wk": [expected_occupancy(lot, base.replace(hour=h)) for h in range(24)],
        "we": [expected_occupancy(lot, (base + timedelta(days=4)).replace(hour=h)) for h in range(24)],
    }


def _profile_at(p: dict, hour: float, weekday: int) -> float:
    arr = p["we" if weekday >= 5 else "wk"]
    h0 = int(hour) % 24
    f = hour - int(hour)
    return arr[h0] * (1 - f) + arr[(h0 + 1) % 24] * f


def features(lot: ParkingLot, t0: datetime, occ0: float, horizon_min: int, rain_mm: float) -> list[float]:
    t0 = t0.astimezone(IST)
    t1 = t0 + timedelta(minutes=horizon_min)
    prof = _profile(lot)
    h0, h1 = t0.hour + t0.minute / 60, t1.hour + t1.minute / 60
    hist_now = _profile_at(prof, h0, t0.weekday())
    return [
        horizon_min, h1, t1.weekday(), 1.0 if t1.weekday() >= 5 else 0.0,
        1.0 if _is_holiday(t1) else 0.0, 1.0 if _is_festival(t1) else 0.0, rain_mm,
        occ0, h0, lot.base_occupancy, hist_now, _profile_at(prof, h1, t1.weekday()), occ0 - hist_now,
        *[1.0 if lot.category == c else 0.0 for c in CATS],
    ]


def _eval(ens: dict, x: list[float], contrib: list[float] | None = None) -> float:
    s = ens["baseline"]
    for t in ens["trees"]:
        k = 0
        if contrib is not None:
            s += t[0][4]
        while t[k][0] != -1:
            n = t[k]
            nxt = n[2] if x[n[0]] <= n[1] else n[3]
            if contrib is not None:
                d = t[nxt][4] - n[4]
                contrib[n[0]] += d
                s += d
            k = nxt
        if contrib is None:
            s += t[k][4]
    return s


def forecast(lot: ParkingLot, t0: datetime, occ0: float, horizon_min: int, rain_mm: float = 0) -> dict:
    m = model()
    x = features(lot, t0, occ0, horizon_min, rain_mm)
    contrib = [0.0] * len(x)
    point = _eval(m["models"]["point"], x, contrib)
    lo, hi = _eval(m["models"]["q10"], x), _eval(m["models"]["q90"], x)
    lo, hi = min(lo, hi), max(lo, hi)
    by_label: dict[str, float] = {}
    for f, c in zip(m["meta"]["features"], contrib):
        by_label[f["label"]] = by_label.get(f["label"], 0.0) + c
    factors = sorted(
        ({"label": k, "points": round(v * 100, 1)} for k, v in by_label.items() if abs(v) >= 0.001),
        key=lambda f: -abs(f["points"]),
    )
    clamp = lambda v: max(0.0, min(1.0, v))  # noqa: E731
    return {
        "occupancy": clamp(point),
        "low": clamp(min(lo, point)),
        "high": clamp(max(hi, point)),
        "factors": factors,
        "confidence": max(0.5, min(0.99, 1 - (hi - lo))),
        "model_version": m["meta"]["version"],
    }


def _hour_label(h: int) -> str:
    h %= 24
    return f"{12 if h % 12 == 0 else h % 12}{'am' if h < 12 else 'pm'}"


def predict(lot: ParkingLot, current_occupancy: float, total_slots: int, arrival_in_min: int, rain_mm: float = 0, now: datetime | None = None) -> Prediction:
    now = (now or datetime.now(IST)).astimezone(IST)
    f = forecast(lot, now, current_occupancy, min(180, arrival_in_min), rain_mm) if arrival_in_min > 0 else None
    predicted = f["occupancy"] if f else current_occupancy
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    trend: list[TrendPoint] = []
    for h in range(24):
        t = day_start + timedelta(hours=h)
        typical = expected_occupancy(lot, t)
        actual = round(current_occupancy * 100) if h == now.hour else (round(typical * 100) if h < now.hour else None)
        fc = band = None
        if h >= now.hour:
            ahead = round((t - now).total_seconds() / 60)
            if ahead <= 0:
                fc, band = round(current_occupancy * 100), [round(current_occupancy * 100)] * 2
            elif ahead <= 180:
                g = forecast(lot, now, current_occupancy, max(15, ahead), rain_mm)
                fc, band = round(g["occupancy"] * 100), [round(g["low"] * 100), round(g["high"] * 100)]
            else:
                fc = round(typical * 100)
        trend.append(TrendPoint(hour=_hour_label(h), typical=round(typical * 100), actual=actual, forecast=fc, band=band))
    by_hour = [(h, expected_occupancy(lot, day_start + timedelta(hours=h))) for h in range(24)]
    peaks = sorted(sorted(by_hour, key=lambda x: -x[1])[:3])
    upcoming = [(i, p.forecast) for i, p in enumerate(trend) if p.forecast is not None and now.hour < i <= now.hour + 6]
    quiet = min(upcoming, key=lambda x: x[1]) if upcoming else None
    return Prediction(
        lot_id=lot.id,
        current_occupancy=round(current_occupancy, 4),
        predicted_occupancy=round(predicted, 4),
        predicted_available=max(0, round(total_slots * (1 - predicted))),
        total_slots=total_slots,
        confidence=round(f["confidence"], 3) if f else 0.99,
        arrival_at=int((now + timedelta(minutes=arrival_in_min)).timestamp() * 1000),
        peak_hours=[PeakHour(label=f"{_hour_label(h)} – {_hour_label(h + 1)}", occupancy=round(v * 100)) for h, v in peaks],
        best_time_to_arrive=f"{_hour_label(quiet[0])} (≈{quiet[1]}% full)" if quiet else "Now",
        trend=trend,
        low=round(f["low"], 4) if f else current_occupancy,
        high=round(f["high"], 4) if f else current_occupancy,
        range_available=[max(0, round(total_slots * (1 - f["high"]))), max(0, round(total_slots * (1 - f["low"])))] if f else None,
        factors=[Factor(**x) for x in (f["factors"] if f else [])],
        model_version=model()["meta"]["version"],
        horizon_min=arrival_in_min,
    )
