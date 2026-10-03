"""Simulated AI parking detection.

In production each lot runs a YOLO bay classifier on camera frames at the edge and
POSTs state changes to /api/detections. For the demo this worker generates the
same events: realistic transitions that pull each lot towards its base occupancy.
"""
from __future__ import annotations

import asyncio
import logging
import random

from app.data import mock
from app.models import DetectionEvent, SlotStatus
from app.services.repository import new_id, now_ms, repo

log = logging.getLogger("slotify.detector")
rng = random.Random()


def step() -> list[DetectionEvent]:
    events: list[DetectionEvent] = []
    for _ in range(rng.randint(1, 3)):
        lot = rng.choice(list(repo.lots.values()))
        candidates = [s for s in repo.slots[lot.id].values() if s.held_by is None]
        if not candidates:
            continue
        slot = rng.choice(candidates)
        occ = repo.summary(lot.id).occupancy
        too_full, too_empty = occ > lot.base_occupancy + 0.08, occ < lot.base_occupancy - 0.08
        r = rng.random()
        to = None
        if slot.status == SlotStatus.available and not too_full:
            to = SlotStatus.occupied if r < 0.68 else SlotStatus.reserved
        elif slot.status == SlotStatus.reserved:
            to = SlotStatus.occupied if r < 0.72 else SlotStatus.available
        elif slot.status == SlotStatus.occupied and (not too_empty or r < 0.25):
            to = SlotStatus.available
        elif slot.status == SlotStatus.maintenance and r < 0.06:
            to = SlotStatus.available
        if to is None:
            continue
        plate = slot.vehicle_number if (slot.status == SlotStatus.reserved and slot.vehicle_number) else mock.random_plate(rng)
        repo.set_slot(lot.id, slot.id, status=to, vehicle_number=plate if to in (SlotStatus.occupied, SlotStatus.reserved) else None)
        event = DetectionEvent(
            id=new_id("EV"), lot_id=lot.id, slot_id=slot.id, from_=slot.status, to=to,
            camera=rng.choice(mock.CAMERAS), confidence=round(0.9 + rng.random() * 0.095, 3),
            vehicle_number=plate, at=now_ms(),
        )
        repo.publish(event)
        events.append(event)
    return events


async def run(interval: float):
    log.info("AI detection simulator running every %.1fs", interval)
    tick = 0
    while True:
        await asyncio.sleep(interval)
        try:
            step()
            tick += 1
            if tick % 7 == 0:  # an ANPR violation roughly every 20 s
                v = mock.make_violation(rng, 0, 900 + tick)
                repo.save_violation(v.model_copy(update={"id": new_id("VIO-"), "status": "detected", "at": now_ms()}))
        except Exception:  # pragma: no cover
            log.exception("detector step failed")
