from fastapi import APIRouter, HTTPException

from app.models import AddSlotsRequest, OwnerAnalytics, ParkingLot, Slot, SlotIdsRequest, SlotStatus, SlotStatusRequest
from app.services.predictor import owner_series
from app.services.repository import repo

router = APIRouter(prefix="/api/owner", tags=["owner"])


def _lot(lot_id: str) -> ParkingLot:
    lot = repo.lot(lot_id)
    if not lot:
        raise HTTPException(404, "Parking lot not found")
    return lot


@router.get("/{owner_id}/lots", response_model=list[ParkingLot])
def owner_lots(owner_id: str):
    return [l for l in repo.lots.values() if l.owner_id == owner_id]


@router.get("/lots/{lot_id}/analytics", response_model=OwnerAnalytics)
def analytics(lot_id: str):
    lot = _lot(lot_id)
    summary = repo.summary(lot_id)
    series = owner_series(lot, summary.total)
    bookings = sum(b.amount for b in repo.bookings.values() if b.lot_id == lot_id and b.status != "cancelled")
    return OwnerAnalytics(
        lot_id=lot_id, summary=summary, revenue_today=series["revenue_today"] + bookings,
        occupancy=series["occupancy"], revenue=series["revenue"], peak=series["peak"],
    )


@router.post("/lots/{lot_id}/slots", response_model=list[Slot], status_code=201)
def add_slots(lot_id: str, body: AddSlotsRequest):
    _lot(lot_id)
    return repo.add_slots(lot_id, body.row, body.count, body.type)


@router.post("/lots/{lot_id}/slots/remove")
def remove_slots(lot_id: str, body: SlotIdsRequest):
    _lot(lot_id)
    removed = repo.remove_slots(lot_id, body.slot_ids)
    return {"removed": removed, "kept": [s for s in body.slot_ids if s not in removed]}


@router.patch("/lots/{lot_id}/slots/status", response_model=list[Slot])
def set_status(lot_id: str, body: SlotStatusRequest):
    """Mark maintenance / reopen. Occupied bays can't be put into maintenance."""
    _lot(lot_id)
    updated = []
    for sid in body.slot_ids:
        slot = repo.slots[lot_id].get(sid)
        if not slot or (body.status == SlotStatus.maintenance and slot.status == SlotStatus.occupied):
            continue
        updated.append(repo.set_slot(lot_id, sid, status=body.status, held_by=None,
                                     vehicle_number=None if body.status in (SlotStatus.available, SlotStatus.maintenance) else slot.vehicle_number))
    return updated
