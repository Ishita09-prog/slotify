from typing import Optional

from fastapi import APIRouter, HTTPException

from fastapi import Depends, Query

from app.security import User, require
from app.services.audit import ledger

from app.data import mock
from app.models import LegalParking, Violation, ViolationStatus, ViolationUpdate, Zone
from app.services.repository import repo

router = APIRouter(prefix="/api/police", tags=["police"])


@router.get("/violations", response_model=list[Violation])
def violations(status: Optional[ViolationStatus] = None, city: Optional[str] = None):
    items = [v for v in repo.violations.values() if (not status or v.status == status) and (not city or v.city == city)]
    return sorted(items, key=lambda v: -v.at)


@router.patch("/violations/{violation_id}", response_model=Violation)
def update_violation(violation_id: str, body: ViolationUpdate, user: User = Depends(require("challan.issue"))):
    v = repo.violations.get(violation_id)
    if not v:
        raise HTTPException(404, "Violation not found")
    v = v.model_copy(update={"status": body.status})
    repo.save_violation(v)
    ledger.append(actor=user.id, actor_id=user.id, role=user.role, action="enforcement.status", entity=violation_id,
                  detail=f"{v.vehicle_number} → {body.status}", source="API")
    return v


@router.get("/legal-parking", response_model=list[LegalParking])
def legal_parking(city: Optional[str] = None):
    return mock.seed_legal_parking(city)


@router.get("/zones", response_model=list[Zone])
def zones(city: str = Query(mock.DEFAULT_CITY)):
    """Demand zones (monitored localities). Occupancy of zones that contain lots is refreshed from live data."""
    if city not in mock.CITIES:
        raise HTTPException(404, "Unknown city")
    live = []
    for z in mock.city_zones(city):
        nearby = [l for l in repo.lots.values() if abs(l.lat - z.lat) < 0.006 and abs(l.lng - z.lng) < 0.006]
        if nearby:
            occ = sum(repo.summary(l.id).occupancy for l in nearby) / len(nearby)
            occ = round(0.5 * z.occupancy + 0.5 * occ, 3)
            demand = "high" if occ > 0.8 else "medium" if occ >= 0.6 else "low"
            live.append(z.model_copy(update={"occupancy": occ, "demand": demand}))
        else:
            live.append(z)
    return live
