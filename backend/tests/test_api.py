import os

os.environ["DETECTION_INTERVAL"] = "0"  # deterministic tests

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.services.repository import repo

client = TestClient(app)
VEHICLE = "TN38AB1234"
POLICE = {"Authorization": "Bearer demo:police:gctp.insp.2291"}
OPERATOR = {"Authorization": "Bearer demo:operator:gcc.op.0310"}


def first_free(lot_id: str) -> str:
    return next(s["id"] for s in client.get(f"/api/lots/{lot_id}/slots").json() if s["status"] == "available")


def test_health_and_lots():
    assert client.get("/health").json()["status"] == "ok"
    lots = client.get("/api/lots", params={"lat": 11.0168, "lng": 76.9558, "city": "coimbatore"}).json()
    assert len(lots) == 9
    assert len(client.get("/api/lots", params={"city": "chennai-south"}).json()) == 21
    assert len(client.get("/api/lots").json()) == 30
    assert {"available", "occupancy", "etaMin", "distanceKm"} <= lots[0].keys()
    assert lots[0]["distanceKm"] <= lots[-1]["distanceKm"]


def test_search_by_area():
    names = [l["area"] for l in client.get("/api/lots", params={"q": "gandhi", "city": "coimbatore"}).json()]
    assert names == ["Gandhipuram"]


def test_booking_flow_deducts_fastag_and_blocks_double_booking():
    slot = first_free("race-course")
    before = client.get(f"/api/fastag/{VEHICLE}").json()["balance"]
    body = {"lot_id": "race-course", "slot_id": slot, "vehicle_number": VEHICLE,
            "start_time": datetime.now(timezone.utc).isoformat(), "duration_hours": 2, "payment_method": "fastag"}
    r = client.post("/api/bookings", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["amount"] == 20 * 2 + 10
    assert client.get(f"/api/fastag/{VEHICLE}").json()["balance"] == before - 50
    assert client.post("/api/bookings", json=body).status_code == 409


def test_fastag_entry_exit_charges_overstay_only():
    wallet = client.get(f"/api/fastag/{VEHICLE}").json()["balance"]
    r = client.post(f"/api/fastag/{VEHICLE}/entry", json={"lot_id": "race-course"})
    assert r.status_code == 200, r.text
    receipt = client.post(f"/api/fastag/{VEHICLE}/exit", json={"lot_id": "race-course", "duration_minutes": 204}).json()
    assert receipt["prepaidHours"] == 2 and receipt["billableHours"] == 2 and receipt["fee"] == 40
    assert receipt["balance"] == wallet - 40


def test_grace_period_is_free():
    client.post("/api/fastag/KA01AB1234/entry", json={"lot_id": "prozone"})
    receipt = client.post("/api/fastag/KA01AB1234/exit", json={"lot_id": "prozone", "duration_minutes": 10}).json()
    assert receipt["fee"] == 0


def test_prediction_shape():
    p = client.get("/api/predictions/brookefields", params={"arrival_in_minutes": 60}).json()
    assert 0 < p["predictedOccupancy"] < 1
    assert len(p["trend"]) == 24 and len(p["peakHours"]) == 3
    assert p["low"] <= p["predictedOccupancy"] <= p["high"]
    assert p["factors"] and p["modelVersion"].startswith("slotify-occ-gbm")
    q = client.get("/api/predictions/tn-pondy", params={"arrival_in_minutes": 45, "current_occupancy": 0.9, "rain_mm": 10}).json()
    assert q["horizonMin"] == 45 and len(q["rangeAvailable"]) == 2


def test_owner_manage_slots():
    lot = "prozone"
    total = client.get(f"/api/owner/lots/{lot}/analytics").json()["summary"]["total"]
    added = client.post(f"/api/owner/lots/{lot}/slots", json={"row": "G", "count": 3, "type": "ev"}).json()
    assert [s["id"] for s in added] == ["G1", "G2", "G3"]
    client.patch(f"/api/owner/lots/{lot}/slots/status", json={"slot_ids": ["G1"], "status": "maintenance"})
    assert repo.slots[lot]["G1"].status.value == "maintenance"
    client.post(f"/api/owner/lots/{lot}/slots/remove", json={"slot_ids": ["G1", "G2", "G3"]})
    assert client.get(f"/api/owner/lots/{lot}/analytics").json()["summary"]["total"] == total


def test_police_endpoints():
    v = client.get("/api/police/violations").json()
    assert v and {"vehicleNumber", "location", "status"} <= v[0].keys()
    vid = v[0]["id"]
    assert client.patch(f"/api/police/violations/{vid}", json={"status": "challan_issued"}).status_code == 401
    assert client.patch(f"/api/police/violations/{vid}", json={"status": "challan_issued"}, headers=OPERATOR).status_code == 403
    upd = client.patch(f"/api/police/violations/{vid}", json={"status": "challan_issued"}, headers=POLICE).json()
    assert upd["status"] == "challan_issued"
    for city, n in (("chennai-south", 31), ("coimbatore", 9)):
        zones = client.get("/api/police/zones", params={"city": city}).json()
        assert len(zones) == n and {z["demand"] for z in zones} <= {"high", "medium", "low"}
    chennai = client.get("/api/police/violations", params={"city": "chennai-south"}).json()
    assert chennai and all(x["city"] == "chennai-south" for x in chennai)


def test_detection_ingest():
    slot = first_free("brookefields")
    r = client.post("/api/detections", json={"lot_id": "brookefields", "slot_id": slot, "status": "occupied",
                                             "confidence": 0.97, "camera": "CAM-N01", "vehicle_number": "TN37CD4321"})
    assert r.status_code == 200 and r.json()["from"] == "available"


def test_search_chennai_area():
    areas = {l["area"] for l in client.get("/api/lots", params={"q": "velachery", "city": "chennai-south"}).json()}
    assert areas == {"Velachery"}
