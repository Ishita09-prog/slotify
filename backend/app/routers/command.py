from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.data import mock
from app.security import User, current_user, require
from app.services import forecast as fc
from app.services.audit import ledger
from app.services.repository import repo

router = APIRouter(prefix="/api", tags=["command"])


@router.get("/cities")
def cities():
    """Deployments served by this cluster (one config per city)."""
    return [
        {"id": c["id"], "name": c["name"], "authority": c["authority"], "lots": len(c["lots"]),
         "zones": [z["name"] for z in c["commandZones"]]}
        for c in mock.CITIES.values()
    ]


@router.get("/model")
def model_card():
    """Model card: version, training data, hold-out metrics, limitations."""
    return fc.card()


@router.get("/command/overview")
def overview(city: str = Query(mock.DEFAULT_CITY), user: User = Depends(require("command.view"))):
    c = mock.CITIES[city]
    zones = []
    for z in c["commandZones"]:
        ids = [i for loc in z["localities"] for i in loc["lotIds"]]
        sums = [repo.summary(i) for i in ids]
        usable = sum(s.total - s.maintenance for s in sums) or 1
        used = sum((s.occupied + s.reserved) for s in sums)
        zones.append({"id": z["id"], "name": z["name"], "occupancy": round(used / usable, 3), "free": usable - used, "lots": len(ids)})
    return {"city": city, "zones": zones}


class AuditIn(BaseModel):
    action: str
    entity: str
    detail: str
    source: str = "API"


@router.post("/audit", status_code=201)
def audit_append(body: AuditIn, user: Optional[User] = Depends(current_user)):
    """Every client action is written here; the actor comes from the token, never from the body."""
    actor = user or User(id="anonymous", role="citizen")
    return ledger.append(actor=f"{actor.id} ({actor.role})", actor_id=actor.id, role=actor.role, action=body.action,
                         entity=body.entity, detail=body.detail, source=body.source)


@router.get("/audit")
def audit_list(limit: int = Query(200, le=5000), user: User = Depends(require("audit.view"))):
    return ledger.entries[-limit:]


@router.get("/audit/verify")
def audit_verify(user: User = Depends(require("audit.verify"))):
    return ledger.verify()
