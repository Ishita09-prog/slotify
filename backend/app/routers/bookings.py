from typing import Optional

from fastapi import APIRouter, HTTPException

from app.models import Booking, BookingCreate, SlotStatus
from app.services.pricing import reservation_quote
from app.services.repository import new_id, now_ms, repo

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.post("", response_model=Booking, status_code=201)
def create_booking(body: BookingCreate):
    lot = repo.lot(body.lot_id)
    if not lot:
        raise HTTPException(404, "Parking lot not found")
    slot = repo.slots[lot.id].get(body.slot_id)
    if not slot:
        raise HTTPException(404, f"Slot {body.slot_id} does not exist")
    if slot.status != SlotStatus.available:
        raise HTTPException(409, f"Slot {body.slot_id} is {slot.status.value}. Pick another bay.")

    amount = reservation_quote(lot.price_per_hour, lot.ev_surcharge_per_hour, body.duration_hours, slot.type == "ev")
    if body.payment_method == "fastag":
        wallet = repo.wallet(body.vehicle_number)
        if wallet.balance < amount:
            raise HTTPException(402, f"FASTag balance ₹{wallet.balance:.0f} is below ₹{amount:.0f}. Recharge or pay by UPI.")
        repo.wallet_txn(body.vehicle_number, "debit", amount, f"Reservation · {lot.name} · {slot.id}", lot_name=lot.name)

    repo.set_slot(lot.id, slot.id, status=SlotStatus.reserved, held_by=body.vehicle_number, vehicle_number=body.vehicle_number)
    booking = Booking(
        id=new_id("SLT-"), lot_id=lot.id, lot_name=lot.name, slot_id=slot.id, vehicle_number=body.vehicle_number,
        start_time=int(body.start_time.timestamp() * 1000), duration_hours=body.duration_hours, amount=amount,
        payment_method=body.payment_method, status="confirmed", created_at=now_ms(),
    )
    repo.save_booking(booking)
    return booking


@router.get("", response_model=list[Booking])
def list_bookings(vehicle: Optional[str] = None, lot_id: Optional[str] = None):
    items = [b for b in repo.bookings.values() if (not vehicle or b.vehicle_number == vehicle) and (not lot_id or b.lot_id == lot_id)]
    return sorted(items, key=lambda b: -b.created_at)


@router.delete("/{booking_id}", response_model=Booking)
def cancel_booking(booking_id: str):
    b = repo.bookings.get(booking_id)
    if not b:
        raise HTTPException(404, "Booking not found")
    if b.status != "confirmed":
        raise HTTPException(409, f"Booking is already {b.status}")
    b = b.model_copy(update={"status": "cancelled"})
    repo.save_booking(b)
    repo.set_slot(b.lot_id, b.slot_id, status=SlotStatus.available, held_by=None, vehicle_number=None)
    if b.payment_method == "fastag":
        repo.wallet_txn(b.vehicle_number, "credit", b.amount, f"Refund · {b.lot_name} · {b.slot_id}")
    return b
