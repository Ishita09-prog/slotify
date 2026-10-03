"""Emit reference forecasts for the TS parity test (frontend/scripts/parity.ts)."""
import json
from datetime import datetime, timedelta, timezone
import numpy as np
from common import feature_row, load_lots, FEATURES
from train import predict_json, ROOT

model = json.loads((ROOT / "frontend/src/lib/ml/model.json").read_text())
lots = {l["id"]: l for l in load_lots()}
cases = []
for lid, iso, occ, h, rain in [("tn-pondy", "2026-10-02T18:30:00", 0.91, 45, 0), ("omr-tidel", "2026-10-05T09:10:00", 0.4, 90, 12),
                               ("ad-besant", "2026-10-03T17:00:00", 0.7, 120, 0), ("gandhipuram", "2026-11-01T12:00:00", 0.8, 15, 4)]:
    t0 = datetime.fromisoformat(iso)
    t1 = t0 + timedelta(minutes=h)
    x = feature_row(lots[lid], t0, occ, h, t1, rain, model["profiles"][lid])
    epoch = int((t0 - timedelta(hours=5, minutes=30)).replace(tzinfo=timezone.utc).timestamp() * 1000)
    cases.append({"lot": lid, "t0": epoch, "occ": occ, "h": h, "rain": rain, "x": x,
                  "point": predict_json(model["models"]["point"], np.array(x)), "q10": predict_json(model["models"]["q10"], np.array(x))})
out = json.dumps(cases)
(ROOT / "backend/tests/parity_cases.json").write_text(out)
print(out)
