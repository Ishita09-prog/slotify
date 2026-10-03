"""Generate a simulated year of parking history and train the Slotify occupancy forecaster.

    python ml/train.py            # ~1-2 min on a laptop

Outputs
  frontend/src/lib/ml/model.json   compact tree ensemble used in the browser (offline-capable)
  backend/app/ml/model.json        same file, used by the FastAPI forecast service
  ml/model_card.json               metrics, features and data description

DATA HONESTY: there is no public bay-level occupancy feed for these lots, so the training
history is SIMULATED from the demand profiles plus effects the model never sees directly
(daily bias, unannounced events, autocorrelated noise). The pipeline is the production one:
swap generate_history() for a query over the detections archive and retrain.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

from common import CATS, FEATURE_LABELS, FEATURES, ROOT, expected_occupancy, feature_row, is_festival, is_holiday, load_lots

RNG = np.random.default_rng(42)
STEP_MIN = 15
START = datetime(2025, 9, 25)
DAYS = 365
HOLDOUT_DAYS = 60
HORIZONS = [15, 30, 45, 60, 90, 120, 180]
MODEL_VERSION = "slotify-occ-gbm-2026.10"
ANOM_MARGIN = 0.05

# Chennai-style monsoon: share of days with rain, by month
RAIN_P = {1: 0.1, 2: 0.04, 3: 0.04, 4: 0.05, 5: 0.08, 6: 0.22, 7: 0.25, 8: 0.28, 9: 0.3, 10: 0.45, 11: 0.55, 12: 0.35}


def rain_series(n_steps: int) -> np.ndarray:
    """City-wide rain (mm/h) at 15-min resolution."""
    rain = np.zeros(n_steps)
    per_day = 24 * 60 // STEP_MIN
    for d in range(DAYS):
        day = START + timedelta(days=d)
        if RNG.random() < RAIN_P[day.month]:
            start = int(RNG.integers(10, 22) * 60 / STEP_MIN)
            dur = int(RNG.integers(2, 7) * 60 / STEP_MIN)
            mm = RNG.uniform(3, 25)
            a = d * per_day + start
            rain[a : a + dur] = mm
    return rain


def generate_history(lots: list[dict]):
    per_day = 24 * 60 // STEP_MIN
    n = DAYS * per_day
    times = [START + timedelta(minutes=STEP_MIN * i) for i in range(n)]
    rain = rain_series(n)
    hours = np.array([t.hour + t.minute / 60 for t in times])
    wd = np.array([t.weekday() for t in times])
    hol = np.array([is_holiday(t.date()) for t in times])
    fest = np.array([is_festival(t.date()) for t in times])

    occ = {}
    events = {}
    for lot in lots:
        exp = np.array([
            expected_occupancy(lot["category"], lot["base"], hours[i], wd[i], hol[i], fest[i], rain[i]) for i in range(n)
        ])
        day_bias = np.repeat(RNG.normal(1.0, 0.045, DAYS), per_day)
        shock = np.zeros(n)
        if lot["category"] in ("mall", "commercial", "recreation", "religious", "transit"):
            for d in range(DAYS):
                if RNG.random() < 0.06:  # unannounced event / sale / procession / crowd
                    s = d * per_day + int(RNG.integers(9, 21) * 60 / STEP_MIN)
                    dur = int(RNG.integers(2, 7) * 60 / STEP_MIN)
                    shock[s : s + dur] += RNG.uniform(0.15, 0.6)
        noise = np.zeros(n)
        eps = RNG.normal(0, 0.017, n)
        for i in range(1, n):
            noise[i] = 0.93 * noise[i - 1] + eps[i]
        o = np.clip(exp * day_bias + shock + noise, 0.02, 0.995)
        # cameras count whole bays
        o = np.round(o * lot["bays"]) / lot["bays"]
        occ[lot["id"]] = o
        events[lot["id"]] = shock > 0
    return times, rain, occ, events


def build_profiles(lots, times, occ, split):
    """Per-lot historical mean occupancy by hour, weekday vs weekend — computed from TRAINING data only."""
    hours = np.array([t.hour for t in times[:split]])
    we = np.array([t.weekday() >= 5 for t in times[:split]])
    prof = {}
    for lot in lots:
        o = occ[lot["id"]][:split]
        prof[lot["id"]] = {
            "wk": [round(float(o[(hours == h) & ~we].mean()), 4) for h in range(24)],
            "we": [round(float(o[(hours == h) & we].mean()), 4) for h in range(24)],
        }
    return prof


def build_pairs(lots, times, rain, occ, idx_range, samples_per_lot, profiles):
    X, y, meta = [], [], []
    lo, hi = idx_range
    for lot in lots:
        o = occ[lot["id"]]
        prof = profiles[lot["id"]]
        origins = RNG.integers(lo, hi - max(HORIZONS) // STEP_MIN, samples_per_lot)
        hs = RNG.choice(HORIZONS, samples_per_lot)
        for i0, h in zip(origins, hs):
            i1 = i0 + h // STEP_MIN
            X.append(feature_row(lot, times[i0], o[i0], int(h), times[i1], rain[i1], prof))
            y.append(o[i1])
            meta.append((lot["id"], i0, i1))
    return np.array(X), np.array(y), meta


def heuristic_baseline(lot, times, rain, o, i0, i1):
    """Original Slotify v1 method: typical curve + today's deviation decaying with tau = 90 min (no holiday / rain awareness).
    NOTE: it is handed the simulator's exact demand curves, which a hand-tuned curve in a real city never has,
    so it is an optimistic baseline."""
    t0, t1 = times[i0], times[i1]
    e0 = expected_occupancy(lot["category"], lot["base"], t0.hour + t0.minute / 60, t0.weekday(), False, False, 0)
    e1 = expected_occupancy(lot["category"], lot["base"], t1.hour + t1.minute / 60, t1.weekday(), False, False, 0)
    h = (i1 - i0) * STEP_MIN
    return float(np.clip(e1 + (o[i0] - e0) * np.exp(-h / 90), 0.02, 0.99))


def export_model(m: HistGradientBoostingRegressor):
    """Compact JSON: per tree a flat node list [feature, threshold, left, right, value, count]."""
    trees = []
    for it in m._predictors:
        nodes = it[0].nodes
        n = len(nodes)
        val = np.array(nodes["value"], dtype=float)
        cnt = np.array(nodes["count"], dtype=float)
        # internal value = count-weighted mean of leaves below (for path attributions)
        order = sorted(range(n), key=lambda k: -int(nodes["depth"][k]))
        for k in order:
            if not nodes["is_leaf"][k]:
                l, r = int(nodes["left"][k]), int(nodes["right"][k])
                val[k] = (val[l] * cnt[l] + val[r] * cnt[r]) / max(1.0, cnt[l] + cnt[r])
        flat = []
        for k in range(n):
            if nodes["is_leaf"][k]:
                flat.append([-1, 0, 0, 0, round(float(val[k]), 6), int(cnt[k])])
            else:
                flat.append([int(nodes["feature_idx"][k]), float(nodes["num_threshold"][k]),
                             int(nodes["left"][k]), int(nodes["right"][k]), round(float(val[k]), 6), int(cnt[k])])
        trees.append(flat)
    return {"baseline": round(float(np.ravel(m._baseline_prediction)[0]), 6), "trees": trees}


def predict_json(model: dict, x: np.ndarray) -> float:
    s = model["baseline"]
    for t in model["trees"]:
        k = 0
        while t[k][0] != -1:
            k = t[k][2] if x[t[k][0]] <= t[k][1] else t[k][3]
        s += t[k][4]
    return s


def main():
    t_start = time.time()
    lots = load_lots()
    print(f"{len(lots)} lots ({sum(l['bays'] for l in lots)} bays) · generating {DAYS} days at {STEP_MIN}-min resolution…")
    times, rain, occ, events = generate_history(lots)
    n = len(times)
    split = n - HOLDOUT_DAYS * 24 * 60 // STEP_MIN
    profiles = build_profiles(lots, times, occ, split)
    Xtr, ytr, _ = build_pairs(lots, times, rain, occ, (0, split), 16000, profiles)
    Xte, yte, meta_te = build_pairs(lots, times, rain, occ, (split, n), 2500, profiles)
    print(f"train {len(ytr):,} pairs · holdout {len(yte):,} pairs (last {HOLDOUT_DAYS} days, time-based split)")

    common = dict(max_iter=220, learning_rate=0.08, max_leaf_nodes=15, min_samples_leaf=80, l2_regularization=0.5, random_state=7)
    models = {
        "point": HistGradientBoostingRegressor(loss="squared_error", **common),
        "q10": HistGradientBoostingRegressor(loss="quantile", quantile=0.1, **common),
        "q90": HistGradientBoostingRegressor(loss="quantile", quantile=0.9, **common),
    }
    for k, m in models.items():
        m.fit(Xtr, ytr)
        print(f"  trained {k} in {time.time() - t_start:.0f}s")

    p = models["point"].predict(Xte)
    lo, hi = models["q10"].predict(Xte), models["q90"].predict(Xte)
    persist = Xte[:, FEATURES.index("current_occ")]
    lot_by_id = {l["id"]: l for l in lots}
    heur = np.array([heuristic_baseline(lot_by_id[lid], times, rain, occ[lid], i0, i1) for lid, i0, i1 in meta_te])
    bays = np.array([lot_by_id[lid]["bays"] for lid, _, _ in meta_te])

    def mae(a):
        return float(np.mean(np.abs(a - yte)))

    metrics = {
        "mae_occupancy_pts": {"gbm": round(mae(p) * 100, 2), "heuristic_v1": round(mae(heur) * 100, 2), "persistence": round(mae(persist) * 100, 2)},
        "mae_free_bays": {"gbm": round(float(np.mean(np.abs(p - yte) * bays)), 2), "heuristic_v1": round(float(np.mean(np.abs(heur - yte) * bays)), 2),
                          "persistence": round(float(np.mean(np.abs(persist - yte) * bays)), 2)},
        "interval_80_coverage": round(float(np.mean((yte >= lo) & (yte <= hi))), 3),
        "mean_interval_width_pts": round(float(np.mean(hi - lo)) * 100, 1),
        "by_horizon_mae_pts": {},
    }
    special = (Xte[:, FEATURES.index("is_holiday")] > 0) | (Xte[:, FEATURES.index("rain_mm")] > 2) | (Xte[:, FEATURES.index("festival_season")] > 0)
    metrics["mae_on_holiday_rain_festival_pts"] = {
        "share_of_holdout": round(float(special.mean()), 3),
        "gbm": round(float(np.mean(np.abs(p[special] - yte[special]))) * 100, 2),
        "heuristic_v1": round(float(np.mean(np.abs(heur[special] - yte[special]))) * 100, 2),
        "persistence": round(float(np.mean(np.abs(persist[special] - yte[special]))) * 100, 2),
    }
    hcol = Xte[:, 0]
    for h in HORIZONS:
        mk = hcol == h
        metrics["by_horizon_mae_pts"][str(h)] = {
            "gbm": round(float(np.mean(np.abs(p[mk] - yte[mk]))) * 100, 2),
            "heuristic_v1": round(float(np.mean(np.abs(heur[mk] - yte[mk]))) * 100, 2),
            "persistence": round(float(np.mean(np.abs(persist[mk] - yte[mk]))) * 100, 2),
        }

    # Anomaly detector evaluation (event level). Every 5 min the detector compares the observed value with the
    # 80% band of a forecast made 30 min earlier; it raises an alert after 2 consecutive out-of-band checks.
    detected = missed = false_alerts = 0
    delays = []
    lot_days = 0
    for lot in lots:
        o, ev, prof = occ[lot["id"]], events[lot["id"]], profiles[lot["id"]]
        idx = np.arange(split + 2, n)
        Xa = np.array([feature_row(lot, times[i - 2], o[i - 2], 30, times[i], rain[i], prof) for i in idx])
        ahi = models["q90"].predict(Xa)
        alo = models["q10"].predict(Xa)
        out = (o[idx] > ahi + ANOM_MARGIN) | (o[idx] < alo - ANOM_MARGIN)
        alert = out & np.concatenate([[False], out[:-1]])
        truth = ev[idx]
        lot_days += HOLDOUT_DAYS
        # events = contiguous runs of truth
        k = 0
        while k < len(truth):
            if truth[k]:
                e = k
                while e < len(truth) and truth[e]:
                    e += 1
                hit = np.where(alert[k:e])[0]
                if hit.size:
                    detected += 1
                    delays.append(int(hit[0]) * STEP_MIN)
                else:
                    missed += 1
                k = e
            else:
                k += 1
        # false alerts = alert onsets outside events (+1 h grace after an event)
        grace = truth.copy()
        for g in range(1, 5):
            grace[g:] |= truth[:-g]
        onsets = alert & ~np.concatenate([[False], alert[:-1]])
        false_alerts += int(np.sum(onsets & ~grace))
    metrics["anomaly_detector"] = {
        "rule": f"observed occupancy outside the 30-min-ahead 80% interval by > {int(ANOM_MARGIN * 100)} pts on 2 consecutive checks",
        "events_in_holdout": detected + missed,
        "event_recall": round(detected / max(1, detected + missed), 3),
        "median_detection_delay_min": int(np.median(delays)) if delays else None,
        "false_alerts_per_lot_per_week": round(false_alerts / lot_days * 7, 2),
    }

    exported = {k: export_model(m) for k, m in models.items()}
    # parity check: JSON inference == sklearn
    for k, m in models.items():
        sk = m.predict(Xte[:200])
        js = np.array([predict_json(exported[k], x) for x in Xte[:200]])
        assert np.max(np.abs(sk - js)) < 1e-4, f"export mismatch for {k}: {np.max(np.abs(sk - js))}"

    trained_at = datetime.now().isoformat(timespec="seconds")
    card = {
        "version": MODEL_VERSION,
        "trainedAt": trained_at,
        "algorithm": "Gradient-boosted decision trees (scikit-learn HistGradientBoostingRegressor): mean + 10th/90th percentile quantile models",
        "target": "Lot occupancy (0-1) at arrival time, 15-180 min ahead",
        "features": [{"name": f, "label": FEATURE_LABELS[f]} for f in FEATURES],
        "categories": CATS,
        "training": {
            "data": "SIMULATED — 365 days x 30 lots at 15-min resolution, generated from demand profiles + daily bias, unannounced events, AR(1) noise, monsoon rain",
            "lots": len(lots), "trainPairs": int(len(ytr)), "holdoutPairs": int(len(yte)), "holdout": f"last {HOLDOUT_DAYS} days (time-based)",
        },
        "metrics": metrics,
        "limitations": [
            "Trained on simulated history; must be retrained on the real detections archive before go-live.",
            "Does not see unannounced events (that is what the anomaly detector is for).",
            "Weather is a forecast input; forecast error is not modelled.",
        ],
    }
    out = {"meta": card, "featureNames": FEATURES, "models": exported, "profiles": profiles}
    for path in [ROOT / "frontend/src/lib/ml/model.json", ROOT / "backend/app/ml/model.json"]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, separators=(",", ":")))
    (ROOT / "ml/model_card.json").write_text(json.dumps(card, indent=2))
    (ROOT / "backend/app/ml/profiles.json").write_text((ROOT / "frontend/src/lib/sim/profiles.json").read_text())
    size = (ROOT / "frontend/src/lib/ml/model.json").stat().st_size
    print(json.dumps(metrics, indent=2))
    print(f"exported {size / 1024:.0f} KB · total {time.time() - t_start:.0f}s")


if __name__ == "__main__":
    main()
