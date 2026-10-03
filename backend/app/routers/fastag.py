from fastapi import APIRouter, HTTPException

from app.models import EntryRequest, ExitReceipt, ExitRequest, FastagTxn, RechargeRequest, SlotStatus, Wallet
from app.services.pricing import exit_fee
from app.services.repository import now_ms, repo

router = APIRouter(prefix="/api/fastag", tags=["fastag"])


@router.get("/{vehicle}", response_model=Wallet)
def get_wallet(vehicle: str):
    return repo.wallet(vehicle.upper())


@router.get("/{vehicle}/transactions", response_model=list[FastagTxn])
def transactions(vehicle: str):
    return repo.wallet(vehicle.upper()).txns


@router.post("/{vehicle}/recharge", response_model=Wallet)
def recharge(vehicle: str, body: RechargeRequest):
    repo.wallet_txn(vehicle.upper(), "credit", body.amount, "FASTag recharge · UPI")
    return repo.wallet(vehicle.upper())


@router.post("/{vehicle}/entry")
def entry(vehicle: str, body: EntryRequest):
    """Gate reader saw the tag: use the driver's reserved bay or assign the first free one."""
    vehicle = vehicle.upper()
    lot = repo.lot(body.lot_id)
    if not lot:
        raise HTTPException(404, "Parking lot not found")
    if vehicle in repo.sessions:
        raise HTTPException(409, "This vehicle is already parked")
    booking = next((b for b in repo.bookings.values() if b.vehicle_number == vehicle and b.lot_id == lot.id and b.status == "confirmed"), None)
    slot_id = booking.slot_id if booking else next((s.id for s in repo.slot_list(lot.id) if s.status == SlotStatus.available), None)
    if not slot_id:
        raise HTTPException(409, f"{lot.name} is full")
    if booking:
        repo.save_booking(booking.model_copy(update={"status": "active"}))
    repo.set_slot(lot.id, slot_id, status=SlotStatus.occupied, held_by=vehicle, vehicle_number=vehicle)
    repo.sessions[vehicle] = {"lot_id": lot.id, "slot_id": slot_id, "entry_at": now_ms(), "prepaid": booking.duration_hours if booking else 0,
                              "booking_id": booking.id if booking else None}
    return {"lotId": lot.id, "slotId": slot_id, "entryAt": repo.sessions[vehicle]["entry_at"], "gate": "open"}


@router.post("/{vehicle}/exit", response_model=ExitReceipt)
def exit_lot(vehicle: str, body: ExitRequest):
    """Calculate duration and fee, then auto-deduct from the FASTag wallet."""
    vehicle = vehicle.upper()
    lot = repo.lot(body.lot_id)
    if not lot:
        raise HTTPException(404, "Parking lot not found")
    session = repo.sessions.get(vehicle)
    duration = body.duration_minutes
    if duration is None:
        if not session:
            raise HTTPException(404, "No active parking session for this vehicle")
        duration = max(1, round((now_ms() - session["entry_at"]) / 60000))
    prepaid = session["prepaid"] if session else 0
    billable, fee = exit_fee(duration, lot.price_per_hour, prepaid)
    wallet = repo.wallet(vehicle)
    if fee > wallet.balance:
        raise HTTPException(402, f"Parking charge ₹{fee:.0f} exceeds balance ₹{wallet.balance:.0f}. Recharge to exit.")
    repo.wallet_txn(vehicle, "debit", fee, f"Parking · {lot.name}", lot_name=lot.name, duration_min=duration)
    slot_id = session["slot_id"] if session else "—"
    if session:
        repo.set_slot(session["lot_id"], session["slot_id"], status=SlotStatus.available, held_by=None, vehicle_number=None)
        if session.get("booking_id") and session["booking_id"] in repo.bookings:
            repo.save_booking(repo.bookings[session["booking_id"]].model_copy(update={"status": "completed"}))
        repo.sessions.pop(vehicle, None)
    return ExitReceipt(lot_id=lot.id, lot_name=lot.name, slot_id=slot_id, duration_min=duration, billable_hours=billable,
                       prepaid_hours=prepaid, fee=fee, balance=repo.wallet(vehicle).balance)
