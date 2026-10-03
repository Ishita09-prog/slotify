"""Long-range forecaster: occupancy 4 hours to 7 days ahead ("Will there be space at Phoenix at 10 pm on Saturday?").

    python ml/train_long.py

Same simulated history, features and tree export as train.py (short-range, 15-180 min, which also powers the
anomaly detector). Far ahead, what the cameras see right now matters less and the model leans on the
day-of-week x hour pattern, holidays, festival season and weather; the 10-90% band widens honestly.
Output: frontend/src/lib/ml/model-long.json (+ backend copy).
"""
from __future__ import annotations

import json
import time
from datetime import datetime

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

import train as T
from common import CATS, FEATURE_LABELS, FEATURES, ROOT, load_lots

T.HORIZONS = [240, 360, 480, 720, 960, 1440, 2160, 2880, 4320, 5760, 7200, 10080]
VERSION = "slotify-occ-gbm-long-2026.10"


def main():
    t0 = time.time()
    lots = load_lots()
    times, rain, occ, _ = T.generate_history(lots)
    n = len(times)
    split = n - T.HOLDOUT_DAYS * 24 * 60 // T.STEP_MIN
    profiles = T.build_profiles(lots, times, occ, split)
    Xtr, ytr, _ = T.build_pairs(lots, times, rain, occ, (0, split), 16000, profiles)
    Xte, yte, meta = T.build_pairs(lots, times, rain, occ, (split, n), 2500, profiles)
    print(f"train {len(ytr):,} · holdout {len(yte):,}")
    common = dict(max_iter=220, learning_rate=0.08, max_leaf_nodes=15, min_samples_leaf=80, l2_regularization=0.5, random_state=7)
    models = {
        "point": HistGradientBoostingRegressor(loss="squared_error", **common),
        "q10": HistGradientBoostingRegressor(loss="quantile", quantile=0.1, **common),
        "q90": HistGradientBoostingRegressor(loss="quantile", quantile=0.9, **common),
    }
    for k, m in models.items():
        m.fit(Xtr, ytr)
        print(f"  {k} {time.time() - t0:.0f}s")
    p = models["point"].predict(Xte)
    lo, hi = models["q10"].predict(Xte), models["q90"].predict(Xte)
    persist = Xte[:, FEATURES.index("current_occ")]
    hist = Xte[:, FEATURES.index("hist_target_occ")]
    lot_by_id = {l["id"]: l for l in lots}
    bays = np.array([lot_by_id[lid]["bays"] for lid, _, _ in meta])
    mae = lambda a: round(float(np.mean(np.abs(a - yte))) * 100, 2)  # noqa: E731
    metrics = {
        "mae_occupancy_pts": {"gbm": mae(p), "usual_for_that_hour": mae(hist), "persistence": mae(persist)},
        "mae_free_bays": {"gbm": round(float(np.mean(np.abs(p - yte) * bays)), 2), "usual_for_that_hour": round(float(np.mean(np.abs(hist - yte) * bays)), 2)},
        "interval_80_coverage": round(float(np.mean((yte >= lo) & (yte <= hi))), 3),
        "mean_interval_width_pts": round(float(np.mean(hi - lo)) * 100, 1),
        "by_horizon_mae_pts": {},
    }
    for h in T.HORIZONS:
        mk = Xte[:, 0] == h
        metrics["by_horizon_mae_pts"][str(h)] = {"gbm": round(float(np.mean(np.abs(p[mk] - yte[mk]))) * 100, 2), "usual_for_that_hour": round(float(np.mean(np.abs(hist[mk] - yte[mk]))) * 100, 2)}
    exported = {k: T.export_model(m) for k, m in models.items()}
    for k, m in models.items():
        sk = m.predict(Xte[:200])
        js = np.array([T.predict_json(exported[k], x) for x in Xte[:200]])
        assert np.max(np.abs(sk - js)) < 1e-4
    card = {
        "version": VERSION,
        "trainedAt": datetime.now().isoformat(timespec="seconds"),
        "algorithm": "Gradient-boosted decision trees (HistGradientBoostingRegressor): mean + 10th/90th percentile",
        "target": "Lot occupancy (0-1) 4 hours to 7 days ahead",
        "features": [{"name": f, "label": FEATURE_LABELS[f]} for f in FEATURES],
        "categories": CATS,
        "training": {"data": "SIMULATED, same history as the short-range model", "lots": len(lots), "trainPairs": int(len(ytr)), "holdoutPairs": int(len(yte)), "holdout": f"last {T.HOLDOUT_DAYS} days (time-based)"},
        "metrics": metrics,
        "limitations": ["Trained on simulated history.", "Cannot foresee unannounced events days ahead.", "Uses today's weather; a weather-forecast feed would improve it."],
    }
    out = {"meta": card, "featureNames": FEATURES, "models": exported, "profiles": profiles}
    for path in [ROOT / "frontend/src/lib/ml/model-long.json", ROOT / "backend/app/ml/model-long.json"]:
        path.write_text(json.dumps(out, separators=(",", ":")))
    print(json.dumps(metrics, indent=1))
    print(f"done {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
