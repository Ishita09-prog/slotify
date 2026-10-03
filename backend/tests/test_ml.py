"""ML service tests: browser/server parity, intervals, explanations; audit chain; RBAC."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

os.environ["DETECTION_INTERVAL"] = "0"

from fastapi.testclient import TestClient

from app.main import app
from app.services import forecast as fc
from app.services.audit import ledger
from app.services.repository import repo

client = TestClient(app)
CMD = {"Authorization": "Bearer demo:command:gcc.cmd.0142"}
CITIZEN = {"Authorization": "Bearer demo:citizen:citizen.demo"}
CASES = Path(__file__).parent / "parity_cases.json"


def test_python_matches_reference_cases():
    """Same reference cases the TypeScript parity test uses (frontend/scripts/parity.ts)."""
    for c in json.loads(CASES.read_text()):
        lot = repo.lot(c["lot"])
        t0 = datetime.fromtimestamp(c["t0"] / 1000, tz=timezone.utc)
        x = fc.features(lot, t0, c["occ"], c["h"], c["rain"])
        assert max(abs(a - b) for a, b in zip(x, c["x"])) < 1e-9
        f = fc.forecast(lot, t0, c["occ"], c["h"], c["rain"])
        assert abs(f["occupancy"] - min(1, max(0, c["point"]))) < 1e-9


def test_interval_and_explanation():
    lot = repo.lot("omr-tidel")
    f = fc.forecast(lot, datetime(2026, 10, 7, 9, 0, tzinfo=fc.IST), 0.3, 60)
    assert 0 <= f["low"] <= f["occupancy"] <= f["high"] <= 1
    assert f["factors"] and abs(sum(x["points"] for x in f["factors"])) > 0
    # rain should cut beach demand
    beach = repo.lot("ad-besant")
    t = datetime(2026, 10, 4, 17, 0, tzinfo=fc.IST)
    assert fc.forecast(beach, t, 0.5, 60, rain_mm=20)["occupancy"] < fc.forecast(beach, t, 0.5, 60)["occupancy"]


def test_model_card_and_cities():
    card = client.get("/api/model").json()
    assert card["metrics"]["mae_occupancy_pts"]["gbm"] < card["metrics"]["mae_occupancy_pts"]["persistence"]
    ids = {c["id"] for c in client.get("/api/cities").json()}
    assert ids == {"chennai-south", "coimbatore"}


def test_audit_chain_and_rbac():
    client.post("/api/audit", json={"action": "incident.approve", "entity": "INC-1", "detail": "redirect, vms"}, headers=CMD)
    client.post("/api/audit", json={"action": "incident.close", "entity": "INC-1", "detail": "normal"}, headers=CMD)
    assert client.get("/api/audit/verify").status_code == 401
    assert client.get("/api/audit/verify", headers=CITIZEN).status_code == 403
    assert client.get("/api/audit/verify", headers=CMD).json()["ok"] is True
    entry = ledger.entries[-2]
    original = entry["detail"]
    entry["detail"] = "tampered"
    r = client.get("/api/audit/verify", headers=CMD).json()
    assert r["ok"] is False and r["brokenAt"] == entry["seq"]
    entry["detail"] = original
    assert client.get("/api/audit/verify", headers=CMD).json()["ok"] is True


def test_command_overview_requires_role():
    assert client.get("/api/command/overview").status_code == 401
    o = client.get("/api/command/overview", params={"city": "chennai-south"}, headers=CMD).json()
    assert {z["name"] for z in o["zones"]} == {"T. Nagar", "Velachery", "Adyar", "OMR Corridor"}
