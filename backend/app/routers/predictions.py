from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models import Prediction
from app.services.forecast import predict
from app.services.repository import repo

router = APIRouter(prefix="/api/predictions", tags=["predictions"])


@router.get("/{lot_id}", response_model=Prediction)
def get_prediction(
    lot_id: str,
    arrival_in_minutes: int = Query(30, ge=0, le=24 * 60),
    current_occupancy: Optional[float] = Query(None, ge=0, le=1, description="Override (e.g. client's live view); defaults to server state"),
    rain_mm: float = Query(0, ge=0, le=200),
):
    """Trained GBM forecast with 80% interval and per-input explanation."""
    lot = repo.lot(lot_id)
    if not lot:
        raise HTTPException(404, "Parking lot not found")
    s = repo.summary(lot_id)
    occ = s.occupancy if current_occupancy is None else current_occupancy
    return predict(lot, occ, s.total - s.maintenance, arrival_in_minutes, rain_mm)
