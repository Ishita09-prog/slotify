import asyncio
import json
import math
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.models import DetectionIngest, DetectionEvent, LotWithStats, ParkingLot, Slot, SlotStatus
from app.services.repository import new_id, now_ms, repo

router = APIRouter(prefix="/api", tags=["lots"])


def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _with_stats(lot: ParkingLot, lat: Optional[float], lng: Optional[float]) -> LotWithStats:
    data = {**lot.model_dump(), **repo.summary(lot.id).model_dump()}
    if lat is not None and lng is not None:
        km = _haversine_km(lat, lng, lot.lat, lot.lng)
        data["distance_km"] = round(km, 2)
        data["eta_min"] = max(2, round(km * 1.3 / 22 * 60))  # 1.3× road factor, 22 km/h city average
    return LotWithStats(**data)


@router.get("/lots", response_model=list[LotWithStats])
def list_lots(
    q: Optional[str] = Query(None, description="Search by area, name or address"),
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    sort: str = Query("nearest", pattern="^(nearest|free|cheapest)$"),
    city: Optional[str] = Query(None, description="chennai-south | coimbatore (all cities when omitted)"),
):
    lots = [_with_stats(l, lat, lng) for l in repo.lots.values() if not city or l.city == city]
    if q:
        needle = q.lower()
        lots = [l for l in lots if needle in l.area.lower() or needle in l.name.lower() or needle in l.address.lower()]
    key = {
        "free": lambda l: -l.available,
        "cheapest": lambda l: l.price_per_hour,
        "nearest": lambda l: l.distance_km if l.distance_km is not None else 0,
    }[sort]
    return sorted(lots, key=key)


@router.get("/lots/{lot_id}", response_model=LotWithStats)
def get_lot(lot_id: str, lat: Optional[float] = None, lng: Optional[float] = None):
    lot = repo.lot(lot_id)
    if not lot:
        raise HTTPException(404, "Parking lot not found")
    return _with_stats(lot, lat, lng)


@router.get("/lots/{lot_id}/slots", response_model=list[Slot])
def get_slots(lot_id: str):
    if not repo.lot(lot_id):
        raise HTTPException(404, "Parking lot not found")
    return repo.slot_list(lot_id)


@router.get("/lots/{lot_id}/stream")
async def stream_detections(lot_id: str, request: Request):
    """Server-Sent Events: one message per AI detection at this lot ('*' for the whole city)."""
    if lot_id != "*" and not repo.lot(lot_id):
        raise HTTPException(404, "Parking lot not found")
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    repo.subscribers[lot_id].add(queue)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    event: DetectionEvent = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"event: detection\ndata: {event.model_dump_json(by_alias=True)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            repo.subscribers[lot_id].discard(queue)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/detections", response_model=DetectionEvent, tags=["detections"])
def ingest_detection(body: DetectionIngest):
    """Edge cameras post bay state changes here."""
    slot = repo.slots.get(body.lot_id, {}).get(body.slot_id)
    if not slot:
        raise HTTPException(404, "Slot not found")
    before = slot.status
    repo.set_slot(
        body.lot_id, body.slot_id, status=body.status,
        vehicle_number=body.vehicle_number if body.status in (SlotStatus.occupied, SlotStatus.reserved) else None,
    )
    event = DetectionEvent(
        id=new_id("EV"), lot_id=body.lot_id, slot_id=body.slot_id, from_=before, to=body.status,
        camera=body.camera, confidence=body.confidence, vehicle_number=body.vehicle_number, at=now_ms(),
    )
    repo.publish(event)
    return event


@router.get("/detections/recent", response_model=list[DetectionEvent], tags=["detections"])
def recent_detections(lot_id: Optional[str] = None, limit: int = Query(20, le=200)):
    events = [e for e in repo.events if not lot_id or e.lot_id == lot_id]
    return events[:limit]
