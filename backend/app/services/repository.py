"""State store.

Reads are served from memory for speed. When FIREBASE_CREDENTIALS is set every
mutation is mirrored to Firestore, which the Next.js dashboards subscribe to with
onSnapshot — that is what makes the dashboards "live" in production.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from collections import defaultdict
from typing import Optional

from app.config import get_settings
from app.data import mock
from app.models import (
    Booking, DetectionEvent, FastagTxn, LotSummary, ParkingLot, Slot, SlotStatus, Violation, Wallet,
)

log = logging.getLogger("slotify.repo")


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8].upper()}"


class FirestoreMirror:
    def __init__(self, credentials_path: str):
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(credentials_path))
        self.db = firestore.client()
        self.server_ts = firestore.SERVER_TIMESTAMP

    def _run(self, fn):
        # Fire-and-forget so request latency never depends on Firestore.
        threading.Thread(target=self._safe, args=(fn,), daemon=True).start()

    @staticmethod
    def _safe(fn):
        try:
            fn()
        except Exception as exc:  # pragma: no cover - network dependent
            log.warning("Firestore write failed: %s", exc)

    def slot(self, lot_id: str, slot: Slot):
        data = {**slot.model_dump(exclude={"id"}, by_alias=False, mode="json"), "updated_at": self.server_ts}
        self._run(lambda: self.db.collection("parking_lots").document(lot_id).collection("slots").document(slot.id).set(data))

    def delete_slot(self, lot_id: str, slot_id: str):
        self._run(lambda: self.db.collection("parking_lots").document(lot_id).collection("slots").document(slot_id).delete())

    def doc(self, collection: str, doc_id: str, data: dict):
        self._run(lambda: self.db.collection(collection).document(doc_id).set(data, merge=True))


class Repository:
    def __init__(self):
        settings = get_settings()
        self.lots: dict[str, ParkingLot] = {l.id: l for l in mock.LOTS}
        self.slots: dict[str, dict[str, Slot]] = {l.id: {s.id: s for s in mock.generate_slots(l)} for l in mock.LOTS}
        self.bookings: dict[str, Booking] = {}
        self.wallets: dict[str, Wallet] = {}
        self.sessions: dict[str, dict] = {}  # vehicle -> {lot_id, slot_id, entry_at}
        self.violations: dict[str, Violation] = {v.id: v for v in mock.seed_violations()}
        self.events: list[DetectionEvent] = []
        self.subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self.lock = threading.RLock()
        self.mirror: Optional[FirestoreMirror] = None
        if settings.firebase_credentials:
            try:
                self.mirror = FirestoreMirror(settings.firebase_credentials)
                log.info("Firestore mirroring enabled")
            except Exception as exc:
                log.warning("Firestore disabled: %s", exc)

    # ---------- lots & slots ----------
    def lot(self, lot_id: str) -> Optional[ParkingLot]:
        return self.lots.get(lot_id)

    def slot_list(self, lot_id: str) -> list[Slot]:
        return sorted(self.slots.get(lot_id, {}).values(), key=lambda s: (s.row, s.col))

    def summary(self, lot_id: str) -> LotSummary:
        counts = {s: 0 for s in SlotStatus}
        for slot in self.slots.get(lot_id, {}).values():
            counts[slot.status] += 1
        total = sum(counts.values())
        usable = total - counts[SlotStatus.maintenance]
        return LotSummary(
            total=total,
            available=counts[SlotStatus.available],
            occupied=counts[SlotStatus.occupied],
            reserved=counts[SlotStatus.reserved],
            maintenance=counts[SlotStatus.maintenance],
            occupancy=round((counts[SlotStatus.occupied] + counts[SlotStatus.reserved]) / usable, 4) if usable else 0.0,
        )

    def set_slot(self, lot_id: str, slot_id: str, **changes) -> Slot:
        with self.lock:
            slot = self.slots[lot_id][slot_id]
            updated = slot.model_copy(update={**changes, "updated_at": now_ms()})
            self.slots[lot_id][slot_id] = updated
        if self.mirror:
            self.mirror.slot(lot_id, updated)
        return updated

    def add_slots(self, lot_id: str, row: str, count: int, slot_type: str) -> list[Slot]:
        with self.lock:
            existing = [s.col for s in self.slots[lot_id].values() if s.row == row]
            start = max(existing, default=0)
            added = []
            for i in range(count):
                s = Slot(id=f"{row}{start + i + 1}", row=row, col=start + i + 1, status=SlotStatus.available, type=slot_type, updated_at=now_ms())
                self.slots[lot_id][s.id] = s
                added.append(s)
        if self.mirror:
            for s in added:
                self.mirror.slot(lot_id, s)
        return added

    def remove_slots(self, lot_id: str, slot_ids: list[str]) -> list[str]:
        removed = []
        with self.lock:
            for sid in slot_ids:
                s = self.slots[lot_id].get(sid)
                if s and s.status not in (SlotStatus.occupied, SlotStatus.reserved):
                    del self.slots[lot_id][sid]
                    removed.append(sid)
        if self.mirror:
            for sid in removed:
                self.mirror.delete_slot(lot_id, sid)
        return removed

    # ---------- detections (pub/sub for SSE) ----------
    def publish(self, event: DetectionEvent):
        self.events = [event, *self.events][:200]
        for q in list(self.subscribers[event.lot_id]) + list(self.subscribers["*"]):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    # ---------- wallets ----------
    def wallet(self, vehicle: str) -> Wallet:
        if vehicle not in self.wallets:
            self.wallets[vehicle] = Wallet(
                vehicle_number=vehicle,
                tag_id=uuid.uuid5(uuid.NAMESPACE_DNS, vehicle).hex[:16].upper(),
                bank="Kovai Co-op Bank FASTag",
                balance=get_settings().starting_balance,
            )
        return self.wallets[vehicle]

    def wallet_txn(self, vehicle: str, kind: str, amount: float, description: str, **extra) -> FastagTxn:
        with self.lock:
            w = self.wallet(vehicle)
            w.balance = round(w.balance + (amount if kind == "credit" else -amount), 2)
            txn = FastagTxn(id=new_id("TX"), kind=kind, amount=amount, description=description, at=now_ms(), balance_after=w.balance, **extra)
            w.txns.insert(0, txn)
        if self.mirror:
            self.mirror.doc("fastag_wallets", vehicle, {"balance": w.balance, "vehicle_number": vehicle, "tag_id": w.tag_id})
            self.mirror.doc(f"fastag_wallets/{vehicle}/transactions", txn.id, txn.model_dump(mode="json"))
        return txn

    def save_booking(self, b: Booking):
        self.bookings[b.id] = b
        if self.mirror:
            self.mirror.doc("bookings", b.id, b.model_dump(mode="json"))

    def save_violation(self, v: Violation):
        self.violations[v.id] = v
        if self.mirror:
            self.mirror.doc("violations", v.id, v.model_dump(mode="json"))


repo = Repository()
